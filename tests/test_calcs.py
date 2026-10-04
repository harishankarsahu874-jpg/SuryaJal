"""Unit tests for the Odisha solar, rainwater, tariff, geometry and layout maths.

Run:  pytest -q
"""
import math

import pytest

from app import odisha
from app.config import (CHHATA, DEFAULTS, DISCOMS, ODA_RWH_L_PER_M2, OERC_DUTY_PCT,
                        OERC_EXPORT_FIT, OERC_FIXED_CHARGE_PER_KW, OERC_NET_METER_CAP)
from app.geo import (decode_polyline, encode_polyline, from_local_m, latlon_to_px,
                     meters_per_px, polygon_area_m2, px_to_latlon)
from app.layout import auto_layout
from app.rain import assess_rain, chhata, downpipes, green_score, recharge_well, suggest_tank
from app.solar import (assess_solar, net_meter_limit, odisha_state_subsidy,
                       pm_surya_ghar_subsidy, size_system, subsidies, yield_per_kwp)
from app.tariff import energy_charge, marginal_rate, monthly_bill, slab_table

# ------------------------------------------------------------------ fixtures
BBSR = next(p for p in odisha.points() if p["name"] == "Bhubaneswar")
# NASA POWER climatology 2001-2020 for Bhubaneswar (bundled offline in data/)
CLIMATE = {"ghi": BBSR["ghi"], "rain_mm_day": BBSR["rain_mm_day"], "t2m": BBSR["t2m"]}
# the Bhubaneswar demo roof: a real 177 m2 house in Ward 27
DEMO_POLY = [(20.2954465, 85.8139218), (20.2953165, 85.8139877),
             (20.2953639, 85.8140812), (20.2954939, 85.8140152)]


def P(**kw):
    return {**DEFAULTS, **kw}


# ------------------------------------------------------------------ OERC tariff
def test_odisha_domestic_slabs_are_telescopic():
    # 300 units: 50 x 2.90 + 150 x 4.70 + 100 x 5.70 = 1420
    assert energy_charge(300) == pytest.approx(1420.0)
    assert energy_charge(50) == pytest.approx(145.0)
    assert energy_charge(200) == pytest.approx(850.0)
    assert energy_charge(500) == pytest.approx(2600.0)      # + 100 x 6.10


def test_odisha_bill_300_units_2kw():
    b = monthly_bill(300, 2.0)
    assert b["energy"] == pytest.approx(1420.0)
    assert b["fixed"] == pytest.approx(2 * OERC_FIXED_CHARGE_PER_KW)
    assert b["duty"] == pytest.approx((1420 + 40) * OERC_DUTY_PCT / 100)
    assert b["total"] == pytest.approx(1518.40)
    assert b["marginal_rate"] == pytest.approx(5.70)
    assert 4.5 < b["effective_rate"] < 5.5


def test_kutir_jyoti_is_a_flat_charge():
    b = monthly_bill(25, 1.0)
    assert b["kutir_jyoti"] is True
    assert b["energy"] == 0.0 and b["fixed"] == pytest.approx(70.0)
    assert b["total"] == pytest.approx(70 * (1 + OERC_DUTY_PCT / 100))
    assert monthly_bill(31, 1.0)["kutir_jyoti"] is False


def test_marginal_rate_walks_the_slabs():
    assert marginal_rate(0) == 2.90 and marginal_rate(50) == 2.90
    assert marginal_rate(51) == 4.70 and marginal_rate(200) == 4.70
    assert marginal_rate(201) == 5.70 and marginal_rate(400) == 5.70
    assert marginal_rate(401) == 6.10 and marginal_rate(5000) == 6.10


def test_slab_table_is_printable():
    t = slab_table()
    assert [r["rate"] for r in t] == [2.90, 4.70, 5.70, 6.10]
    assert t[0]["label"].startswith("0") and t[-1]["to"] is None


# ------------------------------------------------------------------ subsidies
@pytest.mark.parametrize("kw,expected", [(0, 0), (1, 30000), (2, 60000), (2.5, 69000),
                                         (3, 78000), (5, 78000), (10, 78000)])
def test_pm_surya_ghar_subsidy(kw, expected):
    assert pm_surya_ghar_subsidy(kw) == pytest.approx(expected)


@pytest.mark.parametrize("kw,expected", [(0, 0), (1, 25000), (2, 50000), (2.5, 55000),
                                         (3, 60000), (5, 60000)])
def test_odisha_state_subsidy(kw, expected):
    assert odisha_state_subsidy(kw) == pytest.approx(expected)


def test_both_subsidies_stack_up_to_1_38_lakh_at_3kw():
    both = subsidies(3.0)
    assert both["central"] == pytest.approx(78000)
    assert both["state"] == pytest.approx(60000)
    assert both["total"] == pytest.approx(138000)
    assert subsidies(3.0, central=True, state=False)["total"] == pytest.approx(78000)
    assert subsidies(3.0, central=False, state=True)["total"] == pytest.approx(60000)
    assert subsidies(0.5)["total"] == pytest.approx(27500)


# ------------------------------------------------------------------ solar physics
def test_bhubaneswar_specific_yield_is_plausible():
    y = sum(yield_per_kwp(CLIMATE["ghi"], CLIMATE["t2m"], DEFAULTS))
    assert 1200 < y < 1600            # ~3.3-4.4 units/day per kW in coastal Odisha
    assert 3.2 < y / 365 < 4.5


def test_odisha_climate_table_covers_every_district():
    pts = odisha.points()
    assert len(pts) == 32
    assert len({p["district"] for p in pts}) == 30        # all 30 districts
    assert {p["discom"] for p in pts} == set(DISCOMS)     # all four Tata Power DISCOMs
    for p in pts:
        assert len(p["ghi"]) == len(p["rain_mm_day"]) == len(p["t2m"]) == 12
        rain = sum(r * n for r, n in zip(p["rain_mm_day"],
                                         [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]))
        assert 1000 < rain < 2500                          # Odisha normals
        assert 4.0 < sum(p["ghi"]) / 12 < 5.6


@pytest.mark.parametrize("lat,lon,district,discom", [
    (20.2961, 85.8245, "Khurda", "TPCODL"),        # Bhubaneswar
    (20.4625, 85.8830, "Cuttack", "TPCODL"),       # Cuttack
    (22.2600, 84.8400, "Sundargarh", "TPWODL"),    # Rourkela
    (19.3131, 84.7941, "Ganjam", "TPSODL"),        # Berhampur
    (21.4991, 86.9317, "Balasore", "TPNODL"),      # Balasore
])
def test_district_and_discom_lookup(lat, lon, district, discom):
    loc = odisha.locate(lat, lon)
    assert loc["district"] == district and loc["discom"] == discom
    assert loc["discom_name"].startswith("TP")
    assert odisha.in_odisha(lat, lon)


def test_place_outside_odisha_is_flagged():
    assert odisha.in_odisha(12.9716, 77.5946) is False     # Bengaluru
    assert odisha.locate(12.9716, 77.5946)["district"] != "Khurda"


def test_hot_months_have_lower_performance_ratio():
    ypk = yield_per_kwp([5.0] * 12, [15.0] * 6 + [35.0] * 6, DEFAULTS)
    assert ypk[0] > ypk[6]                # same sunlight, hotter -> less energy


# ------------------------------------------------------------------ sizing
def test_sizing_limited_by_consumption():
    s = size_system(200, 250 * 12, 1352, P())
    assert s["limited_by"] == "consumption"
    assert s["panels"] == math.ceil((3000 / 1352) / 0.54)   # 5 panels
    assert s["kw"] == pytest.approx(s["panels"] * 0.54)


def test_sizing_limited_by_roof():
    s = size_system(20, 1000 * 12, 1352, P())      # 14 m2 usable -> 1.4 kW max
    assert s["limited_by"] == "roof"
    assert s["panels"] == 2 and s["kw"] == pytest.approx(1.08)


def test_tiny_roof_gets_no_panels_but_no_crash():
    s = assess_solar(5, CLIMATE, P())
    assert s["panels"] == 0 and s["payback_years"] is None
    assert s["annual_savings"] == pytest.approx(0.0)


def test_layout_cap_limits_panels():
    s = assess_solar(300, CLIMATE, P(monthly_units=2000), layout_max_panels=3)
    assert s["panels"] == 3


# ------------------------------------------------------------------ solar money
def test_solar_money_consistency():
    s = assess_solar(150, CLIMATE, P())
    assert sum(s["monthly_gen"]) == pytest.approx(s["annual_gen"])
    assert sum(s["monthly_bill_before"]) == pytest.approx(s["bill_before"])
    assert sum(s["monthly_bill_after"]) == pytest.approx(s["bill_after"])
    assert s["bill_before"] == pytest.approx(12 * monthly_bill(250, 3.0)["total"])
    assert s["bill_after"] < s["bill_before"]
    assert s["annual_savings"] == pytest.approx(
        s["bill_before"] - s["bill_after"] + s["export_income"])
    assert s["net_cost"] == pytest.approx(s["gross_cost"] - s["subsidy"])
    assert s["subsidy"] == pytest.approx(s["subsidy_central"] + s["subsidy_state"])
    assert s["payback_years"] == pytest.approx(s["net_cost"] / s["annual_savings"])
    assert 0.8 < s["payback_years"] < 3.0          # both subsidies on: very fast payback
    assert s["co2_t_year"] == pytest.approx(s["annual_gen"] * 0.71 / 1000)


def test_without_subsidies_payback_is_still_reasonable():
    s = assess_solar(150, CLIMATE, P(subsidy=False, state_subsidy=False))
    assert s["subsidy"] == 0.0 and s["net_cost"] == pytest.approx(s["gross_cost"])
    assert 6 < s["payback_years"] < 14


def test_export_rate_defaults_to_the_gridco_appc():
    s = assess_solar(150, CLIMATE, P())
    assert s["export_rate"] == pytest.approx(OERC_EXPORT_FIT) and s["export_rate_auto"]
    assert assess_solar(150, CLIMATE, P(export_rate=2.5))["export_rate"] == pytest.approx(2.5)


def test_oerc_caps_credited_generation_at_90_percent_of_consumption():
    """OERC: "electricity generated from a Solar PV project shall be capped cumulatively at
    90 % of the electricity consumption ... at the end of the settlement period". Generation
    above that is free energy - it is neither offset nor paid for."""
    s = assess_solar(177, CLIMATE, P(monthly_units=300))
    assert s["coverage"] == pytest.approx(1.0)
    assert s["exported"] > 0
    assert s["credit_limit_units"] == pytest.approx(0.9 * 300 * 12)
    # self-consumption alone already uses up the whole 90 % allowance
    assert s["self_used"] > s["credit_limit_units"]
    assert s["export_paid"] == pytest.approx(0.0)
    assert s["export_lapsed"] == pytest.approx(s["exported"])
    assert s["export_income"] == pytest.approx(0.0)
    # lift the cap to 100 % and the leftover export is settled at the feed-in tariff
    loose = assess_solar(177, CLIMATE, P(monthly_units=300, net_meter_cap=1.0))
    assert loose["export_paid"] > 0
    assert loose["export_income"] == pytest.approx(loose["export_paid"] * OERC_EXPORT_FIT)


def test_sizing_to_your_own_bill_is_the_right_call_in_odisha():
    """Because of the 90 % cap, an oversized plant earns no extra money."""
    sized = assess_solar(400, CLIMATE, P(monthly_units=200))            # auto: 2.16 kW
    forced = assess_solar(400, CLIMATE, P(monthly_units=200, panels=sized["roof_max_panels"]))
    assert forced["kw"] > sized["kw"]
    assert forced["export_lapsed"] > sized["export_lapsed"]
    assert forced["annual_savings"] <= sized["annual_savings"] + 1


def test_net_metering_is_limited_by_sanctioned_load():
    s = assess_solar(150, CLIMATE, P(monthly_units=600, sanctioned_load_kw=1.0))
    assert s["net_metering"]["ok"] is False
    assert s["net_metering"]["need_kw"] == pytest.approx(s["kw"] - 1.0, abs=0.01)
    assert net_meter_limit(2.0, 3.0)["ok"] is True
    assert net_meter_limit(600, 1000)["ok"] is False       # above the 500 kW state cap


def test_flat_tariff_override_replaces_the_slabs():
    s = assess_solar(150, CLIMATE, P(tariff=7.0))
    assert s["tariff_override"] is True
    assert s["bill_before"] == pytest.approx(3000 * 7.0 + 12 * 3 * OERC_FIXED_CHARGE_PER_KW)
    assert assess_solar(150, CLIMATE, P(tariff=None))["tariff_override"] is False


# ------------------------------------------------------------------ rainwater
def test_rain_litres_formula():
    r = assess_rain(100, CLIMATE, P(rain_override_mm=1000, roof_type="rcc"))
    assert r["annual_harvest_l"] == pytest.approx(100 * 1000 * 0.85)   # 1 mm on 1 m2 = 1 L


def test_odisha_rule_is_60_litres_per_m2_of_roof():
    r = assess_rain(150, CLIMATE, P())
    assert ODA_RWH_L_PER_M2 == 60.0
    assert r["rule_min_l"] == pytest.approx(150 * 60)
    assert r["rule"]["m3_per_100m2"] == pytest.approx(6.0)
    assert r["planned_l"] == pytest.approx(r["tank"]["litres"] + r["recharge_well"]["capacity_l"])
    assert r["meets_rule"] is (r["planned_l"] >= r["rule_min_l"] - 1e-9)
    assert r["downpipes"] == downpipes(150)


def test_recharge_well_is_sized_to_the_rule():
    r = assess_rain(150, CLIMATE, P())
    w = r["recharge_well"]
    assert w["capacity_l"] >= r["rule_min_l"]
    assert w["diameter_m"] == 1.0 and w["depth_m"] <= 6.0
    assert recharge_well(12000)["wells"] == 3              # 15.3 m of 1 m rings -> 3 wells


def test_downpipes_follow_the_oda_norm():
    assert downpipes(50)["count"] == 2                     # minimum two
    assert downpipes(100)["count"] == 2
    assert downpipes(150)["count"] == 3
    assert downpipes(1000)["count"] == 20
    assert downpipes(150)["diameter_mm"] == 100


def test_tank_suggestions():
    assert suggest_tank(640)["litres"] == 750
    assert suggest_tank(12000)["litres"] == 20000
    assert "sump" in suggest_tank(45000)["text"]


def test_monsoon_share_is_most_of_the_year():
    r = assess_rain(150, CLIMATE, P())
    assert 0.55 < r["monsoon_share"] < 0.9                 # Jul-Oct carries the Odisha monsoon
    assert r["wettest_month"] in (6, 7, 8)


# ------------------------------------------------------------------ CHHATA
def test_chhata_subsidy_for_an_eligible_home():
    c = chhata(150, 2, 600)
    assert c["eligible"] and c["reasons"] == []
    assert c["est_cost"] == pytest.approx(150 * 600)
    assert c["subsidy"] == pytest.approx(0.5 * 150 * 600)   # 50 % of cost
    assert c["net_cost"] == pytest.approx(c["est_cost"] - c["subsidy"])


def test_chhata_caps_at_55000():
    c = chhata(200, 3, 800)                                 # cost 1.6 lakh -> 50 % = 80,000
    assert CHHATA["max_subsidy"] == pytest.approx(55000)
    assert c["subsidy"] == pytest.approx(CHHATA["max_subsidy"])


@pytest.mark.parametrize("area,floors,on", [(40, 2, True), (250, 2, True), (150, 4, True),
                                            (150, 2, False)])
def test_chhata_rejects_out_of_scope_homes(area, floors, on):
    c = chhata(area, floors, 600, enabled=on)
    assert c["eligible"] is False and c["subsidy"] == 0.0 and c["reasons"]


def test_assess_rain_reports_chhata_for_the_roof():
    r = assess_rain(150, CLIMATE, P())
    assert r["chhata"]["eligible"] is True
    assert assess_rain(150, CLIMATE, P(chhata=False))["chhata"]["eligible"] is False
    assert assess_rain(150, CLIMATE, P(floors=5))["chhata"]["eligible"] is False


# ------------------------------------------------------------------ green score
def test_green_score_honest_and_location_sensitive():
    """Not a constant 100/A+ anymore - the score moves with the place (sun, rain)
    and the roof (coverage, payback, months the rain alone meets demand)."""
    # genuinely exceptional: everything maxed -> a real 100
    top = green_score({"panels": 6, "coverage": 1.2, "specific_yield": 1520.0, "payback_years": 1.0},
                      {"coverage": 2.0, "annual_rain_mm": 1850.0, "meets_rule": True,
                       "monthly_harvest_l": [5000] * 12, "monthly_demand_l": [1000] * 12})
    assert top["score"] == 100 and top["grade"] == "A+"
    assert (top["solar_pts"], top["water_pts"], top["rule_pts"]) == (55, 35, 10)

    # no panels, no rain, no rule -> zero
    zero = green_score({"panels": 0, "coverage": 0.0, "specific_yield": 1300.0, "payback_years": None},
                       {"coverage": 0.0, "annual_rain_mm": 900.0, "meets_rule": False,
                        "monthly_harvest_l": [0] * 12, "monthly_demand_l": [1000] * 12})
    assert zero == {"score": 0, "grade": "D", "solar_pts": 0, "water_pts": 0, "rule_pts": 0}

    # the SAME fully-covering roof in a drier, less sunny, slower-payback corner
    # of Odisha scores visibly lower - 100 is not for everyone
    dry = green_score({"panels": 6, "coverage": 1.0, "specific_yield": 1330.0, "payback_years": 5.0},
                      {"coverage": 1.0, "annual_rain_mm": 1335.0, "meets_rule": True,
                       "monthly_harvest_l": [12000, 12000, 900, 12000, 12000, 12000, 12000,
                                             12000, 12000, 900, 800, 700],
                       "monthly_demand_l": [1000] * 12})
    assert 70 <= dry["score"] <= 85 and dry["grade"] == "B"
    assert dry["score"] < top["score"] and dry["water_pts"] < top["water_pts"]

    # a roof too small for panels can't score solar points however sunny the place
    tiny = green_score({"panels": 0, "coverage": 0.0, "specific_yield": 1520.0, "payback_years": 1.0},
                       {"coverage": 3.0, "annual_rain_mm": 1850.0, "meets_rule": True,
                        "monthly_harvest_l": [5000] * 12, "monthly_demand_l": [1000] * 12})
    assert tiny["solar_pts"] == 0 and tiny["score"] == top["score"] - 55


# ------------------------------------------------------------------ surface check
def test_classify_surface_ponds_and_fields():
    import numpy as np
    from app.segment import classify_surface

    green = np.zeros((64, 64, 3), np.uint8) + np.array([60, 130, 70], np.uint8)   # BGR vegetation
    water = np.zeros((64, 64, 3), np.uint8) + np.array([110, 80, 60], np.uint8)   # dark blue water
    tile = np.zeros((64, 64, 3), np.uint8) + np.array([80, 110, 200], np.uint8)   # terracotta roof
    grey = np.zeros((64, 64, 3), np.uint8) + np.array([150, 150, 150], np.uint8)  # concrete roof
    m = np.ones((64, 64), bool)
    assert classify_surface(green, m) == "vegetation"
    assert classify_surface(water, m) == "water"
    assert classify_surface(tile, m) == "built"
    assert classify_surface(grey, m) == "built"


# ------------------------------------------------------------------ geometry
def test_mercator_roundtrip():
    for lat, lon in [(20.2961, 85.8245), (22.26, 84.84), (-33.9, 151.2)]:
        x, y = latlon_to_px(lat, lon, 19)
        la, lo = px_to_latlon(x, y, 19)
        assert la == pytest.approx(lat, abs=1e-9) and lo == pytest.approx(lon, abs=1e-9)


def test_ground_resolution():
    assert meters_per_px(0, 19) == pytest.approx(0.29858, rel=1e-4)
    assert meters_per_px(20.30, 19) == pytest.approx(0.29858 * math.cos(math.radians(20.30)),
                                                     rel=1e-4)


def test_polygon_area_of_20m_square():
    sq = from_local_m([(0, 0), (20, 0), (20, 20), (0, 20)], (20.2961, 85.8245))
    assert polygon_area_m2(sq) == pytest.approx(400, rel=2e-3)


def test_demo_roof_is_about_177_m2():
    assert polygon_area_m2(DEMO_POLY) == pytest.approx(177, rel=0.05)


def test_polyline_roundtrip():
    pts = DEMO_POLY + [(-1.5, -80.25)]
    back = decode_polyline(encode_polyline(pts))
    assert all(abs(a - c) < 1e-6 and abs(b - d) < 1e-6 for (a, b), (c, d) in zip(pts, back))


# ------------------------------------------------------------------ panel layout
def test_layout_on_rectangle_roof():
    roof = from_local_m([(0, 0), (12, 0), (12, 8), (0, 8)], (20.2961, 85.8245))
    lay = auto_layout(roof, None, DEFAULTS)
    assert 4 <= lay["max_panels"] <= 30
    lats = [p[0] for p in roof]
    lons = [p[1] for p in roof]
    for panel in lay["panels"]:
        for la, lo in panel:
            assert min(lats) - 1e-7 <= la <= max(lats) + 1e-7
            assert min(lons) - 1e-7 <= lo <= max(lons) + 1e-7
    assert len(auto_layout(roof, 4, DEFAULTS)["panels"]) == 4
