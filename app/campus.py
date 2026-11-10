"""Mapped campuses - building-level maps of places OpenStreetMap does not cover.

NIST University, Berhampur has no campus in OpenStreetMap (no outline, no named building),
so data/campus_nist.json (built by scripts/build_campus.py from hand-traced outlines) gives
the map an accurate, labelled layer of every section and lets search find them offline:
"NIST", "Galleria", "nist library", "LHC", "Einstein hall", "nist hostel"...
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Optional

from .config import DATA_DIR

CAMPUS_FILES = {"nist": DATA_DIR / "campus_nist.json"}

_WORD = re.compile(r"[a-z0-9]+")
# words that never narrow the search down to one building
_FILLER = {"the", "of", "in", "at", "near", "and", "a", "an", "to", "for", "building", "block", "bldg",
           "campus", "university", "univ", "college", "odisha", "orissa", "india", "ganjam", "berhampur",
           "brahmapur", "behrampur", "bramhapur", "golanthara", "palur", "hill", "hills", "institute",
           "park", "national", "science", "technology", "tech", "nist"}
# words that mean "at NIST" on their own
_CONTEXT_WORDS = {"nist"}
_CONTEXT_PHRASES = ("national institute of science", "institute park")
# building words specific enough to find without saying "NIST" first
_DISTINCT = {"galleria", "octagon", "atrium", "attrium", "tifac", "lhc", "einstein", "hawking", "cineplex", "ntcs"}

KIND_LABEL = {"academic": "Academic block", "research": "Research centre", "hostel": "Hall of residence",
              "sports": "Sports", "ground": "Sports ground", "transport": "Transport", "facility": "Facility",
              "construction": "Under construction", "other": "Campus building"}
# order of the "everything at NIST" list
_KIND_ORDER = ["academic", "research", "hostel", "sports", "transport", "facility", "ground"]


def words(s: str) -> list[str]:
    return _WORD.findall(s.lower().replace("&", " and "))


@lru_cache(maxsize=None)
def raw(cid: str) -> Optional[bytes]:
    """The layer file as served to the map (compact JSON), or None when not bundled."""
    p = CAMPUS_FILES.get(cid)
    if p is None or not p.exists():
        return None
    try:
        data = p.read_bytes()
        json.loads(data)
        return data
    except (OSError, ValueError):
        return None


@lru_cache(maxsize=None)
def load(cid: str) -> Optional[dict]:
    data = raw(cid)
    return json.loads(data) if data else None


def _term_score(term: str, rest: list[str]) -> int:
    tw = [w for w in words(term) if w not in _FILLER] or words(term)
    if not tw:
        return 0
    if rest == tw:
        return 100
    if all(any(t.startswith(w) for t in tw) for w in rest):
        return 70 + (10 if tw[0].startswith(rest[0]) else 0) - min(len(tw) - len(rest), 5)
    return 0


def campus_row(c: dict) -> dict:
    return {"name": f'{c["name"]}, Berhampur', "lat": c["center"][0], "lon": c["center"][1], "type": "poi",
            "kind": "University", "cat": "college", "address": c["address"], "campus": {"id": c["id"]}}


def building_row(c: dict, b: dict, section: Optional[str] = None) -> dict:
    if section:
        name, address, kind = f'{section}, {c["name"]}', f'In the {b["name"]}', "Campus section"
    else:
        name, kind = f'{b["name"]}, {c["name"]}', KIND_LABEL.get(b["kind"], "Campus building")
        address = b.get("about") or c["address"]
    return {"name": name, "lat": b["center"][0], "lon": b["center"][1], "type": "campus", "kind": kind,
            "cat": "campus", "address": address, "campus": {"id": c["id"], "building": b["id"]}}


def search(q: str, limit: int = 8) -> list[dict]:
    """Campus rows for a place query, best first ([] when the query is not about a campus)."""
    c = load("nist")
    if not c:
        return []
    ws = words(q)
    if not ws:
        return []
    text = " ".join(ws)
    at_campus = any(w in _CONTEXT_WORDS for w in ws) or any(p in text for p in _CONTEXT_PHRASES)
    rest = [w for w in ws if w not in _FILLER]
    named = [b for b in c["buildings"] if b.get("search", True)]
    if at_campus and not rest:            # "NIST", "NIST University Berhampur": the campus + its sections
        order = {k: i for i, k in enumerate(_KIND_ORDER)}
        top = sorted(named, key=lambda b: (order.get(b["kind"], 99), -b["area"]))
        return [campus_row(c)] + [building_row(c, b) for b in top][: max(0, limit - 1)]
    if not rest:
        return []
    if not at_campus and not any(w == t or (len(w) >= 4 and t.startswith(w)) for w in rest for t in _DISTINCT):
        return []                         # "library", "pool"... are only campus words after "NIST"
    hits: list[tuple[int, int, dict]] = []
    for i, b in enumerate(named):
        terms = [b["name"], b.get("label", "")] + list(b.get("aliases", []))
        s = max(_term_score(t, rest) for t in terms if t)
        if s:
            hits.append((s + 5, -i, building_row(c, b)))
        for sec in b.get("sections", []):
            s = _term_score(sec, rest)
            if s:
                hits.append((s, -i, building_row(c, b, sec)))
    hits.sort(key=lambda h: (h[0], h[1]), reverse=True)
    rows = [h[2] for h in hits[:limit]]
    if at_campus and not rows:            # "nist canteen" - at least take them to the campus
        rows = [campus_row(c)]
    return rows
