"""Offline Odisha PIN-code lookup (fallback when the online geocoder can't find a PIN).

Odisha PINs run 751xxx-770xxx. The first three digits are the postal sorting district,
so every valid Odisha PIN resolves at least to its district town; a few dozen common
city PINs resolve to the exact locality. The map then zooms there and the user taps
their roof.
"""
from __future__ import annotations

import re
from typing import Dict, Optional

PIN_RE = re.compile(r"(?<!\d)([1-9]\d{2})[\s\-]?(\d{3})(?!\d)")

# exact localities (post-office areas) - lat, lon, name
EXACT: Dict[str, tuple] = {
    "751001": (20.2686, 85.8430, "Bhubaneswar GPO, Old Town"),
    "751002": (20.2376, 85.8339, "Old Town, Bhubaneswar"),
    "751003": (20.2960, 85.8110, "Nayapalli, Bhubaneswar"),
    "751004": (20.2980, 85.8200, "Unit 8 / Utkal University area, Bhubaneswar"),
    "751005": (20.2890, 85.8370, "Bhoinagar, Bhubaneswar"),
    "751006": (20.2700, 85.8420, "Budheswari, Bhubaneswar"),
    "751007": (20.2961, 85.8245, "Sahid Nagar, Bhubaneswar"),
    "751009": (20.2770, 85.8390, "Unit 1 / Ashok Nagar, Bhubaneswar"),
    "751010": (20.2860, 85.8540, "Rasulgarh, Bhubaneswar"),
    "751012": (20.2700, 85.8250, "Unit 9, Bhubaneswar"),
    "751013": (20.3100, 85.8150, "Acharya Vihar / RRL, Bhubaneswar"),
    "751014": (20.2830, 85.8150, "Unit 6 / Ganga Nagar, Bhubaneswar"),
    "751015": (20.2900, 85.7980, "Nayapalli / IRC Village, Bhubaneswar"),
    "751016": (20.3150, 85.8000, "Chandrasekharpur side, Bhubaneswar"),
    "751017": (20.3320, 85.8180, "Mancheswar, Bhubaneswar"),
    "751018": (20.2520, 85.8130, "Baramunda, Bhubaneswar"),
    "751019": (20.2460, 85.8600, "Old Town / Lingaraj area, Bhubaneswar"),
    "751020": (20.2530, 85.7900, "Khandagiri, Bhubaneswar"),
    "751021": (20.2550, 85.8030, "Pokhariput, Bhubaneswar"),
    "751022": (20.3030, 85.8480, "Satya Nagar, Bhubaneswar"),
    "751023": (20.3380, 85.8190, "Chandrasekharpur, Bhubaneswar"),
    "751024": (20.3530, 85.8190, "Patia / KIIT, Bhubaneswar"),
    "751025": (20.2900, 85.7800, "Nayapalli west, Bhubaneswar"),
    "751030": (20.2600, 85.7760, "Jagamara / Khandagiri, Bhubaneswar"),
    "751031": (20.3660, 85.8190, "Infocity / Patia, Bhubaneswar"),
    "761008": (19.1868, 84.7529, "Palur Hills / Golanthara (NIST area), Ganjam"),
    "753001": (20.4686, 85.8792, "Cuttack GPO"),
    "753003": (20.4600, 85.8600, "Buxi Bazar, Cuttack"),
    "753004": (20.4720, 85.8930, "Mangalabag, Cuttack"),
    "753007": (20.4620, 85.9000, "Chandini Chowk, Cuttack"),
    "753014": (20.4950, 85.8720, "CDA, Cuttack"),
    "752001": (19.8135, 85.8312, "Puri"),
    "760001": (19.3150, 84.7941, "Berhampur (Brahmapur)"),
    "768001": (21.4669, 83.9812, "Sambalpur"),
    "769001": (22.2604, 84.8536, "Rourkela"),
    "769012": (22.2500, 84.8800, "Rourkela Steel Township"),
    "756001": (21.4942, 86.9317, "Balasore (Baleswar)"),
    "757001": (21.9322, 86.7516, "Baripada"),
    "758001": (21.6289, 85.5817, "Keonjhar"),
    "759001": (20.6571, 85.5981, "Dhenkanal"),
    "759122": (20.8400, 85.1000, "Angul"),
    "764020": (18.8135, 82.7123, "Koraput"),
    "765001": (19.1712, 83.4163, "Rayagada"),
    "766001": (19.9137, 83.1649, "Bhawanipatna"),
    "767001": (20.7074, 83.4843, "Balangir"),
    "768028": (21.3470, 83.6200, "Bargarh"),
    "768201": (21.8554, 84.0062, "Jharsuguda"),
    "770001": (22.1167, 84.0333, "Sundargarh"),
}

# postal sorting district (first 3 digits) -> main town
PREFIX: Dict[str, tuple] = {
    "751": (20.2961, 85.8245, "Bhubaneswar area (Khordha)"),
    "752": (19.8135, 85.8312, "Puri / Khordha / Nayagarh area"),
    "753": (20.4625, 85.8830, "Cuttack city"),
    "754": (20.3500, 86.1700, "Cuttack / Jagatsinghpur / Kendrapara area"),
    "755": (20.8500, 86.3300, "Jajpur area"),
    "756": (21.4942, 86.9317, "Balasore / Bhadrak area"),
    "757": (21.9322, 86.7516, "Mayurbhanj (Baripada) area"),
    "758": (21.6289, 85.5817, "Keonjhar area"),
    "759": (20.6571, 85.5981, "Dhenkanal / Angul area"),
    "760": (19.3150, 84.7941, "Berhampur (Ganjam) area"),
    "761": (19.3800, 84.6800, "Ganjam / Gajapati area"),
    "762": (20.4700, 84.2300, "Kandhamal / Boudh area"),
    "763": (18.8135, 82.7123, "Koraput / Sunabeda area"),
    "764": (18.8135, 82.7123, "Koraput / Nabarangpur / Malkangiri area"),
    "765": (19.1712, 83.4163, "Rayagada area"),
    "766": (19.9137, 83.1649, "Kalahandi / Nuapada area"),
    "767": (20.7074, 83.4843, "Balangir / Subarnapur area"),
    "768": (21.4669, 83.9812, "Sambalpur / Bargarh / Jharsuguda area"),
    "769": (22.2604, 84.8536, "Rourkela (Sundargarh) area"),
    "770": (22.1167, 84.0333, "Sundargarh area"),
}


def find_pin(text: str) -> Optional[str]:
    m = PIN_RE.search(text or "")
    return m.group(1) + m.group(2) if m else None


def lookup(pin: str) -> Optional[Dict]:
    """{'name','lat','lon','exact'} for an Odisha PIN, else None."""
    if pin in EXACT:
        lat, lon, name = EXACT[pin]
        return {"name": f"{name}, Odisha {pin}", "lat": lat, "lon": lon, "exact": True}
    if pin[:3] in PREFIX:
        lat, lon, name = PREFIX[pin[:3]]
        return {"name": f"PIN {pin} · {name}, Odisha (approximate — zoom in to your street)",
                "lat": lat, "lon": lon, "exact": False}
    return None
