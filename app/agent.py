"""SuryaJal AI Agent — context-aware solar & rainwater harvesting assistant.

Answers user queries grounded in their selected roof's exact assessment (solar sizing,
OERC slab bills, PM Surya Ghar + Odisha SFA subsidies, net metering, rainwater harvest,
tank & recharge pit sizing, ODA Rules 2020, CHHATA eligibility, and Green Score),
including live "what-if" recalculations on their roof.

Works 100% offline with zero API keys by default, and optionally upgrades to an
OpenAI-compatible or Gemini LLM if configured via environment variables
(SURYAJAL_AI_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY).
"""
from __future__ import annotations

import copy
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .config import (CHHATA, DEFAULTS, DISCOMS, MONTH_LABELS, OERC_DOMESTIC_SLABS,
                     OERC_DUTY_PCT, OERC_EXPORT_FIT, OERC_FIXED_CHARGE_PER_KW,
                     OERC_NET_METER_CAP, ROOF_TYPES, SFA_WINDOW, TARIFF_FY)
from .rain import assess_rain, green_score
from .solar import assess_solar, odisha_state_subsidy, pm_surya_ghar_subsidy
from .tariff import monthly_bill

MONTHS_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ------------------------------------------------------------------ Indian number formatting
def fmt_in(n: float, decimals: int = 0) -> str:
    if n is None or not math.isfinite(float(n)):
        return "0"
    neg = float(n) < 0
    val = abs(float(n))
    if decimals > 0:
        whole_str, frac_str = f"{val:.{decimals}f}".split(".")
    else:
        whole_str, frac_str = str(int(round(val))), ""
    if len(whole_str) > 3:
        head, tail = whole_str[:-3], whole_str[-3:]
        groups = []
        while len(head) > 2:
            groups.append(head[-2:])
            head = head[:-2]
        if head:
            groups.append(head)
        whole_str = ",".join(reversed(groups)) + "," + tail
    out = f"{whole_str}.{frac_str}" if frac_str else whole_str
    return f"-{out}" if neg else out


def rs(n: float) -> str:
    neg = float(n or 0) < 0
    return f"{'−' if neg else ''}₹{fmt_in(abs(float(n or 0)))}"


def litres_fmt(n: float) -> str:
    val = float(n or 0)
    if val >= 100_000:
        return f"{val / 100_000:.2f} lakh L ({fmt_in(val)} L)"
    return f"{fmt_in(val)} L"


def sqft(m2: float) -> float:
    return float(m2 or 0) * 10.7639


def _units_from_bill(target_bill: float, load_kw: float = 3.0) -> float:
    """Invert the OERC monthly bill (slabs + fixed charge + duty) to monthly kWh."""
    if target_bill <= 0:
        return 0.0
    lo, hi = 0.0, 25000.0
    for _ in range(45):
        mid = (lo + hi) / 2.0
        if monthly_bill(mid, load_kw)["total"] < target_bill:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2.0)


# ------------------------------------------------------------------ live what-if simulator
def _detect_what_if(msg: str, a: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Detect hypothetical 'what if ...' parameters and recompute exact physics/tariffs."""
    area = float(a.get("area_m2") or 0)
    climate = a.get("climate") or {}
    if area < 4 or not climate.get("ghi") or not climate.get("rain_mm_day"):
        return None

    low = msg.lower()
    whatif_cue = any(w in low for w in (
        "what if", "suppose", "if i ", "if my ", "if we ", "what about ",
        "agar ", "maan lo", "instead of", "increase to", "reduce to",
        "without subsidy", "no subsidy", "commercial", "full roof", "max panel",
        "maximum panel", "all panels", "entire roof",
    ))

    base_params = {**DEFAULTS, **(a.get("params") or {})}
    new_params = copy.deepcopy(base_params)
    layout_max = (a.get("layout") or {}).get("max_panels")
    changes: List[str] = []

    # 1. Full roof / maximum panels
    if any(p in low for p in ("full roof", "max panel", "maximum panel", "max capacity",
                              "maximum solar", "entire roof", "fill the roof", "all panels")):
        max_p = int((a.get("solar") or {}).get("roof_max_panels") or 0)
        if max_p > 0:
            new_params["panels"] = max_p
            changes.append(f"filling the roof with the maximum **{max_p} panels**")

    # 2. Specific panel count ("what if 8 panels", "install 10 panels")
    m_pan = re.search(r"\b(\d{1,3})\s*(?:solar\s+)?panels?\b", low)
    if m_pan and (whatif_cue or "panel" in low and any(x in low for x in ("put", "install", "use", "add", "with", "for"))):
        n_p = max(0, min(400, int(m_pan.group(1))))
        if n_p != (a.get("solar") or {}).get("panels"):
            new_params["panels"] = n_p
            changes.append(f"**{n_p} panels**")

    # 3. Specific kW system ("what if 3 kw", "install a 5 kw system")
    if "panels" not in " ".join(changes):
        m_kw = re.search(r"\b(\d+(?:\.\d+)?)\s*kwp?\b", low)
        if m_kw and whatif_cue and "load" not in low:
            kw_target = float(m_kw.group(1))
            pw = float(new_params.get("panel_w") or 540)
            n_p = max(1, min(400, round(kw_target * 1000.0 / pw)))
            new_params["panels"] = n_p
            changes.append(f"~**{kw_target:g} kW** ({n_p} × {int(pw)} W panels)")

    # 4. Monthly bill in rupees ("what if my bill is 3000", "bill of ₹2,500")
    m_bill = re.search(
        r"(?:bill\s*(?:is|of|around|=)?\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]{2,6})|(?:rs\.?|inr|₹)\s*(\d[\d,]{2,6})\s*(?:monthly\s+)?bill)",
        low,
    )
    if m_bill:
        raw = (m_bill.group(1) or m_bill.group(2)).replace(",", "")
        bill_val = float(raw)
        if 100 <= bill_val <= 200_000:
            u = _units_from_bill(bill_val, float(new_params.get("sanctioned_load_kw") or 3.0))
            new_params["monthly_units"] = u
            if "panels" not in " ".join(changes):
                new_params["panels"] = None
            changes.append(f"a monthly bill of **{rs(bill_val)}** (~**{fmt_in(u)} units/month**)")

    # 5. Monthly electricity units ("what if 400 units", "consume 500 kwh")
    m_units = re.search(r"\b(\d{2,5})\s*(?:units?|kwh)\b", low)
    if m_units and not m_bill and (whatif_cue or any(x in low for x in ("use", "consume", "consumption", "monthly"))):
        u = float(m_units.group(1))
        if u != float(base_params.get("monthly_units") or 250):
            new_params["monthly_units"] = min(100_000.0, u)
            if "panels" not in " ".join(changes):
                new_params["panels"] = None
            changes.append(f"**{fmt_in(u)} units/month** consumption")

    # 6. Family size / occupants ("what if 6 people", "family of 8")
    m_fam = re.search(r"(?:family\s+(?:of|size)\s*(\d{1,3})|\b(\d{1,3})\s*(?:people|persons|members|occupants)\b)", low)
    if m_fam and whatif_cue:
        fam = max(1, min(100, int(m_fam.group(1) or m_fam.group(2))))
        if fam != int(base_params.get("family_size") or 4):
            new_params["family_size"] = fam
            changes.append(f"**{fam} people** using the building")

    # 7. Floors ("what if 4 floors", "3 storey")
    m_fl = re.search(r"\b(\d{1,2})\s*(?:floors?|storeys?|stories)\b", low)
    if m_fl and whatif_cue:
        fl = max(1, min(30, int(m_fl.group(1))))
        if fl != int(base_params.get("floors") or 2):
            new_params["floors"] = fl
            changes.append(f"**{fl} floors**")

    # 8. Roof material ("metal roof", "clay tile roof", "gi sheet")
    if whatif_cue:
        for rt_key, kws in (
            ("metal", ("metal roof", "gi sheet", "metal sheet", "tin roof")),
            ("tile", ("tile roof", "clay tile", "terracotta")),
            ("asbestos", ("asbestos", "cement sheet", "ac sheet")),
            ("rcc", ("rcc roof", "concrete roof", "flat roof")),
        ):
            if any(k in low for k in kws) and rt_key != base_params.get("roof_type"):
                new_params["roof_type"] = rt_key
                changes.append(f"**{ROOF_TYPES[rt_key]['label']}** (runoff {ROOF_TYPES[rt_key]['c']})")
                break

    # 9. Without subsidy / commercial building
    if any(k in low for k in ("without subsidy", "no subsidy", "zero subsidy",
                              "commercial", "office", "shop", "business", "institution")):
        if base_params.get("subsidy") or base_params.get("state_subsidy"):
            new_params["subsidy"] = False
            new_params["state_subsidy"] = False
            new_params["chhata"] = False
            changes.append("**no residential subsidies** (commercial / unsubsidised case)")

    if not changes:
        return None

    sim_solar = assess_solar(area, climate, new_params, layout_max_panels=layout_max)
    sim_rain = assess_rain(area, climate, new_params)
    sim_score = green_score(sim_solar, sim_rain)
    return ", ".join(changes), {
        "solar": sim_solar,
        "rain": sim_rain,
        "score": sim_score,
        "params": new_params,
    }


def _format_what_if(label: str, cur: Dict[str, Any], sim: Dict[str, Any]) -> str:
    cs, CR = cur.get("solar") or {}, cur.get("rain") or {}
    ss, sr, sg = sim["solar"], sim["rain"], sim["score"]
    lines = [f"Here is the live simulation for your roof with {label}:"]

    if (ss.get("panels") != cs.get("panels")
            or round(ss.get("annual_savings", 0)) != round(cs.get("annual_savings", 0))
            or round(ss.get("net_cost", 0)) != round(cs.get("net_cost", 0))):
        pb = f"{ss['payback_years']:.1f} years" if ss.get("payback_years") else "—"
        lines.append(
            f"\n**Solar impact:**\n"
            f"- **System size:** {ss['kw']:.2f} kW ({ss['panels']} panels, max roof fit is {ss['roof_max_panels']} panels / {ss['roof_max_kw']:.2f} kW)\n"
            f"- **Annual generation:** {fmt_in(ss['annual_gen'])} kWh/yr (~{fmt_in(ss['annual_gen'] / 12)} kWh/month)\n"
            f"- **Cost & subsidy:** {rs(ss['gross_cost'])} gross − {rs(ss['subsidy'])} subsidy = **{rs(ss['net_cost'])}** net cost\n"
            f"- **Yearly bill savings:** **{rs(ss['annual_savings'])}/yr** (~{rs(ss['monthly_savings_avg'])}/month) · Payback: **{pb}**"
        )
        if ss.get("export_lapsed", 0) > 5:
            lines.append(
                f"- *Note:* About **{fmt_in(ss['export_lapsed'])} kWh/yr** of surplus export would lapse on 31 March "
                f"under OERC's {int(ss['net_meter_cap'] * 100)}% consumption credit cap."
            )

    if (round(sr.get("annual_harvest_l", 0)) != round(CR.get("annual_harvest_l", 0))
            or round(sr.get("coverage", 0), 3) != round(CR.get("coverage", 0), 3)
            or sr["chhata"]["eligible"] != CR.get("chhata", {}).get("eligible")):
        ch = sr["chhata"]
        ch_txt = (f"Eligible for **{rs(ch['subsidy'])}** subsidy (you pay {rs(ch['net_cost'])})"
                  if ch["eligible"] else f"Not eligible ({'; '.join(ch['reasons'])})")
        lines.append(
            f"\n**Rainwater impact:**\n"
            f"- **Annual harvest:** {litres_fmt(sr['annual_harvest_l'])}\n"
            f"- **Household coverage:** **{round(sr['coverage'] * 100)}%** of yearly water demand ({fmt_in(sr['days_of_water'])} days of water)\n"
            f"- **CHHATA status:** {ch_txt}"
        )

    lines.append(
        f"\n**Updated Green Score:** **{sg['score']}/100 (Grade {sg['grade']})**. "
        f"You can also move the sliders on the **Solar**, **Rainwater**, or **Report → Assumptions** sections to apply this directly to your report!"
    )
    return "\n".join(lines)


# ------------------------------------------------------------------ topic builders
def _loc_label(a: Dict[str, Any], address: str) -> str:
    loc = a.get("location") or {}
    parts = []
    if address and address.strip():
        parts.append(address.strip())
    elif loc.get("district"):
        parts.append(f"{loc['district']} district, Odisha")
    else:
        parts.append("your selected roof")
    return parts[0]


def _discom_str(a: Dict[str, Any]) -> str:
    loc = a.get("location") or {}
    if loc.get("discom") and loc.get("discom_name"):
        return f"{loc['discom']} ({loc['discom_name']})"
    if loc.get("discom"):
        return str(loc["discom"])
    return "your Odisha DISCOM (TPCODL / TPNODL / TPWODL / TPSODL)"


def _topic_overview(a: Dict[str, Any], address: str) -> str:
    area = float(a.get("area_m2") or 0)
    s = a.get("solar") or {}
    r = a.get("rain") or {}
    g = a.get("score") or {}
    place = _loc_label(a, address)
    discom = (a.get("location") or {}).get("discom") or "Odisha DISCOM"

    if (s.get("panels") or 0) <= 0:
        return (
            f"Here is the complete summary for **{place}** (**{fmt_in(area)} m²** / {fmt_in(sqft(area))} sq ft):\n\n"
            f"- **Solar:** After keeping the 0.5 m safety walkway and usable roof share, this roof outline is too compact for full-size {int((a.get('params') or {}).get('panel_w', 540))} W panels. If part of your terrace was missed, tap **Back to map** to drag the yellow corners!\n"
            f"- **Rainwater Harvesting:** Captures **{litres_fmt(r.get('annual_harvest_l', 0))}** per year (~**{round((r.get('coverage') or 0) * 100)}%** of water demand), paired with a **{fmt_in((r.get('tank') or {}).get('litres', 0))} L** tank.\n"
            f"- **Green Score:** **{g.get('score', 0)}/100 (Grade {g.get('grade', '—')})**."
        )

    pb = f"{s['payback_years']:.1f} years" if s.get("payback_years") else "—"
    ch = r.get("chhata") or {}
    ch_line = f" plus **{rs(ch['subsidy'])}** CHHATA rainwater subsidy" if ch.get("eligible") and ch.get("subsidy") else ""
    return (
        f"Here is your personalized assessment for **{place}** (**{fmt_in(area)} m²** / {fmt_in(sqft(area))} sq ft · {discom}):\n\n"
        f"- **Recommended Solar:** **{s['kw']:.2f} kW** ({s['panels']} panels, up to {s['roof_max_panels']} max on roof) generating **{fmt_in(s['annual_gen'])} kWh/yr**.\n"
        f"- **Solar Cost & Savings:** **{rs(s['net_cost'])}** out-of-pocket (after **{rs(s['subsidy'])}** subsidy) · saves **{rs(s['annual_savings'])}/yr** · recovers cost in **{pb}**.\n"
        f"- **Rainwater Harvesting:** **{litres_fmt(r['annual_harvest_l'])}** harvested/yr (**{round(r['coverage'] * 100)}%** of water needs) with a **{fmt_in(r['tank']['litres'])} L** tank + **{fmt_in(r['recharge_well']['capacity_l'])} L** recharge pit{ch_line}.\n"
        f"- **Green Score:** **{g['score']}/100 (Grade {g['grade']})** · offsets **{s['co2_t_year']:.1f} tonnes CO₂/yr**."
    )


def _topic_solar_subsidy_cost(a: Dict[str, Any], address: str) -> str:
    s = a.get("solar") or {}
    p = a.get("params") or DEFAULTS
    is_campus = "nist university" in (address or "").lower()
    if (s.get("panels") or 0) <= 0:
        max_sub = pm_surya_ghar_subsidy(3.0) + odisha_state_subsidy(3.0)
        return (
            f"Right now this roof outline (**{fmt_in(a.get('area_m2', 0))} m²**) is too small to fit a standard {int(p.get('panel_w', 540))} W solar panel with a 0.5 m safety setback.\n\n"
            f"For Odisha homes that fit 1–3 kW+ systems, subsidies combine:\n"
            f"- **PM Surya Ghar (Central):** ₹30,000/kW up to 2 kW + ₹18,000 for the 3rd kW (max **₹78,000**)\n"
            f"- **Odisha SFA (State top-up):** ₹25,000/kW up to 2 kW + ₹10,000 for the 3rd kW (max **₹60,000**)\n"
            f"- **Combined max subsidy:** **{rs(max_sub)}** at 3 kW!"
        )

    pb = f"{s['payback_years']:.1f} years" if s.get("payback_years") else "—"
    irr_txt = f" (**{s['irr'] * 100:.1f}% IRR**)" if s.get("irr") is not None else ""
    campus_note = (
        "\n\n*Note:* Since this looks like an institutional/campus building, keep in mind that **PM Surya Ghar** and **Odisha SFA** apply to residential domestic connections — you can toggle subsidies off in **Report → Assumptions** to inspect unsubsidised institutional economics."
        if is_campus and s.get("subsidy", 0) > 0 else ""
    )
    return (
        f"For your **{s['kw']:.2f} kW** ({s['panels']}-panel) solar system, here is the full cost & subsidy breakdown:\n\n"
        f"- **Estimated Installed Cost:** **{rs(s['gross_cost'])}** (@ {rs(p.get('cost_per_kw', 55000))}/kW via OREDA-empanelled vendor)\n"
        f"- **PM Surya Ghar (Central CFA):** **−{rs(s['subsidy_central'])}** *(₹30k/kW first 2 kW + ₹18k for 3rd kW, capped at ₹78,000)*\n"
        f"- **Odisha State Financial Assistance (SFA):** **−{rs(s['subsidy_state'])}** *(₹25k/kW first 2 kW + ₹10k for 3rd kW, capped at ₹60,000, {SFA_WINDOW})*\n"
        f"- **Your Net Out-of-Pocket Cost:** **{rs(s['net_cost'])}**\n\n"
        f"**Return on Investment:**\n"
        f"- Saves **{rs(s['annual_savings'])}/year** (~**{rs(s['monthly_savings_avg'])}/month**)\n"
        f"- **Simple Payback:** **{pb}**{irr_txt}\n"
        f"- **{s['lifetime_years']}-Year Net Profit:** **{rs(s['lifetime_profit'])}** (total lifetime savings {rs(s['lifetime_savings'])})"
        f"{campus_note}"
    )


def _topic_solar_panels_layout(a: Dict[str, Any]) -> str:
    area = float(a.get("area_m2") or 0)
    s = a.get("solar") or {}
    p = a.get("params") or DEFAULTS
    lat = abs((a.get("centroid") or [20.3, 85.8])[0])
    tilt = round(lat)
    usable_pct = round(float(p.get("usable_fraction", 0.7)) * 100)
    if (s.get("panels") or 0) <= 0:
        return (
            f"Your outlined roof is **{fmt_in(area)} m²** ({fmt_in(sqft(area))} sq ft), with **{fmt_in(s.get('usable_area_m2', 0), 1)} m²** usable area ({usable_pct}%). "
            f"With a **0.5 m walkway clearance** from roof edges, a standard {int(p.get('panel_w', 540))} W panel (~2.28 m × 1.13 m) doesn't fit safely inside this polygon.\n\n"
            f"If your actual terrace is larger, click **Back to map** and drag the yellow corner dots to include the full slab."
        )

    reason = (
        f"limited by physical roof space (your **{fmt_in(p.get('monthly_units', 250))} units/mo** bill would ideally use ~{s['need_kw']:.2f} kW)"
        if s.get("limited_by") == "roof"
        else "set manually by your panel slider choice"
        if s.get("limited_by") == "choice"
        else f"auto-sized to match your **{fmt_in(p.get('monthly_units', 250))} units/month** electricity use"
    )
    return (
        f"Here is how your solar panel layout is engineered for this **{fmt_in(area)} m²** roof:\n\n"
        f"- **Recommended System:** **{s['panels']} panels** × {int(p.get('panel_w', 540))} Wp Mono-PERC/TOPCon = **{s['kw']:.2f} kW** ({reason}).\n"
        f"- **Maximum Roof Capacity:** Up to **{s['roof_max_panels']} panels ({s['roof_max_kw']:.2f} kW)** physically fit on your **{fmt_in(s['usable_area_m2'], 1)} m²** usable area ({usable_pct}% shadow-free share, keeping a **0.5 m edge walkway**).\n"
        f"- **Tilt & Direction:** Fixed **South-facing (180° azimuth)** at **~{tilt}° tilt** (matching your {lat:.1f}°N latitude) for maximum year-round sunlight (**{a['climate']['ghi_avg']:.2f} peak sun-hours/day**).\n"
        f"- **Output:** Produces **{fmt_in(s['annual_gen'])} kWh/yr** (~{s['daily_units_per_kw']:.2f} units per kW per day)."
    )


def _topic_bill_tariff_netmetering(a: Dict[str, Any]) -> str:
    s = a.get("solar") or {}
    p = a.get("params") or DEFAULTS
    discom = _discom_str(a)
    nm = s.get("net_metering") or {}
    slabs_str = " · ".join(
        f"0–50u: ₹{OERC_DOMESTIC_SLABS[0][1]:.2f}",
    )
    load_note = ""
    if not nm.get("ok", True):
        load_note = (
            f"\n- **Sanctioned Load Check:** Your current sanctioned load is **{nm['limit_kw']:.1f} kW**, while the plant is **{s['kw']:.2f} kW**. "
            f"OERC allows net metering up to your sanctioned load — simply request a **+{nm['need_kw']:.1f} kW load enhancement** when applying with {(a.get('location') or {}).get('discom') or 'your DISCOM'}."
        )
    else:
        load_note = (
            f"\n- **Sanctioned Load Check:** Passes OERC rules — your **{s['kw']:.2f} kW** system is within your **{nm.get('limit_kw', 3.0):.1f} kW** sanctioned load."
        )

    return (
        f"Your electricity billing follows **{discom}** under the **OERC {TARIFF_FY}** domestic order:\n\n"
        f"- **Bill Today (Without Solar):** **{rs(s.get('bill_before', 0))}/yr** (~{rs(s.get('bill_before', 0) / 12)}/mo for {fmt_in(p.get('monthly_units', 250))} units/mo, effective rate ₹{s.get('tariff', 0):.2f}/unit).\n"
        f"- **Bill With Solar:** **{rs(s.get('bill_after', 0))}/yr** (~{rs(s.get('bill_after', 0) / 12)}/mo — solar offsets **{round((s.get('coverage') or 0) * 100)}%** of your units; the ₹{OERC_FIXED_CHARGE_PER_KW:.0f}/kW/month fixed charge + {OERC_DUTY_PCT:.0f}% duty still apply).\n"
        f"- **March Export Settlement:** **{rs(s.get('export_income', 0))}/yr** ({fmt_in(s.get('export_paid', 0))} surplus kWh paid at GRIDCO APPC **₹{s.get('export_rate', OERC_EXPORT_FIT):.2f}/unit**, subject to OERC's {int((s.get('net_meter_cap') or OERC_NET_METER_CAP) * 100)}% annual consumption cap).\n"
        f"- **Total Annual Savings:** **{rs(s.get('annual_savings', 0))}/yr**!\n\n"
        f"**OERC Telescopic Slabs ({TARIFF_FY}):** ₹2.90 (0–50u) · ₹4.70 (51–200u) · ₹5.70 (201–400u) · ₹6.10 (>400u) — so solar replaces your *most expensive* slab unit first (**₹{s.get('tariff_marginal', 0):.2f}/unit**)."
        f"{load_note}"
    )


def _topic_monthly_seasonality(a: Dict[str, Any]) -> str:
    s = a.get("solar") or {}
    r = a.get("rain") or {}
    gen = s.get("monthly_gen") or [0] * 12
    harv = r.get("monthly_harvest_l") or [0] * 12
    peak_i = max(range(12), key=lambda i: gen[i])
    low_i = min(range(12), key=lambda i: gen[i])
    wet_i = int(r.get("wettest_month") or max(range(12), key=lambda i: harv[i]))
    return (
        f"Solar and rainwater complement each other beautifully across Odisha's seasons (NASA POWER 2001–2020 climatology):\n\n"
        f"- **Peak Solar Month:** **{MONTHS_FULL[peak_i]}** (~**{fmt_in(gen[peak_i])} kWh**). Summer surplus exports to the grid and banks as kWh credits.\n"
        f"- **Monsoon Solar Dip:** **{MONTHS_FULL[low_i]}** (~**{fmt_in(gen[low_i])} kWh**) due to monsoon cloud cover — your banked summer net-metering credits offset extra grid draw during these months!\n"
        f"- **Peak Rainwater Month:** **{MONTHS_FULL[wet_i]}** (**{litres_fmt(harv[wet_i])}**, {fmt_in((r.get('monthly_rain_mm') or [0]*12)[wet_i])} mm rain). About **{round((r.get('monsoon_share') or 0) * 100)}%** of your yearly rain falls in July–October."
    )


def _topic_rain_harvest_sizing(a: Dict[str, Any]) -> str:
    area = float(a.get("area_m2") or 0)
    r = a.get("rain") or {}
    p = a.get("params") or DEFAULTS
    well = r.get("recharge_well") or {}
    dp = r.get("downpipes") or {}
    tank = r.get("tank") or {}
    cov_pct = round((r.get("coverage") or 0) * 100)
    wells_str = f"{well.get('wells', 1)} recharge wells" if well.get("wells", 1) > 1 else "1 recharge well"
    return (
        f"Here is your rooftop rainwater harvesting plan for **{fmt_in(area)} m²** ({r.get('roof_type_label', 'RCC roof')}, runoff coefficient **{r.get('runoff_c', 0.85)}**):\n\n"
        f"- **Annual Rainwater Harvest:** **{litres_fmt(r.get('annual_harvest_l', 0))}** from **{fmt_in(r.get('annual_rain_mm', 0))} mm/yr** rainfall.\n"
        f"- **Water Demand Coverage:** Covers **{cov_pct}%** of yearly water needs (**{fmt_in(r.get('days_of_water', 0))} days** of water for **{int(p.get('family_size', 4))} people** @ {int(p.get('lpcd', 135))} L/person/day).\n"
        f"- **Recommended Storage Tank:** **{fmt_in(tank.get('litres', 0))} L** ({tank.get('text', 'standard tank')}) — sized to capture a heavy **{fmt_in(p.get('design_rain_mm', 100))} mm** monsoon rain day.\n"
        f"- **Groundwater Recharge Unit:** **{wells_str}** of **{well.get('diameter_m', 1.0)} m diameter × {well.get('depth_m', 2.0)} m depth** (capacity **{fmt_in(well.get('capacity_l', 0))} L**).\n"
        f"- **Piping & Filtration:** **{dp.get('count', 2)} × {dp.get('diameter_mm', 100)} mm** PVC downpipes + a **first-flush diverter** + sand-gravel-charcoal filter.\n"
        f"- **Tanker Value:** Equivalent to **{fmt_in(r.get('tankers_saved', 0))} water tankers/yr** saved (~**{rs(r.get('tanker_savings', 0))}/yr**).\n\n"
        f"*Good to know:* Installing solar panels on your roof does **not** reduce rainwater collection — rain runs straight off the glass panels onto the roof and into the same gutters!"
    )


def _topic_chhata_oda_rules(a: Dict[str, Any]) -> str:
    area = float(a.get("area_m2") or 0)
    r = a.get("rain") or {}
    ch = r.get("chhata") or {}
    rule = r.get("rule") or {}
    status_rule = (
        f"**Compliant** — your plan provides **{fmt_in(r.get('planned_l', 0))} L** (tank + recharge well) vs the mandatory **{fmt_in(r.get('rule_min_l', 0))} L**."
        if r.get("meets_rule")
        else f"**Short by {fmt_in(r.get('rule_gap_l', 0))} L** (needs {fmt_in(r.get('rule_min_l', 0))} L) — deepen or add a recharge ring pit."
    )
    if ch.get("eligible"):
        ch_block = (
            f"**CHHATA Subsidy (Govt. of Odisha): Eligible!**\n"
            f"- **Estimated RRHS Cost:** {rs(ch['est_cost'])} ({fmt_in(area)} m² × ₹{fmt_in(ch['cost_per_m2'])}/m²)\n"
            f"- **CHHATA Subsidy (50%, max ₹55,000):** **−{rs(ch['subsidy'])}**\n"
            f"- **Your Net Rainwater Cost:** **{rs(ch['net_cost'])}**\n"
            f"- *Requirement:* Roof 50–200 m², up to 3 floors, compulsory groundwater recharge unit, applied via your ULB / [echhata.odisha.gov.in]({ch['portal']})."
        )
    else:
        reasons = "; ".join(ch.get("reasons") or ["Check roof size (50–200 m²) and floors (≤3)"])
        ch_block = (
            f"**CHHATA Subsidy (Govt. of Odisha): Not eligible on current settings**\n"
            f"- **Why:** {reasons}.\n"
            f"- *Scheme rules ({ch.get('scheme_years', CHHATA['scheme_years'])}):* 50% subsidy up to ₹55,000 for domestic buildings with 50–200 m² roof area and at most 3 floors."
        )

    return (
        f"{ch_block}\n\n"
        f"**Odisha Building Rule Check ({rule.get('short', 'ODA Rules 2020')}):**\n"
        f"- **Status:** {status_rule}\n"
        f"- Under the Odisha Development Authorities Rules 2020, rainwater harvesting is mandatory on plots above **{fmt_in(rule.get('mandate_plot_m2', 100))} m²**, groundwater recharge above **{fmt_in(rule.get('recharge_plot_m2', 225))} m²**, with at least **6 m³ recharge per 100 m² of roof** (60 L/m²)."
    )


def _topic_combined_budget(a: Dict[str, Any]) -> str:
    s = a.get("solar") or {}
    r = a.get("rain") or {}
    ch = r.get("chhata") or {}
    sol_gross = float(s.get("gross_cost") or 0)
    sol_sub = float(s.get("subsidy") or 0)
    sol_net = float(s.get("net_cost") or 0)
    rw_gross = float(ch.get("est_cost") or 0)
    rw_sub = float(ch.get("subsidy") or 0) if ch.get("eligible") else 0.0
    rw_net = max(0.0, rw_gross - rw_sub)
    tot_gross = sol_gross + rw_gross
    tot_sub = sol_sub + rw_sub
    tot_net = sol_net + rw_net
    tot_save = float(s.get("annual_savings") or 0) + float(r.get("tanker_savings") or 0)

    return (
        f"Here is your **combined Solar + Rainwater** investment and savings summary:\n\n"
        f"- **Solar ({s.get('kw', 0):.2f} kW):** {rs(sol_gross)} gross − {rs(sol_sub)} subsidy = **{rs(sol_net)}** net\n"
        f"- **Rainwater System:** {rs(rw_gross)} est. cost − {rs(rw_sub)} CHHATA subsidy = **{rs(rw_net)}** net\n"
        f"- **Total Gross Value:** {rs(tot_gross)}\n"
        f"- **Total Govt. Subsidies:** **−{rs(tot_sub)}**\n"
        f"- **Total Out-of-Pocket:** **{rs(tot_net)}**\n\n"
        f"**Combined Yearly Benefit:** **{rs(tot_save)}/yr** ({rs(s.get('annual_savings', 0))} electricity bill savings + {rs(r.get('tanker_savings', 0))} equivalent tanker water value)."
    )


def _topic_green_score_env(a: Dict[str, Any]) -> str:
    g = a.get("score") or {}
    s = a.get("solar") or {}
    r = a.get("rain") or {}
    tips = []
    if (g.get("solar_pts") or 0) < 48 and (s.get("panels") or 0) < (s.get("roof_max_panels") or 0):
        tips.append("adding 1–2 more panels (if within your consumption cap) raises solar coverage")
    if not r.get("meets_rule", True):
        tips.append("sizing your tank + recharge pit above 60 L/m² earns the full 10/10 Odisha rule points")
    if (g.get("water_pts") or 0) < 28:
        tips.append("using water-saving aerators reduces daily demand and boosts rainwater coverage")
    tip_line = f"\n\n**How to boost it further:** {', '.join(tips).capitalize()}." if tips else ""
    return (
        f"Your roof earns a **Green Score of {g.get('score', 0)}/100 (Grade {g.get('grade', '—')})**:\n\n"
        f"- **Solar Score ({g.get('solar_pts', 0)} / 55 pts):** Based on electricity bill coverage ({round((s.get('coverage') or 0) * 100)}%), local solar yield ({fmt_in(s.get('specific_yield', 0))} kWh/kWp/yr), and payback speed.\n"
        f"- **Water Score ({g.get('water_pts', 0)} / 35 pts):** Based on annual water coverage ({round((r.get('coverage') or 0) * 100)}%), local rainfall ({fmt_in(r.get('annual_rain_mm', 0))} mm/yr), and self-sufficient monsoon months.\n"
        f"- **Odisha Rule Compliance ({g.get('rule_pts', 0)} / 10 pts):** {'Full 10/10 — meets the 60 L/m² ODA 2020 recharge norm!' if r.get('meets_rule') else '0/10 — increase storage/recharge capacity to meet 60 L/m².'}\n\n"
        f"**Climate Impact:** Cuts **{s.get('co2_t_year', 0):.2f} tonnes of CO₂/year** (**{s.get('co2_t_life', 0):.1f} tonnes** over {s.get('lifetime_years', 25)} years) — equivalent to planting **{fmt_in(s.get('trees_equiv', 0))} mature trees**!"
        f"{tip_line}"
    )


def _topic_how_to_apply(a: Dict[str, Any]) -> str:
    loc = a.get("location") or {}
    discom = loc.get("discom") or "your Odisha DISCOM (TPCODL/TPNODL/TPWODL/TPSODL)"
    site = loc.get("site") or "https://pmsuryaghar.gov.in/"
    s = a.get("solar") or {}
    r = a.get("rain") or {}
    ch = r.get("chhata") or {}
    return (
        f"Here is your step-by-step application roadmap in Odisha:\n\n"
        f"**1. Rooftop Solar (PM Surya Ghar + Odisha SFA + Net Metering):**\n"
        f"- Register at **[pmsuryaghar.gov.in](https://pmsuryaghar.gov.in/)** using your **{discom}** consumer number.\n"
        f"- Apply for a **{s.get('kw', 0):.2f} kW** rooftop plant (if your sanctioned load is under {s.get('kw', 0):.1f} kW, request load enhancement with {discom} — portal: {site}).\n"
        f"- Choose an **OREDA / DISCOM-empanelled vendor** so your system qualifies for subsidies and carries a 5-year comprehensive maintenance warranty.\n"
        f"- After installation, {discom} inspects the plant and installs the bi-directional **net meter**. Both Central (**{rs(s.get('subsidy_central', 0))}**) and Odisha SFA (**{rs(s.get('subsidy_state', 0))}**) subsidies are transferred directly to your bank account (DBT)!\n\n"
        f"**2. Rainwater Harvesting (CHHATA Scheme):**\n"
        f"- {'Your roof qualifies! Apply' if ch.get('eligible') else 'Check'} via **[echhata.odisha.gov.in](https://echhata.odisha.gov.in/)** or your Urban Local Body (ULB) / Directorate of Ground Water Development.\n"
        f"- Tip: Download your **SuryaJal Green Roof Report PDF** from the **Report** tab to hand directly to your vendor or engineer!"
    )


def _topic_power_cut_battery(a: Dict[str, Any]) -> str:
    s = a.get("solar") or {}
    return (
        f"Great practical question! Here is how solar works during power cuts:\n\n"
        f"- **Standard On-Grid System (what {rs(s.get('gross_cost', 0))} prices here):** Connects directly to the grid without batteries. For lineman safety (*anti-islanding*), an on-grid inverter automatically pauses during a daytime power cut — or works alongside your existing home inverter/battery.\n"
        f"- **Hybrid Solar System (Solar + Battery):** Uses a hybrid inverter + LiFePO₄ battery so solar keeps running your fans, lights, Wi-Fi, and fridge during outages *and* still exports surplus via net metering! A hybrid setup typically adds ₹45,000–₹90,000 depending on battery size.\n"
        f"- **Subsidy tip:** PM Surya Ghar & Odisha SFA (**{rs(s.get('subsidy', 0))}** on your roof) cover on-grid/grid-interactive rooftop installations registered with your DISCOM."
    )


def _topic_water_quality_filter() -> str:
    return (
        "Yes — with simple, low-cost stages, rooftop rainwater is one of the cleanest water sources available:\n\n"
        "- **Stage 1 (Leaf mesh & First-Flush Diverter):** Automatically diverts the first 1–2 mm of rain (which washes dust and bird droppings off the roof) away from your storage tank.\n"
        "- **Stage 2 (Sand–Gravel–Charcoal Filter):** Filters suspended particles and odour before water enters your storage tank or recharge pit.\n"
        "- **Direct uses:** Immediately great for bathing, laundry, toilet flushing, mopping, gardening, and borewell/groundwater recharge (soft water with zero hardness!).\n"
        "- **For drinking & cooking:** Pass stored tank water through a household **UV + RO/UF purifier** and clean the roof gutters before June monsoon."
    )


def _topic_maintenance_structure(a: Dict[str, Any]) -> str:
    s = a.get("solar") or {}
    m = s.get("maintenance") or {}
    area = float(a.get("area_m2") or 0)
    panels = int(s.get("panels") or 0)
    if panels <= 0 or not m:
        return (
            f"For a rooftop in Odisha (**{fmt_in(area)} m²**), solar & rooftop maintenance is very minimal:\n\n"
            f"- **Years 1–5 Vendor AMC:** **₹0** — mandatory 5-year free Comprehensive Maintenance (CMC) from OREDA / PM Surya Ghar empanelled vendors.\n"
            f"- **Cleaning:** Wash panels early morning every **15 days** in dry months (Oct–May) using a soft microfiber mop and plain/rain water (~3.5 L/panel); monsoon rain cleans them naturally.\n"
            f"- **Rooftop Care:** Keep terrace drain outlets & rainwater downpipes clear before June monsoon; structural load is only **~16.3 kg/m²**."
        )

    return (
        f"Here is your personalized **Rooftop & Panel Maintenance Plan** for **{panels} panels ({s['kw']:.2f} kW)** on your **{fmt_in(area)} m²** {m.get('roof_type_label', 'RCC roof')}:\n\n"
        f"- **Why It’s Required:** Uncleaned dust & bird droppings in dry months cut solar output by **~{int(m['dust_loss_pct'])}%** — regular cleaning protects **~{fmt_in(m['kwh_protected_yr'])} kWh/yr** (**{rs(m['savings_protected_yr'])}/yr** in bill savings).\n"
        f"- **How & When to Clean:** **{m['cleans_per_year']} washes/year** (every **15 days** in dry months, 1×/mo inspection in monsoon) **before 8 AM or after 5:30 PM** using **{m['water_per_wash_l']:.0f} L** soft/rain water + a soft microfiber squeegee (~**{m['minutes_per_wash']} mins** per wash). Never spray cold water on hot glass at noon or walk on panels!\n"
        f"- **Cost of Maintenance:**\n"
        f"  • **Years 1–{m['free_cmc_years']}:** **₹0 vendor AMC** (free mandatory OREDA/PM Surya Ghar CMC; only ~**{rs(m['years_1_to_5_annual_cost'])}/yr** for a soft wiper/mop)\n"
        f"  • **Years {m['free_cmc_years'] + 1}–{m['lifetime_years']} (Self-Clean + Annual Check):** **{rs(m['diy_annual_cost'])}/yr** (~{rs(m['diy_annual_cost'] / 12)}/mo) · or **{rs(m['amc_annual_cost'])}/yr** for a full vendor AMC ({rs(m['pro_visit_cost'])}/visit pro wash)\n"
        f"  • **Mid-Life Inverter Reserve ( ~Year {m['inverter_replacement_year']}):** ~**{rs(m['inverter_replacement_cost'])}** one-time (panels themselves last 25+ years)\n"
        f"- **Rooftop & Cyclone Check:** Total added weight is **{fmt_in(m['total_weight_kg'])} kg** (**{m['load_kg_per_m2']} kg/m²** vs 150 kg/m² RCC safe capacity). {m.get('rooftop_care_note', '')}"
    )


def _topic_website_help(a: Dict[str, Any]) -> str:
    return (
        f"Here is how to get the most out of **SuryaJal** on this roof (Report ID `#{a.get('report_id', '—')}`):\n\n"
        f"- **Solar tab:** Drag the *Electricity use* or *Panels on the roof* sliders, inspect monthly kWh bars & 25-year payback, and scroll down to the **Maintenance** section inside Solar for your cleaning calendar, DIY vs AMC cost breakdown, and rooftop care guide.\n"
        f"- **Rainwater tab:** Change *Roof type*, *Floors*, or *People* to update tank size, recharge pit depth, ODA 2020 compliance, and CHHATA subsidy instantly.\n"
        f"- **Report tab:** Download the **3-page A4 PDF**, scan the **QR code** to open on your phone, **Save** to *My roofs*, or open **Assumptions** to customize tariff, load, or vendor ₹/kW quote.\n"
        f"- **Back to map:** Fine-tune the yellow roof corner dots or tap another building/house any time!"
    )


# ------------------------------------------------------------------ intent routing & follow-ups
def suggestions_for(tab: str, a: Optional[Dict[str, Any]], asked_topics: Optional[List[str]] = None) -> List[str]:
    asked = set(asked_topics or [])
    ch_ok = bool(((a or {}).get("rain") or {}).get("chhata", {}).get("eligible", True))
    pool_by_tab = {
        "solar": [
            ("subsidy", "How much solar subsidy can I get?"),
            ("bill", "Explain my electricity bill savings"),
            ("maintenance", "How much does panel maintenance cost?"),
            ("panels", "How many panels max can fit on my roof?"),
            ("whatif_max", "What if I fill my full roof with panels?"),
            ("battery", "Will solar work during a power cut?"),
        ],
        "maintenance": [
            ("maintenance", "Full maintenance cost & cleaning schedule?"),
            ("battery", "Will solar work during a power cut?"),
            ("subsidy", "How much solar subsidy & net profit do I get?"),
            ("rain", "Can I use harvested rainwater to clean panels?"),
            ("apply", "How do I get the 5-year free vendor AMC?"),
        ],
        "rain": [
            ("chhata", "Am I eligible for CHHATA subsidy?" if ch_ok else "Why am I not eligible for CHHATA?"),
            ("rain", "What tank & recharge pit size do I need?"),
            ("water_quality", "Can we drink harvested rainwater?"),
            ("season", "Do solar panels block rainwater collection?"),
            ("combined", "Total cost & subsidy for solar + rainwater?"),
            ("apply", "How do I apply for CHHATA & solar?"),
        ],
        "report": [
            ("score", "Explain my Green Score breakdown"),
            ("combined", "Total cost & savings after all subsidies?"),
            ("maintenance", "Maintenance cost & rooftop care tips"),
            ("apply", "Step-by-step guide to apply in Odisha"),
            ("whatif_bill", "What if my monthly bill is ₹3,000?"),
            ("site", "How to customize vendor cost or tariff?"),
        ],
    }
    candidates = pool_by_tab.get(tab, pool_by_tab["solar"]) + pool_by_tab["report"]
    out: List[str] = []
    seen: set = set()
    for tag, label in candidates:
        if tag not in asked and label not in seen:
            seen.add(label)
            out.append(label)
        if len(out) >= 3:
            break
    return out


def _classify_topics(msg: str, history: List[Dict[str, str]], tab: str) -> List[str]:
    low = msg.lower().strip()
    topics: List[str] = []

    # Greetings / identity / general help
    if re.fullmatch(
        r"(hi+|hello+|hey+|hlo|namaste|namaskar|kemiti achha|yo|sup|good\s+(morning|afternoon|evening)|"
        r"hey\s+bro|hi\s+bro|hello\s+bro|who\s+are\s+you\??|what\s+can\s+you\s+do\??|help(\s+me)?\??)[!.?\s]*",
        low,
    ):
        return ["greeting"]

    # Check specific intents (a user can ask up to 2 related things at once!)
    if any(k in low for k in (
        "power cut", "outage", "blackout", "load shedding", "battery", "backup",
        "inverter", "off-grid", "off grid", "hybrid", "on-grid", "on grid",
    )):
        topics.append("battery")

    if any(k in low for k in (
        "drink", "potable", "filter", "first flush", "first-flush", "clean water",
        "purif", "water quality", "safe to use", "mosquito",
    )):
        topics.append("water_quality")

    if any(k in low for k in (
        "panel", "panels", "block rain", "reduce rain", "stop rain",
    )) and any(k in low for k in ("rain", "water", "harvest")):
        topics.append("rain")

    if any(k in low for k in (
        "mainten", "clean", "wash", "dust", "soiling", "wiper", "mop", "upkeep", "amc", "cmc",
        "service", "cyclone", "wind", "storm", "strong enough", "structural", "weight",
        "load on roof", "warranty", "lifespan", "life of", "degrad", "shade", "shading",
        "shadow", "monkey",
    )):
        topics.append("maintenance")

    if any(k in low for k in (
        "how to apply", "where to apply", "apply for", "application", "registration",
        "register", "portal", "oreda", "vendor", "empanel", "next step", "get started",
        "process", "procedure", "documents", "dbt",
    )):
        topics.append("apply")

    if any(k in low for k in ("both", "combined", "total cost", "overall cost", "everything together")) or (
        any(k in low for k in ("solar", "panel")) and any(k in low for k in ("rain", "water", "chhata", "tank"))
        and any(k in low for k in ("cost", "subsidy", "price", "kharcha", "budget", "save", "saving"))
    ):
        topics.append("combined")

    if any(k in low for k in (
        "chhata", "echhata", "oda ", "oda rule", "building rule", "mandatory", "compulsory",
        "60 l", "6 m3", "eligible", "eligibility", "rainwater subsidy", "water subsidy",
    )):
        topics.append("chhata")

    if any(k in low for k in (
        "subsidy", "pmsg", "pm surya", "surya ghar", "muft bijli", "sfa", "state financial",
        "central assistance", "payback", "recover", "roi", "irr", "25 year", "25-year",
        "lifetime", "profit", "capital cost", "out of pocket", "net cost", "gross cost",
        "kitna kharcha", "kitna milega", "kete tanka", "price", "cost", "kharcha", "loan", "emi",
    )) and "combined" not in topics:
        if ("maintenance" in topics or tab == "maintenance") and not any(k in low for k in ("subsidy", "surya", "sfa", "payback", "irr", "loan", "emi")):
            if "maintenance" not in topics:
                topics.append("maintenance")
        elif tab == "rain" and not any(k in low for k in ("solar", "surya", "panel", "kw", "sfa", "payback", "irr")):
            if "chhata" not in topics:
                topics.append("chhata")
        else:
            topics.append("subsidy")

    if any(k in low for k in (
        "bill", "bijli", "tariff", "slab", "oerc", "discom", "tpcodl", "tpnodl", "tpwodl",
        "tpsodl", "tata power", "net meter", "net-meter", "export", "import", "feed-in",
        "gridco", "appc", "sanctioned load", "fixed charge", "duty", "march settlement",
        "zero bill", "unit rate",
    )):
        topics.append("bill")

    if any(k in low for k in (
        "rain", "water", "harvest", "paani", "pani", "tank", "tanki", "sump", "recharge",
        "pit", "well", "borewell", "downpipe", "gutter", "runoff", "tanker", "lpcd",
    )) and "rain" not in topics and "chhata" not in topics and "water_quality" not in topics and "combined" not in topics:
        topics.append("rain")

    if any(k in low for k in (
        "panel", "kw", "kwp", "capacity", "size", "sizing", "roof area", "usable",
        "walkway", "setback", "tilt", "angle", "azimuth", "south", "direction", "layout",
        "fit on", "how many", "kitne panel",
    )) and "subsidy" not in topics and "rain" not in topics:
        topics.append("panels")

    if any(k in low for k in (
        "month", "summer", "monsoon", "winter", "season", "peak month", "cloudy", "rainy season",
        "sunshine", "sun hours", "ghi", "nasa", "climate",
    )):
        topics.append("season")

    if any(k in low for k in (
        "green score", "score", "grade", "co2", "carbon", "tree", "trees", "environment",
        "pollution", "climate impact",
    )):
        topics.append("score")

    if any(k in low for k in (
        "pdf", "download", "qr", "share", "save roof", "my roofs", "edit roof", "redr",
        "assumption", "slider", "how to use", "website",
    )):
        topics.append("site")

    if any(k in low for k in (
        "summary", "summarize", "overview", "tell me about my roof", "about this roof",
        "about my house", "explain my report", "full report", "is my roof good", "worth it",
    )):
        topics.append("overview")

    # Conversational follow-ups ("why?", "tell me more", "how do I get that?", "and for water?")
    if not topics and history:
        last_assistant = next((h["content"].lower() for h in reversed(history) if h.get("role") == "assistant"), "")
        if any(k in low for k in ("apply", "get it", "claim", "where", "link", "portal")):
            topics.append("apply")
        elif any(k in low for k in ("why", "reason", "not eligible")):
            topics.append("chhata" if "chhata" in last_assistant else "panels")
        elif any(k in low for k in ("water", "rain", "tank")):
            topics.append("rain")
        elif any(k in low for k in ("solar", "panel")):
            topics.append("subsidy")
        elif any(k in low for k in ("more", "detail", "explain", "elaborate")):
            if "chhata" in last_assistant:
                topics.append("apply")
            elif "subsidy" in last_assistant:
                topics.append("bill")
            else:
                topics.append("overview")

    # Polite handling for clearly unrelated off-topic requests
    if not topics:
        off_topic = any(k in low for k in (
            "cricket", "movie", "recipe", "joke", "poem", "song", "bitcoin", "stock market",
            "write code", "python program", "java", "leetcode", "girlfriend", "politics", "election",
        ))
        if off_topic:
            return ["off_topic"]
        return ["overview"]

    return topics[:2]


def answer_grounded(
    message: str,
    assessment: Optional[Dict[str, Any]] = None,
    tab: str = "solar",
    address: str = "",
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Generate an accurate, conversational response grounded in SuryaJal's calculations."""
    msg = (message or "").strip()
    hist = history or []

    if not assessment:
        return {
            "reply": (
                "I’m your **SuryaJal** assistant! As soon as your roof’s solar and rainwater "
                "assessment finishes loading, I can walk you through your exact kW size, PM Surya Ghar + "
                "Odisha SFA subsidies, OERC electricity bill savings, tank & recharge pit sizing, CHHATA "
                "eligibility, or run *what-if* checks for your home."
            ),
            "suggestions": [
                "Summarize my roof report",
                "How much solar subsidy can I get?",
                "What tank & recharge pit do I need?",
            ],
            "source": "suryajal-ai",
        }

    # 1. Check live What-If simulation first!
    sim = _detect_what_if(msg, assessment)
    if sim is not None:
        label, sim_res = sim
        return {
            "reply": _format_what_if(label, assessment, sim_res),
            "suggestions": suggestions_for(tab, assessment, ["whatif_max", "whatif_bill"]),
            "source": "suryajal-ai",
        }

    # 2. Classify topics & build natural response
    topics = _classify_topics(msg, hist, tab)
    place = _loc_label(assessment, address)
    s = assessment.get("solar") or {}
    r = assessment.get("rain") or {}
    g = assessment.get("score") or {}

    if topics == ["greeting"]:
        sol_bit = (
            f"**{s['kw']:.2f} kW** solar saving **{rs(s['annual_savings'])}/yr**"
            if (s.get("panels") or 0) > 0
            else "compact roof outline (adjustable on map)"
        )
        reply = (
            f"Namaste! Happy to help you explore **{place}** (**{fmt_in(assessment.get('area_m2', 0))} m²** roof).\n\n"
            f"Right now your roof shows {sol_bit}, **{litres_fmt(r.get('annual_harvest_l', 0))}** yearly rainwater harvest, "
            f"and a **Green Score of {g.get('score', 0)}/100 ({g.get('grade', '—')})**.\n\n"
            f"Ask me anything — subsidies, OERC bill math, payback, rainwater tank & recharge pit size, power-cut backup, or *“what if my bill is ₹3,000?”*!"
        )
        return {
            "reply": reply,
            "suggestions": suggestions_for(tab, assessment, []),
            "source": "suryajal-ai",
        }

    if topics == ["off_topic"]:
        return {
            "reply": (
                f"Haha, I’m specialized in **rooftop solar, rainwater harvesting, and Odisha energy/water rules** for **{place}**! "
                f"Feel free to ask me anything about your **{s.get('kw', 0):.2f} kW** solar estimate, subsidies (**{rs(s.get('subsidy', 0))}**), "
                f"electricity bills, rainwater tank (**{fmt_in((r.get('tank') or {}).get('litres', 0))} L**), CHHATA scheme, or *what-if* scenarios."
            ),
            "suggestions": suggestions_for(tab, assessment, []),
            "source": "suryajal-ai",
        }

    builders = {
        "overview": lambda: _topic_overview(assessment, address),
        "subsidy": lambda: _topic_solar_subsidy_cost(assessment, address),
        "panels": lambda: _topic_solar_panels_layout(assessment),
        "bill": lambda: _topic_bill_tariff_netmetering(assessment),
        "season": lambda: _topic_monthly_seasonality(assessment),
        "rain": lambda: _topic_rain_harvest_sizing(assessment),
        "chhata": lambda: _topic_chhata_oda_rules(assessment),
        "combined": lambda: _topic_combined_budget(assessment),
        "score": lambda: _topic_green_score_env(assessment),
        "apply": lambda: _topic_how_to_apply(assessment),
        "battery": lambda: _topic_power_cut_battery(assessment),
        "water_quality": _topic_water_quality_filter,
        "maintenance": lambda: _topic_maintenance_structure(assessment),
        "site": lambda: _topic_website_help(assessment),
    }

    parts = [builders[t]() for t in topics if t in builders]
    reply = "\n\n---\n\n".join(parts) if len(parts) > 1 else parts[0]
    return {
        "reply": reply,
        "suggestions": suggestions_for(tab, assessment, topics),
        "source": "suryajal-ai",
    }


# ------------------------------------------------------------------ optional external LLM upgrade
def _system_prompt(a: Optional[Dict[str, Any]], tab: str, address: str, sim_text: Optional[str]) -> str:
    if not a:
        return (
            "You are SuryaJal AI, a warm, concise rooftop solar and rainwater harvesting advisor "
            "for Odisha, India. Keep answers practical, accurate, and friendly."
        )
    s, r, g, loc = a.get("solar") or {}, a.get("rain") or {}, a.get("score") or {}, a.get("location") or {}
    ch = r.get("chhata") or {}
    ctx = (
        f"You are SuryaJal AI, the friendly embedded rooftop solar & rainwater assistant on the SuryaJal website (Odisha edition).\n"
        f"Current tab viewed by user: {tab}.\n"
        f"Selected Roof: {address or 'User roof'} | Area: {a.get('area_m2', 0):.1f} m² ({sqft(a.get('area_m2', 0)):.0f} sq ft) | "
        f"District: {loc.get('district')} | DISCOM: {loc.get('discom')} ({loc.get('discom_name')}).\n"
        f"Solar: {s.get('kw', 0):.2f} kW ({s.get('panels', 0)} panels, max roof {s.get('roof_max_panels', 0)} panels / {s.get('roof_max_kw', 0):.2f} kW), "
        f"annual gen {s.get('annual_gen', 0):.0f} kWh, gross cost {rs(s.get('gross_cost', 0))}, "
        f"PM Surya Ghar central subsidy {rs(s.get('subsidy_central', 0))}, Odisha SFA state subsidy {rs(s.get('subsidy_state', 0))}, "
        f"net cost {rs(s.get('net_cost', 0))}, bill before {rs(s.get('bill_before', 0))}/yr, bill after {rs(s.get('bill_after', 0))}/yr, "
        f"annual savings {rs(s.get('annual_savings', 0))}/yr, payback {s.get('payback_years')} yrs, CO2 saved {s.get('co2_t_year', 0):.2f} t/yr.\n"
        f"Rainwater: annual rain {r.get('annual_rain_mm', 0):.0f} mm, harvest {r.get('annual_harvest_l', 0):.0f} L/yr "
        f"({round((r.get('coverage') or 0) * 100)}% of demand), tank {r.get('tank', {}).get('litres', 0)} L, "
        f"recharge well {r.get('recharge_well', {})}, ODA 2020 rule met={r.get('meets_rule')}, "
        f"CHHATA eligible={ch.get('eligible')} (subsidy {rs(ch.get('subsidy', 0))}, reasons={ch.get('reasons')}).\n"
        f"Green Score: {g.get('score', 0)}/100 (Grade {g.get('grade')}).\n"
    )
    if sim_text:
        ctx += f"\nLive What-If calculation already computed by backend (use exact figures):\n{sim_text}\n"
    ctx += (
        "\nRules: Use Indian rupee formatting (₹) and exact numbers from this roof. "
        "Keep answers clear, warm, bulleted where helpful, and under 180 words unless asked for detail. "
        "Remind users estimates are for preliminary planning before an OREDA/DISCOM site survey if giving investment advice."
    )
    return ctx


async def _try_external_llm(
    message: str,
    assessment: Optional[Dict[str, Any]],
    tab: str,
    address: str,
    history: List[Dict[str, str]],
    http: Optional[httpx.AsyncClient],
) -> Optional[str]:
    api_key = (
        os.environ.get("SURYAJAL_AI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )
    if not api_key:
        return None

    sim = _detect_what_if(message, assessment) if assessment else None
    sim_txt = _format_what_if(sim[0], assessment, sim[1]) if (sim and assessment) else None
    sys_prompt = _system_prompt(assessment, tab, address, sim_txt)

    own_client = http is None
    client = http or httpx.AsyncClient(timeout=12.0)
    try:
        # Native Gemini if GEMINI_API_KEY is set without custom OpenAI base URL
        if os.environ.get("GEMINI_API_KEY") and not os.environ.get("SURYAJAL_AI_BASE_URL") and not os.environ.get("OPENAI_API_KEY"):
            model = os.environ.get("SURYAJAL_AI_MODEL") or "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            contents = []
            for h in history[-8:]:
                role = "model" if h.get("role") == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": h.get("content", "")[:1500]}]})
            contents.append({"role": "user", "parts": [{"text": message}]})
            r = await client.post(
                url,
                params={"key": api_key},
                json={
                    "systemInstruction": {"parts": [{"text": sys_prompt}]},
                    "contents": contents,
                    "generationConfig": {"temperature": 0.35, "maxOutputTokens": 600},
                },
                timeout=12.0,
            )
            if r.status_code == 200:
                data = r.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                if text and text.strip():
                    return text.strip()
            return None

        # OpenAI-compatible Chat Completions
        base = (os.environ.get("SURYAJAL_AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        model = os.environ.get("SURYAJAL_AI_MODEL") or "gpt-4o-mini"
        msgs = [{"role": "system", "content": sys_prompt}]
        for h in history[-8:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                msgs.append({"role": h["role"], "content": h["content"][:1500]})
        msgs.append({"role": "user", "content": message})
        r = await client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": msgs, "temperature": 0.35, "max_tokens": 600},
            timeout=12.0,
        )
        if r.status_code == 200:
            data = r.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if text and text.strip():
                return text.strip()
    except Exception:
        return None
    finally:
        if own_client:
            await client.aclose()
    return None


async def chat(
    message: str,
    assessment: Optional[Dict[str, Any]] = None,
    tab: str = "solar",
    address: str = "",
    history: Optional[List[Dict[str, str]]] = None,
    http: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    hist = history or []
    llm_reply = await _try_external_llm(message, assessment, tab, address, hist, http)
    if llm_reply:
        topics = _classify_topics(message, hist, tab)
        return {
            "reply": llm_reply,
            "suggestions": suggestions_for(tab, assessment, topics),
            "source": "llm",
        }
    return answer_grounded(message, assessment=assessment, tab=tab, address=address, history=hist)
