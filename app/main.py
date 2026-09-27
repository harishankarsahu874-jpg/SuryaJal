"""SuryaJal - FastAPI backend.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import socket
import time
from contextlib import asynccontextmanager
from typing import List, Literal, Optional, Tuple
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import auth, odisha, stats
from .climate import get_climate
from .config import (APP_NAME, APP_VERSION, CHHATA, DEFAULTS, DISCOMS, FALLBACK_CLIMATE_FILE,
                     MAP_CENTER, MAP_ZOOM, MAX_NATIVE_ZOOM, M_PER_PX_REF_LAT, MODELS_DIR,
                     NOMINATIM_URL, NOMINATIM_VIEWBOX, ODA_DOWNPIPE_MM,
                     ODA_DOWNPIPES_PER_100_M2, ODA_RWH_L_PER_M2, ODA_RWH_PLOT_MIN_M2,
                     ODA_RECHARGE_PLOT_MIN_M2, OERC_DUTY_PCT, OERC_EXPORT_FIT,
                     OERC_FIXED_CHARGE_PER_KW, OERC_MAX_NM_KW, OERC_NET_METER_CAP,
                     ROOF_TYPES, SEG_CROP_PX, SITE_DIR, SOURCES, STATE, STATIC_DIR,
                     TARIFF_FY, USER_AGENT)
from .geo import (decode_polyline, encode_polyline, latlon_to_px, polygon_area_m2,
                  polygon_centroid, polygon_perimeter_m, px_to_latlon)
from .layout import auto_layout
from .rain import RULE_NAME, RULE_SHORT, assess_rain, green_score
from .report import build_report_pdf, qr_svg, roof_thumbnail
from .segment import RoofSegmenter, mask_to_polygon
from .solar import assess_solar, odisha_state_subsidy, pm_surya_ghar_subsidy
from .tariff import TARIFF_LABEL, monthly_bill, slab_table
from .tiles import TileFetcher

state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    auth.init_db()
    state["tiles"] = TileFetcher()
    state["http"] = httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=20.0)
    state["seg"] = RoofSegmenter(MODELS_DIR)
    # warm the ONNX graph in the background so the first tap is fast
    asyncio.get_running_loop().run_in_executor(None, state["seg"].warmup)
    yield
    await state["tiles"].close()
    await state["http"].aclose()
    state.clear()                     # release the ONNX sessions


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(auth.router)


# ------------------------------------------------------------------ models
class SegPoint(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, le=180)
    label: int = Field(1, ge=0, le=1)


class SegmentIn(BaseModel):
    points: List[SegPoint] = Field(min_length=1, max_length=20)
    zoom: int = Field(19, ge=12, le=23)
    engine: Literal["auto", "opencv"] = "auto"


class AssessIn(BaseModel):
    polygon: List[Tuple[float, float]] = Field(min_length=3, max_length=600)
    monthly_units: float = Field(DEFAULTS["monthly_units"], ge=0, le=100000)
    family_size: int = Field(DEFAULTS["family_size"], ge=1, le=100)
    roof_type: str = DEFAULTS["roof_type"]
    usable_fraction: float = Field(DEFAULTS["usable_fraction"], ge=0.05, le=1.0)
    # None (or 0) = bill with the OERC domestic slabs for the units you enter
    tariff: Optional[float] = Field(DEFAULTS["tariff"], ge=0, le=50)
    sanctioned_load_kw: float = Field(DEFAULTS["sanctioned_load_kw"], ge=0, le=500)
    floors: int = Field(DEFAULTS["floors"], ge=1, le=30)
    cost_per_kw: float = Field(DEFAULTS["cost_per_kw"], ge=10000, le=300000)
    panel_w: int = Field(DEFAULTS["panel_w"], ge=100, le=800)
    subsidy: bool = DEFAULTS["subsidy"]                   # PM Surya Ghar (central)
    state_subsidy: bool = DEFAULTS["state_subsidy"]       # Odisha SFA on top of it
    export_rate: Optional[float] = Field(None, ge=0, le=20)   # None = OERC feed-in tariff
    net_meter_cap: float = Field(DEFAULTS["net_meter_cap"], ge=0, le=1)
    tanker_price: float = Field(DEFAULTS["tanker_price"], ge=0, le=20000)
    design_rain_mm: float = Field(DEFAULTS["design_rain_mm"], ge=5, le=300)
    rwh_l_per_m2: float = Field(DEFAULTS["rwh_l_per_m2"], ge=0, le=1000)   # ODA Rules: 60
    chhata: bool = DEFAULTS["chhata"]                     # Odisha CHHATA rainwater subsidy
    rrhs_cost_per_m2: float = Field(DEFAULTS["rrhs_cost_per_m2"], ge=0, le=100000)
    rain_override_mm: Optional[float] = Field(None, ge=50, le=12000)
    panels: Optional[int] = Field(None, ge=0, le=400)     # user-chosen panel count (None = auto)

    @field_validator("roof_type")
    @classmethod
    def _rt(cls, v):
        return v if v in ROOF_TYPES else "other"

    @field_validator("polygon")
    @classmethod
    def _poly(cls, v):
        for lat, lon in v:
            if not (-85 <= lat <= 85 and -180 <= lon <= 180):
                raise ValueError("polygon coordinates out of range")
        return v


# ------------------------------------------------------------------ core
async def run_assessment(req: AssessIn) -> dict:
    poly = [(float(a), float(b)) for a, b in req.polygon]
    area = polygon_area_m2(poly)
    if area < 4:
        raise HTTPException(422, "Roof polygon is too small (under 4 m²).")
    if area > 200000:
        raise HTTPException(422, "Polygon is larger than 20 hectares - please outline one roof.")
    clat, clon = polygon_centroid(poly)
    params = {**DEFAULTS, **req.model_dump(exclude={"polygon"})}
    try:
        climate = await get_climate(clat, clon, state.get("http"))
    except Exception:
        raise HTTPException(503, "Climate data unavailable (offline and no cached data).")
    layout = await run_in_threadpool(auto_layout, poly, None, params)
    solar = assess_solar(area, climate, params, layout_max_panels=layout["max_panels"])
    rain = assess_rain(area, climate, params)
    score = green_score(solar["coverage"], rain["coverage"], solar["panels"] > 0,
                        rain["meets_rule"])
    panels = layout["panels"][: solar["panels"]][:400]
    rid = hashlib.sha1(json.dumps([encode_polyline(poly), params], sort_keys=True,
                                  default=str).encode()).hexdigest()[:8].upper()
    ghi_avg = sum(climate["ghi"]) / 12
    place = odisha.locate(clat, clon)
    return {
        "report_id": rid,
        "area_m2": area,
        "perimeter_m": polygon_perimeter_m(poly),
        "centroid": [clat, clon],
        "polygon": poly,
        "location": {**place, "in_odisha": odisha.in_odisha(clat, clon),
                     "discoms": DISCOMS, "state": STATE},
        "climate": {**climate, "ghi_avg": ghi_avg,
                    "short_source": "Offline climate data" if climate.get("offline")
                    else "NASA POWER climatology"},
        "solar": solar,
        "rain": rain,
        "score": score,
        "layout": {"panels": panels, "max_panels": layout["max_panels"],
                   "orientation": layout.get("orientation"), "angle": layout.get("angle")},
        "params": params,
    }


# ------------------------------------------------------------------ health + specs (used by the loader)
_spec_cache: dict = {}


def _static_specs() -> dict:
    if not _spec_cache:
        size = sum((MODELS_DIR / f).stat().st_size for f in
                   ("mobile_sam_image_encoder.onnx", "sam_mask_decoder_multi.onnx")
                   if (MODELS_DIR / f).exists())
        try:
            cities = len(json.loads(FALLBACK_CLIMATE_FILE.read_text())["cities"])
        except Exception:
            cities = 0
        _spec_cache.update({
            "model_mb": round(size / 1e6, 1),
            "state": {"name": STATE, "capital": "Bhubaneswar", "map_center": MAP_CENTER,
                      "map_zoom": MAP_ZOOM, "discoms": len(DISCOMS),
                      "districts": len(odisha.points())},
            "imagery": {"source": "Esri World Imagery", "max_zoom": MAX_NATIVE_ZOOM,
                        "m_per_px": round(156543.03392 * math.cos(math.radians(M_PER_PX_REF_LAT))
                                          / 2 ** MAX_NATIVE_ZOOM, 2)},
            "climate": {"source": "NASA POWER", "period": "2001-2020",
                        "offline_cities": len(odisha.points())},
            "solar": {"scheme": "PM Surya Ghar + Odisha SFA",
                      "max_subsidy": pm_surya_ghar_subsidy(3.0) + odisha_state_subsidy(3.0),
                      "central_max": pm_surya_ghar_subsidy(3.0),
                      "state_max": odisha_state_subsidy(3.0),
                      "tariff": None, "tariff_label": TARIFF_LABEL,
                      "tariff_slabs": slab_table(), "fixed_charge_per_kw": OERC_FIXED_CHARGE_PER_KW,
                      "duty_pct": OERC_DUTY_PCT, "tariff_fy": TARIFF_FY,
                      "export_rate": OERC_EXPORT_FIT, "net_meter_cap": OERC_NET_METER_CAP,
                      "max_nm_kw": OERC_MAX_NM_KW,
                      "m2_per_kw": DEFAULTS["m2_per_kw"], "panel_w": DEFAULTS["panel_w"],
                      "co2_kg_per_kwh": DEFAULTS["co2_kg_per_kwh"]},
            "water": {"rule": RULE_SHORT, "rule_full": RULE_NAME,
                      "l_per_m2": ODA_RWH_L_PER_M2,
                      "mandate_plot_m2": ODA_RWH_PLOT_MIN_M2,
                      "recharge_plot_m2": ODA_RECHARGE_PLOT_MIN_M2,
                      "downpipes_per_100_m2": ODA_DOWNPIPES_PER_100_M2,
                      "downpipe_mm": ODA_DOWNPIPE_MM,
                      "chhata": CHHATA,
                      "lpcd": DEFAULTS["lpcd"], "roof_types": len(ROOF_TYPES)},
        })
    return _spec_cache


@app.get("/api/health")
async def health():
    seg: RoofSegmenter = state["seg"]
    sp = _static_specs()
    return {"ok": True, "app": APP_NAME, "version": APP_VERSION,
            "engine": seg.method, "note": seg.load_error,
            "ready": seg.method != "mobilesam" or seg.warm,
            "specs": {"model": {"name": "MobileSAM (Segment Anything)" if seg.method == "mobilesam"
                                else "OpenCV fallback", "runtime": "ONNX Runtime · CPU",
                                "size_mb": sp["model_mb"], "warm": seg.warm, "crop_px": SEG_CROP_PX},
                      **{k: sp[k] for k in ("state", "imagery", "climate", "solar", "water")}}}


@app.get("/api/config")
async def config():
    seg: RoofSegmenter = state["seg"]
    sp = _static_specs()
    return {"defaults": DEFAULTS, "roof_types": ROOF_TYPES, "sources": SOURCES,
            "odisha": {"state": STATE, "capital": "Bhubaneswar",
                       "map_center": MAP_CENTER, "map_zoom": MAP_ZOOM,
                       "discoms": DISCOMS, "tariff": sp["solar"], "water": sp["water"],
                       "towns": odisha.odisha_table()},
            "engine": seg.method, "engine_note": seg.load_error, "version": APP_VERSION}


@app.get("/api/odisha/table")
async def odisha_table():
    """Sunlight + rainfall + DISCOM for every district HQ in Odisha (bundled NASA POWER)."""
    rows = odisha.odisha_table()
    return {"state": STATE, "count": len(rows), "discoms": DISCOMS,
            "source": "NASA POWER 2001-2020 climatology, bundled offline", "rows": rows}


@app.get("/api/odisha/locate")
async def odisha_locate(lat: float = Query(..., ge=-85, le=85),
                        lon: float = Query(..., ge=-180, le=180)):
    """Which district and which Odisha DISCOM serves this point."""
    loc = odisha.locate(lat, lon)
    loc["in_odisha"] = odisha.in_odisha(lat, lon)
    return loc


@app.get("/api/odisha/tariff")
async def odisha_tariff(units: float = Query(DEFAULTS["monthly_units"], ge=0, le=100000),
                        load_kw: float = Query(DEFAULTS["sanctioned_load_kw"], ge=0, le=500)):
    """Itemised OERC domestic bill - what your rooftop solar is competing with."""
    return {"fy": TARIFF_FY, "slabs": slab_table(), "label": TARIFF_LABEL,
            "fixed_charge_per_kw": OERC_FIXED_CHARGE_PER_KW, "duty_pct": OERC_DUTY_PCT,
            "bill": monthly_bill(units, load_kw)}


@app.get("/api/stats")
async def get_stats():
    return stats.summary()


@app.get("/api/net")
async def net(request: Request):
    """This machine's LAN IPv4 addresses + port, so the report QR and share links work
    when SuryaJal runs on a PC and a phone on the same Wi-Fi/hotspot scans them
    (the frontend only asks for this when the site itself is opened on localhost)."""
    ips: List[str] = []
    try:  # preferred: the address on the default route (no packet is actually sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s_:
            s_.connect(("10.255.255.255", 1))
            ips.append(s_.getsockname()[0])
    except OSError:
        pass
    try:  # fallback/companion: every IPv4 of the host, loopback dropped
        for _fam, _typ, _proto, _canon, sa in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = sa[0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    return {"ips": ips[:6], "port": port}


# ------------------------------------------------------------------ geocoding (Nominatim proxy)
_geo_lock = asyncio.Lock()
_geo_last = [0.0]
_geo_cache: dict = {}


async def _nominatim(path: str, params: dict):
    key = path + json.dumps(params, sort_keys=True)
    if key in _geo_cache:
        return _geo_cache[key]
    async with _geo_lock:                      # Nominatim policy: max 1 request / second
        wait = 1.05 - (time.monotonic() - _geo_last[0])
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            r = await state["http"].get(NOMINATIM_URL.replace("/search", path),
                                        params={**params, "format": "jsonv2"},
                                        headers={"Accept-Language": "en"})
        finally:
            _geo_last[0] = time.monotonic()
    if r.status_code != 200:
        raise HTTPException(502, "Place search is unavailable right now.")
    data = r.json()
    if len(_geo_cache) > 500:
        _geo_cache.clear()
    _geo_cache[key] = data
    return data


@app.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=2, max_length=200)):
    # SuryaJal serves Odisha: bias (and limit) place search to the State.
    try:
        data = await _nominatim("/search", {"q": q, "limit": 6, "addressdetails": 0,
                                            "countrycodes": "in",
                                            "viewbox": NOMINATIM_VIEWBOX, "bounded": 0})
    except httpx.HTTPError:
        raise HTTPException(503, "Place search needs internet - you can still pan the map.")
    out = []
    for d in data:
        name = d.get("display_name", "")
        if ", India" in name and not any(t in name for t in (", Odisha", "Odisha,")):
            continue                       # outside the State: skip it
        out.append({"name": name, "lat": float(d["lat"]), "lon": float(d["lon"]),
                    "type": d.get("type", ""),
                    **{k: v for k, v in odisha.locate(float(d["lat"]), float(d["lon"])).items()
                       if k in ("district", "discom")}})
    if not out and data:                   # nothing in Odisha matched - show what we found
        out = [{"name": d.get("display_name", ""), "lat": float(d["lat"]),
                "lon": float(d["lon"]), "type": d.get("type", ""),
                "district": None, "discom": None} for d in data[:3]]
    return out


@app.get("/api/reverse")
async def reverse(lat: float = Query(..., ge=-85, le=85), lon: float = Query(..., ge=-180, le=180)):
    try:
        d = await _nominatim("/reverse", {"lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "zoom": 17,
                                          "addressdetails": 1})
    except (httpx.HTTPError, HTTPException):
        return {"name": ""}
    a = d.get("address", {}) if isinstance(d, dict) else {}
    parts = [a.get("road"), a.get("neighbourhood") or a.get("suburb") or a.get("quarter"),
             a.get("city") or a.get("town") or a.get("village") or a.get("county")]
    seen, out = set(), []
    for p_ in parts:
        if p_ and p_ not in seen:
            seen.add(p_)
            out.append(p_)
    name = ", ".join(out) or (d.get("display_name", "") if isinstance(d, dict) else "")
    return {"name": name}


# ------------------------------------------------------------------ AI roof segmentation
@app.post("/api/segment")
async def segment(req: SegmentIn):
    seg: RoofSegmenter = state["seg"]
    anchor = req.points[0]
    crop = await state["tiles"].crop_around(anchor.lat, anchor.lon, req.zoom, SEG_CROP_PX)
    if crop is None or crop["bad"] > 0.5:
        raise HTTPException(503, "Satellite imagery is not available here (or you are offline). "
                                 "Use ‘Draw manually’ instead.")
    z, gx0, gy0 = crop["z"], crop["gx0"], crop["gy0"]
    pts, labels = [], []
    for p_ in req.points:
        x, y = latlon_to_px(p_.lat, p_.lon, z)
        x, y = x - gx0, y - gy0
        if 0 <= x < SEG_CROP_PX and 0 <= y < SEG_CROP_PX:
            pts.append((x, y))
            labels.append(p_.label)
    if not pts or labels[0] != 1:
        raise HTTPException(422, "Tap inside the roof first.")
    res = await run_in_threadpool(seg.segment, crop["img"], pts, labels, ("crop", z, gx0, gy0),
                                  req.engine == "opencv")
    poly_px, touches = mask_to_polygon(res["mask"])
    if poly_px is None:
        return {"ok": False, "message": "No roof found at that spot - tap the middle of the roof, "
                                        "or use ‘Draw manually’."}
    ll = [px_to_latlon(gx0 + x, gy0 + y, z) for x, y in poly_px]
    area = polygon_area_m2(ll)
    warnings = []
    if touches:
        warnings.append("The outline reaches the edge of the AI view, so the roof may be bigger. "
                        "Zoom out one step and tap again, or drag the corners.")
    if area < 12:
        warnings.append("That looks too small for a roof (a water tank or car?). "
                        "Tap the middle of the roof.")
    return {"ok": True, "polygon": [[round(a, 7), round(b, 7)] for a, b in ll], "area_m2": area,
            "method": res["method"], "score": res["score"], "zoom": z, "ms": res["ms"],
            "cached": res["cached_embedding"], "warnings": warnings}


# ------------------------------------------------------------------ assessment
@app.post("/api/assess")
async def assess(req: AssessIn):
    return JSONResponse(await run_assessment(req))


# ------------------------------------------------------------------ report (stateless GET)
def _public_base(request: Request) -> str:
    h = request.headers
    host = h.get("x-forwarded-host") or h.get("host") or request.url.netloc
    proto = h.get("x-forwarded-proto") or request.url.scheme
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}"


def _assess_from_query(q) -> Tuple[AssessIn, dict]:
    if "p" not in q:
        raise HTTPException(422, "Missing roof polygon (p).")
    try:
        poly = decode_polyline(q["p"])
    except ValueError:
        raise HTTPException(422, "Bad polygon encoding.")

    def num(k, cast=float):
        return cast(q[k]) if k in q and q[k] != "" else None

    fields = {"polygon": poly, "monthly_units": num("u"), "family_size": num("f", int),
              "floors": num("fl", int), "roof_type": q.get("rt"),
              "usable_fraction": (num("uf") / 100) if num("uf") else None,
              "tariff": num("t"), "sanctioned_load_kw": num("sl"),
              "cost_per_kw": num("c"), "panel_w": num("pw", int),
              "subsidy": (q.get("s", "1") != "0"), "state_subsidy": (q.get("ss", "1") != "0"),
              "export_rate": num("ex"), "net_meter_cap": num("nc"),
              "tanker_price": num("tp"), "design_rain_mm": num("dr"),
              "rwh_l_per_m2": num("rl"), "chhata": (q.get("ch", "1") != "0"),
              "rrhs_cost_per_m2": num("rc"),
              "rain_override_mm": num("rn"), "panels": num("n", int)}
    fields = {k: v for k, v in fields.items() if v is not None}
    try:
        req = AssessIn(**fields)
    except Exception as e:
        raise HTTPException(422, f"Invalid parameters: {e}")
    meta = {"address": q.get("a", "")[:140], "method": q.get("m", "manual"),
            "conf": q.get("cf", "")}
    return req, meta


@app.get("/r")
@app.get("/api/report")
async def report(request: Request):
    q = dict(request.query_params)
    req, meta = _assess_from_query(q)
    a = await run_assessment(req)
    try:
        crop = await state["tiles"].crop_bbox(a["polygon"])
    except Exception:
        crop = None
    thumb = await run_in_threadpool(roof_thumbnail, crop, a["polygon"], a["layout"]["panels"])
    share_q = {k: v for k, v in q.items() if k not in ("dl",)}
    share_url = f"{_public_base(request)}/app?{httpx.QueryParams(share_q)}"
    if meta["method"] == "ai":
        conf = f", confidence {float(meta['conf']):.2f}" if meta["conf"] else ""
        method_label = f"AI - MobileSAM (Segment Anything){conf}"
    else:
        method_label = "drawn by hand on satellite map"
    pdf = await run_in_threadpool(build_report_pdf, a, thumb, share_url,
                                  meta["address"], method_label)
    stats.record(a["report_id"], a["solar"]["kw"], a["rain"]["annual_harvest_l"],
                 a["solar"]["co2_t_year"])
    disp = "attachment" if q.get("dl") == "1" else "inline"
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'{disp}; filename="SuryaJal_Green_Roof_Report_{a["report_id"]}.pdf"',
        "Cache-Control": "no-store"})


@app.get("/api/qr.svg")
async def qr(data: str = Query(..., min_length=1, max_length=2000)):
    svg = await run_in_threadpool(qr_svg, data, 180)
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ roof photo with panel layout
@app.get("/api/thumb")
async def thumb(request: Request, size: int = Query(560, ge=200, le=900)):
    q = dict(request.query_params)
    req, _ = _assess_from_query(q)
    a = await run_assessment(req)
    try:
        crop = await state["tiles"].crop_bbox(a["polygon"])
    except Exception:
        crop = None
    img = await run_in_threadpool(roof_thumbnail, crop, a["polygon"], a["layout"]["panels"], size)
    if img is None:
        raise HTTPException(503, "Satellite imagery is not available right now.")
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=84, optimize=True)
    return Response(buf.getvalue(), media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"})


# ------------------------------------------------------------------ "My roofs" (signed-in users)
class SaveRoofIn(BaseModel):
    query: str = Field(..., min_length=3, max_length=4000)
    title: str = Field("", max_length=140)


def _roof_summary(a: dict, meta: dict) -> dict:
    s, r, g = a["solar"], a["rain"], a["score"]
    return {"report_id": a["report_id"], "area_m2": round(a["area_m2"], 1), "kw": s["kw"],
            "panels": s["panels"], "annual_gen": round(s["annual_gen"]),
            "annual_savings": round(s["annual_savings"]), "net_cost": round(s["net_cost"]),
            "payback_years": s["payback_years"], "irr": s["irr"],
            "co2_t_year": round(s["co2_t_year"], 2), "annual_harvest_l": round(r["annual_harvest_l"]),
            "tank_l": r["tank"]["litres"], "score": g["score"], "grade": g["grade"],
            "method": meta["method"], "centroid": a["centroid"]}


@app.get("/api/roofs")
def roofs_list(user: dict = Depends(auth.current_user)):
    return {"roofs": auth.list_roofs(user["id"])}


@app.post("/api/roofs", status_code=201)
async def roofs_save(body: SaveRoofIn, user: dict = Depends(auth.current_user)):
    q = dict(parse_qsl(body.query.lstrip("?")))
    q.pop("dl", None)
    req, meta = _assess_from_query(q)
    a = await run_assessment(req)
    title = (body.title.strip() or meta["address"] or f"Roof #{a['report_id']}")[:140]
    roof = await run_in_threadpool(auth.save_roof, user["id"], q["p"], urlencode(q), title,
                                   _roof_summary(a, meta))
    return {"roof": roof}


@app.delete("/api/roofs/{roof_id}")
def roofs_delete(roof_id: int, user: dict = Depends(auth.current_user)):
    if not auth.delete_roof(user["id"], roof_id):
        raise HTTPException(404, "Roof not found.")
    return {"ok": True}


# ------------------------------------------------------------------ pages (React site + classic tool)
CLASSIC_HTML = STATIC_DIR / "index.html"
SPA_ROUTES = {"", "app", "login", "signup", "account", "demo"}


@app.get("/classic", include_in_schema=False)
async def classic():
    """The original single-page tool (vanilla JS) - kept as a no-build fallback."""
    return FileResponse(CLASSIC_HTML, headers={"Cache-Control": "no-cache"})


@app.get("/{path:path}", include_in_schema=False)
async def site(path: str, request: Request):
    clean = path.strip("/")
    if clean == "api" or clean.startswith("api/"):
        raise HTTPException(404, "Not found")
    if clean == "" and "p" in request.query_params:            # old share links: /?p=...
        return RedirectResponse(f"/app?{request.url.query}", status_code=307)
    root = SITE_DIR.resolve()
    if clean:
        f = (root / clean).resolve()
        if f.is_file() and root in f.parents:
            cache = ("public, max-age=31536000, immutable" if clean.startswith("assets/")
                     else "public, max-age=3600")
            return FileResponse(f, headers={"Cache-Control": cache})
    index = root / "index.html"
    if not index.exists():                                      # site not built -> classic tool
        return FileResponse(CLASSIC_HTML, headers={"Cache-Control": "no-cache"})
    return FileResponse(index, status_code=200 if clean in SPA_ROUTES else 404,
                        headers={"Cache-Control": "no-cache"})
