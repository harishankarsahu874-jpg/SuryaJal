"""Model-based current weather for an assessed roof, via Open-Meteo.

This supplements (but does not replace) the NASA POWER long-term climatology used by
solar and rainwater design calculations. Values are current model estimates, not an
on-roof weather-station observation. Responses are cached briefly to avoid repeat calls.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_TTL_SECONDS = 5 * 60
MAX_CACHE_ENTRIES = 512
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


def _first_number(values: dict, key: str) -> Optional[float]:
    rows = values.get(key)
    if not isinstance(rows, list) or not rows or rows[0] is None:
        return None
    return float(rows[0])


def parse_open_meteo(payload: dict) -> dict:
    """Validate and normalize the fields the dashboard displays."""
    current = payload.get("current")
    hourly = payload.get("hourly")
    daily = payload.get("daily")
    if not isinstance(current, dict) or not isinstance(hourly, dict) or not isinstance(daily, dict):
        raise ValueError("Open-Meteo response is missing current, hourly or daily data")

    current_time = str(current.get("time") or "")
    if not current_time:
        raise ValueError("Open-Meteo response has no current timestamp")

    solar_radiation = None
    hourly_times = hourly.get("time") or []
    radiation_values = hourly.get("shortwave_radiation") or []
    # The hourly radiation sample for the current local hour is the closest solar
    # reading Open-Meteo provides alongside its current-conditions block.
    current_hour = current_time[:13]
    for index, hour in enumerate(hourly_times):
        if str(hour)[:13] == current_hour and index < len(radiation_values):
            if radiation_values[index] is not None:
                solar_radiation = float(radiation_values[index])
            break

    required = ("temperature_2m", "relative_humidity_2m", "precipitation", "rain",
                "weather_code", "cloud_cover", "wind_speed_10m")
    if any(current.get(key) is None for key in required):
        raise ValueError("Open-Meteo response is missing a current weather field")

    return {
        "source": "Open-Meteo forecast models",
        "timezone": str(payload.get("timezone") or "UTC"),
        "timezone_abbreviation": str(payload.get("timezone_abbreviation") or ""),
        "current_time": current_time,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "temperature_c": float(current["temperature_2m"]),
        "relative_humidity_pct": float(current["relative_humidity_2m"]),
        "precipitation_mm": float(current["precipitation"]),
        "rain_mm": float(current["rain"]),
        "weather_code": int(current["weather_code"]),
        "cloud_cover_pct": float(current["cloud_cover"]),
        "wind_speed_kmh": float(current["wind_speed_10m"]),
        "shortwave_radiation_w_m2": solar_radiation,
        "today": {
            "rain_forecast_mm": _first_number(daily, "precipitation_sum"),
            "rain_probability_pct": _first_number(daily, "precipitation_probability_max"),
            "min_temperature_c": _first_number(daily, "temperature_2m_min"),
            "max_temperature_c": _first_number(daily, "temperature_2m_max"),
        },
    }


def _cached(key: str) -> Optional[dict]:
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and now - entry[0] < CACHE_TTL_SECONDS:
            return entry[1]
        if entry:
            _cache.pop(key, None)
    return None


def _remember(key: str, value: dict) -> None:
    with _cache_lock:
        if len(_cache) >= MAX_CACHE_ENTRIES:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic(), value)


async def get_current_weather(
    lat: float,
    lon: float,
    client: Optional[httpx.AsyncClient] = None,
) -> dict:
    """Fetch current model conditions and today's forecast for a roof coordinate."""
    key = f"{lat:.3f},{lon:.3f}"
    cached = _cached(key)
    if cached is not None:
        return cached

    params = {
        "latitude": f"{lat:.5f}",
        "longitude": f"{lon:.5f}",
        "current": ("temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,"
                    "cloud_cover,wind_speed_10m"),
        "hourly": "shortwave_radiation",
        "daily": ("precipitation_sum,precipitation_probability_max,temperature_2m_min,"
                  "temperature_2m_max"),
        "forecast_days": 1,
        "timezone": "auto",
    }
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=15.0, follow_redirects=True)
    try:
        response = await client.get(OPEN_METEO_URL, params=params, timeout=15.0)
        response.raise_for_status()
        result = parse_open_meteo(response.json())
        _remember(key, result)
        return result
    finally:
        if own_client:
            await client.aclose()
