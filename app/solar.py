"""Rooftop-solar sizing and economics for Odisha.

Monthly energy  E_m = kWp x GHI_m x days_m x PR_m
PR_m            = system_eff x [1 + temp_coeff x (T_air_m + cell_rise - 25)]
System size     = min(what the roof can hold, what the household needs)
Money           = the OERC domestic bill **without** solar minus the bill **with** solar
                  (telescopic slabs, so a solar unit displaces your dearest unit),
                  plus the export settled at the OERC feed-in tariff, subject to the
                  90 %-of-consumption net-metering cap.
Subsidy         = PM Surya Ghar central assistance + Odisha's State Financial Assistance.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

from .config import (CFA_CAP, CFA_PER_KW_FIRST_2, CFA_THIRD_KW, DAYS_IN_MONTH,
                     OERC_EXPORT_FIT, OERC_MAX_NM_KW, OERC_NET_METER_CAP, SFA_CAP,
                     SFA_PER_KW_FIRST_2, SFA_THIRD_KW)
from .tariff import flat_rate_override, marginal_rate, monthly_bill


# ------------------------------------------------------------------ subsidies
def pm_surya_ghar_subsidy(kw: float) -> float:
    """Central financial assistance: Rs 30,000/kW for the first 2 kW, Rs 18,000 for the
    3rd kW, capped at Rs 78,000 (PM Surya Ghar: Muft Bijli Yojana)."""
    kw = max(0.0, kw)
    return min(CFA_CAP, CFA_PER_KW_FIRST_2 * min(kw, 2.0)
               + CFA_THIRD_KW * max(0.0, min(kw, 3.0) - 2.0))


def odisha_state_subsidy(kw: float) -> float:
    """Odisha State Financial Assistance on top of the central subsidy: Rs 25,000/kW up to
    2 kW + Rs 10,000 for the 3rd kW, capped at Rs 60,000 (Cabinet decision 03.01.2025,
    3 lakh households, FY 2024-25 to FY 2026-27)."""
    kw = max(0.0, kw)
    return min(SFA_CAP, SFA_PER_KW_FIRST_2 * min(kw, 2.0)
               + SFA_THIRD_KW * max(0.0, min(kw, 3.0) - 2.0))


def subsidies(kw: float, central: bool = True, state: bool = True) -> Dict:
    """Both subsidies, never more than the system actually costs."""
    cfa = pm_surya_ghar_subsidy(kw) if central else 0.0
    sfa = odisha_state_subsidy(kw) if state else 0.0
    return {"central": cfa, "state": sfa, "total": cfa + sfa,
            "capped_at": CFA_CAP if central else 0.0, "sfa_cap": SFA_CAP if state else 0.0}


# ------------------------------------------------------------------ net metering
def net_meter_limit(kw: float, sanctioned_load_kw: float) -> Dict:
    """OERC allows net metering up to the sanctioned load (max 500 kW)."""
    limit = max(0.0, min(float(sanctioned_load_kw or 0.0), OERC_MAX_NM_KW))
    return {"ok": kw <= limit + 1e-9, "limit_kw": limit, "kw": kw,
            "need_kw": round(max(0.0, kw - limit), 2),
            "state_cap_kw": OERC_MAX_NM_KW}


# ------------------------------------------------------------------ physics
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


# ------------------------------------------------------------------ the assessment
def _bill(units: float, p: Dict) -> Dict:
    """One month's OERC domestic bill, or the user's flat rate if they typed one."""
    override = flat_rate_override(units, p.get("tariff"), p.get("sanctioned_load_kw", 0.0))
    if override is not None:
        return override
    return monthly_bill(units, p.get("sanctioned_load_kw", 0.0))


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
    load = float(p.get("sanctioned_load_kw") or 0.0)

    # ---- month by month: what you import, what you export, what each bill looks like
    imports = [max(0.0, c - g) for g, c in zip(gen, cons)]
    exports = [max(0.0, g - c) for g, c in zip(gen, cons)]
    bill_before_m = [_bill(c, p)["total"] for c in cons]
    bill_after_m = [_bill(i, p)["total"] for i in imports]
    bill_saving_m = [b - a for b, a in zip(bill_before_m, bill_after_m)]

    self_used = sum(min(g, c) for g, c in zip(gen, cons))
    total_export = sum(exports)

    # ---- OERC net metering: credits carry forward inside the financial year, and only
    #      90 % of the year's consumption can be offset by solar generation.
    cap = float(p.get("net_meter_cap", OERC_NET_METER_CAP))
    creditable_gen = cap * annual_units
    export_paid = min(total_export, max(0.0, creditable_gen - self_used))
    lapsed = max(0.0, total_export - export_paid)
    subsidy_on = bool(p.get("subsidy", True))
    state_on = bool(p.get("state_subsidy", True))
    export_rate = p["export_rate"] if p.get("export_rate") not in (None, "", "auto") \
        else OERC_EXPORT_FIT
    export_income = export_paid * float(export_rate)
    savings_m = [s for s in bill_saving_m]
    annual_savings = sum(savings_m) + export_income

    annual_gen = sum(gen)
    bill_before = sum(bill_before_m)
    bill_after = sum(bill_after_m)
    units_after = sum(imports)
    tariff_used = p.get("tariff")
    effective_rate = bill_before / annual_units if annual_units > 0 else 0.0
    marginal = marginal_rate(monthly_units) if tariff_used in (None, "", 0) else float(tariff_used)

    gross_cost = kw * p["cost_per_kw"]
    sub = subsidies(kw, subsidy_on, state_on)
    subsidy = min(sub["total"], gross_cost)
    # keep the split proportional if the system is cheaper than the paper subsidy
    if sub["total"] > 0 and subsidy < sub["total"]:
        k = subsidy / sub["total"]
        sub_central, sub_state = sub["central"] * k, sub["state"] * k
    else:
        sub_central, sub_state = sub["central"], sub["state"]
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
        "monthly_import": imports,
        "monthly_export": exports,
        "monthly_bill_before": bill_before_m,
        "monthly_bill_after": bill_after_m,
        "monthly_savings": savings_m,
        "annual_gen": annual_gen,
        "annual_units": annual_units,
        "annual_units_after": units_after,
        "self_used": self_used,
        "exported": total_export,
        "export_paid": export_paid,
        "export_lapsed": lapsed,
        "export_income": export_income,
        "net_meter_cap": cap,
        "credit_limit_units": creditable_gen,
        "coverage": min(1.0, annual_gen / annual_units) if annual_units > 0 else 1.0,
        # money
        "tariff": effective_rate,                         # all-in Rs/unit you pay today
        "tariff_marginal": marginal,                      # Rs/unit your last unit costs
        "tariff_override": bool(tariff_used not in (None, "", 0)),
        "sanctioned_load_kw": load,
        "export_rate": export_rate,
        "export_rate_auto": p.get("export_rate") in (None, "", "auto"),
        "gross_cost": gross_cost,
        "subsidy": subsidy,
        "subsidy_central": sub_central,
        "subsidy_state": sub_state,
        "net_cost": net_cost,
        "bill_before": bill_before,
        "bill_after": bill_after,
        "annual_savings": annual_savings,
        "monthly_savings_avg": annual_savings / 12.0,
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
        "net_metering": net_meter_limit(kw, load),
        "pr_avg": annual_ypk / max(1e-9, sum(g * d for g, d in zip(climate["ghi"], DAYS_IN_MONTH))),
    }
