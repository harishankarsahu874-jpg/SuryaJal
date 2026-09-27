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
  subsidy: boolean              // PM Surya Ghar central financial assistance
  state_subsidy: boolean        // Odisha State Financial Assistance (SFA)
  /** null = bill with the OERC domestic slabs instead of a flat rate */
  tariff: number | null
  sanctioned_load_kw: number    // for the ₹20/kW/month fixed charge
  export_rate: number | null    // null = OERC settlement at the GRIDCO APPC feed-in tariff
  net_meter_cap: number         // 0.9 - generation credited up to 90 % of consumption
  co2_kg_per_kwh: number
  monthly_units: number
  family_size: number
  floors: number                // CHHATA allows at most 3
  roof_type: string
  lpcd: number
  design_rain_mm: number
  rwh_l_per_m2: number          // ODA Rules 2020: 60 L per m² of roof
  chhata: boolean               // show the Odisha CHHATA rainwater subsidy
  rrhs_cost_per_m2: number
  tanker_litres: number
  tanker_price: number
  kg_co2_per_tree_year: number
  life_years: number
}

export interface Discom {
  name: string
  areas: string
  site: string
}

export interface OdishaTown {
  name: string
  district: string
  discom: string
  lat: number
  lon: number
  annual_rain_mm: number
  ghi_avg: number
  sunniest_month: number
  monsoon_rain_mm: number
}

export interface OdishaInfo {
  state: string
  capital: string
  map_center: [number, number]
  map_zoom: number
  discoms: Record<string, Discom>
  tariff: HealthSpecs["solar"]
  water: HealthSpecs["water"]
  towns: OdishaTown[]
}

export interface LocationInfo {
  state: string
  district: string | null
  discom: string | null
  discom_name: string | null
  nearest: string | null
  km_away: number | null
  areas: string | null
  site: string | null
  in_odisha: boolean
  discoms?: Record<string, Discom>
}

export interface AppConfig {
  defaults: Defaults
  roof_types: Record<string, { label: string; c: number }>
  sources: [string, string, string][]
  odisha?: OdishaInfo
  engine: string
  engine_note: string | null
  version: string
}

export interface HealthSpecs {
  model: { name: string; runtime: string; size_mb: number; warm: boolean; crop_px: number }
  state: { name: string; capital: string; map_center: [number, number]; map_zoom: number; discoms: number; districts: number }
  imagery: { source: string; max_zoom: number; m_per_px: number }
  climate: { source: string; period: string; offline_cities: number }
  solar: {
    scheme: string
    max_subsidy: number
    central_max: number
    state_max: number
    tariff: number | null
    tariff_label: string
    tariff_slabs: { from: number; to: number | null; label: string; rate: number }[]
    fixed_charge_per_kw: number
    duty_pct: number
    tariff_fy: string
    export_rate: number
    net_meter_cap: number
    max_nm_kw: number
    m2_per_kw: number
    panel_w: number
    co2_kg_per_kwh: number
  }
  water: {
    rule: string
    rule_full: string
    l_per_m2: number
    mandate_plot_m2: number
    recharge_plot_m2: number
    downpipes_per_100_m2: number
    downpipe_mm: number
    chhata: {
      max_subsidy: number
      share_of_cost: number
      roof_min_m2: number
      roof_max_m2: number
      max_floors: number
      scheme_years: string
      portal: string
    }
    lpcd: number
    roof_types: number
  }
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
  monthly_import: number[]
  monthly_export: number[]
  monthly_bill_before: number[]
  monthly_bill_after: number[]
  monthly_savings: number[]
  annual_gen: number
  annual_units: number
  annual_units_after: number
  self_used: number
  exported: number
  /** units actually paid for under the OERC 90 %-of-consumption cap */
  export_paid: number
  /** export credits that lapse at the March settlement */
  export_lapsed: number
  export_income: number
  net_meter_cap: number
  credit_limit_units: number
  coverage: number
  /** all-in ₹/unit you pay today (OERC slabs + fixed charge + duty) */
  tariff: number
  /** ₹/unit your last (dearest) unit costs - what a solar unit displaces */
  tariff_marginal: number
  tariff_override: boolean
  sanctioned_load_kw: number
  export_rate: number
  export_rate_auto: boolean
  gross_cost: number
  subsidy: number
  subsidy_central: number
  subsidy_state: number
  net_cost: number
  annual_savings: number
  monthly_savings_avg: number
  bill_before: number
  bill_after: number
  net_metering: { ok: boolean; limit_kw: number; kw: number; need_kw: number; state_cap_kw: number }
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
  monsoon_harvest_l: number
  monsoon_share: number
  tank: { litres: number; text: string }
  /** Odisha Development Authorities Rules 2020: 60 L of storage/recharge per m² of roof */
  rule_min_l: number
  rule: {
    name: string
    short: string
    l_per_m2: number
    m3_per_100m2: number
    mandate_plot_m2: number
    recharge_plot_m2: number
  }
  planned_l: number
  meets_rule: boolean
  rule_gap_l: number
  recharge_well: { wells: number; diameter_m: number; depth_m: number; capacity_l: number }
  downpipes: { count: number; diameter_mm: number }
  /** Govt. of Odisha CHHATA rooftop rainwater subsidy */
  chhata: {
    eligible: boolean
    reasons: string[]
    est_cost: number
    cost_per_m2: number
    subsidy: number
    share_of_cost: number
    max_subsidy: number
    net_cost: number
    roof_min_m2: number
    roof_max_m2: number
    max_floors: number
    scheme_years: string
    portal: string
    note: string
  }
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
  location: LocationInfo
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
  score: { score: number; grade: string; solar_pts: number; water_pts: number; rule_pts: number }
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
