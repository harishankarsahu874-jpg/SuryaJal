"""Rooftop-solar sizing and economics.

Monthly energy  E_m = kWp x GHI_m x days_m x PR_m
PR_m            = system_eff x [1 + temp_coeff x (T_air_m + cell_rise - 25)]
System size     = min(what the roof can hold, what the household needs)
Savings         = self-used units x tariff + exported units x export rate (monthly net metering)
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

from .config import DAYS_IN_MONTH, KERC_EXPORT_NO_SUBSIDY, KERC_EXPORT_WITH_SUBSIDY


def pm_surya_ghar_subsidy(kw: float) -> float:
    """Central subsidy: Rs 30,000/kW for the first 2 kW, Rs 18,000 for the 3rd kW, max Rs 78,000."""
    kw = max(0.0, kw)
    return 30000 * min(kw, 2.0) + 18000 * max(0.0, min(kw, 3.0) - 2.0)


def kerc_export_rate(kw: float, subsidy: bool) -> float:
    if not subsidy:
        return KERC_EXPORT_NO_SUBSIDY
    for upto, rate in KERC_EXPORT_WITH_SUBSIDY:
        if kw <= upto:
            return rate
    return KERC_EXPORT_WITH_SUBSIDY[-1][1]


def monthly_pr(t2m: List[float], system_eff: float, temp_coeff: float, cell_rise: float) -> List[float]:
    return [system_eff * (1 + temp_coeff * max(0.0, t + cell_rise - 25.0)) for t in t2m]


def yield_per_kwp(ghi: List[float], t2m: List[float], p: Dict) -> List[float]:
    """kWh produced per installed kWp in each month."""
    pr = monthly_pr(t2m, p["system_eff"], p["temp_coeff"], p["cell_temp_rise"])
    return [g * d * r for g, d, r in zip(ghi, DAYS_IN_MONTH, pr)]


def size_system(roof_area_m2: float, annual_units: float, annual_yield_kwp: float, p: Dict,
                layout_max_panels: Optional[int] = None) -> Dict:
    """Panels = min(what fits on the roof, what the family needs).
    p["panels"] (optional) lets the user pick their own count, capped by the roof."""
    panel_kw = p["panel_w"] / 1000.0
    usable = roof_area_m2 * p["usable_fraction"]
    roof_kw = usable / p["m2_per_kw"]
    n_roof = int(math.floor(roof_kw / panel_kw + 1e-9))
    if layout_max_panels is not None:
        n_roof = min(n_roof, int(layout_max_panels))
    need_kw = annual_units / annual_yield_kwp if annual_yield_kwp > 0 else 0.0
    n_need = int(math.ceil(need_kw / panel_kw - 1e-9)) if annual_units > 0 else n_roof
    n = max(0, min(n_roof, n_need))
    override = p.get("panels")
    chosen = override is not None and override != ""
    if chosen:
        n = max(0, min(n_roof, int(override)))
    return {
        "panels": n,
        "auto_panels": max(0, min(n_roof, n_need)),
        "user_chosen": bool(chosen),
        "kw": round(n * panel_kw, 3),
        "usable_area_m2": usable,
        "roof_max_panels": n_roof,
        "roof_max_kw": round(n_roof * panel_kw, 3),
        "need_kw": need_kw,
        "limited_by": "choice" if chosen else ("roof" if n_roof < n_need else "consumption"),
    }


def irr(cashflows: List[float]) -> Optional[float]:
    """Internal rate of return by bisection (cashflows[0] is the upfront cost, negative)."""
    if not cashflows or cashflows[0] >= 0 or sum(cashflows) <= 0:
        return None

    def npv(r: float) -> float:
        return sum(cf / (1 + r) ** t for t, cf in enumerate(cashflows))

    lo, hi = -0.99, 10.0
    if npv(hi) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(mid) > 0:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-7:
            break
    return (lo + hi) / 2


def assess_solar(roof_area_m2: float, climate: Dict, p: Dict,
                 layout_max_panels: Optional[int] = None) -> Dict:
    ypk = yield_per_kwp(climate["ghi"], climate["t2m"], p)
    annual_ypk = sum(ypk)
    monthly_units = float(p["monthly_units"])
    annual_units = monthly_units * 12
    size = size_system(roof_area_m2, annual_units, annual_ypk, p, layout_max_panels)
    kw = size["kw"]

    gen = [kw * y for y in ypk]
    cons = [monthly_units] * 12
    self_used = [min(g, c) for g, c in zip(gen, cons)]
    exported = [max(0.0, g - c) for g, c in zip(gen, cons)]
    subsidy_on = bool(p["subsidy"])
    export_rate = p["export_rate"] if p.get("export_rate") not in (None, "", "auto") \
        else kerc_export_rate(kw, subsidy_on)
    tariff = float(p["tariff"])
    savings_m = [s * tariff + e * export_rate for s, e in zip(self_used, exported)]
    annual_gen = sum(gen)
    annual_savings = sum(savings_m)

    gross_cost = kw * p["cost_per_kw"]
    subsidy = min(pm_surya_ghar_subsidy(kw), gross_cost) if subsidy_on else 0.0
    net_cost = gross_cost - subsidy
    payback = net_cost / annual_savings if annual_savings > 0 else None

    life = int(p["life_years"])
    deg = float(p["degradation"])
    life_factor = sum((1 - deg) ** y for y in range(life))
    lifetime_savings = annual_savings * life_factor
    yearly_savings = [annual_savings * (1 - deg) ** y for y in range(life)]
    irr_value = irr([-net_cost] + yearly_savings) if net_cost > 0 else None
    co2_t_year = annual_gen * p["co2_kg_per_kwh"] / 1000.0
    co2_t_life = co2_t_year * life_factor
    bill_before = annual_units * tariff

    # Full-roof potential (if the family wants to maximise export income)
    full_kw = size["roof_max_kw"]
    full_gen = full_kw * annual_ypk

    return {
        **size,
        "specific_yield": annual_ypk,                     # kWh / kWp / year
        "daily_units_per_kw": annual_ypk / 365.0,
        "monthly_yield_per_kwp": ypk,
        "monthly_gen": gen,
        "monthly_consumption": cons,
        "monthly_savings": savings_m,
        "annual_gen": annual_gen,
        "annual_units": annual_units,
        "self_used": sum(self_used),
        "exported": sum(exported),
        "coverage": min(1.0, annual_gen / annual_units) if annual_units > 0 else 1.0,
        "tariff": tariff,
        "export_rate": export_rate,
        "gross_cost": gross_cost,
        "subsidy": subsidy,
        "net_cost": net_cost,
        "annual_savings": annual_savings,
        "monthly_savings_avg": annual_savings / 12.0,
        "bill_before": bill_before,
        "payback_years": payback,
        "lifetime_years": life,
        "lifetime_savings": lifetime_savings,
        "lifetime_profit": lifetime_savings - net_cost,
        "yearly_savings": yearly_savings,
        "irr": irr_value,
        "co2_t_year": co2_t_year,
        "co2_t_life": co2_t_life,
        "trees_equiv": co2_t_year * 1000.0 / p["kg_co2_per_tree_year"],
        "full_roof_kw": full_kw,
        "full_roof_gen": full_gen,
        "pr_avg": annual_ypk / max(1e-9, sum(g * d for g, d in zip(climate["ghi"], DAYS_IN_MONTH))),
    }
