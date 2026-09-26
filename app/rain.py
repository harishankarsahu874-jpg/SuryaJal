"""Rooftop rainwater harvesting.

Harvest (litres) = roof area (m2) x rainfall (mm) x runoff coefficient
(1 mm of rain on 1 m2 = 1 litre). Solar panels do not reduce the harvest - rain runs
off the panels onto the same roof and into the same pipes.
"""
from __future__ import annotations

import math
from typing import Dict

from .config import DAYS_IN_MONTH, ROOF_TYPES

STANDARD_TANKS = [500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000]
RING_DIA_M = 1.0                                   # precast RCC recharge-well rings
RING_L_PER_M = math.pi * (RING_DIA_M / 2) ** 2 * 1000.0   # ~785 L per metre depth


def runoff_coefficient(roof_type: str) -> float:
    return ROOF_TYPES.get(roof_type, ROOF_TYPES["other"])["c"]


def suggest_tank(litres: float) -> Dict:
    for t in STANDARD_TANKS:
        if litres <= t:
            return {"litres": t, "text": f"{t:,} L tank"}
    if litres <= 20000:
        n = math.ceil(litres / 10000)
        return {"litres": n * 10000, "text": f"{n} x 10,000 L tanks or a sump"}
    m3 = math.ceil(litres / 1000)
    return {"litres": m3 * 1000, "text": f"underground sump of ~{m3} m3"}


def recharge_well(target_litres: float) -> Dict:
    depth = target_litres / RING_L_PER_M
    wells = max(1, math.ceil(depth / 6.0))          # keep each well <= 6 m deep
    each = max(2.0, math.ceil(depth / wells * 2) / 2)  # round up to 0.5 m, min 2 m
    return {"wells": wells, "diameter_m": RING_DIA_M, "depth_m": each,
            "capacity_l": wells * each * RING_L_PER_M}


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
    bwssb_min = roof_area_m2 * p["bwssb_l_per_m2"]
    well = recharge_well(bwssb_min)
    tankers = annual / p["tanker_litres"]
    wettest = max(range(12), key=lambda i: harvest[i])
    return {
        "runoff_c": c,
        "roof_type_label": ROOF_TYPES.get(p["roof_type"], ROOF_TYPES["other"])["label"],
        "monthly_rain_mm": rain_mm,
        "annual_rain_mm": sum(rain_mm),
        "monthly_harvest_l": harvest,
        "annual_harvest_l": annual,
        "monthly_demand_l": demand_m,
        "annual_demand_l": annual_demand,
        "coverage": annual / annual_demand if annual_demand else 0.0,
        "days_of_water": annual / demand_day if demand_day else 0.0,
        "storage_need_l": storage_need,
        "tank": tank,
        "bwssb_min_l": bwssb_min,
        "recharge_well": well,
        "tankers_saved": tankers,
        "tanker_savings": tankers * p["tanker_price"],
        "wettest_month": wettest,
        "wettest_harvest_l": harvest[wettest],
        "rain_overridden": bool(override),
    }


def green_score(solar_coverage: float, water_coverage: float, has_solar: bool) -> Dict:
    """0-100: 60 pts for covering the home's electricity with rooftop solar,
    40 pts for rainwater (covering 60 % of the yearly water demand earns full marks)."""
    s = 60.0 * min(1.0, solar_coverage if has_solar else 0.0)
    w = 40.0 * min(1.0, water_coverage / 0.6)
    score = round(s + w)
    grade = ("A+" if score >= 90 else "A" if score >= 75 else "B" if score >= 60
             else "C" if score >= 40 else "D")
    return {"score": score, "grade": grade, "solar_pts": round(s), "water_pts": round(w)}
