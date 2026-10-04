"""Rooftop rainwater harvesting for Odisha.

Harvest (litres) = roof area (m2) x rainfall (mm) x runoff coefficient
(1 mm of rain on 1 m2 = 1 litre). Solar panels do not reduce the harvest - rain runs
off the panels onto the same roof and into the same pipes.

Two Odisha rules shape the answer:

* **Odisha Development Authorities (Planning & Building Standards) Rules, 2020** -
  rainwater harvesting is mandatory on plots above 100 m2, ground-water recharge on
  plots above 225 m2, and "the dimension of recharging pits or trenches shall be at
  least 6 cubic metres for every 100 square metre of roof area", i.e. 60 litres of
  storage/recharge per m2 of roof, with two 100 mm downpipes per 100 m2 of roof.
* **CHHATA** (Dept. of Water Resources, Govt. of Odisha, FY 2022-23 to 2026-27) -
  50 % of the cost of the system or Rs 55,000, whichever is less, for homes with a roof
  of 50-200 m2 and at most three floors, provided a recharge unit is built.
"""
from __future__ import annotations

import math
from typing import Dict, List

from .config import (CHHATA, DAYS_IN_MONTH, ODA_DOWNPIPE_MM, ODA_DOWNPIPES_PER_100_M2,
                     ODA_RWH_L_PER_M2, ODA_RWH_PLOT_MIN_M2, ODA_RECHARGE_PLOT_MIN_M2,
                     ROOF_TYPES)

STANDARD_TANKS = [500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000]
RING_DIA_M = 1.0                                   # precast RCC recharge-well rings
RING_L_PER_M = math.pi * (RING_DIA_M / 2) ** 2 * 1000.0   # ~785 L per metre depth
M3 = 1000.0

RULE_NAME = "Odisha Development Authorities (Planning & Building Standards) Rules, 2020"
RULE_SHORT = "ODA Rules 2020 · 6 m³ of recharge per 100 m² of roof"


def runoff_coefficient(roof_type: str) -> float:
    return ROOF_TYPES.get(roof_type, ROOF_TYPES["other"])["c"]


def suggest_tank(litres: float) -> Dict:
    for t in STANDARD_TANKS:
        if litres <= t:
            return {"litres": t, "text": f"{t:,} L tank"}
    if litres <= 20000:
        n = math.ceil(litres / 10000)
        return {"litres": n * 10000, "text": f"{n} x 10,000 L tanks or a sump"}
    m3 = math.ceil(litres / M3)
    return {"litres": m3 * 1000, "text": f"underground sump of ~{m3} m3"}


def recharge_well(target_litres: float) -> Dict:
    depth = target_litres / RING_L_PER_M
    wells = max(1, math.ceil(depth / 6.0))          # keep each well <= 6 m deep
    each = max(2.0, math.ceil(depth / wells * 2) / 2)  # round up to 0.5 m, min 2 m
    return {"wells": wells, "diameter_m": RING_DIA_M, "depth_m": each,
            "capacity_l": wells * each * RING_L_PER_M}


def downpipes(roof_area_m2: float) -> Dict:
    """ODA Rules: two 100 mm rainwater pipes for every 100 m2 of roof."""
    n = max(2, math.ceil(roof_area_m2 / 100.0 * ODA_DOWNPIPES_PER_100_M2))
    return {"count": n, "diameter_mm": ODA_DOWNPIPE_MM}


def chhata(roof_area_m2: float, floors: int, cost_per_m2: float, enabled: bool = True) -> Dict:
    """Govt. of Odisha CHHATA rooftop rainwater subsidy for this roof."""
    area = float(roof_area_m2)
    est_cost = max(0.0, area * float(cost_per_m2))
    reasons: List[str] = []
    if not enabled:
        reasons.append("Switched off in Assumptions")
    if area < CHHATA["roof_min_m2"]:
        reasons.append(f"Roof is under {CHHATA['roof_min_m2']:.0f} m² "
                       f"({CHHATA['roof_min_m2'] * 10.76:.0f} sq ft)")
    if area > CHHATA["roof_max_m2"]:
        reasons.append(f"Roof is over {CHHATA['roof_max_m2']:.0f} m² - the scheme covers "
                       f"50-200 m² (bigger buildings: recharge is still mandatory)")
    if floors > CHHATA["max_floors"]:
        reasons.append(f"Building has more than {CHHATA['max_floors']} floors")
    eligible = not reasons
    subsidy = min(est_cost * CHHATA["share_of_cost"], CHHATA["max_subsidy"]) if eligible else 0.0
    return {
        "eligible": eligible,
        "reasons": reasons,
        "est_cost": est_cost,
        "cost_per_m2": float(cost_per_m2),
        "subsidy": subsidy,
        "share_of_cost": CHHATA["share_of_cost"],
        "max_subsidy": CHHATA["max_subsidy"],
        "net_cost": max(0.0, est_cost - subsidy),
        "roof_min_m2": CHHATA["roof_min_m2"],
        "roof_max_m2": CHHATA["roof_max_m2"],
        "max_floors": CHHATA["max_floors"],
        "scheme_years": CHHATA["scheme_years"],
        "portal": CHHATA["portal"],
        "note": ("Apply through your ULB / the Directorate of Ground Water Development. A "
                 "recharge unit (dug well, bore well or tube well) is compulsory for the "
                 "subsidy, and your ULB must be one of the 27 in the scheme."),
    }


def assess_rain(roof_area_m2: float, climate: Dict, p: Dict) -> Dict:
    c = runoff_coefficient(p["roof_type"])
    rain_mm = [r * d for r, d in zip(climate["rain_mm_day"], DAYS_IN_MONTH)]
    override = p.get("rain_override_mm")
    if override:
        total = sum(rain_mm)
        if total > 0:
            rain_mm = [r * float(override) / total for r in rain_mm]
    harvest = [roof_area_m2 * r * c for r in rain_mm]
    annual = sum(harvest)
    family = max(1, int(p["family_size"]))
    demand_day = family * p["lpcd"]
    demand_m = [demand_day * d for d in DAYS_IN_MONTH]
    annual_demand = demand_day * 365

    storage_need = roof_area_m2 * p["design_rain_mm"] * c
    tank = suggest_tank(storage_need)
    l_per_m2 = float(p.get("rwh_l_per_m2") or ODA_RWH_L_PER_M2)
    rule_min = roof_area_m2 * l_per_m2
    well = recharge_well(rule_min)
    tankers = annual / p["tanker_litres"]
    wettest = max(range(12), key=lambda i: harvest[i])
    planned = tank["litres"] + well["capacity_l"]
    monsoon = sum(harvest[6:10])                      # Jul-Oct, the Odisha monsoon
    return {
        "runoff_c": c,
        "roof_type_label": ROOF_TYPES.get(p["roof_type"], ROOF_TYPES["other"])["label"],
        "monthly_rain_mm": rain_mm,
        "annual_rain_mm": sum(rain_mm),
        "monthly_harvest_l": harvest,
        "annual_harvest_l": annual,
        "monsoon_harvest_l": monsoon,
        "monsoon_share": monsoon / annual if annual else 0.0,
        "monthly_demand_l": demand_m,
        "annual_demand_l": annual_demand,
        "coverage": annual / annual_demand if annual_demand else 0.0,
        "days_of_water": annual / demand_day if demand_day else 0.0,
        "storage_need_l": storage_need,
        "tank": tank,
        "rule_min_l": rule_min,
        "rule": {"name": RULE_NAME, "short": RULE_SHORT, "l_per_m2": l_per_m2,
                 "m3_per_100m2": l_per_m2 / 10.0,
                 "mandate_plot_m2": ODA_RWH_PLOT_MIN_M2,
                 "recharge_plot_m2": ODA_RECHARGE_PLOT_MIN_M2},
        "planned_l": planned,
        "meets_rule": planned >= rule_min - 1e-9,
        "rule_gap_l": max(0.0, rule_min - planned),
        "recharge_well": well,
        "downpipes": downpipes(roof_area_m2),
        "chhata": chhata(roof_area_m2, int(p.get("floors") or 1),
                         p.get("rrhs_cost_per_m2", 600), bool(p.get("chhata", True))),
        "tankers_saved": tankers,
        "tanker_savings": tankers * p["tanker_price"],
        "wettest_month": wettest,
        "wettest_harvest_l": harvest[wettest],
        "rain_overridden": bool(override),
    }


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


# where the bundled Odisha climate actually sits (data/climate_fallback.json):
# specific yield ~1330-1500 kWh/kWp/yr, rain ~1335-1850 mm/yr
SUN_LO, SUN_HI = 1300.0, 1520.0
RAIN_LO, RAIN_HI = 1300.0, 1850.0


def green_score(solar: Dict, rain: Dict) -> Dict:
    """0-100 Green Score - honest, and it moves with the place and the roof.

    The design tools always *size* solar to cover the bill and always *plan*
    rainwater to meet the Odisha norm, so "coverage" and "meets rule" alone can't
    tell a great roof from a mediocre one - that's why every report used to print
    100/A+. The score also credits what genuinely varies:

      Solar /55 = 35 bill covered + 10 sunshine quality + 10 payback speed
      Water /35 = 20 water covered + 8 rainfall + 7 months the rain alone meets demand
      Rule  /10 = Odisha 6 m³ per 100 m² norm met
    """
    has_solar = (solar.get("panels") or 0) > 0
    s_cov = 35.0 * _clamp(float(solar.get("coverage") or 0.0))
    s_sun = 10.0 * _clamp((float(solar.get("specific_yield") or 0.0) - SUN_LO) / (SUN_HI - SUN_LO))
    payback = solar.get("payback_years")
    s_val = 10.0 * _clamp((6.0 - float(payback)) / 4.0) if payback else 0.0
    if not has_solar:                       # roof too small for panels: no solar credit
        s_cov = s_sun = s_val = 0.0
    s = s_cov + s_sun + s_val

    w_cov = 20.0 * _clamp(float(rain.get("coverage") or 0.0))
    w_rain = 8.0 * _clamp((float(rain.get("annual_rain_mm") or 0.0) - RAIN_LO) / (RAIN_HI - RAIN_LO))
    harv = rain.get("monthly_harvest_l") or []
    dem = rain.get("monthly_demand_l") or []
    months = sum(1 for h, d in zip(harv, dem) if d > 0 and h >= d)   # self-sufficient months
    w_mon = 7.0 * _clamp((months - 3.0) / 4.0)
    w = w_cov + w_rain + w_mon

    r = 10.0 if rain.get("meets_rule") else 0.0

    score = round(s + w + r)
    grade = ("A+" if score >= 90 else "A" if score >= 80 else "B" if score >= 68
             else "C" if score >= 50 else "D")
    return {"score": score, "grade": grade, "solar_pts": round(s), "water_pts": round(w),
            "rule_pts": round(r)}
