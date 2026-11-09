"""Builds data/campus_nist.json - the NIST University campus layer for the map
(Institute Park, Palur Hills, Berhampur/Brahmapur, Ganjam, Odisha).

Why this exists: OpenStreetMap has no NIST campus at all (no campus outline, no named
building - checked Nov 2026), so neither place search nor the AI roof detector knows the
campus. Overture Maps only has unnamed Google Open Buildings footprints there, several of
them shifted 10-20 m from the imagery and the Octagon missing entirely.

So every outline in scripts/campus_nist_sections.json is traced by hand on the Esri World
Imagery mosaic the app uses as its basemap (Vantor, 7 Jan 2026, 0.34 m) - they line up with
what users see. Names come from the NIST University website (nist.edu/campus and its photos);
public place listings that mirror Google Maps pins, and Overture places, were only used as hints
for which roof is which - no geometry was copied from them. Each building records its evidence.
Buildings whose name is not confirmed are labelled "B1".."B7" until someone who knows the campus
names them (edit "name"/"label"/"search" in the sections table, then run `build`).

    python scripts/build_campus.py build     # sections table -> data/campus_nist.json (no internet)

Optional helpers for re-tracing (internet; `pip install overturemaps pillow requests`):

    python scripts/build_campus.py fetch     # Overture buildings + places, OSM, Esri tiles
    python scripts/build_campus.py preview   # imagery with numbered outlines

`fetch` and `preview` write to scripts/campus_raw/ (scratch, git-ignored, not needed by the app).
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
    """(lon, lat) area centroid - falls back to the vertex mean for slivers. Worked out relative to
    the first corner: with raw degrees (84.7 x 19.2) the cross products of a 150 m2 roof cancel so
    badly that the centroid lands tens of metres away."""
    x0, y0 = ring[0]
    pts = [(x - x0, y - y0) for x, y in ring]
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-16:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    return (x0 + cx / (3 * a), y0 + cy / (3 * a))


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
KINDS = ("academic", "research", "hostel", "sports", "ground", "transport", "facility", "construction", "other")


def _ll_ring(ring_latlon: list) -> list[list[float]]:
    """[[lat, lon], ...] -> [[lon, lat], ...] without a closing duplicate."""
    ring = [[float(lon), float(lat)] for lat, lon in ring_latlon]
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return ring


def _seg_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    ll = dx * dx + dy * dy
    t = 0.0 if ll == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def label_point(ring: list[list[float]], holes: list[list[list[float]]]) -> tuple[float, float]:
    """(lon, lat) for the label - and the tap target - of a building: the roof point farthest from
    every edge (a "pole of inaccessibility", nudged towards the centroid on ties), so it sits well
    inside L-shaped, U-shaped and courtyard buildings instead of on a corner or in a courtyard."""
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111_320 * math.cos(lat0), 110_574
    x0, y0 = ring[0]
    def m(p):
        return ((p[0] - x0) * kx, (p[1] - y0) * ky)
    outer = [m(p) for p in ring]
    inner = [[m(p) for p in h] for h in holes]
    edges = [(a, b) for r in [outer] + inner for a, b in zip(r, r[1:] + r[:1])]
    cx, cy = m(ring_centroid(ring))
    def inside(x, y):
        return point_in_ring(x, y, outer) and not any(point_in_ring(x, y, h) for h in inner)
    def score(x, y):
        clear = min(_seg_dist(x, y, a[0], a[1], b[0], b[1]) for a, b in edges)
        return clear - 0.03 * math.hypot(x - cx, y - cy)
    xs, ys = [p[0] for p in outer], [p[1] for p in outer]
    n = 40
    best = None
    for i in range(n + 1):
        for j in range(n + 1):
            x = min(xs) + (max(xs) - min(xs)) * i / n
            y = min(ys) + (max(ys) - min(ys)) * j / n
            if inside(x, y) and (best is None or score(x, y) > best[0]):
                best = (score(x, y), x, y)
    if best is None:                                       # sliver: fall back to the centroid
        x, y = cx, cy
    else:
        step = max(max(xs) - min(xs), max(ys) - min(ys)) / n
        for _ in range(6):                                 # refine around the best grid point
            _, bx, by = best
            for dx in (-step, 0.0, step):
                for dy in (-step, 0.0, step):
                    if inside(bx + dx, by + dy) and score(bx + dx, by + dy) > best[0]:
                        best = (score(bx + dx, by + dy), bx + dx, by + dy)
            step /= 2
        _, x, y = best
    return x0 + x / kx, y0 + y / ky


def convex_hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo: list = []
    hi: list = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def campus_outline(buildings: list[dict], margin_m: float = 30.0) -> list[list[float]]:
    """Convex hull of every traced outline grown by `margin_m` - only used to frame the campus
    (bounds, zoom-out highlight), NOT the legal campus boundary."""
    lat0 = math.radians(CENTER[0])
    dlat, dlon = margin_m / 110_574, margin_m / (111_320 * math.cos(lat0))
    pts = []
    for b in buildings:
        for lon, lat in b["_ring"]:
            for k in range(8):
                a = math.pi * k / 4
                pts.append((lon + dlon * math.cos(a), lat + dlat * math.sin(a)))
    return [[round(lat, 6), round(lon, 6)] for lon, lat in convex_hull(pts)]


def cmd_build(_args) -> None:
    spec = json.loads(SECTIONS.read_text())
    by_id = {}
    if (RAW / "buildings.geojson").exists():          # legacy: outline taken from an Overture footprint
        for f in json.loads((RAW / "buildings.geojson").read_text()).get("features", []):
            p = f.get("properties") or {}
            rings = rings_of(f.get("geometry"))
            if rings:
                by_id[p.get("id") or f.get("id")] = max(rings, key=lambda r: ring_area_m2(r[:-1]))[:-1]
    out_b, seen = [], set()
    for s in spec["buildings"]:
        bid = s["id"]
        if bid in seen:
            sys.exit(f"duplicate building id {bid!r}")
        seen.add(bid)
        if s.get("kind") not in KINDS:
            sys.exit(f"{bid}: kind must be one of {KINDS}")
        if "ring" in s:                               # traced by hand on the imagery: [[lat, lon], ...]
            ring = _ll_ring(s["ring"])
        elif s.get("overture_id") in by_id:
            ring = by_id[s["overture_id"]]
        else:
            sys.exit(f"{bid}: needs a traced 'ring' (or an overture_id present in campus_raw/buildings.geojson)")
        holes = [_ll_ring(h) for h in s.get("holes", [])]
        if len(ring) < 3 or any(len(h) < 3 for h in holes):
            sys.exit(f"{bid}: rings need at least 3 points")
        for lon, lat in ring:
            if not (W <= lon <= E and S <= lat <= N):
                sys.exit(f"{bid}: point {lat}, {lon} is outside the campus area")
        area = ring_area_m2(ring) - sum(ring_area_m2(h) for h in holes)
        if s.get("label_at"):                         # hand-placed label (keeps it clear of a neighbour)
            ly, lx = s["label_at"]
        else:
            lx, ly = label_point(ring, holes)
        row = {
            "id": bid, "name": s["name"], "label": s.get("label") or s["name"], "kind": s["kind"],
            **({"about": s["about"]} if s.get("about") else {}),
            **({"aliases": s["aliases"]} if s.get("aliases") else {}),
            **({"sections": s["sections"]} if s.get("sections") else {}),
            **({"floors": s["floors"]} if s.get("floors") else {}),
            "search": bool(s.get("search", True)),
            **({"roof": False} if s.get("roof") is False else {}),     # open ground / pool / site: not a roof
            "area": round(area), "center": [round(ly, 6), round(lx, 6)],
            "poly": [[round(lat, 6), round(lon, 6)] for lon, lat in ring],
            **({"holes": [[[round(lat, 6), round(lon, 6)] for lon, lat in h] for h in holes]} if holes else {}),
            "_ring": ring,
        }
        out_b.append(row)
    campus = spec["campus"]
    boundary = campus.get("boundary") or campus_outline(out_b)
    for b in out_b:
        b.pop("_ring")
    lats = [p[0] for p in boundary]
    lons = [p[1] for p in boundary]
    data = {
        "id": campus["id"], "name": campus["name"], "short": campus["short"], "full_name": campus["full_name"],
        "address": campus["address"], "aliases": campus["aliases"],
        "center": campus["center"], "zoom": campus.get("zoom", 17),
        "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
        "boundary": boundary,
        "imagery": campus.get("imagery", ""),
        "attribution": "Campus outlines traced on Esri World Imagery (Vantor); names from nist.edu, "
                       "Google Maps listings and Overture Maps",
        "buildings": out_b,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    named = sum(1 for b in out_b if b["search"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out_b)} outlines ({named} named), "
          f"{OUT.stat().st_size // 1024} KB")


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
