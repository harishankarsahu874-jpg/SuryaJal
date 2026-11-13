"""Tests for the SuryaJal AI Agent (/api/agent and app.agent)."""
import pytest
from fastapi.testclient import TestClient

from app import stats
from app.geo import from_local_m
from app.main import app

# 14 m x 10 m (~140 m²) roof in Bhubaneswar (TPCODL, CHHATA-eligible 50-200 m²)
ROOF_BBSR = [list(p) for p in from_local_m([(0, 0), (14, 0), (14, 10), (0, 10)], (20.2961, 85.8245))]
# Tiny 2.2 m x 2.2 m (~4.8 m²) roof — valid for /api/assess (>= 4 m²) but 0 solar panels
ROOF_TINY = [list(p) for p in from_local_m([(0, 0), (2.2, 0), (2.2, 2.2), (0, 2.2)], (20.2961, 85.8245))]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    stats._FILE = tmp_path_factory.mktemp("stats_agent") / "stats.json"
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def bbsr_assessment(client):
    r = client.post("/api/assess", json={"polygon": ROOF_BBSR, "monthly_units": 250, "family_size": 4})
    assert r.status_code == 200
    return r.json()


def test_agent_subsidy_and_cost_breakdown(client, bbsr_assessment):
    r = client.post("/api/agent", json={
        "message": "How much solar subsidy can I get and what is my net cost?",
        "tab": "solar",
        "address": "Sahid Nagar, Bhubaneswar",
        "assessment": bbsr_assessment,
    })
    assert r.status_code == 200
    d = r.json()
    assert "PM Surya Ghar" in d["reply"]
    assert "Odisha" in d["reply"]
    assert "₹" in d["reply"]
    assert len(d["suggestions"]) >= 2


def test_agent_electricity_bill_and_discom(client, bbsr_assessment):
    r = client.post("/api/agent", json={
        "message": "Explain my electricity bill savings and net metering",
        "tab": "solar",
        "assessment": bbsr_assessment,
    })
    assert r.status_code == 200
    reply = r.json()["reply"]
    assert "TPCODL" in reply
    assert "OERC" in reply
    assert "March" in reply


def test_agent_rainwater_and_chhata(client, bbsr_assessment):
    r1 = client.post("/api/agent", json={
        "message": "What tank size and recharge pit do I need for rainwater?",
        "tab": "rain",
        "assessment": bbsr_assessment,
    }).json()
    assert "tank" in r1["reply"].lower() and "recharge" in r1["reply"].lower()
    assert str(bbsr_assessment["rain"]["tank"]["litres"]) in r1["reply"].replace(",", "")

    r2 = client.post("/api/agent", json={
        "message": "Am I eligible for CHHATA subsidy?",
        "tab": "rain",
        "assessment": bbsr_assessment,
    }).json()
    assert "CHHATA" in r2["reply"] and "Eligible" in r2["reply"]


def test_agent_live_what_if_simulations(client, bbsr_assessment):
    # What if full roof panels
    r_max = client.post("/api/agent", json={
        "message": "What if I fill my full roof with panels?",
        "tab": "solar",
        "assessment": bbsr_assessment,
    }).json()
    max_p = bbsr_assessment["solar"]["roof_max_panels"]
    assert f"{max_p} panels" in r_max["reply"]

    # What if higher monthly bill
    r_bill = client.post("/api/agent", json={
        "message": "What if my monthly bill is ₹3,500?",
        "tab": "solar",
        "assessment": bbsr_assessment,
    }).json()
    assert "₹3,500" in r_bill["reply"] and "units/month" in r_bill["reply"]

    # What if 5 floors -> CHHATA ineligible (>3 floors)
    r_floors = client.post("/api/agent", json={
        "message": "What if 5 floors?",
        "tab": "rain",
        "assessment": bbsr_assessment,
    }).json()
    assert "Not eligible" in r_floors["reply"]


def test_agent_assess_request_fallback_and_tiny_roof(client):
    r = client.post("/api/agent", json={
        "message": "Summarize my roof report",
        "tab": "report",
        "assess_request": {"polygon": ROOF_TINY, "monthly_units": 200, "family_size": 4},
    })
    assert r.status_code == 200
    reply = r.json()["reply"]
    assert "Rainwater" in reply and "Green Score" in reply


def test_agent_followup_and_offtopic_and_validation(client, bbsr_assessment):
    # Follow-up using conversation history
    r_follow = client.post("/api/agent", json={
        "message": "How do I apply for it?",
        "tab": "solar",
        "assessment": bbsr_assessment,
        "history": [
            {"role": "user", "content": "Tell me about PM Surya Ghar"},
            {"role": "assistant", "content": "PM Surya Ghar + Odisha SFA gives subsidy..."},
        ],
    }).json()
    assert "pmsuryaghar.gov.in" in r_follow["reply"]

    # Off-topic politely redirects back to roof help
    r_off = client.post("/api/agent", json={
        "message": "Who won the cricket match yesterday?",
        "tab": "solar",
        "assessment": bbsr_assessment,
    }).json()
    assert "solar" in r_off["reply"].lower() and "rainwater" in r_off["reply"].lower()

    # Blank message rejected
    assert client.post("/api/agent", json={"message": "   "}).status_code == 422


def test_agent_external_llm_fallback_when_unreachable(client, bbsr_assessment, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-unreachable-key")
    monkeypatch.setenv("SURYAJAL_AI_BASE_URL", "http://127.0.0.1:9")
    r = client.post("/api/agent", json={
        "message": "Explain my Green Score",
        "tab": "report",
        "assessment": bbsr_assessment,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["source"] == "suryajal-ai"
    assert "Green Score" in d["reply"]


def test_agent_solar_maintenance_and_costs(client, bbsr_assessment):
    r = client.post("/api/agent", json={
        "message": "How much does panel maintenance cost and what is my cleaning schedule?",
        "tab": "solar",
        "assessment": bbsr_assessment,
    })
    assert r.status_code == 200
    d = r.json()
    m = bbsr_assessment["solar"]["maintenance"]
    assert "₹0" in d["reply"]
    assert str(m["cleans_per_year"]) in d["reply"]
    assert "inverter" in d["reply"].lower()
    assert len(d["suggestions"]) >= 2

