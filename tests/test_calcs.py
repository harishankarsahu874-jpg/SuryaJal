"""Unit tests for the solar, rainwater, geometry and layout maths.  Run:  pytest -q"""
import math

import pytest

from app.config import DEFAULTS
from app.geo import (decode_polyline, encode_polyline, from_local_m, latlon_to_px,
                     meters_per_px, polygon_area_m2, px_to_latlon)
from app.layout import auto_layout
from app.rain import assess_rain, green_score, recharge_well, suggest_tank
from app.solar import (assess_solar, kerc_export_rate, pm_surya_ghar_subsidy, size_system,
                       yield_per_kwp)

# NASA POWER climatology for Bengaluru (2001-2020)
BLR = {
    "ghi": [5.4953, 6.2806, 6.607, 6.5966, 6.222, 5.328, 4.7582, 4.8199, 5.2908, 5.0251, 4.6637, 4.7525],
    "rain_mm_day": [0.08, 0.16, 0.54, 1.91, 3.54, 2.54, 3.22, 3.63, 5.05, 4.54, 1.87, 0.48],
    "t2m": [21.1, 23.52, 26.75, 28.37, 26.97, 24.28, 23.54, 23.31, 23.15, 22.54, 21.14, 20.22],
}


def P(**kw):
    return {**DEFAULTS, **kw}


# ------------------------------------------------------------------ subsidy / tariffs
@pytest.mark.parametrize("kw,expected", [(0, 0), (1, 30000), (2, 60000), (2.5, 69000),
                                         (3, 78000), (5, 78000), (10, 78000)])
def test_pm_surya_ghar_subsidy(kw, expected):
    assert pm_surya_ghar_subsidy(kw) == pytest.approx(expected)


def test_kerc_export_rates():
    assert kerc_export_rate(1.5, True) == 1.96
    assert kerc_export_rate(2.7, True) == 2.14
    assert kerc_export_rate(4.0, True) == 2.58
    assert kerc_export_rate(2.0, False) == 3.89


# ------------------------------------------------------------------ solar
def test_bengaluru_specific_yield_is_plausible():
    y = sum(yield_per_kwp(BLR["ghi"], BLR["t2m"], DEFAULTS))
    assert 1400 < y < 1700          # rule of thumb: 1 kW makes ~4-4.6 units/day in Bengaluru


def test_hot_months_have_lower_performance_ratio():
    ypk = yield_per_kwp([5.0] * 12, [15.0] * 6 + [35.0] * 6, DEFAULTS)
    assert ypk[0] / 31 > ypk[6] / 31   # same sunlight, hotter -> less energy


def test_sizing_limited_by_consumption():
    s = size_system(200, 250 * 12, 1550, P())
    assert s["limited_by"] == "consumption"
    assert s["panels"] == math.ceil((3000 / 1550) / 0.54)     # 4 panels
    assert s["kw"] == pytest.approx(s["panels"] * 0.54)


def test_sizing_limited_by_roof():
    s = size_system(20, 1000 * 12, 1550, P())      # 14 m2 usable -> 1.4 kW max
    assert s["limited_by"] == "roof"
    assert s["panels"] == 2 and s["kw"] == pytest.approx(1.08)


def test_tiny_roof_gets_no_panels_but_no_crash():
    s = assess_solar(5, BLR, P())
    assert s["panels"] == 0 and s["payback_years"] is None


def test_solar_money_consistency():
    s = assess_solar(150, BLR, P())
    assert sum(s["monthly_gen"]) == pytest.approx(s["annual_gen"])
    assert s["net_cost"] == pytest.approx(s["gross_cost"] - s["subsidy"])
    assert s["payback_years"] == pytest.approx(s["net_cost"] / s["annual_savings"])
    assert 2 < s["payback_years"] < 8
    assert s["co2_t_year"] == pytest.approx(s["annual_gen"] * 0.71 / 1000)


def test_layout_cap_limits_panels():
    s = assess_solar(300, BLR, P(monthly_units=2000), layout_max_panels=3)
    assert s["panels"] == 3


# ------------------------------------------------------------------ rain
def test_rain_litres_formula():
    r = assess_rain(100, BLR, P(rain_override_mm=1000, roof_type="rcc"))
    assert r["annual_harvest_l"] == pytest.approx(100 * 1000 * 0.85)   # 1 mm on 1 m2 = 1 L


def test_bwssb_minimum_and_recharge_well():
    r = assess_rain(100, BLR, P())
    assert r["bwssb_min_l"] == 2000
    w = r["recharge_well"]
    assert w["wells"] == 1 and w["depth_m"] == 3.0          # 2000 L / 785 L per m = 2.55 m -> 3 m
    assert w["capacity_l"] >= 2000


def test_recharge_well_splits_when_deep():
    w = recharge_well(12000)                                   # 15.3 m of 1 m rings
    assert w["wells"] == 3 and w["depth_m"] <= 6.0
    assert w["capacity_l"] >= 12000


def test_tank_suggestions():
    assert suggest_tank(640)["litres"] == 750
    assert suggest_tank(12000)["litres"] == 20000
    assert "sump" in suggest_tank(45000)["text"]


def test_green_score_bounds():
    assert green_score(1.0, 1.0, True)["score"] == 100
    assert green_score(0.0, 0.0, False)["score"] == 0
    assert green_score(0.5, 0.3, True) == {"score": 50, "grade": "C", "solar_pts": 30, "water_pts": 20}


# ------------------------------------------------------------------ geometry
def test_mercator_roundtrip():
    for lat, lon in [(12.9716, 77.5946), (28.61, 77.21), (-33.9, 151.2)]:
        x, y = latlon_to_px(lat, lon, 19)
        la, lo = px_to_latlon(x, y, 19)
        assert la == pytest.approx(lat, abs=1e-9) and lo == pytest.approx(lon, abs=1e-9)


def test_ground_resolution():
    assert meters_per_px(0, 19) == pytest.approx(0.29858, rel=1e-4)
    assert meters_per_px(12.97, 19) == pytest.approx(0.29858 * math.cos(math.radians(12.97)), rel=1e-4)


def test_polygon_area_of_20m_square():
    sq = from_local_m([(0, 0), (20, 0), (20, 20), (0, 20)], (12.97, 77.59))
    assert polygon_area_m2(sq) == pytest.approx(400, rel=2e-3)


def test_polyline_roundtrip():
    pts = [(12.9285874, 77.5820667), (12.9284642, 77.5820639), (12.9284562, 77.5821079), (-1.5, -80.25)]
    back = decode_polyline(encode_polyline(pts))
    assert all(abs(a - c) < 1e-6 and abs(b - d) < 1e-6 for (a, b), (c, d) in zip(pts, back))


# ------------------------------------------------------------------ panel layout
def test_layout_on_rectangle_roof():
    roof = from_local_m([(0, 0), (12, 0), (12, 8), (0, 8)], (12.97, 77.59))
    lay = auto_layout(roof, None, DEFAULTS)
    assert 8 <= lay["max_panels"] <= 30
    lats = [p[0] for p in roof]
    lons = [p[1] for p in roof]
    for panel in lay["panels"]:
        for la, lo in panel:
            assert min(lats) - 1e-7 <= la <= max(lats) + 1e-7
            assert min(lons) - 1e-7 <= lo <= max(lons) + 1e-7
    assert len(auto_layout(roof, 4, DEFAULTS)["panels"]) == 4
