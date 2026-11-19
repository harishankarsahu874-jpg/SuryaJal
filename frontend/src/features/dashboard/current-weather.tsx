import { useEffect, useMemo, useState } from "react"
import { Cloud, CloudRain, CloudSun, ExternalLink, RefreshCw, Sun, Thermometer, Wind } from "lucide-react"
import { api, type CurrentWeather } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Pill, SectionCard } from "./ui-bits"

const REFRESH_MS = 10 * 60 * 1000

const WEATHER_LABELS: Record<number, string> = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Heavy freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Light snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy thunderstorm with hail",
}

function value(value: number | null, digits = 0, unit = "") {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${unit}`
}

function WeatherMetric({ icon: Icon, label, value: metricValue, note }: {
  icon: typeof Sun; label: string; value: string; note?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/80 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-sage-600" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-heading text-xl font-medium leading-tight tabular-nums">{metricValue}</div>
      {note && <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{note}</div>}
    </div>
  )
}

export function CurrentWeatherCard({ lat, lon }: { lat: number; lon: number }) {
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const url = useMemo(() => `/api/weather/current?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, [lat, lon])

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const load = async () => {
      if (alive) setLoading(true)
      try {
        const result = await api<CurrentWeather>(url, { signal: controller.signal })
        if (alive) {
          setWeather(result)
          setError(false)
        }
      } catch (e) {
        if (alive && (e as Error).name !== "AbortError") setError(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, REFRESH_MS)
    return () => {
      alive = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [url, refreshKey])

  const checkedAt = weather ? new Date(weather.fetched_at).toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit",
  }) : ""
  const weatherLabel = weather ? WEATHER_LABELS[weather.weather_code] ?? `Weather code ${weather.weather_code}` : ""

  return (
    <SectionCard title="Current weather near this roof" subtitle="Online model-based conditions · refreshes every 10 minutes"
      right={<button type="button" aria-label="Refresh current weather" title="Refresh current weather"
        onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}
        className="grid size-9 place-items-center rounded-lg border bg-card text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50">
        <RefreshCw className={cn("size-4", loading && "animate-spin")} />
      </button>}>
      {loading && !weather ? (
        <div className="grid grid-cols-2 gap-2" aria-label="Loading current weather">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-[82px] animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : error && !weather ? (
        <div className="rounded-xl border border-dashed p-3.5 text-sm leading-relaxed text-muted-foreground" role="status">
          Current conditions couldn’t be reached. The long-term NASA POWER estimates are still available; try refreshing when the server has internet access.
        </div>
      ) : weather ? (
        <>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Pill tone="water"><CloudSun className="size-3.5" /> {weatherLabel}</Pill>
            <span className="text-[10px] text-muted-foreground">
              Roof local time {weather.current_time.slice(11, 16)} {weather.timezone_abbreviation || weather.timezone}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <WeatherMetric icon={Thermometer} label="Temperature" value={value(weather.temperature_c, 1, " °C")}
              note={`${value(weather.relative_humidity_pct, 0, "% humidity")}`} />
            <WeatherMetric icon={Sun} label="Solar radiation" value={value(weather.shortwave_radiation_w_m2, 0, " W/m²")}
              note="Hourly model estimate" />
            <WeatherMetric icon={CloudRain} label="Rain now" value={value(weather.rain_mm, 1, " mm")}
              note={`Precipitation ${value(weather.precipitation_mm, 1, " mm")}`} />
            <WeatherMetric icon={CloudRain} label="Rain forecast today" value={value(weather.today.rain_forecast_mm, 1, " mm")}
              note={weather.today.rain_probability_pct == null ? "Daily forecast" : `${value(weather.today.rain_probability_pct, 0, "% chance")}`} />
            <WeatherMetric icon={Cloud} label="Cloud cover" value={value(weather.cloud_cover_pct, 0, "%")} />
            <WeatherMetric icon={Wind} label="Wind speed" value={value(weather.wind_speed_kmh, 0, " km/h")} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] leading-relaxed text-muted-foreground">
            <span>
              Open-Meteo weather-model estimate, not a rooftop station reading. Updated {checkedAt}.
              {error && " Latest refresh failed; showing the last successful reading."}
            </span>
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline">
              Open-Meteo <ExternalLink className="size-3" />
            </a>
          </div>
          <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
            This current snapshot is for awareness only. Annual solar generation and rainwater planning continue to use NASA POWER long-term climatology (2001–2020), not today’s weather.
          </p>
        </>
      ) : null}
    </SectionCard>
  )
}
