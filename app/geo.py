"""Web-Mercator maths (same tiling scheme as Leaflet / Esri / Google, 256 px tiles)
plus small helpers for polygon area and an encoded-polyline codec used in share URLs."""
from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

TILE = 256
EARTH_EQ_RADIUS = 6378137.0            # WGS84, used by Web Mercator
EARTH_MEAN_RADIUS = 6371008.8          # used for local metric projection
MAX_LAT = 85.05112878

LatLon = Tuple[float, float]


def clamp_lat(lat: float) -> float:
    return max(-MAX_LAT, min(MAX_LAT, lat))


def latlon_to_px(lat: float, lon: float, z: int) -> Tuple[float, float]:
    """Global pixel coordinates of a lat/lon at zoom z."""
    lat = clamp_lat(lat)
    n = TILE * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def px_to_latlon(x: float, y: float, z: int) -> LatLon:
    n = TILE * (2 ** z)
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def meters_per_px(lat: float, z: int) -> float:
    """Ground resolution of a Web-Mercator pixel (m/px)."""
    return 2 * math.pi * EARTH_EQ_RADIUS * math.cos(math.radians(lat)) / (TILE * 2 ** z)


# ------------------------------------------------------------------ local metric frame
def to_local_m(latlngs: Sequence[LatLon], origin: LatLon | None = None):
    """Project lat/lon to a local east/north metre frame around `origin` (equirectangular,
    accurate to well under 1 % for roof-sized shapes)."""
    if origin is None:
        origin = centroid_simple(latlngs)
    lat0, lon0 = origin
    k = math.cos(math.radians(lat0))
    pts = [((lon - lon0) * math.pi / 180 * EARTH_MEAN_RADIUS * k,
            (lat - lat0) * math.pi / 180 * EARTH_MEAN_RADIUS) for lat, lon in latlngs]
    return pts, origin


def from_local_m(pts: Iterable[Tuple[float, float]], origin: LatLon) -> List[LatLon]:
    lat0, lon0 = origin
    k = math.cos(math.radians(lat0))
    out = []
    for x, y in pts:
        lat = lat0 + y / EARTH_MEAN_RADIUS * 180 / math.pi
        lon = lon0 + x / (EARTH_MEAN_RADIUS * k) * 180 / math.pi
        out.append((lat, lon))
    return out


def centroid_simple(latlngs: Sequence[LatLon]) -> LatLon:
    n = len(latlngs)
    return (sum(p[0] for p in latlngs) / n, sum(p[1] for p in latlngs) / n)


def polygon_area_m2(latlngs: Sequence[LatLon]) -> float:
    if len(latlngs) < 3:
        return 0.0
    pts, _ = to_local_m(latlngs)
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def polygon_perimeter_m(latlngs: Sequence[LatLon]) -> float:
    if len(latlngs) < 2:
        return 0.0
    pts, _ = to_local_m(latlngs)
    return sum(math.dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts)))


def polygon_centroid(latlngs: Sequence[LatLon]) -> LatLon:
    """Area-weighted centroid (falls back to vertex mean for degenerate shapes)."""
    pts, origin = to_local_m(latlngs)
    a = cx = cy = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    if abs(a) < 1e-9:
        return origin
    a /= 2.0
    return from_local_m([(cx / (6 * a), cy / (6 * a))], origin)[0]


# ------------------------------------------------------------------ encoded polyline
def encode_polyline(latlngs: Sequence[LatLon], precision: int = 6) -> str:
    """Google encoded-polyline algorithm (precision 6 = ~0.1 m)."""
    factor = 10 ** precision
    out, plat, plon = [], 0, 0
    for lat, lon in latlngs:
        ilat, ilon = int(round(lat * factor)), int(round(lon * factor))
        for d in (ilat - plat, ilon - plon):
            v = ~(d << 1) if d < 0 else (d << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def decode_polyline(s: str, precision: int = 6) -> List[LatLon]:
    factor = 10 ** precision
    coords, idx, lat, lon = [], 0, 0, 0
    while idx < len(s):
        vals = []
        for _ in range(2):
            shift = result = 0
            while True:
                if idx >= len(s):
                    raise ValueError("truncated polyline")
                b = ord(s[idx]) - 63
                idx += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(result >> 1) if result & 1 else result >> 1)
        lat += vals[0]
        lon += vals[1]
        coords.append((lat / factor, lon / factor))
    return coords
