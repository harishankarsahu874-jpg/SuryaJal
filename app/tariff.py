"""OERC (Odisha Electricity Regulatory Commission) domestic electricity billing.

Odisha does not use one flat rate per unit like most calculators assume. The LT
"Domestic (other than Kutir Jyoti)" tariff is **telescopic**:

    first 50 units        Rs 2.90 / unit
    next 150 (51-200)     Rs 4.70 / unit
    next 200 (201-400)    Rs 5.70 / unit
    above 400 units       Rs 6.10 / unit

plus Rs 20 per kW of sanctioned load per month, plus electricity duty (~4 %), with a
10 paise/unit prompt-payment rebate. Rates are common to TPCODL, TPNODL, TPWODL and
TPSODL and were left unchanged for FY 2026-27 (fifth year running).

Because the tariff is slabbed, the honest way to value rooftop solar is to bill the home
*without* solar and *with* solar and take the difference - a unit of solar replaces the
**most expensive** unit you would have bought, not an average one.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from .config import (OERC_DOMESTIC_SLABS, OERC_DUTY_PCT, OERC_FIXED_CHARGE_PER_KW,
                     OERC_KUTIR_JYOTI_CHARGE, OERC_KUTIR_JYOTI_UNITS,
                     OERC_REBATE_PER_UNIT, TARIFF_FY)

Slabs = Sequence[Sequence[float]]


def energy_charge(units: float, slabs: Slabs = OERC_DOMESTIC_SLABS) -> float:
    """Telescopic energy charge for a month's consumption."""
    units = max(0.0, float(units))
    cost, prev = 0.0, 0.0
    for upto, rate in slabs:
        band = min(units, upto) - prev
        if band <= 0:
            break
        cost += band * rate
        prev = upto
    return cost


def marginal_rate(units: float, slabs: Slabs = OERC_DOMESTIC_SLABS) -> float:
    """Rate that applies to the last unit consumed - what a solar unit displaces."""
    units = max(0.0, float(units))
    prev = 0.0
    for upto, rate in slabs:
        if units <= upto:
            return rate
        prev = upto
    return slabs[-1][1]


def monthly_bill(units: float, load_kw: float = 0.0,
                 slabs: Slabs = OERC_DOMESTIC_SLABS,
                 fixed_per_kw: float = OERC_FIXED_CHARGE_PER_KW,
                 duty_pct: float = OERC_DUTY_PCT,
                 rebate: bool = False) -> Dict:
    """Full monthly domestic bill, itemised."""
    units = max(0.0, float(units))
    kutir = units <= OERC_KUTIR_JYOTI_UNITS and units > 0
    energy = 0.0 if kutir else energy_charge(units, slabs)
    fixed = OERC_KUTIR_JYOTI_CHARGE if kutir else max(0.0, load_kw) * fixed_per_kw
    duty = (energy + fixed) * duty_pct / 100.0
    reb = min(units, 0.0) if kutir else (OERC_REBATE_PER_UNIT * units if rebate else 0.0)
    total = max(0.0, energy + fixed + duty - reb)
    return {
        "units": units,
        "kutir_jyoti": kutir,
        "energy": energy,
        "fixed": fixed,
        "duty": duty,
        "rebate": reb,
        "total": total,
        "effective_rate": total / units if units > 0 else 0.0,
        "marginal_rate": 0.0 if kutir else marginal_rate(units, slabs),
    }


def annual_bill(monthly_units: Sequence[float], load_kw: float = 0.0, **kw) -> Dict:
    bills = [monthly_bill(u, load_kw, **kw) for u in monthly_units]
    total = sum(b["total"] for b in bills)
    units = sum(b["units"] for b in bills)
    return {"monthly": bills, "total": total, "units": units,
            "effective_rate": total / units if units > 0 else 0.0}


def slab_table(slabs: Slabs = OERC_DOMESTIC_SLABS) -> List[Dict]:
    """The tariff card, for the UI and the PDF."""
    rows, prev = [], 0.0
    for upto, rate in slabs:
        rows.append({
            "from": int(prev) + (1 if prev else 0),
            "to": None if upto == float("inf") else int(upto),
            "label": (f"above {int(prev)} units" if upto == float("inf")
                      else f"{int(prev) + (1 if prev else 0)} – {int(upto)} units"),
            "rate": rate,
        })
        prev = upto
    return rows


def flat_rate_override(units: float, rate: Optional[float], load_kw: float = 0.0) -> Optional[Dict]:
    """If the user typed their own Rs/unit in Assumptions, bill with that instead."""
    if rate in (None, "", 0):
        return None
    units = max(0.0, float(units))
    energy = units * float(rate)
    fixed = max(0.0, load_kw) * OERC_FIXED_CHARGE_PER_KW
    total = energy + fixed
    return {"units": units, "kutir_jyoti": False, "energy": energy, "fixed": fixed,
            "duty": 0.0, "rebate": 0.0, "total": total,
            "effective_rate": total / units if units > 0 else 0.0,
            "marginal_rate": float(rate)}


TARIFF_LABEL = (f"OERC domestic {TARIFF_FY}: Rs 2.90 / 4.70 / 5.70 / 6.10 per unit "
                f"(telescopic) + Rs {OERC_FIXED_CHARGE_PER_KW:.0f}/kW/month "
                f"+ {OERC_DUTY_PCT:.0f} % electricity duty")
