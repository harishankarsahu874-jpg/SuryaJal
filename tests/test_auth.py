"""Accounts, sessions and "My roofs" (uses a throw-away SQLite file)."""
import pytest
from fastapi.testclient import TestClient

from app import auth, stats
from app.geo import encode_polyline, from_local_m
from app.main import app

ROOF = [tuple(p) for p in from_local_m([(0, 0), (12, 0), (12, 10), (0, 10)], (12.9285, 77.5821))]
QUERY = f"p={encode_polyline(ROOF)}&u=250&f=4&rt=rcc&uf=70&a=Test+house&m=manual"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("auth")
    auth.DB_PATH = tmp / "users.db"
    stats._FILE = tmp / "stats.json"
    with TestClient(app) as c:
        yield c


def _signup(client, email="asha@example.com", pw="sun and rain 2026", name="Asha"):
    return client.post("/api/auth/signup", json={"name": name, "email": email, "password": pw})


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_password_hashing_roundtrip():
    h = auth.hash_password("correct horse")
    assert h.startswith("scrypt$") and auth.verify_password("correct horse", h)
    assert not auth.verify_password("wrong horse", h)
    assert not auth.verify_password("x", "garbage")


def test_signup_validation(client):
    assert client.post("/api/auth/signup", json={"email": "bad", "password": "longenough1"}).status_code == 422
    assert client.post("/api/auth/signup", json={"email": "a@b.co", "password": "short"}).status_code == 422
    assert client.post("/api/auth/signup", json={"email": "a@b.co", "password": "password"}).status_code == 422


def test_signup_login_me_logout(client):
    r = _signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "asha@example.com" and body["user"]["name"] == "Asha"
    tok = body["token"]
    assert client.get("/api/auth/me", headers=_h(tok)).json()["user"]["roofs"] == 0
    # duplicate email (case-insensitive)
    assert _signup(client, email="ASHA@example.com").status_code == 409
    # wrong password, then right one
    assert client.post("/api/auth/login", json={"email": "asha@example.com", "password": "nope nope"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": " Asha@Example.com ", "password": "sun and rain 2026"})
    assert r.status_code == 200
    tok2 = r.json()["token"]
    assert tok2 != tok
    # sign out revokes only that token
    assert client.post("/api/auth/logout", headers=_h(tok2)).json()["ok"] is True
    assert client.get("/api/auth/me", headers=_h(tok2)).status_code == 401
    assert client.get("/api/auth/me", headers=_h(tok)).status_code == 200
    # no / bad token
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=_h("x" * 43)).status_code == 401


def test_logout_everywhere(client):
    tok = _signup(client, email="ravi@example.com").json()["token"]
    tok2 = client.post("/api/auth/login", json={"email": "ravi@example.com",
                                                "password": "sun and rain 2026"}).json()["token"]
    client.post("/api/auth/logout?everywhere=true", headers=_h(tok))
    assert client.get("/api/auth/me", headers=_h(tok2)).status_code == 401


def test_login_throttle(client):
    _signup(client, email="throttle@example.com")
    for _ in range(auth.MAX_FAILS):
        client.post("/api/auth/login", json={"email": "throttle@example.com", "password": "wrong pass"})
    r = client.post("/api/auth/login", json={"email": "throttle@example.com", "password": "sun and rain 2026"})
    assert r.status_code == 429


def test_my_roofs_crud(client):
    tok = _signup(client, email="roofs@example.com").json()["token"]
    assert client.get("/api/roofs").status_code == 401
    r = client.post("/api/roofs", json={"query": QUERY}, headers=_h(tok))
    assert r.status_code == 201
    roof = r.json()["roof"]
    assert roof["title"] == "Test house" and roof["summary"]["area_m2"] == pytest.approx(120, rel=0.02)
    assert roof["summary"]["kw"] > 0 and roof["updated"] is False
    # saving the same outline again updates the same card
    r2 = client.post("/api/roofs", json={"query": QUERY.replace("u=250", "u=400"), "title": "Home"},
                     headers=_h(tok)).json()["roof"]
    assert r2["id"] == roof["id"] and r2["updated"] is True and r2["title"] == "Home"
    lst = client.get("/api/roofs", headers=_h(tok)).json()["roofs"]
    assert len(lst) == 1 and "u=400" in lst[0]["query"]
    # another user cannot delete it
    other = _signup(client, email="other@example.com").json()["token"]
    assert client.delete(f"/api/roofs/{roof['id']}", headers=_h(other)).status_code == 404
    assert client.delete(f"/api/roofs/{roof['id']}", headers=_h(tok)).json()["ok"] is True
    assert client.get("/api/roofs", headers=_h(tok)).json()["roofs"] == []


def test_delete_account(client):
    tok = _signup(client, email="bye@example.com").json()["token"]
    client.post("/api/roofs", json={"query": QUERY}, headers=_h(tok))
    assert client.request("DELETE", "/api/auth/me", json={"password": "wrong one"},
                          headers=_h(tok)).status_code == 401
    assert client.request("DELETE", "/api/auth/me", json={"password": "sun and rain 2026"},
                          headers=_h(tok)).json()["ok"] is True
    assert client.get("/api/auth/me", headers=_h(tok)).status_code == 401
    assert client.post("/api/auth/login", json={"email": "bye@example.com",
                                                "password": "sun and rain 2026"}).status_code == 401


def test_health_specs_and_pages(client):
    h = client.get("/api/health").json()
    assert "ready" in h and h["specs"]["solar"]["max_subsidy"] == 78000 + 60000   # central + Odisha SFA
    assert h["specs"]["climate"]["offline_cities"] >= 10
    # old share links redirect to the dashboard; unknown API paths stay 404
    r = client.get("/?p=abc&u=1", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"].startswith("/app?p=abc")
    assert client.get("/api/nope").status_code == 404
    assert client.get("/classic").status_code == 200


def test_panel_override_and_irr(client):
    base = client.post("/api/assess", json={"polygon": [list(p) for p in ROOF], "monthly_units": 250}).json()
    s = base["solar"]
    # with the central + Odisha subsidies a small system costs very little, so IRR can exceed 100 %
    assert s["user_chosen"] is False and s["irr"] is not None and s["irr"] > 0
    more = client.post("/api/assess", json={"polygon": [list(p) for p in ROOF], "monthly_units": 250,
                                             "panels": s["panels"] + 2}).json()["solar"]
    assert more["user_chosen"] is True and more["panels"] == min(s["panels"] + 2, s["roof_max_panels"])
    assert more["limited_by"] == "choice"
