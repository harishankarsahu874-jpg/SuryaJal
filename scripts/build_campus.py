"""Builds data/campus_nist.json - the NIST University campus layer for the map
(Institute Park, Palur Hills, Golanthara, Berhampur/Brahmapur, Odisha).

Why this exists: OpenStreetMap has no NIST campus at all (no campus outline, no named
building - checked Nov 2026), so neither place search nor the AI roof detector knows the
campus. The building outlines here come from Overture Maps (Google Open Buildings,
Microsoft ML footprints and OpenStreetMap, ODbL) and the section names from the curated
table scripts/campus_nist_sections.json, checked against the 7 Jan 2026 Vantor imagery
(0.34 m) that Esri World Imagery shows over the campus.

    pip install overturemaps pillow requests
    python scripts/build_campus.py fetch     # internet: Overture buildings + places, OSM, Esri tiles
    python scripts/build_campus.py preview   # imagery with numbered outlines (for naming sections)
    python scripts/build_campus.py build     # names table + outlines -> data/campus_nist.json

`fetch` and `preview` write to scripts/campus_raw/ (scratch, not needed by the app).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "scripts" / "campus_raw"
TILES = Path("/tmp/suryajal_campus_tiles")
SECTIONS = ROOT / "scripts" / "campus_nist_sections.json"
OUT = ROOT / "data" / "campus_nist.json"

# NIST University and its surroundings (W, S, E, N) - generous: the campus is ~65 acres
W, S, E, N = 84.7385, 19.1920, 84.7550, 19.2045
CENTER = (19.1982, 84.7466)               # Esri World Geocoder: "National Institute of Science and Technology"
ESRI_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
PLACEHOLDER_MAX_BYTES = 3000              # Esri's grey "Map data not yet available" tile (same rule as app/tiles.py)
UA = "SuryaJal-campus-builder/1.0 (+https://github.com/harishankarsahu874-jpg/SuryaJal)"


# ---------------------------------------------------------------------------- geometry
def gx(lon: float, z: int) -> float:
    """Global Web-Mercator pixel x at zoom z (256 px tiles)."""
    return (lon + 180.0) / 360.0 * (256 << z)


def gy(lat: float, z: int) -> float:
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (256 << z)


def rings_of(geom: dict) -> list[list[list[float]]]:
    """Outer rings ([lon, lat] lists) of a Polygon / MultiPolygon."""
    if not geom:
        return []
    if geom.get("type") == "Polygon":
        return [geom["coordinates"][0]]
    if geom.get("type") == "MultiPolygon":
        return [p[0] for p in geom["coordinates"]]
    return []


def ring_area_m2(ring: list[list[float]]) -> float:
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111_320 * math.cos(lat0), 110_574
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(a) / 2


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """(lon, lat) area centroid - falls back to the vertex mean for slivers."""
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-14:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    return (cx / (3 * a), cy / (3 * a))


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def prop(p: dict, key: str):
    """Overture GeoJSON export keeps struct columns either nested or as JSON text."""
    v = p.get(key)
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def primary_name(p: dict) -> str:
    names = prop(p, "names")
    if isinstance(names, dict):
        return names.get("primary") or ""
    return p.get("names.primary") or p.get("name") or ""


def source_names(p: dict) -> list[str]:
    src = prop(p, "sources") or []
    out = []
    for s in src if isinstance(src, list) else []:
        if isinstance(s, dict) and s.get("dataset") and s["dataset"] not in out:
            out.append(s["dataset"])
    return out


# ---------------------------------------------------------------------------- fetch
def overture(kind: str, out: Path) -> None:
    print(f"overture {kind} ...", flush=True)
    t = time.time()
    subprocess.run(["overturemaps", "download", f"--bbox={W},{S},{E},{N}", "-f", "geojson",
                    "-t", kind, "-o", str(out)], check=True)
    n = len(json.loads(out.read_text()).get("features", []))
    print(f"  {n} {kind} features in {time.time() - t:.0f}s", flush=True)


def osm(out: Path) -> None:
    import requests

    q = (f"[out:json][timeout:120];(way({S},{W},{N},{E});node({S},{W},{N},{E})[name];"
         f"relation({S},{W},{N},{E})[type=multipolygon];);out tags geom;")
    for url in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
                "https://maps.mail.ru/osm/tools/overpass/api/interpreter"):
        try:
            r = requests.post(url, data={"data": q}, headers={"User-Agent": UA}, timeout=180)
            r.raise_for_status()
            data = r.json()
            out.write_text(json.dumps(data))
            print(f"osm: {len(data.get('elements', []))} elements from {url}", flush=True)
            return
        except Exception as exc:                     # noqa: BLE001 - try the next mirror
            print(f"osm: {url} failed: {exc}", flush=True)


def tiles(z: int) -> dict:
    """Download every Esri tile of the area at zoom z -> {"x0","y0","nx","ny","placeholders"}."""
    import requests

    x0, x1 = int(gx(W, z) // 256), int(gx(E, z) // 256)
    y0, y1 = int(gy(N, z) // 256), int(gy(S, z) // 256)
    TILES.mkdir(parents=True, exist_ok=True)
    sess = requests.Session()
    sess.headers["User-Agent"] = UA
    placeholders = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            f = TILES / f"{z}_{x}_{y}.jpg"
            if not f.exists():
                for attempt in range(3):
                    try:
                        r = sess.get(ESRI_TILE.format(z=z, x=x, y=y), timeout=30)
                        r.raise_for_status()
                        f.write_bytes(r.content)
                        break
                    except Exception as exc:         # noqa: BLE001
                        print(f"tile {z}/{x}/{y}: {exc}", flush=True)
                        time.sleep(1 + attempt)
            if f.exists() and f.stat().st_size <= PLACEHOLDER_MAX_BYTES:
                placeholders += 1
    info = {"z": z, "x0": x0, "y0": y0, "nx": x1 - x0 + 1, "ny": y1 - y0 + 1, "placeholders": placeholders}
    print(f"tiles z{z}: {info['nx']}x{info['ny']}, {placeholders} placeholder(s)", flush=True)
    return info


def cmd_fetch(_args) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    overture("building", RAW / "buildings.geojson")
    overture("place", RAW / "places.geojson")
    try:
        overture("land_use", RAW / "land_use.geojson")
    except subprocess.CalledProcessError as exc:
        print("land_use failed:", exc)
    osm(RAW / "osm.json")
    info = {str(z): tiles(z) for z in (16, 17, 18)}
    # does Esri have anything sharper than z18 over the campus? (it sends a grey placeholder if not)
    import requests
    z = 19
    cx, cy = int(gx(CENTER[1], z) // 256), int(gy(CENTER[0], z) // 256)
    sizes = []
    for dx, dy in ((0, 0), (1, 0), (0, 1), (-3, 2), (4, -3)):
        r = requests.get(ESRI_TILE.format(z=z, x=cx + dx, y=cy + dy), headers={"User-Agent": UA}, timeout=30)
        sizes.append(len(r.content))
    info["z19_probe_bytes"] = sizes
    (RAW / "tiles.json").write_text(json.dumps(info, indent=1))
    print("z19 probe sizes:", sizes)


# ---------------------------------------------------------------------------- preview
def _font(size: int):
    from PIL import ImageFont

    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def mosaic(z: int):
    from PIL import Image

    info = json.loads((RAW / "tiles.json").read_text())[str(z)]
    img = Image.new("RGB", (info["nx"] * 256, info["ny"] * 256), (40, 40, 40))
    for i in range(info["nx"]):
        for j in range(info["ny"]):
            f = TILES / f"{z}_{info['x0'] + i}_{info['y0'] + j}.jpg"
            if f.exists() and f.stat().st_size > PLACEHOLDER_MAX_BYTES:
                img.paste(Image.open(io.BytesIO(f.read_bytes())).convert("RGB"), (i * 256, j * 256))
    ox, oy = info["x0"] * 256, info["y0"] * 256
    return img, (lambda lon, lat: (gx(lon, z) - ox, gy(lat, z) - oy))


def load_buildings() -> list[dict]:
    feats = json.loads((RAW / "buildings.geojson").read_text()).get("features", [])
    rows = []
    for f in feats:
        p = f.get("properties") or {}
        for ring in rings_of(f.get("geometry")):
            if len(ring) < 4:
                continue
            rows.append({"id": p.get("id") or f.get("id"), "ring": ring, "area": ring_area_m2(ring[:-1]),
                         "name": primary_name(p), "height": p.get("height"), "floors": p.get("num_floors"),
                         "sources": source_names(p), "class": p.get("class")})
    rows.sort(key=lambda r: -r["area"])
    for i, r in enumerate(rows, 1):
        r["idx"] = i
        r["c"] = ring_centroid(r["ring"][:-1])
    return rows


def load_places() -> list[dict]:
    feats = json.loads((RAW / "places.geojson").read_text()).get("features", [])
    out = []
    for f in feats:
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        cats = prop(p, "categories") or {}
        out.append({"name": primary_name(p), "lon": g["coordinates"][0], "lat": g["coordinates"][1],
                    "category": cats.get("primary") if isinstance(cats, dict) else None,
                    "confidence": p.get("confidence"), "sources": source_names(p)})
    return out


SRC_COLOURS = {"Google Open Buildings": (255, 214, 0), "Microsoft ML Buildings": (0, 220, 255),
               "OpenStreetMap": (255, 60, 220), "Esri Community Maps": (255, 140, 0)}


def draw_overlay(img, proj, buildings, places, z: int, labels: bool = True):
    from PIL import ImageDraw

    d = ImageDraw.Draw(img, "RGBA")
    # 0.001 deg grid (~105 m) with labels, to read coordinates off the picture
    f_grid = _font(14 if z >= 18 else 11)
    lat = math.floor(S * 1000) / 1000
    while lat <= N:
        _, y = proj(W, lat)
        d.line([(0, y), (img.width, y)], fill=(255, 255, 255, 70), width=1)
        d.text((4, y + 2), f"{lat:.3f}", fill=(255, 255, 255, 230), font=f_grid, stroke_width=2, stroke_fill=(0, 0, 0))
        lat += 0.001
    lon = math.floor(W * 1000) / 1000
    while lon <= E:
        x, _ = proj(lon, S)
        d.line([(x, 0), (x, img.height)], fill=(255, 255, 255, 70), width=1)
        d.text((x + 3, 4), f"{lon:.3f}", fill=(255, 255, 255, 230), font=f_grid, stroke_width=2, stroke_fill=(0, 0, 0))
        lon += 0.001
    f_lab = _font(18 if z >= 18 else 12)
    for b in buildings:
        pts = [proj(x, y) for x, y in b["ring"]]
        col = SRC_COLOURS.get(b["sources"][0] if b["sources"] else "", (255, 255, 255))
        d.line(pts, fill=col + (255,), width=2 if z >= 18 else 1)
        if labels and (z >= 18 or b["area"] >= 150):
            x, y = proj(*b["c"])
            d.text((x, y), str(b["idx"]), fill=(255, 255, 255), font=f_lab, anchor="mm",
                   stroke_width=3, stroke_fill=(0, 0, 0))
    f_pl = _font(15 if z >= 18 else 11)
    for p in places:
        x, y = proj(p["lon"], p["lat"])
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 40, 40, 255), outline=(255, 255, 255))
        if p["name"]:
            d.text((x + 8, y - 8), p["name"][:38], fill=(255, 235, 235), font=f_pl,
                   stroke_width=2, stroke_fill=(90, 0, 0))


def cmd_preview(_args) -> None:
    buildings, places = load_buildings(), load_places()
    print(f"{len(buildings)} building outlines, {len(places)} places")
    (RAW / "buildings_index.json").write_text(json.dumps([
        {k: (round(v, 1) if k == "area" else v) for k, v in b.items() if k != "ring"} for b in buildings
    ], indent=1))
    (RAW / "places_index.json").write_text(json.dumps(places, indent=1))
    for z in (17, 18):
        img, proj = mosaic(z)
        img.save(RAW / f"z{z}_plain.jpg", quality=88)
        draw_overlay(img, proj, buildings, places, z)
        img.save(RAW / f"z{z}_overlay.jpg", quality=86)
        if z == 18:                                   # quarters at full resolution, easier to read
            w, h = img.size
            for name, box in {"nw": (0, 0, w // 2 + 150, h // 2 + 150), "ne": (w // 2 - 150, 0, w, h // 2 + 150),
                              "sw": (0, h // 2 - 150, w // 2 + 150, h), "se": (w // 2 - 150, h // 2 - 150, w, h)}.items():
                img.crop(box).save(RAW / f"z18_overlay_{name}.jpg", quality=86)
    print("previews written to", RAW)


# ---------------------------------------------------------------------------- build
def cmd_build(_args) -> None:
    spec = json.loads(SECTIONS.read_text())
    by_id = {}
    if (RAW / "buildings.geojson").exists():
        for f in json.loads((RAW / "buildings.geojson").read_text()).get("features", []):
            p = f.get("properties") or {}
            rings = rings_of(f.get("geometry"))
            if rings:
                by_id[p.get("id") or f.get("id")] = {"ring": max(rings, key=lambda r: ring_area_m2(r[:-1])),
                                                     "sources": source_names(p)}
    out_b = []
    used_sources: set[str] = set()
    for s in spec["buildings"]:
        if "ring" in s:                               # traced by hand from the imagery: [[lat, lon], ...]
            ring = [[lon, lat] for lat, lon in s["ring"]]
            srcs = ["Traced from Esri World Imagery"]
        else:
            hit = by_id.get(s["overture_id"])
            if not hit:
                sys.exit(f"overture id {s['overture_id']} ({s['name']}) not in campus_raw/buildings.geojson - run fetch")
            ring, srcs = hit["ring"][:-1], hit["sources"]
        used_sources.update(srcs)
        area = ring_area_m2(ring)
        clon, clat = ring_centroid(ring)
        out_b.append({
            "id": s["id"], "name": s["name"], "kind": s["kind"],
            **({"about": s["about"]} if s.get("about") else {}),
            **({"aliases": s["aliases"]} if s.get("aliases") else {}),
            **({"floors": s["floors"]} if s.get("floors") else {}),
            "area": round(area), "center": [round(clat, 6), round(clon, 6)],
            "poly": [[round(lat, 6), round(lon, 6)] for lon, lat in ring],
        })
    campus = spec["campus"]
    lats = [p[0] for p in campus["boundary"]]
    lons = [p[1] for p in campus["boundary"]]
    data = {
        "id": campus["id"], "name": campus["name"], "short": campus["short"], "full_name": campus["full_name"],
        "address": campus["address"], "aliases": campus["aliases"],
        "center": campus["center"], "zoom": campus.get("zoom", 17),
        "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
        "boundary": campus["boundary"],
        "imagery": campus.get("imagery", ""),
        "attribution": "Campus outlines: Overture Maps (Google Open Buildings, Microsoft, OpenStreetMap - ODbL), "
                       "checked against Esri World Imagery",
        "sources": sorted(used_sources),
        "buildings": out_b,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out_b)} buildings, sources {sorted(used_sources)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch").set_defaults(fn=cmd_fetch)
    sub.add_parser("preview").set_defaults(fn=cmd_preview)
    sub.add_parser("build").set_defaults(fn=cmd_build)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
