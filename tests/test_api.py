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


def test_geocode_pincode_offline(client, monkeypatch):
    import app.main as m

    async def boom(*a, **k):
        raise m.httpx.ConnectError("offline")
    monkeypatch.setattr(m, "_nominatim", boom)
    r = client.get("/api/geocode", params={"q": "751007"}).json()
    assert r[0]["district"] and "Sahid Nagar" in r[0]["name"]
    r = client.get("/api/geocode", params={"q": "768 004"}).json()   # district-level fallback
    assert "Sambalpur" in r[0]["name"]
