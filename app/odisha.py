"""Odisha-specific lookups.

* which of the four Odisha DISCOMs (TPCODL / TPNODL / TPWODL / TPSODL) serves a roof,
* which district it is in,
* the bundled NASA POWER table for all 30 districts (used for the offline fallback and
  for the "sun & rain across Odisha" panel in the UI).
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

from .config import (DAYS_IN_MONTH, DISCOMS, FALLBACK_CLIMATE_FILE, MAP_CENTER,
                     ODISHA_BOUNDS, STATE)

# ------------------------------------------------------------------ bundled climate points
@lru_cache(maxsize=1)
def points() -> List[Dict]:
    """NASA POWER climatology for every Odisha district, bundled in data/."""
    try:
        return json.loads(FALLBACK_CLIMATE_FILE.read_text())["cities"]
    except (OSError, ValueError, KeyError):
        return []


def annual_summary(p: Dict) -> Dict:
    rain = sum(r * n for r, n in zip(p["rain_mm_day"], DAYS_IN_MONTH))
    ghi = p["ghi"]
    best = max(range(12), key=lambda i: ghi[i])
    return {
        "annual_rain_mm": round(rain),
        "ghi_avg": round(sum(ghi) / 12.0, 2),
        "sunniest_month": best,
        "monsoon_rain_mm": round(sum(r * n for r, n in zip(p["rain_mm_day"][6:10],
                                                           DAYS_IN_MONTH[6:10]))),
    }


def odisha_table() -> List[Dict]:
    """One row per bundled town: district, DISCOM, sunlight and rainfall."""
    rows = []
    for p in points():
        rows.append({"name": p["name"], "district": p.get("district", ""),
                     "discom": p.get("discom", ""), "lat": p["lat"], "lon": p["lon"],
                     **annual_summary(p)})
    rows.sort(key=lambda r: (r["district"], r["name"]))
    return rows


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(h))


def nearest_point(lat: float, lon: float) -> Optional[Tuple[Dict, float]]:
    pts = points()
    if not pts:
        return None
    best = min(pts, key=lambda c: _haversine_km((lat, lon), (c["lat"], c["lon"])))
    return best, _haversine_km((lat, lon), (best["lat"], best["lon"]))


def locate(lat: float, lon: float) -> Dict:
    """District + DISCOM for a roof, found from the nearest bundled district point."""
    hit = nearest_point(lat, lon)
    out: Dict = {"state": STATE, "district": None, "discom": None, "discom_name": None,
                 "nearest": None, "km_away": None, "areas": None, "site": None}
    if not hit:
        return out
    p, km = hit
    code = p.get("discom")
    info = DISCOMS.get(code, {})
    out.update({
        "district": p.get("district"),
        "discom": code,
        "discom_name": info.get("name", code),
        "nearest": p["name"],
        "km_away": round(km),
        "areas": info.get("areas"),
        "site": info.get("site"),
    })
    return out


def in_odisha(lat: float, lon: float) -> bool:
    """Rough check against the State's bounding box (Odisha is not a rectangle)."""
    (s, w), (n, e) = ODISHA_BOUNDS
    return s <= lat <= n and w <= lon <= e


def state_centre() -> Tuple[float, float]:
    return MAP_CENTER
