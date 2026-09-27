"""Segmentation tests on a synthetic 'satellite' image (no internet, no licensed imagery)."""
import cv2
import numpy as np
import pytest

from app.config import MODELS_DIR
from app.segment import RoofSegmenter, mask_to_polygon


def synthetic_scene():
    rng = np.random.default_rng(0)
    img = rng.normal(0, 9, (512, 512, 3)) + np.array([70, 95, 60])        # noisy green ground
    img = img.clip(0, 255).astype(np.uint8)
    cv2.rectangle(img, (180, 200), (320, 300), (200, 110, 80), -1)       # terracotta roof 141x101 px
    cv2.rectangle(img, (60, 60), (130, 120), (235, 235, 230), -1)        # white roof
    cv2.rectangle(img, (0, 330), (511, 350), (120, 120, 120), -1)        # a road
    return img


def poly_area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return abs(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y)) / 2


@pytest.fixture(scope="module")
def seg():
    return RoofSegmenter(MODELS_DIR)


@pytest.mark.parametrize("engine", ["mobilesam", "opencv"])
def test_finds_synthetic_roof(seg, engine):
    if engine == "mobilesam" and seg.method != "mobilesam":
        pytest.skip("MobileSAM models not downloaded (run scripts/download_models.py)")
    r = seg.segment(synthetic_scene(), [(250, 250)], [1], cache_key=None,
                    force_opencv=(engine == "opencv"))
    poly, touches = mask_to_polygon(r["mask"])
    assert poly is not None and not touches
    true_area = 141 * 101
    assert abs(poly_area(poly) - true_area) / true_area < 0.12
    assert r["mask"][250, 250]


def test_embedding_cache_speeds_up_refinement(seg):
    if seg.method != "mobilesam":
        pytest.skip("MobileSAM models not downloaded")
    img = synthetic_scene()
    a = seg.segment(img, [(250, 250)], [1], cache_key=("t", 1))
    b = seg.segment(img, [(250, 250), (95, 90)], [1, 1], cache_key=("t", 1))
    assert not a["cached_embedding"] and b["cached_embedding"]


def test_available_cpus_env_override(monkeypatch):
    from app.segment import available_cpus
    monkeypatch.setenv("SURYAJAL_THREADS", "1")
    assert available_cpus() == 1
    monkeypatch.setenv("SURYAJAL_THREADS", "garbage")
    assert available_cpus() >= 1
    monkeypatch.delenv("SURYAJAL_THREADS")
    assert available_cpus() >= 1
