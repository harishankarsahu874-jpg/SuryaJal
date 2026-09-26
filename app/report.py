"""One-page A4 "Green Roof Report" (reportlab): roof thumbnail with outline + auto
panel layout, solar & rainwater KPIs, monthly charts, Green Score, QR code."""
from __future__ import annotations

import datetime as dt
import io
import math
from typing import Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics import renderPDF, renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from .config import ESRI_ATTRIBUTION, FONTS_DIR, MONTH_LABELS
from .geo import latlon_to_px, meters_per_px

F, FB = "DejaVu", "DejaVu-Bold"
_fonts_ok = False

NAVY = HexColor("#26342B")          # sage-900 - matches the SuryaJal site theme
INK = HexColor("#0F172A")
GRAY = HexColor("#64748B")
LIGHT = HexColor("#E2E8F0")
AMBER = HexColor("#F59E0B")
AMBER_D = HexColor("#B45309")
AMBER_BG = HexColor("#FFF7E6")
BLUE = HexColor("#0EA5E9")
BLUE_D = HexColor("#0369A1")
BLUE_BG = HexColor("#EAF6FD")
GREEN = HexColor("#16A34A")
SUB = HexColor("#CBD5E1")


def _register_fonts():
    global _fonts_ok, F, FB
    if _fonts_ok:
        return
    try:
        pdfmetrics.registerFont(TTFont("DejaVu", str(FONTS_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONTS_DIR / "DejaVuSans-Bold.ttf")))
    except Exception:  # fonts missing -> built-in Helvetica (no Rs symbol)
        F, FB = "Helvetica", "Helvetica-Bold"
    _fonts_ok = True


# ------------------------------------------------------------------ number formats
def inr(n: float) -> str:
    """Indian digit grouping: 1234567 -> 12,34,567"""
    neg = n < 0
    s = str(int(round(abs(n))))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + s


def rupees(n: float) -> str:
    if abs(n) >= 1e7:
        return f"₹{n / 1e7:.2f} crore"
    if abs(n) >= 1e5:
        return f"₹{n / 1e5:.2f} lakh"
    return f"₹{inr(n)}"


def litres(n: float) -> str:
    if n >= 1e5:
        return f"{n / 1e5:.2f} lakh L"
    return f"{inr(n)} L"


def compact(v: float) -> str:
    if v >= 1e5:
        return f"{v / 1e5:.1f}L"
    if v >= 1e3:
        return f"{v / 1e3:.1f}k"
    return f"{v:.0f}"


def nice_step(v: float) -> float:
    """Smallest 'nice' step (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k) >= v."""
    if v <= 0:
        return 1.0
    e = 10 ** math.floor(math.log10(v))
    for m in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * e >= v - 1e-12:
            return m * e
    return 10 * e


def nice_ceiling(v: float) -> float:
    if v <= 0:
        return 1.0
    e = 10 ** math.floor(math.log10(v))
    for m in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * e >= v:
            return m * e
    return 10 * e


# ------------------------------------------------------------------ roof thumbnail
def roof_thumbnail(crop: Optional[Dict], polygon, panels, size: int = 420) -> Optional[Image.Image]:
    if crop is None:
        return None
    img = Image.fromarray(crop["img"]).convert("RGB")
    f = size / img.width
    img = img.resize((size, size), Image.LANCZOS)
    draw = ImageDraw.Draw(img, "RGBA")
    z, gx0, gy0 = crop["z"], crop["gx0"], crop["gy0"]

    def px(lat, lon):
        x, y = latlon_to_px(lat, lon, z)
        return ((x - gx0) * f, (y - gy0) * f)

    for pnl in panels or []:
        draw.polygon([px(*q) for q in pnl], fill=(23, 37, 84, 235), outline=(147, 197, 253, 255))
    pts = [px(*q) for q in polygon]
    draw.line(pts + [pts[0]], fill=(250, 204, 21, 255), width=max(2, size // 140), joint="curve")
    # scale bar (bottom-right) + north arrow (top-right)
    try:
        font = ImageFont.truetype(str(FONTS_DIR / "DejaVuSans-Bold.ttf"), max(10, size // 30))
    except Exception:
        font = ImageFont.load_default()
    lat_c = sum(q[0] for q in polygon) / len(polygon)
    mpp = meters_per_px(lat_c, z) / f
    bar_m = next((b for b in (2, 5, 10, 20, 50, 100, 200, 500) if b / mpp >= size * 0.16), 500)
    bl = bar_m / mpp
    x1, y1 = size - 14, size - 30
    draw.rectangle([x1 - bl - 6, y1 - 20, x1 + 6, y1 + 10], fill=(0, 0, 0, 120))
    draw.rectangle([x1 - bl, y1, x1, y1 + 5], fill=(255, 255, 255, 255))
    draw.text((x1 - bl / 2, y1 - 3), f"{bar_m} m", fill=(255, 255, 255, 255), font=font, anchor="ms")
    nx, ny = size - 24, 16
    draw.polygon([(nx, ny), (nx - 8, ny + 20), (nx, ny + 15), (nx + 8, ny + 20)], fill=(255, 255, 255, 235))
    draw.text((nx, ny + 36), "N", fill=(255, 255, 255, 255), font=font, anchor="ms")
    return img


# ------------------------------------------------------------------ drawing helpers
def _sun(c, x, y, r, color=AMBER):
    c.saveState()
    c.setFillColor(color)
    c.setStrokeColor(color)
    c.circle(x, y, r, stroke=0, fill=1)
    c.setLineWidth(max(0.8, r * 0.22))
    c.setLineCap(1)
    for i in range(8):
        a = math.radians(i * 45)
        c.line(x + math.cos(a) * r * 1.35, y + math.sin(a) * r * 1.35,
               x + math.cos(a) * r * 1.85, y + math.sin(a) * r * 1.85)
    c.restoreState()


def _drop(c, x, y, h, color=BLUE):
    """Water drop with the tip at the top; (x, y) = centre of the round part."""
    r = h * 0.36
    c.saveState()
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(x, y + h * 0.62)
    p.curveTo(x + r * 0.35, y + r * 1.05, x + r, y + r * 0.55, x + r, y)
    p.curveTo(x + r, y - r * 1.33, x - r, y - r * 1.33, x - r, y)
    p.curveTo(x - r, y + r * 0.55, x - r * 0.35, y + r * 1.05, x, y + h * 0.62)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.restoreState()


def _logo_mark(c, x, y, s):
    """SuryaJal mark (same geometry as frontend/public/brand/logo-mark.svg); (x, y) = bottom-left."""
    k = s / 64.0

    def T(u, v):
        return x + u * k, y + s - v * k

    c.saveState()
    c.setFillColor(HexColor("#56735A"))
    c.roundRect(x, y, s, s, 16 * k, stroke=0, fill=1)
    c.setStrokeColor(HexColor("#FBBF24"))
    c.setLineWidth(3.2 * k)
    c.setLineCap(1)
    for deg in (-90, -60, -120, -30, -150):
        a = math.radians(deg)
        c.line(*T(32 + 22.5 * math.cos(a), 34 + 22.5 * math.sin(a)),
               *T(32 + 26.5 * math.cos(a), 34 + 26.5 * math.sin(a)))
    # disc: water below, sun above the roof line
    cx, cy = T(32, 34)
    disc = c.beginPath()
    disc.circle(cx, cy, 18 * k)
    c.saveState()
    c.clipPath(disc, stroke=0, fill=0)
    c.setFillColor(HexColor("#38A9E0"))
    c.rect(x, y, s, s, stroke=0, fill=1)
    sun = c.beginPath()
    sun.moveTo(*T(0, 0))
    sun.lineTo(*T(64, 0))
    sun.lineTo(*T(64, 54.8))
    sun.lineTo(*T(32, 28.5))
    sun.lineTo(*T(0, 54.8))
    sun.close()
    c.setFillColor(HexColor("#F9B93C"))
    c.drawPath(sun, stroke=0, fill=1)
    c.restoreState()
    # roof chevron
    c.setStrokeColor(white)
    c.setLineWidth(4.6 * k)
    c.setLineJoin(1)
    roof = c.beginPath()
    roof.moveTo(*T(9.5, 47))
    roof.lineTo(*T(32, 28.5))
    roof.lineTo(*T(54.5, 47))
    c.drawPath(roof, stroke=1, fill=0)
    # water drop
    q = 0.5523 * 4.6
    d = c.beginPath()
    d.moveTo(*T(32, 35.5))
    d.curveTo(*T(34.9, 39.3), *T(36.6, 41.9), *T(36.6, 43.9))
    d.curveTo(*T(36.6, 43.9 + q), *T(32 + q, 48.5), *T(32, 48.5))
    d.curveTo(*T(32 - q, 48.5), *T(27.4, 43.9 + q), *T(27.4, 43.9))
    d.curveTo(*T(27.4, 41.9), *T(29.1, 39.3), *T(32, 35.5))
    d.close()
    c.setFillColor(white)
    c.drawPath(d, stroke=0, fill=1)
    c.restoreState()


def _section(c, x, y, w, title, right, color, bg, icon):
    c.setFillColor(bg)
    c.roundRect(x, y, w, 20, 5, stroke=0, fill=1)
    c.setFillColor(color)
    c.rect(x, y, 4, 20, stroke=0, fill=1)
    if icon == "sun":
        _sun(c, x + 16, y + 10, 4.2, AMBER)
    else:
        _drop(c, x + 16, y + 8.6, 13, BLUE)
    c.setFont(FB, 11)
    c.setFillColor(INK)
    c.drawString(x + 30, y + 6, title)
    c.setFont(F, 8)
    c.setFillColor(GRAY)
    c.drawRightString(x + w - 8, y + 6.5, right)


def _tile(c, x, y, w, h, label, value, sub, accent):
    c.setFillColor(white)
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, 4, stroke=1, fill=1)
    c.setFillColor(accent)
    c.roundRect(x, y + h - 2.2, w, 2.2, 1, stroke=0, fill=1)
    c.setFont(F, 6.2)
    c.setFillColor(GRAY)
    c.drawString(x + 6, y + h - 11, label.upper())
    size = 12.5
    while pdfmetrics.stringWidth(value, FB, size) > w - 10 and size > 7.5:
        size -= 0.5
    c.setFont(FB, size)
    c.setFillColor(INK)
    c.drawString(x + 6, y + h - 25, value)
    c.setFont(F, 6.0)
    c.setFillColor(GRAY)
    s = sub
    while pdfmetrics.stringWidth(s, F, 6.0) > w - 10 and len(s) > 4:
        s = s[:-2]
    if s != sub:
        s = s.rstrip() + "…"
    c.drawString(x + 6, y + 5, s)


def _bar_chart(c, x, y, w, h, values: List[float], color, line: Optional[List[float]] = None,
               title: str = "", bar_name: str = "", line_name: str = ""):
    c.saveState()
    top = max(list(values) + list(line or [0])) or 1.0
    step = nice_step(top * 1.08 / 4)
    vmax = step * 4
    left = 26
    c.setFont(F, 7.2)
    c.setFillColor(INK)
    c.drawString(x, y + h + 6, title)
    # legend
    lx = x + w
    if line:
        c.setStrokeColor(GRAY)
        c.setDash(2, 1.6)
        c.setLineWidth(0.9)
        tw = pdfmetrics.stringWidth(line_name, F, 6.3)
        c.line(lx - tw - 20, y + h + 8.5, lx - tw - 6, y + h + 8.5)
        c.setDash()
        c.setFont(F, 6.3)
        c.setFillColor(GRAY)
        c.drawRightString(lx, y + h + 6.5, line_name)
        lx -= tw + 30
    tw = pdfmetrics.stringWidth(bar_name, F, 6.3)
    c.setFillColor(color)
    c.rect(lx - tw - 14, y + h + 6, 8, 5, stroke=0, fill=1)
    c.setFillColor(GRAY)
    c.setFont(F, 6.3)
    c.drawRightString(lx, y + h + 6.5, bar_name)
    # grid
    c.setLineWidth(0.4)
    for i in range(5):
        gy = y + h * i / 4
        c.setStrokeColor(LIGHT)
        c.line(x + left, gy, x + w, gy)
        c.setFillColor(GRAY)
        c.setFont(F, 5.8)
        c.drawRightString(x + left - 3, gy - 2, compact(step * i))
    slot = (w - left) / 12
    bw = slot * 0.6
    for i, v in enumerate(values):
        bh = max(0.0, h * v / vmax)
        bx = x + left + i * slot + (slot - bw) / 2
        c.setFillColor(color)
        if bh > 0.5:
            c.roundRect(bx, y, bw, bh, min(1.5, bh / 2), stroke=0, fill=1)
        c.setFillColor(GRAY)
        c.setFont(F, 5.8)
        c.drawCentredString(bx + bw / 2, y - 8, MONTH_LABELS[i])
        c.setFillColor(INK)
        c.setFont(F, 5.4)
        c.drawCentredString(bx + bw / 2, y + bh + 2, compact(v))
    if line:
        c.setStrokeColor(GRAY)
        c.setDash(2, 1.6)
        c.setLineWidth(0.9)
        p = c.beginPath()
        for i, v in enumerate(line):
            px_ = x + left + i * slot + slot / 2
            py_ = y + h * v / vmax
            (p.moveTo if i == 0 else p.lineTo)(px_, py_)
        c.drawPath(p, stroke=1, fill=0)
    c.restoreState()


def _score_ring(c, cx, cy, r, score: int, grade: str, solar_pts: int, water_pts: int):
    c.saveState()
    c.setLineWidth(7)
    c.setStrokeColor(LIGHT)
    c.circle(cx, cy, r, stroke=1, fill=0)
    col = GREEN if score >= 75 else AMBER if score >= 50 else HexColor("#EF4444")
    c.setStrokeColor(col)
    c.setLineCap(1)
    if score > 0:
        p = c.beginPath()
        p.arc(cx - r, cy - r, cx + r, cy + r, startAng=90, extent=-3.6 * min(score, 100) + 0.01)
        c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(INK)
    c.setFont(FB, 24)
    c.drawCentredString(cx, cy - 3, str(score))
    c.setFont(FB, 9)
    c.setFillColor(col)
    c.drawCentredString(cx, cy - 16, f"Grade {grade}")
    c.setFont(FB, 7.5)
    c.setFillColor(INK)
    c.drawCentredString(cx, cy - r - 16, "GREEN SCORE")
    c.setFont(F, 6.5)
    c.setFillColor(GRAY)
    c.drawCentredString(cx, cy - r - 25, f"Solar {solar_pts}/60 · Water {water_pts}/40")
    c.restoreState()


def _qr_drawing(data: str, size: float) -> Drawing:
    w = QrCodeWidget(data)
    w.barLevel = "M"
    b = w.getBounds()
    bw, bh = b[2] - b[0], b[3] - b[1]
    d = Drawing(size, size, transform=[size / bw, 0, 0, size / bh, 0, 0])
    d.add(w)
    return d


def qr_svg(data: str, size: float = 180) -> str:
    return renderSVG.drawToString(_qr_drawing(data, size))


# ------------------------------------------------------------------ main builder
def build_report_pdf(a: Dict, thumb: Optional[Image.Image], share_url: str,
                     address: str = "", method_label: str = "") -> bytes:
    _register_fonts()
    buf = io.BytesIO()
    W, H = A4
    M = 28
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("SuryaJal - Green Roof Report")
    c.setAuthor("SuryaJal")
    c.setSubject("Rooftop solar and rainwater harvesting potential")
    s, r, g, p = a["solar"], a["rain"], a["score"], a["params"]

    # ---------------- header band
    c.setFillColor(NAVY)
    c.rect(0, H - 74, W, 74, stroke=0, fill=1)
    _logo_mark(c, M, H - 62, 44)
    c.setFillColor(white)
    c.setFont(FB, 20)
    c.drawString(M + 52, H - 38, "Green Roof Report")
    c.setFont(F, 8.5)
    c.setFillColor(SUB)
    c.drawString(M + 52, H - 53, "SuryaJal · AI rooftop solar + rainwater assessment")
    c.setFont(FB, 8.5)
    c.setFillColor(white)
    c.drawRightString(W - M, H - 34, f"Report #{a['report_id']}")
    c.setFont(F, 8)
    c.setFillColor(SUB)
    c.drawRightString(W - M, H - 47, dt.date.today().strftime("%d %b %Y"))
    c.drawRightString(W - M, H - 58, a["climate"].get("short_source", "NASA POWER data"))

    # ---------------- roof row
    top = H - 88
    box = 168
    if thumb is not None:
        jb = io.BytesIO()
        thumb.save(jb, format="JPEG", quality=88)
        jb.seek(0)
        c.drawImage(ImageReader(jb), M, top - box, box, box)
    else:
        c.setFillColor(LIGHT)
        c.rect(M, top - box, box, box, stroke=0, fill=1)
        c.setFillColor(GRAY)
        c.setFont(F, 8)
        c.drawCentredString(M + box / 2, top - box / 2, "Imagery unavailable offline")
    c.setStrokeColor(LIGHT)
    c.setLineWidth(1)
    c.rect(M, top - box, box, box, stroke=1, fill=0)
    c.saveState()
    c.setFillColor(HexColor("#000000"), alpha=0.55)
    c.rect(M, top - box, box, 9, stroke=0, fill=1)
    c.restoreState()
    c.setFont(F, 4.6)
    c.setFillColor(white)
    c.drawString(M + 3, top - box + 3, ESRI_ATTRIBUTION)

    tx = M + box + 16
    tw = W - M - 130 - tx
    c.setFont(FB, 7)
    c.setFillColor(AMBER_D)
    c.drawString(tx, top - 8, "YOUR ROOF")
    c.setFont(FB, 10.5)
    c.setFillColor(INK)
    lines = simpleSplit(address or "Selected rooftop", FB, 10.5, tw)[:2]
    yy = top - 22
    for ln in lines:
        c.drawString(tx, yy, ln)
        yy -= 13
    lat, lon = a["centroid"]
    c.setFont(F, 7.5)
    c.setFillColor(GRAY)
    c.drawString(tx, yy, f"{abs(lat):.5f}° {'N' if lat >= 0 else 'S'}, {abs(lon):.5f}° {'E' if lon >= 0 else 'W'}")
    yy -= 30
    c.setFont(FB, 25)
    c.setFillColor(INK)
    area_txt = f"{a['area_m2']:.0f} m²"
    c.drawString(tx, yy, area_txt)
    c.setFont(F, 9)
    c.setFillColor(GRAY)
    c.drawString(tx + pdfmetrics.stringWidth(area_txt, FB, 25) + 6, yy + 1,
                 f"({inr(a['area_m2'] * 10.7639)} sq ft roof)")
    yy -= 16
    c.setFont(F, 8)
    c.setFillColor(INK)
    info = [
        f"Usable for solar: {s['usable_area_m2']:.0f} m² ({p['usable_fraction'] * 100:.0f}% of roof)",
        f"Roof type: {r['roof_type_label']} (runoff {r['runoff_c']:.2f})",
        f"Outline: {method_label}",
        f"Panel layout: {s['panels']} × {p['panel_w']} Wp, auto-placed with {p['edge_setback_m']} m edge gap"
        if s["panels"] else "Panel layout: roof too small for panels",
    ]
    for ln in info:
        c.drawString(tx, yy, ln)
        yy -= 11.5
    _score_ring(c, W - M - 60, top - 62, 40, g["score"], g["grade"], g["solar_pts"], g["water_pts"])

    # ---------------- solar section
    y0 = 555
    tile_w = (W - 2 * M - 18) / 4
    lim = "roof space" if s["limited_by"] == "roof" else "your electricity use"
    _section(c, M, y0, W - 2 * M, "Rooftop Solar",
             f"{s['kw']:.2f} kW · {s['panels']} panels · sized by {lim} · "
             f"{s['daily_units_per_kw']:.1f} units/day per kW here", AMBER, AMBER_BG, "sun")
    payback = f"{s['payback_years']:.1f} years" if s["payback_years"] else "—"
    tiles = [
        ("System size", f"{s['kw']:.2f} kW", f"{s['panels']} × {p['panel_w']} Wp panels"),
        ("Units per year", inr(s["annual_gen"]), f"≈ {s['annual_gen'] / 12:.0f} units / month"),
        ("Bill savings / year", rupees(s["annual_savings"]), f"≈ ₹{inr(s['monthly_savings_avg'])} per month"),
        ("Cost after subsidy", rupees(s["net_cost"]), f"{rupees(s['gross_cost'])} − {rupees(s['subsidy'])} PM Surya Ghar"),
        ("Payback", payback, f"then ~{max(0, 25 - (s['payback_years'] or 25)):.0f} years of free power"),
        (f"{s['lifetime_years']}-year savings", rupees(s["lifetime_savings"]), f"net gain {rupees(s['lifetime_profit'])}"),
        ("CO₂ avoided", f"{s['co2_t_year']:.1f} t / year", f"{s['co2_t_life']:.0f} t over {s['lifetime_years']} years"),
        ("Like planting", f"{s['trees_equiv']:.0f} trees", "at ~20 kg CO₂ per tree per year"),
    ]
    for i, (lb, val, sub) in enumerate(tiles):
        col, row = i % 4, i // 4
        _tile(c, M + col * (tile_w + 6), y0 - 44 - row * 44, tile_w, 38, lb, val, sub, AMBER)
    _bar_chart(c, M, 372, W - 2 * M, 72, s["monthly_gen"], AMBER, s["monthly_consumption"],
               "Month-wise solar generation (units)", "Solar units", "Your monthly use")

    # ---------------- rain section
    y1 = 330
    _section(c, M, y1, W - 2 * M, "Rainwater Harvesting",
             f"{r['annual_rain_mm']:.0f} mm rain/year · harvest = area × rain × {r['runoff_c']:.2f}",
             BLUE, BLUE_BG, "drop")
    wl = r["recharge_well"]
    wells = f"{wl['wells']} × " if wl["wells"] > 1 else ""
    tiles = [
        ("Rainwater per year", litres(r["annual_harvest_l"]), f"from {r['annual_rain_mm']:.0f} mm of rain"),
        ("Water for", f"{r['days_of_water']:.0f} days", f"family of {p['family_size']} at {p['lpcd']} L/person/day"),
        ("Storage tank", f"{inr(r['tank']['litres'])} L", f"captures a {p['design_rain_mm']:.0f} mm rain day"),
        ("Recharge well", f"{wells}{wl['diameter_m']:.0f} m Ø × {wl['depth_m']:.1f} m",
         f"holds {inr(wl['capacity_l'])} L (BWSSB 20 L/m²)"),
        ("BWSSB minimum", f"{inr(r['bwssb_min_l'])} L", "storage or recharge by law (Bengaluru)"),
        ("Tankers avoided", f"{r['tankers_saved']:.0f} / year", f"of {inr(p['tanker_litres'])} L each"),
        ("Water money saved", rupees(r["tanker_savings"]), f"at ₹{inr(p['tanker_price'])} per tanker"),
        ("Wettest month", MONTH_LABELS[r["wettest_month"]], f"{litres(r['wettest_harvest_l'])} in that month"),
    ]
    for i, (lb, val, sub) in enumerate(tiles):
        col, row = i % 4, i // 4
        _tile(c, M + col * (tile_w + 6), y1 - 44 - row * 44, tile_w, 38, lb, val, sub, BLUE)
    _bar_chart(c, M, 150, W - 2 * M, 72, r["monthly_harvest_l"], BLUE, r["monthly_demand_l"],
               "Month-wise rainwater harvest (litres)", "Harvest", "Family water use")

    # ---------------- footer: assumptions + QR
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.8)
    c.line(M, 128, W - M, 128)
    qr = 88
    renderPDF.draw(_qr_drawing(share_url, qr), c, W - M - qr, 34)
    c.setFont(FB, 6.5)
    c.setFillColor(INK)
    c.drawCentredString(W - M - qr / 2, 26, "Scan to open this roof")
    notes = [
        ("How we calculated", True),
        (f"Solar: NASA POWER sunlight ({a['climate']['ghi_avg']:.2f} kWh/m²/day) × temperature-corrected performance "
         f"ratio {s['pr_avg']:.2f}; {p['m2_per_kw']:.0f} m² per kW (PM Surya Ghar portal); {p['panel_w']} Wp panels.", False),
        (f"Money: ₹{inr(p['cost_per_kw'])}/kW installed; subsidy ₹30k/kW up to 2 kW + ₹18k for the 3rd kW (max ₹78k); "
         f"tariff ₹{s['tariff']:.2f}/unit; surplus exported at ₹{s['export_rate']:.2f}/unit (KERC 2026).", False),
        (f"CO₂: CEA grid factor {p['co2_kg_per_kwh']} kg/unit; panels lose {p['degradation'] * 100:.1f}%/year; "
         f"tariff held flat (conservative).", False),
        (f"Rain: 1 mm on 1 m² = 1 litre; runoff {r['runoff_c']:.2f}; tank sized for a {p['design_rain_mm']:.0f} mm "
         f"rain day; recharge well sized to BWSSB's 20 L per m² of roof.", False),
        ("This is a screening estimate for awareness, not an engineering design. Before buying, get a site survey "
         "from an MNRE-empanelled vendor and apply on pmsuryaghar.gov.in.", False),
        (f"Climate: {a['climate']['source']}. {ESRI_ATTRIBUTION}. Made with SuryaJal (MobileSAM + FastAPI).", False),
    ]
    yy = 116
    for text, bold in notes:
        font, size = (FB, 7.5) if bold else (F, 6.4)
        c.setFont(font, size)
        c.setFillColor(INK if bold else GRAY)
        for ln in simpleSplit(text, font, size, W - 2 * M - qr - 16):
            c.drawString(M, yy, ln)
            yy -= 8.2
        yy -= 1.5
    c.showPage()
    c.save()
    return buf.getvalue()
