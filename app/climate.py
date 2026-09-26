"""NASA POWER climatology (monthly solar irradiance, rainfall, temperature) with a
disk cache and an offline fallback (nearest bundled city) for flaky fest Wi-Fi."""
from __future__ import annotations

import json
import math
import threading
from typing import Optional

import httpx

from .config import (CACHE_DIR, FALLBACK_CLIMATE_FILE, MONTHS, NASA_POWER_URL,
                     USER_AGENT)

_lock = threading.Lock()
_CACHE_FILE = CACHE_DIR / "climate_cache.json"
_mem: dict = {}


def _load_disk_cache():
    global _mem
    if not _mem and _CACHE_FILE.exists():
        try:
            _mem = json.loads(_CACHE_FILE.read_text())
        except Exception:
            _mem = {}


def _save_disk_cache():
    try:
        _CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_FILE.write_text(json.dumps(_mem))
    except OSError:
        pass


def parse_power(js: dict) -> dict:
    p = js["properties"]["parameter"]
    out = {
        "ghi": [float(p["ALLSKY_SFC_SW_DWN"][m]) for m in MONTHS],   # kWh/m2/day
        "rain_mm_day": [float(p["PRECTOTCORR"][m]) for m in MONTHS],  # mm/day
        "t2m": [float(p["T2M"][m]) for m in MONTHS],                  # deg C
    }
    for k, arr in out.items():
        if any(v <= -998 for v in arr):
            raise ValueError(f"NASA POWER returned fill values for {k}")
    return out


def _haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def fallback(lat: float, lon: float) -> Optional[dict]:
    if not FALLBACK_CLIMATE_FILE.exists():
        return None
    cities = json.loads(FALLBACK_CLIMATE_FILE.read_text())["cities"]
    best = min(cities, key=lambda c: _haversine_km((lat, lon), (c["lat"], c["lon"])))
    d = _haversine_km((lat, lon), (best["lat"], best["lon"]))
    return {"ghi": best["ghi"], "rain_mm_day": best["rain_mm_day"], "t2m": best["t2m"],
            "source": f"Offline data: {best['name']} ({d:.0f} km away), NASA POWER 2001-2020",
            "offline": True}


async def get_climate(lat: float, lon: float, client: Optional[httpx.AsyncClient] = None) -> dict:
    key = f"{lat:.2f},{lon:.2f}"
    with _lock:
        _load_disk_cache()
        if key in _mem:
            return _mem[key]
    params = {"parameters": "ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M", "community": "RE",
              "longitude": f"{lon:.4f}", "latitude": f"{lat:.4f}", "format": "JSON"}
    own = client is None
    client = client or httpx.AsyncClient(headers={"User-Agent": USER_AGENT})
    try:
        r = await client.get(NASA_POWER_URL, params=params, timeout=25.0)
        r.raise_for_status()
        data = parse_power(r.json())
        data.update({"source": "NASA POWER climatology 2001-2020 (satellite + MERRA-2)",
                     "offline": False})
        with _lock:
            _mem[key] = data
            _save_disk_cache()
        return data
    except Exception:
        fb = fallback(lat, lon)
        if fb is None:
            raise
        return fb
    finally:
        if own:
            await client.aclose()
