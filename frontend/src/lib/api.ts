/** Typed client for the SuryaJal FastAPI backend (same origin, relative URLs). */
import type { LatLng } from "@/lib/geo"

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ------------------------------------------------------------------ token storage
const TOKEN_KEY = "sj_token"

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const tokenStore = {
  get(): string | null {
    return safe(() => localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY), null)
  },
  /** remember = survive browser restarts (localStorage); otherwise this tab session only */
  set(token: string, remember: boolean) {
    safe(() => {
      localStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(TOKEN_KEY)
      ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
    }, undefined)
  },
  clear() {
    safe(() => {
      localStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(TOKEN_KEY)
    }, undefined)
  },
  key: TOKEN_KEY,
}

// ------------------------------------------------------------------ fetch wrapper
type Opts = { method?: string; body?: unknown; signal?: AbortSignal }

export async function api<T>(url: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  const tok = tokenStore.get()
  if (tok) headers.Authorization = `Bearer ${tok}`
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError("Cannot reach the SuryaJal server — is it running?", 0)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const d = (data as { detail?: unknown } | null)?.detail
    const msg = typeof d === "string" ? d
      : Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg ?? "").join("; ")
        : `Server error ${res.status}`
    throw new ApiError(msg, res.status)
  }
  return data as T
}

// ------------------------------------------------------------------ types
export interface User {
  id: number
  email: string
  name: string
  created_at: number
  roofs?: number
}

export interface AuthResponse {
  token: string
  expires_at: number
  user: User
}

export interface Defaults {
  usable_fraction: number
  m2_per_kw: number
  panel_w: number
  cost_per_kw: number
  subsidy: boolean
  tariff: number
  export_rate: number | null
  co2_kg_per_kwh: number
  monthly_units: number
  family_size: number
  roof_type: string
  lpcd: number
  design_rain_mm: number
  bwssb_l_per_m2: number
  tanker_litres: number
  tanker_price: number
  kg_co2_per_tree_year: number
  life_years: number
}

export interface AppConfig {
  defaults: Defaults
  roof_types: Record<string, { label: string; c: number }>
  sources: [string, string, string][]
  engine: string
  engine_note: string | null
  version: string
}

export interface HealthSpecs {
  model: { name: string; runtime: string; size_mb: number; warm: boolean; crop_px: number }
  imagery: { source: string; max_zoom: number; m_per_px: number }
  climate: { source: string; period: string; offline_cities: number }
  solar: { scheme: string; max_subsidy: number; tariff: number; export_rate: number; m2_per_kw: number; panel_w: number; co2_kg_per_kwh: number }
  water: { rule: string; l_per_m2: number; lpcd: number; roof_types: number }
}

export interface Health {
  ok: boolean
  app: string
  version: string
  engine: string
  note: string | null
  ready: boolean
  specs: HealthSpecs
}

export interface SegmentResponse {
  ok: boolean
  message?: string
  polygon: LatLng[]
  area_m2: number
  method: string
  score: number
  zoom: number
  ms: number
  cached: boolean
  warnings: string[]
}

export interface Solar {
  panels: number
  auto_panels: number
  user_chosen: boolean
  kw: number
  usable_area_m2: number
  roof_max_panels: number
  roof_max_kw: number
  need_kw: number
  limited_by: "roof" | "consumption" | "choice"
  specific_yield: number
  daily_units_per_kw: number
  monthly_gen: number[]
  monthly_consumption: number[]
  monthly_savings: number[]
  annual_gen: number
  annual_units: number
  self_used: number
  exported: number
  coverage: number
  tariff: number
  export_rate: number
  gross_cost: number
  subsidy: number
  net_cost: number
  annual_savings: number
  monthly_savings_avg: number
  bill_before: number
  payback_years: number | null
  lifetime_years: number
  lifetime_savings: number
  lifetime_profit: number
  yearly_savings: number[]
  irr: number | null
  co2_t_year: number
  co2_t_life: number
  trees_equiv: number
  full_roof_kw: number
  full_roof_gen: number
  pr_avg: number
}

export interface Rain {
  runoff_c: number
  roof_type_label: string
  monthly_rain_mm: number[]
  annual_rain_mm: number
  monthly_harvest_l: number[]
  annual_harvest_l: number
  monthly_demand_l: number[]
  annual_demand_l: number
  coverage: number
  days_of_water: number
  storage_need_l: number
  tank: { litres: number; text: string }
  bwssb_min_l: number
  recharge_well: { wells: number; diameter_m: number; depth_m: number; capacity_l: number }
  tankers_saved: number
  tanker_savings: number
  wettest_month: number
  wettest_harvest_l: number
  rain_overridden: boolean
}

export interface Assessment {
  report_id: string
  area_m2: number
  perimeter_m: number
  centroid: LatLng
  polygon: LatLng[]
  climate: {
    source: string
    short_source: string
    offline?: boolean
    ghi: number[]
    ghi_avg: number
    t2m: number[]
    rain_mm_day: number[]
  }
  solar: Solar
  rain: Rain
  score: { score: number; grade: string; solar_pts: number; water_pts: number }
  layout: { panels: LatLng[][]; max_panels: number | null; orientation?: string; angle?: number }
  params: Defaults & Record<string, unknown>
}

export interface RoofSummary {
  report_id: string
  area_m2: number
  kw: number
  panels: number
  annual_gen: number
  annual_savings: number
  net_cost: number
  payback_years: number | null
  irr: number | null
  co2_t_year: number
  annual_harvest_l: number
  tank_l: number
  score: number
  grade: string
  method: string
  centroid: LatLng
}

export interface SavedRoof {
  id: number
  title: string
  query: string
  summary: RoofSummary
  created_at: number
  updated_at: number
  updated?: boolean
}
