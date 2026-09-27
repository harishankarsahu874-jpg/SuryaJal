"""Anonymous "fest counter": how many roofs were assessed today and their total
solar + rainwater potential. Stores only totals + short hashes (no locations)."""
from __future__ import annotations

import datetime as dt
import json
import threading

from .config import RUNTIME_DIR

_FILE = RUNTIME_DIR / "stats.json"
_lock = threading.Lock()


def _empty():
    return {"roofs": 0, "kw": 0.0, "litres": 0.0, "co2_t": 0.0}


def _load():
    if _FILE.exists():
        try:
            return json.loads(_FILE.read_text())
        except Exception:
            pass
    return {"days": {}, "total": _empty()}


def record(key: str, kw: float, litres: float, co2_t: float) -> None:
    today = dt.date.today().isoformat()
    with _lock:
        d = _load()
        day = d["days"].setdefault(today, {**_empty(), "keys": []})
        if key in day["keys"]:
            return
        day["keys"] = (day["keys"] + [key])[-5000:]
        for tgt in (day, d["total"]):
            tgt["roofs"] += 1
            tgt["kw"] += kw
            tgt["litres"] += litres
            tgt["co2_t"] += co2_t
        try:
            _FILE.parent.mkdir(parents=True, exist_ok=True)
            _FILE.write_text(json.dumps(d))
        except OSError:
            pass


def summary() -> dict:
    d = _load()
    today = d["days"].get(dt.date.today().isoformat(), _empty())
    strip = lambda x: {k: round(v, 2) for k, v in x.items() if k != "keys"}  # noqa: E731
    return {"today": strip(today), "total": strip(d["total"])}
