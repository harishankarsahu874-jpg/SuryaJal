"""Offline Odisha place gazetteer (search fallback when Nominatim is unreachable).

Free-text search must keep working without internet - town names, district names,
big-city localities and PIN areas are bundled with the app (data/climate_fallback.json
plus app/pincode.py), so typing "Cuttack", "Sahid Nagar" or "751007" always finds
something and the map can fly there.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Dict, List, Tuple

from . import odisha, pincode

# alternative spellings people actually type -> keys used in the bundled data
_ALIASES = {
    "bhubaneshwar": "bhubaneswar",
    "brahmapur": "berhampur",
    "berhampore": "berhampur",
    "baleswar": "balasore",
    "baleshwar": "balasore",
    "khorda": "khurda",
    "khordha": "khurda",
    "kendujhar": "keonjhar",
    "kendujhargarh": "keonjhar",
    "subarnapur": "sonepur",
    "sonepur": "sonepur",
    "nawarangpur": "nabarangpur",
    "navarangpur": "nabarangpur",
    "nowrangpur": "nabarangpur",
    "malkangiri": "malkangiri",
    "jagatsinghpur": "jagatsinghpur",
    "jajpur": "jajpur",
    "deogarh": "deogarh",
    "sundargarh": "sundargarh",
    "sundergarh": "sundargarh",
    "paradeep": "paradeep",
    "paradip": "paradeep",
    "phulbani": "phulbani",
    "kandhamal": "phulbani",
    "balangir": "balangir",
    "bolangir": "balangir",
    "bhawanipatna": "bhawanipatna",
    "kalahandi": "bhawanipatna",
    "paralakhemundi": "paralakhemundi",
    "gajapati": "paralakhemundi",
    "angul": "angul",
    "anugul": "angul",
    "keonjhar town": "keonjhar",
}

_WS = re.compile(r"\s+")
_WORDS = re.compile(r"[a-z0-9]+")

# India (S, W, N, E) - the map is India-only, and search results should be too
INDIA_BBOX = (6.0, 67.5, 37.5, 98.0)


def in_india(lat: float, lon: float) -> bool:
    s, w, n, e = INDIA_BBOX
    return s <= lat <= n and w <= lon <= e


# Major Odisha institutions & landmarks - the places people actually type in
# ("NIST", "KIIT", "Jagannath Temple"…). Name, lat, lon, extra search keys.
LANDMARKS: List[Tuple[str, float, float, List[str]]] = [
    ("NIST University, Berhampur", 19.1983, 84.7459,   # Palur Hill (OSM), the campus hills
     ["nist", "nist university", "nist berhampur", "national institute of science and technology"]),
    ("Berhampur University", 19.2992, 84.8816, ["berhampur university", "brahmapur university"]),
    ("MKCG Medical College, Berhampur", 19.3145, 84.8063, ["mkcg", "mkcg medical college"]),
    ("Parala Maharaja Engineering College, Palur Hills", 19.1856, 84.7530, ["pmec", "parala maharaja"]),
    ("KIIT University, Bhubaneswar", 20.3551, 85.8173, ["kiit", "kiit university", "kiit bhubaneswar"]),
    ("ITER / SOA University, Bhubaneswar", 20.3414, 85.8077, ["iter", "soa university", "siksha o anusandhan"]),
    ("IIT Bhubaneswar", 20.1493, 85.6677, ["iit bhubaneswar", "iit bbs"]),
    ("AIIMS Bhubaneswar", 20.2364, 85.7773, ["aiims bhubaneswar", "aiims"]),
    ("Utkal University (Vani Vihar), Bhubaneswar", 20.2968, 85.8220, ["utkal university", "vani vihar"]),
    ("Ravenshaw University, Cuttack", 20.4815, 85.8787, ["ravenshaw", "ravenshaw university"]),
    ("NIT Rourkela", 22.2488, 84.9015, ["nit rourkela", "nit rkl"]),
    ("VSSUT, Burla (Sambalpur)", 21.4945, 83.8980, ["vssut", "veer surendra sai university"]),
    ("Bhubaneswar Railway Station", 20.2687, 85.8316, ["bhubaneswar station", "bbs station"]),
    ("Berhampur Railway Station", 19.3120, 84.7904, ["berhampur station", "brahmapur station"]),
    ("Puri Jagannath Temple", 19.8050, 85.8181, ["jagannath temple", "jagannath", "puri temple"]),
    ("Konark Sun Temple", 19.8876, 86.0945, ["konark", "sun temple", "konark temple"]),
    ("Lingaraj Temple, Bhubaneswar", 20.2381, 85.8318, ["lingaraj", "lingaraj temple"]),
    ("Dhauli Shanti Stupa, Bhubaneswar", 20.1919, 85.8466, ["dhauli", "shanti stupa", "dhauli hills"]),
    ("Chilika Lake (Barkul)", 19.7200, 85.3200, ["chilika", "chilika lake", "barkul"]),
    ("Gopalpur Sea Beach", 19.2668, 84.9028, ["gopalpur", "gopalpur beach", "gopalpur on sea"]),
    ("Hirakud Dam, Sambalpur", 21.5333, 83.8667, ["hirakud", "hirakud dam"]),
    ("Simlipal National Park, Mayurbhanj", 21.8333, 86.5000, ["simlipal", "similipal"]),
    ("Biju Patnaik Airport, Bhubaneswar", 20.2444, 85.8178, ["bhubaneswar airport", "bbs airport", "biju patnaik airport"]),
    ("Paradeep Port", 20.2667, 86.6333, ["paradeep", "paradip", "paradip port"]),
]


def _norm(s: str) -> str:
    return _WS.sub(" ", (s or "").strip().lower())


def _keys(*words: str) -> List[str]:
    out = []
    for w in words:
        n = _norm(w)
        if n:
            out.append(n)
            alias = _ALIASES.get(n)
            if alias and alias != n:
                out.append(alias)
    return out


@lru_cache(maxsize=1)
def _catalogue() -> Tuple[Tuple[str, float, float, str, Tuple[str, ...]], ...]:
    """(name, lat, lon, type, search-keys) for every place we know offline."""
    rows: Dict[str, Tuple[str, float, float, str, Tuple[str, ...]]] = {}

    def add(name: str, lat: float, lon: float, typ: str, keys: List[str]) -> None:
        k = _norm(name)
        if k and k not in rows:
            rows[k] = (name, lat, lon, typ, tuple(dict.fromkeys(keys)))

    # 0) curated Odisha landmarks (universities, temples, stations, tourist spots)
    for name, lat, lon, extra in LANDMARKS:
        add(name, lat, lon, "poi", _keys(*extra, name))

    # 1) district HQ towns + the districts themselves (bundled NASA POWER points)
    for p in odisha.points():
        name, lat, lon = p["name"], p["lat"], p["lon"]
        district = p.get("district") or ""
        add(name, lat, lon, "town", _keys(name, f"{name} town"))
        if district and _norm(district) not in rows:
            add(f"{district} district", lat, lon, "county",
                _keys(district, f"{district} district"))

    # 2) exact big-city localities from the PIN table (e.g. "Sahid Nagar, Bhubaneswar")
    for lat, lon, name in pincode.EXACT.values():
        head = name.split(",")[0].strip()
        add(name, lat, lon, "suburb", _keys(head, name))

    # 3) postal sorting districts (approximate, e.g. "Bhubaneswar area (Khordha)")
    for lat, lon, name in pincode.PREFIX.values():
        head = name.split(" area")[0].split(" /")[0].strip()
        add(name, lat, lon, "postcode_area", _keys(head, name))

    return tuple(rows.values())


def _token_score(token: str, key: str) -> int:
    if not token:
        return 0
    if key == token:
        return 100
    if key.startswith(token):
        return 80
    if any(w.startswith(token) for w in _WORDS.findall(key)):
        return 60
    if len(token) >= 3 and token in key:
        return 40
    return 0


def search(q: str, limit: int = 6) -> List[Tuple[str, float, float, str]]:
    """[(name, lat, lon, type)] best-first for a free-text Odisha query.

    Purely offline - used as the fallback (and the safety net) for /api/geocode.
    """
    nq = _norm(q)
    if not nq or len(nq) < 2:
        return []
    if nq.isdigit():                     # PINs are handled by pincode.lookup()
        return []
    # split on punctuation too: "nist university,berhampur" -> nist / university / berhampur
    tokens = [t for t in _WORDS.findall(nq) if len(t) >= 2 and not t.isdigit()]
    if not tokens:
        tokens = [t for t in nq.split(" ") if len(t) >= 2 and not t.isdigit()]
    if not tokens:
        return []

    scored = []
    for name, lat, lon, typ, keys in _catalogue():
        score = 0
        for key in keys:
            s = sum(_token_score(t, key) for t in tokens)
            # reward a whole-query hit over a lucky single word
            if nq == key:
                s += 50
            elif key.startswith(nq):
                s += 25
            score = max(score, s)
        if score >= 40:
            scored.append((score, name, lat, lon, typ))

    scored.sort(key=lambda r: (-r[0], len(r[1]), r[1]))
    return [(name, lat, lon, typ) for _, name, lat, lon, typ in scored[:limit]]
