"""Automatic solar-panel layout on the roof polygon.

1. Project the roof polygon to metres and find its main axis (minimum-area rectangle).
2. Rasterise at 10 cm, shrink by an edge setback (parapet / walkway).
3. Try landscape + portrait grids, both axes and several grid offsets; count panels
   that fit completely (summed-area table => O(1) test per panel).
4. Place the recommended number of panels as a compact block around the roof centre.

Returns panel rectangles in lat/lon for drawing on the map and on the PDF report.
"""
from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

import cv2
import numpy as np

from .geo import from_local_m, polygon_centroid, to_local_m

RES = 0.1          # metres per raster cell
COL_GAP = 0.02     # gap between modules in a row (m)
ROW_GAP = 0.40     # walkway / inter-row gap (m)


def _rot(P: np.ndarray, deg: float) -> np.ndarray:
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.stack([P[:, 0] * c - P[:, 1] * s, P[:, 0] * s + P[:, 1] * c], axis=1)


def _sat(mask_e: np.ndarray) -> np.ndarray:
    H, W = mask_e.shape
    S = np.zeros((H + 1, W + 1), np.int64)
    S[1:, 1:] = mask_e.astype(np.int64).cumsum(0).cumsum(1)
    return S


def _fit(S: np.ndarray, pw: int, ph: int, px: int, py: int, ox: int, oy: int):
    H, W = S.shape[0] - 1, S.shape[1] - 1
    xs = np.arange(ox, W - pw + 1, px)
    ys = np.arange(oy, H - ph + 1, py)
    if len(xs) == 0 or len(ys) == 0:
        return np.zeros((0, 2), int)
    X, Y = np.meshgrid(xs, ys)
    tot = S[Y + ph, X + pw] - S[Y, X + pw] - S[Y + ph, X] + S[Y, X]
    ok = tot == pw * ph
    return np.stack([X[ok], Y[ok]], axis=1)


def auto_layout(latlngs: Sequence[Tuple[float, float]], n_wanted: int | None, p: Dict) -> Dict:
    if len(latlngs) < 3:
        return {"max_panels": 0, "panels": [], "angle": 0.0}
    pts, origin = to_local_m(latlngs, polygon_centroid(latlngs))
    P = np.array(pts, dtype=np.float64)
    (_, _), (_, _), angle = cv2.minAreaRect(P.astype(np.float32))
    L, Wd = float(p["panel_len_m"]), float(p["panel_wid_m"])
    setback = float(p.get("edge_setback_m", 0.5))
    best = None
    for base in (angle, angle + 90.0):
        Q = _rot(P, -base)
        mn = Q.min(axis=0) - 1.0
        Qp = ((Q - mn) / RES).round().astype(np.int32)
        Wr, Hr = int(Qp[:, 0].max()) + 12, int(Qp[:, 1].max()) + 12
        if Wr * Hr > 9_000_000:          # absurdly large polygon: skip layout
            return {"max_panels": None, "panels": [], "angle": float(angle)}
        mask = np.zeros((Hr, Wr), np.uint8)
        cv2.fillPoly(mask, [Qp], 1)
        k = max(1, int(round(setback / RES)))
        mask_e = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (2 * k + 1, 2 * k + 1)))
        S = _sat(mask_e)
        for orient, (pw_m, ph_m) in (("landscape", (L, Wd)), ("portrait", (Wd, L))):
            pw, ph = int(math.ceil(pw_m / RES)), int(math.ceil(ph_m / RES))
            px, py = int(round((pw_m + COL_GAP) / RES)), int(round((ph_m + ROW_GAP) / RES))
            for fx in (0.0, 1 / 3, 2 / 3):
                for fy in (0.0, 1 / 3, 2 / 3):
                    cells = _fit(S, pw, ph, px, py, int(fx * px), int(fy * py))
                    score = len(cells) + (0.1 if orient == "landscape" else 0.0)
                    if best is None or score > best["score"]:
                        best = {"score": score, "cells": cells, "base": base, "mn": mn,
                                "pw": pw, "ph": ph, "orient": orient, "mask": mask_e}
    cells = best["cells"]
    max_panels = int(len(cells))
    n = max_panels if n_wanted is None else max(0, min(int(n_wanted), max_panels))
    panels: List[List[Tuple[float, float]]] = []
    if n > 0:
        m = best["mask"]
        ys, xs = np.nonzero(m)
        cx, cy = xs.mean(), ys.mean()
        # neat installer-style block: fill the row nearest the roof centre first
        # (centred run of panels), then the next-nearest row, and so on
        rows: Dict[int, List[int]] = {}
        for idx, (x0, y0) in enumerate(cells):
            rows.setdefault(int(y0), []).append(idx)
        order: List[int] = []
        for y0 in sorted(rows, key=lambda y: abs(y + best["ph"] / 2 - cy)):
            order += sorted(rows[y0], key=lambda i: abs(cells[i][0] + best["pw"] / 2 - cx))
        for i in order[:n]:
            x0, y0 = cells[i]
            rect = np.array([[x0, y0], [x0 + best["pw"], y0], [x0 + best["pw"], y0 + best["ph"]],
                             [x0, y0 + best["ph"]]], dtype=np.float64) * RES + best["mn"]
            world = _rot(rect, best["base"])
            panels.append([(round(a, 7), round(b, 7)) for a, b in from_local_m(world, origin)])
    return {"max_panels": max_panels, "panels": panels, "angle": float(best["base"] % 180),
            "orientation": best["orient"]}
