"""API smoke tests (work offline too: climate falls back to bundled city data)."""
import pytest
from fastapi.testclient import TestClient

from app import stats
from app.geo import encode_polyline, from_local_m
from app.main import app

ROOF = [list(p) for p in from_local_m([(0, 0), (14, 0), (14, 10), (0, 10)], (12.9285, 77.5821))]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    stats._FILE = tmp_path_factory.mktemp("stats") / "stats.json"   # don't touch real fest stats
    with TestClient(app) as c:
        yield c


def test_health_and_config(client):
    assert client.get("/api/health").json()["ok"] is True
    cfg = client.get("/api/config").json()
    assert "rcc" in cfg["roof_types"] and cfg["defaults"]["m2_per_kw"] == 10.0


def test_assess(client):
    r = client.post("/api/assess", json={"polygon": ROOF, "monthly_units": 300, "family_size": 4})
    assert r.status_code == 200
    a = r.json()
    assert a["area_m2"] == pytest.approx(140, rel=0.01)
    assert a["solar"]["panels"] >= 1 and len(a["layout"]["panels"]) == a["solar"]["panels"]
    assert a["rain"]["annual_harvest_l"] > 0 and 0 <= a["score"]["score"] <= 100


def test_assess_rejects_bad_input(client):
    assert client.post("/api/assess", json={"polygon": ROOF[:2]}).status_code == 422
    assert client.post("/api/assess", json={"polygon": ROOF, "family_size": 0}).status_code == 422


def test_report_pdf(client):
    r = client.get("/r", params={"p": encode_polyline([tuple(p) for p in ROOF]), "u": 300, "f": 4,
                                 "rt": "rcc", "uf": 70, "a": "Test roof", "m": "manual"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-" and len(r.content) > 20000
    assert client.get("/api/stats").json()["today"]["roofs"] == 1


def test_qr_svg(client):
    r = client.get("/api/qr.svg", params={"data": "https://example.com/r?p=abc"})
    assert r.status_code == 200 and "<svg" in r.text


def test_suggest_offline_typeahead(client, monkeypatch):
    """Instant suggestions from the bundled data - no internet, no errors."""
    r = client.get("/api/suggest", params={"q": "Cuttack"}).json()
    assert any("Cuttack" in x["name"] for x in r)
    r = client.get("/api/suggest", params={"q": "751007"}).json()
    assert "Sahid Nagar" in r[0]["name"]
    assert client.get("/api/suggest", params={"q": "zzz"}).json() == []


def test_geocode_pincode_offline(client, monkeypatch):
    import app.main as m

    async def boom(*a, **k):
        raise m.httpx.ConnectError("offline")
    monkeypatch.setattr(m, "_nominatim", boom)
    r = client.get("/api/geocode", params={"q": "751007"}).json()
    assert r[0]["district"] and "Sahid Nagar" in r[0]["name"]
    r = client.get("/api/geocode", params={"q": "768 004"}).json()   # district-level fallback
    assert "Sambalpur" in r[0]["name"]
    r = client.get("/api/geocode", params={"q": "751-007"}).json()   # hyphen separator
    assert "Sahid Nagar" in r[0]["name"]


def test_geocode_place_names_offline(client, monkeypatch):
    """Town / area names resolve from the bundled Odisha gazetteer - no internet needed."""
    import app.main as m

    async def boom(*a, **k):
        raise m.httpx.ConnectError("offline")
    monkeypatch.setattr(m, "_nominatim", boom)
    r = client.get("/api/geocode", params={"q": "Cuttack"}).json()
    assert "Cuttack" in r[0]["name"] and r[0]["district"]
    r = client.get("/api/geocode", params={"q": "Sahid Nagar"}).json()
    assert "Sahid Nagar" in r[0]["name"]
    r = client.get("/api/geocode", params={"q": "Patia Bhubaneswar"}).json()
    assert "Patia" in r[0]["name"]
    r = client.get("/api/geocode", params={"q": "Brahmapur"}).json()   # alias spelling
    assert "Berhampur" in r[0]["name"]
    # curated landmarks beat the generic town fallback (this used to fall back to Berhampur)
    r = client.get("/api/geocode", params={"q": "nist university,berhampur"}).json()
    assert "NIST" in r[0]["name"] and r[0]["type"] == "poi"


def test_geocode_outside_odisha_without_internet(client, monkeypatch):
    import app.main as m

    async def boom(*a, **k):
        raise m.httpx.ConnectError("offline")
    monkeypatch.setattr(m, "_nominatim", boom)
    r = client.get("/api/geocode", params={"q": "560001"})
    assert r.status_code == 404                       # Bangalore PIN: say why, don't fake it
    assert "Odisha" in r.json()["detail"]
    r = client.get("/api/geocode", params={"q": "zzz-not-a-real-place"})
    assert r.status_code == 503
    assert "internet" in r.json()["detail"]


def test_geocode_handles_bad_upstream_response(client, monkeypatch):
    import app.main as m

    async def bad_shape(*a, **k):
        # Some proxies return a JSON error object where Nominatim normally returns a list.
        return {"error": "temporarily unavailable"}

    monkeypatch.setattr(m, "_nominatim", bad_shape)
    # Search remains usable through its local PIN fallback instead of raising a 500.
    r = client.get("/api/geocode", params={"q": "751007"})
    assert r.status_code == 200
    assert "Sahid Nagar" in r.json()[0]["name"]

    # ...and free-text search keeps working through the bundled Odisha gazetteer.
    r = client.get("/api/geocode", params={"q": "Cuttack"})
    assert r.status_code == 200
    assert "Cuttack" in r.json()[0]["name"]


def test_geocode_skips_malformed_upstream_entries(client, monkeypatch):
    import app.main as m

    async def malformed(*a, **k):
        return [{"display_name": "broken result"}, {"lat": "NaN", "lon": "0"}]

    monkeypatch.setattr(m, "_nominatim", malformed)
    r = client.get("/api/geocode", params={"q": "Cuttack"})
    assert r.status_code == 200
    rows = r.json()
    # malformed upstream rows are dropped; the offline gazetteer still answers
    assert rows and all(isinstance(x["lat"], float) and isinstance(x["lon"], float) for x in rows)
    assert any("Cuttack" in x["name"] for x in rows)


def test_suggest_landmarks_nist_first(client):
    """"NIST UNIVERSITY" must find NIST Berhampur (Palur Hills), not foreign universities."""
    r = client.get("/api/suggest", params={"q": "NIST UNIVERSITY"}).json()
    assert r and "NIST" in r[0]["name"] and r[0]["type"] == "poi"
    assert abs(r[0]["lat"] - 19.1868) < 0.02 and abs(r[0]["lon"] - 84.7529) < 0.02
    r = client.get("/api/suggest", params={"q": "nist"}).json()
    assert "NIST" in r[0]["name"]
    # the campus PIN code resolves to the same area (Palur Hills / Golanthara)
    r = client.get("/api/suggest", params={"q": "761008"}).json()
    assert any("Palur" in x["name"] for x in r)


def test_geocode_drops_foreign_rows(client, monkeypatch):
    """Upstream search engines sometimes answer with foreign cities - the map is India-only,
    so those rows must be dropped and Odisha rows kept."""
    import app.main as m

    async def foreign(*a, **k):
        return [
            {"display_name": "Tiraspol, Moldova", "lat": 46.84, "lon": 29.60, "type": "city"},
            {"display_name": "Boulder, Colorado, USA", "lat": 40.01, "lon": -105.27, "type": "city"},
            {"display_name": "Berhampur, Odisha, India", "lat": 19.31, "lon": 84.80, "type": "city"},
        ]

    monkeypatch.setattr(m, "_nominatim", foreign)
    rows = client.get("/api/geocode", params={"q": "somewhere"}).json()
    assert rows
    from app.places import in_india
    assert all(in_india(x["lat"], x["lon"]) for x in rows), "foreign rows leaked through"
    # Odisha answers come first
    from app.odisha import in_odisha
    assert in_odisha(rows[0]["lat"], rows[0]["lon"])


def _synthetic_crop_b64():
    """A satellite-looking 512x512 scene with a clear roof in the middle."""
    import base64
    import io

    import cv2
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(0)
    img = (rng.normal(0, 9, (512, 512, 3)) + np.array([70, 95, 60])).clip(0, 255).astype(np.uint8)
    cv2.rectangle(img, (180, 200), (320, 300), (200, 110, 80), -1)     # terracotta roof
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_segment_with_browser_image(client):
    """The frontend can send the map crop itself - the AI works with zero server internet."""
    from app.geo import latlon_to_px

    b64 = _synthetic_crop_b64()
    gx, gy = latlon_to_px(20.2961, 85.8245, 18)
    gx0, gy0 = int(gx - 256), int(gy - 256)      # 512 px crop centered on the tap
    r = client.post("/api/segment", json={
        "points": [{"lat": 20.2961, "lon": 85.8245, "label": 1}],
        "zoom": 18, "image": b64, "origin": [gx0, gy0], "z": 18,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True and len(d["polygon"]) >= 3 and d["area_m2"] > 0


def test_segment_image_needs_full_geometry(client):
    r = client.post("/api/segment", json={
        "points": [{"lat": 20.2961, "lon": 85.8245, "label": 1}],
        "zoom": 18, "image": _synthetic_crop_b64(),       # missing origin + z
    })
    assert r.status_code == 422
    r = client.post("/api/segment", json={
        "points": [{"lat": 20.2961, "lon": 85.8245, "label": 1}],
        "zoom": 18, "image": "!!not-base64!!", "origin": [0, 0], "z": 18,
    })
    assert r.status_code == 422


def test_report_post_with_browser_image(client):
    """POST /r accepts the browser-captured crop - the PDF keeps its imagery offline."""
    from urllib.parse import urlencode

    from app.geo import encode_polyline

    q = {"p": encode_polyline([tuple(p) for p in ROOF]), "u": "300", "f": "4",
         "rt": "rcc", "uf": "70", "a": "Test roof", "m": "manual"}
    r = client.post("/r", json={"query": urlencode({**q, "dl": "1"}),
                                "image": _synthetic_crop_b64(), "origin": [0, 0], "z": 18})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-" and len(r.content) > 20000
    # garbage image is rejected, not silently ignored
    r = client.post("/r", json={"query": urlencode(q), "image": "!!not-base64!!",
                                "origin": [0, 0], "z": 18})
    assert r.status_code == 422
