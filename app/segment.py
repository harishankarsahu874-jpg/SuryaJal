"""Roof segmentation.

Primary:  MobileSAM (Segment Anything, mobile version) exported to ONNX, run with
          onnxruntime on CPU - encoder ~0.5-1 s, decoder ~0.05 s per click.
Fallback: classical OpenCV region growing (mean-shift smoothing + flood fill) if the
          ONNX models are not downloaded.

Both return a binary mask for the roof under the user's tap, which is cleaned and
converted to a simplified polygon.
"""
from __future__ import annotations

import math
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

ENCODER_FILE = "mobile_sam_image_encoder.onnx"
DECODER_FILE = "sam_mask_decoder_multi.onnx"


def available_cpus() -> int:
    """How many CPU threads ONNX Runtime should use.

    Order: SURYAJAL_THREADS env var  >  container CPU quota (cgroup v2 / v1)  >  affinity
    mask  >  os.cpu_count().  Cloud hosts such as Render, Railway or Fly give a container
    e.g. 0.5 CPU while os.cpu_count() still reports the host's 16+ cores; spinning up that
    many threads on a throttled container makes MobileSAM several times *slower*.
    """
    env = (os.environ.get("SURYAJAL_THREADS") or "").strip()
    if env.isdigit() and int(env) > 0:
        return int(env)
    try:
        n = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        n = os.cpu_count() or 2
    try:                                          # cgroup v2: "max 100000" | "50000 100000"
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
    except (OSError, ValueError):
        try:                                      # cgroup v1
            quota = Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text().strip()
            period = Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text().strip()
        except OSError:
            quota = period = "max"
    if quota != "max" and quota.lstrip("-").isdigit() and int(quota) > 0 and period.isdigit():
        n = min(n, math.ceil(int(quota) / int(period)))
    return max(1, n)


class RoofSegmenter:
    def __init__(self, models_dir: Path):
        self.models_dir = Path(models_dir)
        self.encoder = self.decoder = None
        self.method = "opencv"
        self.load_error: Optional[str] = None
        self.warm = False                    # True once the ONNX graph has run once
        self._emb_cache: "OrderedDict[tuple, np.ndarray]" = OrderedDict()
        self._lock = threading.Lock()
        self._load()

    # ------------------------------------------------------------------ setup
    def _load(self):
        enc_p, dec_p = self.models_dir / ENCODER_FILE, self.models_dir / DECODER_FILE
        if not (enc_p.exists() and dec_p.exists()):
            self.load_error = "MobileSAM models not found - using OpenCV fallback"
            return
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = available_cpus()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.enable_cpu_mem_arena = False     # ~250 MB less RAM, same speed (fits 4 GB laptops)
            so.enable_mem_pattern = False
            prov = ["CPUExecutionProvider"]
            self.encoder = ort.InferenceSession(str(enc_p), so, providers=prov)
            self.decoder = ort.InferenceSession(str(dec_p), so, providers=prov)
            self.method = "mobilesam"
        except Exception as e:  # pragma: no cover - depends on the machine
            self.encoder = self.decoder = None
            self.load_error = f"Could not load MobileSAM ({e}) - using OpenCV fallback"

    def warmup(self):
        try:
            if self.method == "mobilesam":
                dummy = np.full((256, 256, 3), 127, np.uint8)
                self.segment(dummy, [(128, 128)], [1], cache_key=None)
        finally:
            self.warm = True

    # ------------------------------------------------------------------ public
    def segment(self, img: np.ndarray, points: Sequence[Tuple[float, float]],
                labels: Sequence[int], cache_key=None, force_opencv: bool = False) -> dict:
        """img: HxWx3 RGB uint8. points in crop pixel coords. labels 1=roof, 0=not roof."""
        t0 = time.time()
        if self.method == "mobilesam" and not force_opencv:
            mask, score, used = self._sam_mask(img, points, labels, cache_key)
            method = "mobilesam"
        else:
            mask, score, used = self._opencv_mask(img, points, labels), None, False
            method = "opencv"
        seed = tuple(int(round(v)) for v in points[0])
        clean = clean_mask(mask, seed, [p for p, l in zip(points, labels) if l == 1])
        return {"mask": clean, "score": score, "method": method,
                "cached_embedding": used, "ms": int((time.time() - t0) * 1000)}

    # ------------------------------------------------------------------ MobileSAM
    def _embedding(self, img: np.ndarray, cache_key):
        if cache_key is not None and cache_key in self._emb_cache:
            self._emb_cache.move_to_end(cache_key)
            return self._emb_cache[cache_key], True
        h, w = img.shape[:2]
        scale = 1024.0 / max(h, w)
        rs = cv2.resize(img, (int(round(w * scale)), int(round(h * scale))),
                        interpolation=cv2.INTER_LINEAR).astype(np.float32)
        emb = self.encoder.run(None, {"input_image": rs})[0]
        if cache_key is not None:
            with self._lock:
                self._emb_cache[cache_key] = emb
                while len(self._emb_cache) > 6:
                    self._emb_cache.popitem(last=False)
        return emb, False

    def _sam_mask(self, img, points, labels, cache_key):
        h, w = img.shape[:2]
        scale = 1024.0 / max(h, w)
        emb, used = self._embedding(img, cache_key)
        pc = [[x * scale, y * scale] for x, y in points] + [[0.0, 0.0]]
        pl = [float(l) for l in labels] + [-1.0]          # padding point (no box prompt)
        masks, iou, _ = self.decoder.run(None, {
            "image_embeddings": emb,
            "point_coords": np.array([pc], np.float32),
            "point_labels": np.array([pl], np.float32),
            "mask_input": np.zeros((1, 1, 256, 256), np.float32),
            "has_mask_input": np.zeros(1, np.float32),
            "orig_im_size": np.array([h, w], np.float32),
        })
        masks, iou = masks[0] > 0.0, iou[0]
        sx, sy = int(round(points[0][0])), int(round(points[0][1]))
        sx, sy = min(max(sx, 0), w - 1), min(max(sy, 0), h - 1)
        # One tap is ambiguous (roof part / roof / whole block) -> use SAM's multimask
        # outputs 1..3 ranked by predicted IoU. Several taps -> the single-mask output 0.
        order = [0] if len(points) > 1 else list(np.argsort(-iou[1:]) + 1) + [0]
        for idx in order:
            m = masks[idx]
            frac = m.mean()
            if m[sy, sx] and 0.0005 < frac < 0.55:
                return m, float(iou[idx]), used
        best = int(np.argmax(iou))
        return masks[best], float(iou[best]), used

    # ------------------------------------------------------------------ OpenCV fallback
    @staticmethod
    def _opencv_mask(img, points, labels):
        """Region growing on an edge-preserving smoothed image. The flood-fill tolerance
        is chosen where the region size is most *stable* (MSER-like criterion)."""
        h, w = img.shape[:2]
        bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        smooth = cv2.pyrMeanShiftFiltering(bgr, sp=7, sr=18)
        lab = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB)
        total = np.zeros((h, w), np.uint8)
        tols = [4, 6, 8, 10, 13, 16, 20, 25]
        for (x, y), l in zip(points, labels):
            if l != 1:
                continue
            x, y = min(max(int(x), 0), w - 1), min(max(int(y), 0), h - 1)
            masks, areas = [], []
            for tol in tols:
                ff = np.zeros((h + 2, w + 2), np.uint8)
                flags = 4 | cv2.FLOODFILL_FIXED_RANGE | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
                d = (tol, tol // 2 + 3, tol // 2 + 3)
                cv2.floodFill(lab, ff, (x, y), 0, d, d, flags)
                m = ff[1:-1, 1:-1] > 0
                masks.append(m)
                areas.append(int(m.sum()))
            best_i, best_growth = None, 1e9
            for i in range(len(tols) - 1):
                frac = areas[i] / (h * w)
                if not (0.0008 < frac < 0.30):
                    continue
                growth = (areas[i + 1] - areas[i]) / max(areas[i], 1)
                if growth < best_growth:
                    best_i, best_growth = i, growth
            if best_i is None:
                ok = [i for i, a in enumerate(areas) if a / (h * w) < 0.30]
                best_i = ok[-1] if ok else 0
            total |= masks[best_i].astype(np.uint8)
        for (x, y), l in zip(points, labels):     # negative taps carve regions out
            if l == 0:
                cv2.circle(total, (int(x), int(y)), 8, 0, -1)
        return total > 0


# ------------------------------------------------------------------ mask -> polygon
def fill_holes(m: np.ndarray) -> np.ndarray:
    m8 = m.astype(np.uint8) * 255
    cnts, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(m8)
    cv2.drawContours(out, cnts, -1, 255, -1)
    return out > 0


def clean_mask(mask: np.ndarray, seed: Tuple[int, int], positives: List) -> np.ndarray:
    """Keep only the connected region(s) under the positive taps, close gaps, fill holes."""
    h, w = mask.shape
    m = mask.astype(np.uint8)
    if m.sum() == 0:
        return mask.astype(bool)
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k5)
    n, lab = cv2.connectedComponents(m, connectivity=4)
    keep = set()
    for (x, y) in positives or [seed]:
        x, y = min(max(int(round(x)), 0), w - 1), min(max(int(round(y)), 0), h - 1)
        if lab[y, x] > 0:
            keep.add(int(lab[y, x]))
    if not keep:                             # tap landed on an edge: take nearest component
        ys, xs = np.nonzero(m)
        if len(xs):
            i = int(np.argmin((xs - seed[0]) ** 2 + (ys - seed[1]) ** 2))
            keep.add(int(lab[ys[i], xs[i]]))
    comp = np.isin(lab, list(keep))
    return fill_holes(comp)


def mask_to_polygon(mask: np.ndarray, eps_px: float | None = None):
    """Largest external contour, simplified. Returns (Nx2 float array in continuous
    pixel coords, touches_border). The simplified polygon is rescaled about its centroid
    so its area equals the mask's pixel count (contours run through boundary pixel
    centres, which would otherwise under-count area by ~half a pixel all round)."""
    m8 = mask.astype(np.uint8) * 255
    cnts, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return None, False
    cnt = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(cnt) < 12:
        return None, False
    peri = cv2.arcLength(cnt, True)
    eps = eps_px if eps_px is not None else max(1.2, 0.006 * peri)
    approx = cv2.approxPolyDP(cnt, eps, True).reshape(-1, 2).astype(float)
    if len(approx) < 3:
        approx = cnt.reshape(-1, 2).astype(float)
    h, w = mask.shape
    x, y, bw, bh = cv2.boundingRect(cnt)
    touches = x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1
    approx += 0.5                                   # pixel index -> pixel centre
    region = np.zeros_like(m8)
    cv2.drawContours(region, [cnt], -1, 255, -1)
    mask_area = float((region > 0).sum())
    xs, ys = approx[:, 0], approx[:, 1]
    cross = xs * np.roll(ys, -1) - np.roll(xs, -1) * ys
    a = cross.sum() / 2.0
    if abs(a) > 1e-6:
        cx = ((xs + np.roll(xs, -1)) * cross).sum() / (6 * a)
        cy = ((ys + np.roll(ys, -1)) * cross).sum() / (6 * a)
        s = float(np.clip(np.sqrt(mask_area / abs(a)), 0.9, 1.15))
        approx = np.stack([cx + s * (xs - cx), cy + s * (ys - cy)], axis=1)
    return approx, touches
