"""Builds data/climate_fallback.json - NASA POWER climatology for every district of
Odisha, used automatically when the internet is down (fest Wi-Fi, demo on a hotspot).

    python scripts/prefetch_climate.py

Writes one entry per town: name, district, DISCOM, lat/lon and the twelve monthly values
of surface solar irradiance (kWh/m2/day), rainfall (mm/day) and 2 m air temperature (degC).
The district and DISCOM columns are also what app/odisha.py uses to tell a roof which of
the four Tata Power DISCOMs bills it.
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.climate import parse_power  # noqa: E402
from app.config import DAYS_IN_MONTH, NASA_POWER_URL, USER_AGENT  # noqa: E402

# All 30 district headquarters + Rourkela, Paradeep and Berhampur (industrial / coastal
# towns whose climate differs from their district HQ).
POINTS = [
    ("Bhubaneswar", "Khurda", "TPCODL", 20.2961, 85.8245),
    ("Cuttack", "Cuttack", "TPCODL", 20.4625, 85.883),
    ("Puri", "Puri", "TPCODL", 19.8134, 85.8312),
    ("Rourkela", "Sundargarh", "TPWODL", 22.26, 84.8),
    ("Berhampur", "Ganjam", "TPSODL", 19.3134, 84.7941),
    ("Sambalpur", "Sambalpur", "TPWODL", 21.4676, 83.9755),
    ("Balasore", "Balasore", "TPNODL", 21.4972, 86.9337),
    ("Baripada", "Mayurbhanj", "TPNODL", 21.9351, 86.7318),
    ("Bhadrak", "Bhadrak", "TPNODL", 21.0543, 86.497),
    ("Jajpur", "Jajpur", "TPNODL", 20.8428, 86.3225),
    ("Angul", "Angul", "TPCODL", 20.8346, 85.102),
    ("Dhenkanal", "Dhenkanal", "TPCODL", 20.657, 85.5892),
    ("Kendrapara", "Kendrapara", "TPCODL", 20.5042, 86.416),
    ("Jagatsinghpur", "Jagatsinghpur", "TPCODL", 20.2649, 86.1709),
    ("Paradeep", "Jagatsinghpur", "TPCODL", 20.267, 86.634),
    ("Balangir", "Balangir", "TPWODL", 20.7154, 83.4827),
    ("Bargarh", "Bargarh", "TPWODL", 21.3339, 83.6179),
    ("Boudh", "Boudh", "TPSODL", 20.8364, 84.3239),
    ("Deogarh", "Deogarh", "TPWODL", 21.5255, 84.7345),
    ("Paralakhemundi", "Gajapati", "TPSODL", 18.7778, 84.09),
    ("Jharsuguda", "Jharsuguda", "TPWODL", 21.8516, 84.0129),
    ("Bhawanipatna", "Kalahandi", "TPWODL", 19.9048, 83.1655),
    ("Phulbani", "Kandhamal", "TPSODL", 20.4716, 84.232),
    ("Keonjhar", "Keonjhar", "TPNODL", 21.6413, 85.5849),
    ("Koraput", "Koraput", "TPSODL", 18.8128, 82.7128),
    ("Malkangiri", "Malkangiri", "TPSODL", 18.3516, 81.8914),
    ("Nabarangpur", "Nabarangpur", "TPSODL", 19.235, 82.548),
    ("Nayagarh", "Nayagarh", "TPCODL", 20.129, 85.103),
    ("Nuapada", "Nuapada", "TPWODL", 20.836, 83.29),
    ("Rayagada", "Rayagada", "TPSODL", 19.1666, 83.411),
    ("Sonepur", "Subarnapur", "TPWODL", 20.8323, 83.9088),
    ("Sundargarh", "Sundargarh", "TPWODL", 22.1188, 84.0386),
]


def main():
    out = []
    for name, district, discom, lat, lon in POINTS:
        params = {"parameters": "ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M", "community": "RE",
                  "longitude": lon, "latitude": lat, "format": "JSON"}
        r = requests.get(NASA_POWER_URL, params=params, timeout=40,
                         headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        d = parse_power(r.json())
        out.append({"name": name, "district": district, "discom": discom,
                    "lat": lat, "lon": lon, **d})
        rain = sum(v * n for v, n in zip(d["rain_mm_day"], DAYS_IN_MONTH))
        print(f"{name:16s} {district:14s} {discom}  GHI {sum(d['ghi']) / 12:.2f} kWh/m2/day"
              f"  rain {rain:6.0f} mm/yr")
        time.sleep(0.6)                       # be polite to the NASA POWER API
    target = ROOT / "data" / "climate_fallback.json"
    target.write_text(json.dumps({
        "source": "NASA POWER climatology 2001-2020 (satellite + MERRA-2)",
        "state": "Odisha",
        "cities": out,
    }, indent=1))
    print(f"saved {len(out)} Odisha points ->", target)


if __name__ == "__main__":
    main()
