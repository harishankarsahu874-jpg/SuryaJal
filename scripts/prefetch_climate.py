"""Builds data/climate_fallback.json - NASA POWER climatology for major Indian cities,
used automatically when the internet is down at the fest.

    python scripts/prefetch_climate.py
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.climate import parse_power  # noqa: E402
from app.config import NASA_POWER_URL, USER_AGENT  # noqa: E402

CITIES = [
    ("Bengaluru", 12.9716, 77.5946), ("Mysuru", 12.2958, 76.6394),
    ("Mangaluru", 12.9141, 74.8560), ("Hubballi", 15.3647, 75.1240),
    ("Belagavi", 15.8497, 74.4977), ("Kalaburagi", 17.3297, 76.8343),
    ("Chennai", 13.0827, 80.2707), ("Hyderabad", 17.3850, 78.4867),
    ("Kochi", 9.9312, 76.2673), ("Mumbai", 19.0760, 72.8777),
    ("Pune", 18.5204, 73.8567), ("Delhi", 28.6139, 77.2090),
    ("Jaipur", 26.9124, 75.7873), ("Ahmedabad", 23.0225, 72.5714),
    ("Kolkata", 22.5726, 88.3639), ("Bhubaneswar", 20.2961, 85.8245),
]


def main():
    out = []
    for name, lat, lon in CITIES:
        params = {"parameters": "ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M", "community": "RE",
                  "longitude": lon, "latitude": lat, "format": "JSON"}
        r = requests.get(NASA_POWER_URL, params=params, timeout=40,
                         headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        d = parse_power(r.json())
        out.append({"name": name, "lat": lat, "lon": lon, **d})
        rain = sum(v * n for v, n in zip(d["rain_mm_day"], [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]))
        print(f"{name:12s} GHI {sum(d['ghi'])/12:.2f} kWh/m2/day  rain {rain:6.0f} mm/yr")
        time.sleep(0.6)
    target = ROOT / "data" / "climate_fallback.json"
    target.write_text(json.dumps({"source": "NASA POWER climatology 2001-2020",
                                  "cities": out}, indent=1))
    print("saved", target)


if __name__ == "__main__":
    main()
