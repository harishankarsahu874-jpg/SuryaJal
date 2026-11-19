"""Current-weather API parsing and caching tests; no external network required."""
import asyncio

import httpx
import pytest

from app import weather


def sample_payload():
    return {
        "timezone": "Asia/Kolkata",
        "timezone_abbreviation": "GMT+5:30",
        "current": {
            "time": "2026-07-15T14:15",
            "temperature_2m": 31.4,
            "relative_humidity_2m": 67,
            "precipitation": 0.2,
            "rain": 0.2,
            "weather_code": 61,
            "cloud_cover": 78,
            "wind_speed_10m": 12.5,
        },
        "hourly": {
            "time": ["2026-07-15T13:00", "2026-07-15T14:00", "2026-07-15T15:00"],
            "shortwave_radiation": [520, 610, 480],
        },
        "daily": {
            "precipitation_sum": [8.3],
            "precipitation_probability_max": [70],
            "temperature_2m_min": [25.0],
            "temperature_2m_max": [33.2],
        },
    }


def test_parse_current_weather_and_match_local_solar_hour():
    result = weather.parse_open_meteo(sample_payload())
    assert result["source"] == "Open-Meteo forecast models"
    assert result["timezone"] == "Asia/Kolkata"
    assert result["temperature_c"] == pytest.approx(31.4)
    assert result["shortwave_radiation_w_m2"] == 610
    assert result["today"]["rain_forecast_mm"] == pytest.approx(8.3)
    assert result["today"]["rain_probability_pct"] == 70


def test_parse_current_weather_rejects_incomplete_response():
    with pytest.raises(ValueError, match="missing current"):
        weather.parse_open_meteo({})


def test_current_weather_fetches_and_caches_open_meteo_response():
    with weather._cache_lock:
        weather._cache.clear()
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        assert request.url.host == "api.open-meteo.com"
        assert request.url.params["timezone"] == "auto"
        assert "shortwave_radiation" in request.url.params["hourly"]
        return httpx.Response(200, json=sample_payload())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await weather.get_current_weather(18.12345, 84.54321, client)
            second = await weather.get_current_weather(18.12345, 84.54321, client)
            return first, second

    first, second = asyncio.run(run())
    assert first == second
    assert len(calls) == 1
