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
