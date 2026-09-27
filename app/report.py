"""Three-page A4 "Green Roof Report" (reportlab): roof thumbnail with outline + auto
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

from .config import (ESRI_ATTRIBUTION, FONTS_DIR, MONTH_LABELS, OERC_DOMESTIC_SLABS,
                     OERC_DUTY_PCT, OERC_FIXED_CHARGE_PER_KW, TARIFF_FY)
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


def _slab_txt() -> str:
    """₹2.90 up to 50 units · ₹4.70 up to 200 · ₹5.70 up to 400 · ₹6.10 above."""
    out = []
    for upto, rate in OERC_DOMESTIC_SLABS:
        out.append(f"₹{rate:.2f}" + ("" if upto == float("inf") else f" up to {upto:.0f}u"))
    return " · ".join(out) + " per unit, telescopic"


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


def _score_ring(c, cx, cy, r, score: int, grade: str, solar_pts: int, water_pts: int,
                rule_pts: int = 0):
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
    c.drawCentredString(cx, cy - r - 25,
                        f"Solar {solar_pts}/55 · Water {water_pts}/35 · Rule {rule_pts}/10")
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
# Three A4 pages so nothing gets squeezed or overlaps:
#   1. the roof map (big satellite view) + roof facts + Green Score
#   2. the Rooftop Solar report
#   3. the Rainwater Harvesting report + QR code
def _header(c, W, H, M, a, subtitle: str, page: int, pages: int):
    c.setFillColor(NAVY)
    c.rect(0, H - 74, W, 74, stroke=0, fill=1)
    _logo_mark(c, M, H - 62, 44)
    c.setFillColor(white)
    c.setFont(FB, 20)
    c.drawString(M + 52, H - 38, "Green Roof Report")
    c.setFont(F, 8.5)
    c.setFillColor(SUB)
    c.drawString(M + 52, H - 53, subtitle)
    c.setFont(FB, 8.5)
    c.setFillColor(white)
    c.drawRightString(W - M, H - 34, f"Report #{a['report_id']}")
    c.setFont(F, 8)
    c.setFillColor(SUB)
    c.drawRightString(W - M, H - 47, dt.date.today().strftime("%d %b %Y"))
    c.drawRightString(W - M, H - 58, a["climate"].get("short_source", "NASA POWER data"))
    # footer line + page number
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.6)
    c.line(M, 30, W - M, 30)
    c.setFont(F, 7)
    c.setFillColor(GRAY)
    c.drawString(M, 19, "SuryaJal · screening estimate, not an engineering design")
    c.drawRightString(W - M, 19, f"Page {page} of {pages}")


def _notes(c, x, y, w, notes, min_y=40):
    """Wrapped paragraphs; returns the y below the last line (never draws under min_y)."""
    for text, bold in notes:
        font, size, lead = (FB, 9, 12) if bold else (F, 7.8, 10.5)
        c.setFont(font, size)
        c.setFillColor(INK if bold else GRAY)
        for ln in simpleSplit(text, font, size, w):
            if y < min_y:
                return y
            c.drawString(x, y, ln)
            y -= lead
        y -= 4
    return y


def _tiles(c, M, W, y_top, tiles, accent, cols=3, h=46, gap=8):
    tw = (W - 2 * M - gap * (cols - 1)) / cols
    rows = (len(tiles) + cols - 1) // cols
    for i, (lb, val, sub) in enumerate(tiles):
        col, row = i % cols, i // cols
        _tile(c, M + col * (tw + gap), y_top - h - row * (h + gap), tw, h, lb, val, sub, accent)
    return y_top - rows * (h + gap)


def build_report_pdf(a: Dict, thumb: Optional[Image.Image], share_url: str,
                     address: str = "", method_label: str = "") -> bytes:
    _register_fonts()
    buf = io.BytesIO()
    W, H = A4
    M = 32
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("SuryaJal - Green Roof Report")
    c.setAuthor("SuryaJal")
    c.setSubject("Rooftop solar and rainwater harvesting potential in Odisha")
    s, r, g, p = a["solar"], a["rain"], a["score"], a["params"]
    loc = a.get("location") or {}
    district = loc.get("district") or "Odisha"
    place = " · ".join(x for x in (loc.get("district") and f"{loc['district']} district",
                                   loc.get("discom")) if x)
    PAGES = 3

    # =============================== PAGE 1 - roof map
    _header(c, W, H, M, a, "Page 1 · Your roof on the map", 1, PAGES)
    y = H - 100
    c.setFont(FB, 7.5)
    c.setFillColor(AMBER_D)
    c.drawString(M, y, "YOUR ROOF")
    c.setFont(FB, 13)
    c.setFillColor(INK)
    yy = y - 17
    for ln in simpleSplit(address or "Selected rooftop", FB, 13, W - 2 * M)[:2]:
        c.drawString(M, yy, ln)
        yy -= 16
    lat, lon = a["centroid"]
    c.setFont(F, 8)
    c.setFillColor(GRAY)
    c.drawString(M, yy, f"{abs(lat):.5f}° {'N' if lat >= 0 else 'S'}, {abs(lon):.5f}° {'E' if lon >= 0 else 'W'}"
                 + (f"  ·  {place}" if place else ""))
    box = W - 2 * M
    map_top = yy - 12
    map_y = map_top - box
    if thumb is not None:
        jb = io.BytesIO()
        thumb.save(jb, format="JPEG", quality=90)
        jb.seek(0)
        c.drawImage(ImageReader(jb), M, map_y, box, box)
    else:
        c.setFillColor(LIGHT)
        c.rect(M, map_y, box, box, stroke=0, fill=1)
        c.setFillColor(GRAY)
        c.setFont(F, 10)
        c.drawCentredString(M + box / 2, map_y + box / 2, "Satellite imagery unavailable offline")
    c.setStrokeColor(LIGHT)
    c.setLineWidth(1)
    c.rect(M, map_y, box, box, stroke=1, fill=0)
    c.saveState()
    c.setFillColor(HexColor("#000000"), alpha=0.55)
    c.rect(M, map_y, box, 12, stroke=0, fill=1)
    c.restoreState()
    c.setFont(F, 6)
    c.setFillColor(white)
    c.drawString(M + 4, map_y + 4, ESRI_ATTRIBUTION + "  ·  yellow = roof outline, blue = suggested panels")

    # facts (left) + score ring (right) under the map
    fy = map_y - 34
    c.setFont(FB, 24)
    c.setFillColor(INK)
    area_txt = f"{a['area_m2']:.0f} m²"
    c.drawString(M, fy, area_txt)
    c.setFont(F, 9)
    c.setFillColor(GRAY)
    c.drawString(M + pdfmetrics.stringWidth(area_txt, FB, 24) + 6, fy + 1,
                 f"({inr(a['area_m2'] * 10.7639)} sq ft roof)")
    fy -= 17
    info = [
        f"Usable for solar: {s['usable_area_m2']:.0f} m² ({p['usable_fraction'] * 100:.0f}% of roof)",
        f"Roof type: {r['roof_type_label']} (runoff {r['runoff_c']:.2f})",
        f"Outline: {method_label}",
        (f"Panel layout: {s['panels']} × {p['panel_w']} Wp, {p['edge_setback_m']} m edge gap"
         if s["panels"] else "Panel layout: roof too small for panels"),
        f"Solar: {s['kw']:.2f} kW  ·  Rainwater: {litres(r['annual_harvest_l'])} a year",
    ]
    c.setFont(F, 8.5)
    c.setFillColor(INK)
    text_w = W - 2 * M - 140
    for ln in info:
        for part in simpleSplit(ln, F, 8.5, text_w)[:2]:
            if fy < 40:
                break
            c.drawString(M, fy, part)
            fy -= 12
    _score_ring(c, W - M - 62, map_y - 62, 34, g["score"], g["grade"], g["solar_pts"],
                g["water_pts"], g.get("rule_pts", 0))
    c.showPage()

    # =============================== PAGE 2 - solar
    _header(c, W, H, M, a, "Page 2 · Rooftop Solar report", 2, PAGES)
    y0 = H - 112
    lim = "roof space" if s["limited_by"] == "roof" else "your electricity use"
    _section(c, M, y0, W - 2 * M, "Rooftop Solar",
             f"{s['kw']:.2f} kW · {s['panels']} panels · sized by {lim}", AMBER, AMBER_BG, "sun")
    c.setFont(F, 8)
    c.setFillColor(GRAY)
    c.drawString(M, y0 - 14, f"{s['daily_units_per_kw']:.1f} units/day per kW in {district}")
    payback = f"{s['payback_years']:.1f} years" if s["payback_years"] else "—"
    tiles = [
        ("System size", f"{s['kw']:.2f} kW", f"{s['panels']} × {p['panel_w']} Wp panels"),
        ("Units per year", inr(s["annual_gen"]), f"≈ {s['annual_gen'] / 12:.0f} units / month"),
        ("Bill savings / year", rupees(s["annual_savings"]), f"≈ ₹{inr(s['monthly_savings_avg'])}/month"),
        ("Your bill today", rupees(s["bill_before"]), f"→ {rupees(s['bill_after'])}/yr with solar"),
        ("Cost after subsidy", rupees(s["net_cost"]), f"from {rupees(s['gross_cost'])} before subsidy"),
        ("Subsidy", rupees(s["subsidy_central"] + s["subsidy_state"]),
         f"{rupees(s['subsidy_central'])} CFA + {rupees(s['subsidy_state'])} SFA"),
        ("Payback", payback,
         f"then ~{max(0, s['lifetime_years'] - (s['payback_years'] or s['lifetime_years'])):.0f} yrs free power"),
        (f"{s['lifetime_years']}-year savings", rupees(s["lifetime_savings"]), f"net gain {rupees(s['lifetime_profit'])}"),
        ("CO₂ avoided", f"{s['co2_t_year']:.1f} t / year", f"{s['co2_t_life']:.0f} t over {s['lifetime_years']} years"),
        ("Like planting", f"{s['trees_equiv']:.0f} trees", "~20 kg CO₂ per tree per year"),
        ("Units per kW / day", f"{s['daily_units_per_kw']:.1f}", f"sunlight in {district}"),
        ("Usable roof", f"{s['usable_area_m2']:.0f} m²", f"{p['m2_per_kw']:.0f} m² needed per kW"),
    ]
    ty = _tiles(c, M, W, y0 - 24, tiles, AMBER)
    ch_h = 130
    _bar_chart(c, M, ty - 28 - ch_h, W - 2 * M, ch_h, s["monthly_gen"], AMBER, s["monthly_consumption"],
               "Month-wise solar generation (units)", "Solar units", "Your monthly use")
    ny = ty - 28 - ch_h - 36
    _notes(c, M, ny, W - 2 * M, [
        ("How we calculated solar", True),
        (f"Sunlight: NASA POWER ({a['climate']['ghi_avg']:.2f} kWh/m²/day) × temperature-corrected performance "
         f"ratio {s['pr_avg']:.2f}; {p['m2_per_kw']:.0f} m² per kW (PM Surya Ghar portal); {p['panel_w']} Wp panels.", False),
        (f"Money: ₹{inr(p['cost_per_kw'])}/kW installed; PM Surya Ghar ₹30k/kW up to 2 kW + ₹18k for the 3rd kW "
         f"(max ₹78k) plus Odisha SFA ₹25k/kW + ₹10k (max ₹60k).", False),
        (f"Tariff: OERC domestic {TARIFF_FY} ({_slab_txt()}) + ₹{OERC_FIXED_CHARGE_PER_KW:.0f}/kW/month fixed + "
         f"{OERC_DUTY_PCT:.0f}% electricity duty; surplus settled at ₹{s['export_rate']:.2f}/unit (GRIDCO APPC), "
         f"credited up to {s['net_meter_cap'] * 100:.0f}% of your yearly use.", False),
        (f"CO₂: CEA grid factor {p['co2_kg_per_kwh']} kg/unit; panels lose {p['degradation'] * 100:.1f}%/year; "
         f"tariff held flat (conservative).", False),
        ("Next step: get a site survey from an MNRE/OREDA-empanelled vendor, apply on pmsuryaghar.gov.in and "
         f"register for net metering with {loc.get('discom') or 'your Odisha DISCOM'}.", False),
    ])
    c.showPage()

    # =============================== PAGE 3 - rainwater
    _header(c, W, H, M, a, "Page 3 · Rainwater Harvesting report", 3, PAGES)
    y1 = H - 112
    _section(c, M, y1, W - 2 * M, "Rainwater Harvesting",
             f"{r['annual_rain_mm']:.0f} mm rain/year in {district}", BLUE, BLUE_BG, "drop")
    c.setFont(F, 8)
    c.setFillColor(GRAY)
    c.drawString(M, y1 - 14, f"harvest = roof area × rain × runoff {r['runoff_c']:.2f}")
    wl, ch = r["recharge_well"], r["chhata"]
    wells = f"{wl['wells']} × " if wl["wells"] > 1 else ""
    tiles = [
        ("Rainwater per year", litres(r["annual_harvest_l"]), f"from {r['annual_rain_mm']:.0f} mm of rain"),
        ("Water for", f"{r['days_of_water']:.0f} days", f"{p['family_size']} people at {p['lpcd']} L/person/day"),
        ("Storage tank", f"{inr(r['tank']['litres'])} L", f"captures a {p['design_rain_mm']:.0f} mm rain day"),
        ("Recharge well", f"{wells}{wl['diameter_m']:.0f} m Ø × {wl['depth_m']:.1f} m",
         f"holds {inr(wl['capacity_l'])} L"),
        ("Odisha rule", f"{inr(r['rule_min_l'])} L",
         f"{r['rule']['l_per_m2']:.0f} L/m² · " + ("met" if r["meets_rule"] else f"short {litres(r['rule_gap_l'])}")),
        ("CHHATA subsidy", rupees(ch["subsidy"]) if ch["eligible"] else "not eligible",
         f"50% of ~{rupees(ch['est_cost'])} cost" if ch["eligible"] else "see notes below"),
        ("Tankers avoided", f"{r['tankers_saved']:.0f} / year", f"of {inr(p['tanker_litres'])} L each"),
        ("Downpipes", f"{r['downpipes']['count']} × {r['downpipes']['diameter_mm']:.0f} mm", "to carry the roof runoff"),
        ("Runoff factor", f"{r['runoff_c']:.2f}", r["roof_type_label"]),
    ]
    ty = _tiles(c, M, W, y1 - 24, tiles, BLUE)
    _bar_chart(c, M, ty - 28 - ch_h, W - 2 * M, ch_h, r["monthly_harvest_l"], BLUE, r["monthly_demand_l"],
               "Month-wise rainwater harvest (litres)", "Harvest", "Water use")
    ny = ty - 28 - ch_h - 36
    qr = 96
    notes = [
        ("How we calculated rainwater", True),
        (f"1 mm of rain on 1 m² = 1 litre; runoff {r['runoff_c']:.2f}; tank sized for a {p['design_rain_mm']:.0f} mm "
         f"rain day; water use = {p['family_size']} people (home, school or institution) × {p['lpcd']} L/day.", False),
        (f"Recharge well sized to the Odisha Development Authorities Rules 2020 norm of 6 m³ per 100 m² of roof "
         f"({r['rule']['l_per_m2']:.0f} L/m²).", False),
        (f"CHHATA (Govt. of Odisha, {ch['scheme_years']}): 50% of the system cost or ₹{inr(ch['max_subsidy'])}, "
         f"whichever is less, for roofs of {ch['roof_min_m2']:.0f}–{ch['roof_max_m2']:.0f} m² and at most "
         f"{ch['max_floors']} floors; a recharge unit is compulsory. Apply at echhata.odisha.gov.in."
         + ("" if ch["eligible"] or not ch["reasons"] else " Not eligible: " + "; ".join(ch["reasons"]) + "."), False),
        (f"Climate: {a['climate']['source']}. Made with SuryaJal (MobileSAM + FastAPI).", False),
    ]
    _notes(c, M, ny, W - 2 * M - qr - 20, notes, min_y=44)
    renderPDF.draw(_qr_drawing(share_url, qr), c, W - M - qr, ny - qr + 8)
    c.setFont(FB, 7)
    c.setFillColor(INK)
    c.drawCentredString(W - M - qr / 2, ny - qr, "Scan to open this roof")
    c.showPage()
    c.save()
    return buf.getvalue()
