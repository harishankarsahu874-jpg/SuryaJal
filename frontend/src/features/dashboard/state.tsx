import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from "react"
import { toast } from "sonner"
import { api, type AppConfig, type Assessment } from "@/lib/api"
import { centroid, decodePolyline, DEMO_ROOF, DEMO_ROOFS, encodePolyline, type LatLng } from "@/lib/geo"

export type RoofMethod = "ai" | "ai-edited" | "manual"
export type Tab = "map" | "solar" | "rain" | "report"

export interface Roof {
  latlngs: LatLng[]
  method: RoofMethod
  conf: number | null
  /** bumped when the map should zoom to the roof */
  fitNonce: number
}

export interface Inputs {
  monthly_units: number
  family_size: number
  floors: number
  roof_type: string
  usable_pct: number
  /** null = bill with the OERC domestic slabs for the units entered */
  tariff: number | null
  /** sanctioned load in kW - drives the ₹20/kW/month fixed charge and the net-meter limit */
  sanctioned_load_kw: number
  cost_per_kw: number
  panel_w: number
  /** PM Surya Ghar central financial assistance */
  subsidy: boolean
  /** Odisha State Financial Assistance on top of it */
  state_subsidy: boolean
  export_rate: number | null
  /** OERC net-metering cap, in % of yearly consumption (90 by default) */
  net_meter_pct: number
  tanker_price: number
  design_rain_mm: number
  /** Odisha Development Authorities Rules 2020: litres of storage/recharge per m² of roof */
  rwh_l_per_m2: number
  /** Govt. of Odisha CHHATA rooftop rainwater subsidy */
  chhata: boolean
  rrhs_cost_per_m2: number
  rain_override_mm: number | null
  /** user-chosen number of panels; null = auto-size to the bill */
  panels: number | null
}

export interface MapApi {
  locate: () => void
  flyTo: (lat: number, lon: number, zoom: number) => void
  invalidate: () => void
}

interface SetRoofOpts {
  fit?: boolean
  keepPanels?: boolean
}

interface DashboardCtx {
  config: AppConfig | null
  roof: Roof | null
  setRoof: (latlngs: LatLng[], method: RoofMethod, conf?: number | null, opts?: SetRoofOpts) => void
  clearRoof: () => void
  /** load one of the three bundled Odisha demo roofs (default: Bhubaneswar) */
  loadDemo: (id?: string) => void
  inputs: Inputs
  setInput: <K extends keyof Inputs>(key: K, value: Inputs[K]) => void
  address: string
  setAddress: (v: string) => void
  result: Assessment | null
  assessing: boolean
  /** share / report query string (without "?") for the current roof + inputs */
  query: string
  tab: Tab
  setTab: (t: Tab) => void
  mapApi: MutableRefObject<MapApi | null>
}

const Ctx = createContext<DashboardCtx | null>(null)

const FALLBACK_INPUTS: Inputs = {
  monthly_units: 250, family_size: 4, floors: 2, roof_type: "rcc", usable_pct: 70,
  tariff: null, sanctioned_load_kw: 3, cost_per_kw: 55000, panel_w: 540,
  subsidy: true, state_subsidy: true, export_rate: null, net_meter_pct: 90,
  tanker_price: 800, design_rain_mm: 100, rwh_l_per_m2: 60, chhata: true,
  rrhs_cost_per_m2: 600, rain_override_mm: null, panels: null,
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function buildQuery(roof: Roof, i: Inputs, config: AppConfig | null, address: string) {
  const d = config?.defaults
  const q = new URLSearchParams()
  q.set("p", encodePolyline(roof.latlngs))
  q.set("u", String(i.monthly_units))
  q.set("f", String(i.family_size))
  q.set("rt", i.roof_type)
  q.set("uf", String(i.usable_pct))
  if (i.tariff !== null) q.set("t", String(i.tariff))
  if (!d || i.sanctioned_load_kw !== d.sanctioned_load_kw) q.set("sl", String(i.sanctioned_load_kw))
  if (!d || i.floors !== d.floors) q.set("fl", String(i.floors))
  if (!d || i.cost_per_kw !== d.cost_per_kw) q.set("c", String(i.cost_per_kw))
  if (!d || i.panel_w !== d.panel_w) q.set("pw", String(i.panel_w))
  if (!i.subsidy) q.set("s", "0")
  if (!i.state_subsidy) q.set("ss", "0")
  if (i.export_rate !== null) q.set("ex", String(i.export_rate))
  if (!d || i.net_meter_pct !== Math.round(d.net_meter_cap * 100)) q.set("nc", String(i.net_meter_pct))
  if (!d || i.tanker_price !== d.tanker_price) q.set("tp", String(i.tanker_price))
  if (!d || i.design_rain_mm !== d.design_rain_mm) q.set("dr", String(i.design_rain_mm))
  if (!d || i.rwh_l_per_m2 !== d.rwh_l_per_m2) q.set("rl", String(i.rwh_l_per_m2))
  if (!i.chhata) q.set("ch", "0")
  if (!d || i.rrhs_cost_per_m2 !== d.rrhs_cost_per_m2) q.set("rc", String(i.rrhs_cost_per_m2))
  if (i.rain_override_mm !== null) q.set("rn", String(i.rain_override_mm))
  if (i.panels !== null) q.set("n", String(i.panels))
  if (address.trim()) q.set("a", address.trim().slice(0, 120))
  q.set("m", roof.method.startsWith("ai") ? "ai" : "manual")
  if (roof.method === "ai" && roof.conf != null) q.set("cf", Math.min(1, roof.conf).toFixed(2))
  return q.toString()
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [roof, setRoofState] = useState<Roof | null>(null)
  const [inputs, setInputs] = useState<Inputs>(FALLBACK_INPUTS)
  const [address, setAddressState] = useState("")
  const addressAuto = useRef(true)
  const [result, setResult] = useState<Assessment | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [tab, setTabState] = useState<Tab>("map")
  const mapApi = useRef<MapApi | null>(null)
  const seq = useRef(0)
  const lastRev = useRef("")

  const setTab = useCallback((t: Tab) => {
    setTabState(t)
    if (t === "map") setTimeout(() => mapApi.current?.invalidate(), 60)
  }, [])

  const setRoof = useCallback((latlngs: LatLng[], method: RoofMethod, conf: number | null = null, opts: SetRoofOpts = {}) => {
    setRoofState((prev) => ({
      latlngs: latlngs.map((p) => [p[0], p[1]] as LatLng),
      method,
      conf,
      fitNonce: opts.fit ? (prev?.fitNonce ?? 0) + 1 : prev?.fitNonce ?? 0,
    }))
    if (!opts.keepPanels) setInputs((i) => (i.panels === null ? i : { ...i, panels: null }))
  }, [])

  const clearRoof = useCallback(() => {
    seq.current++
    setRoofState(null)
    setResult(null)
    setAssessing(false)
    addressAuto.current = true
    lastRev.current = ""
    setAddressState("")
    setInputs((i) => ({ ...i, panels: null }))
    try { history.replaceState(null, "", "/app") } catch { /* sandboxed iframe */ }
  }, [])

  const setAddress = useCallback((v: string) => {
    addressAuto.current = false
    setAddressState(v)
  }, [])

  const loadDemo = useCallback((id?: string) => {
    const d = DEMO_ROOFS.find((r) => r.id === id) ?? DEMO_ROOF
    addressAuto.current = false
    setAddressState(d.name)
    setRoof(d.poly, "ai", 1.0, { fit: true })
    mapApi.current?.flyTo(d.lat, d.lon, d.zoom)
  }, [setRoof])

  const setInput = useCallback(<K extends keyof Inputs>(key: K, value: Inputs[K]) => {
    setInputs((i) => ({ ...i, [key]: value }))
  }, [])

  // ------------------------------------------------------------ config + restore from URL
  useEffect(() => {
    let alive = true
    api<AppConfig>("/api/config")
      .then((c) => {
        if (!alive) return
        setConfig(c)
        const d = c.defaults
        const base: Inputs = {
          ...FALLBACK_INPUTS,
          monthly_units: d.monthly_units, family_size: d.family_size, floors: d.floors,
          roof_type: d.roof_type, usable_pct: Math.round(d.usable_fraction * 100),
          tariff: d.tariff, sanctioned_load_kw: d.sanctioned_load_kw, cost_per_kw: d.cost_per_kw,
          panel_w: d.panel_w, subsidy: d.subsidy, state_subsidy: d.state_subsidy,
          net_meter_pct: Math.round(d.net_meter_cap * 100), tanker_price: d.tanker_price,
          design_rain_mm: d.design_rain_mm, rwh_l_per_m2: d.rwh_l_per_m2, chhata: d.chhata,
          rrhs_cost_per_m2: d.rrhs_cost_per_m2,
        }
        const q = new URLSearchParams(location.search)
        const num = (k: string) => {
          const v = parseFloat(q.get(k) ?? "")
          return Number.isFinite(v) ? v : null
        }
        let poly: LatLng[] | null = null
        try { poly = q.get("p") ? decodePolyline(q.get("p")!) : null } catch { poly = null }
        if (poly && poly.length >= 3) {
          const restored: Inputs = {
            ...base,
            monthly_units: num("u") ?? base.monthly_units,
            family_size: num("f") ?? base.family_size,
            roof_type: q.get("rt") && c.roof_types[q.get("rt")!] ? q.get("rt")! : base.roof_type,
            floors: num("fl") ?? base.floors,
            usable_pct: num("uf") ?? base.usable_pct,
            tariff: q.has("t") ? num("t") : base.tariff,
            sanctioned_load_kw: num("sl") ?? base.sanctioned_load_kw,
            cost_per_kw: num("c") ?? base.cost_per_kw,
            panel_w: num("pw") ?? base.panel_w,
            subsidy: q.get("s") !== "0",
            state_subsidy: q.get("ss") !== "0",
            export_rate: num("ex"),
            net_meter_pct: num("nc") ?? base.net_meter_pct,
            tanker_price: num("tp") ?? base.tanker_price,
            design_rain_mm: num("dr") ?? base.design_rain_mm,
            rwh_l_per_m2: num("rl") ?? base.rwh_l_per_m2,
            chhata: q.get("ch") !== "0",
            rrhs_cost_per_m2: num("rc") ?? base.rrhs_cost_per_m2,
            rain_override_mm: num("rn"),
            panels: num("n"),
          }
          setInputs(restored)
          if (q.get("a")) {
            addressAuto.current = false
            setAddressState(q.get("a")!)
          }
          setRoof(poly, q.get("m") === "ai" ? "ai" : "manual", num("cf"), { fit: true, keepPanels: true })
          setTabState(window.matchMedia("(min-width: 1024px)").matches ? "solar" : "solar")
        } else {
          setInputs(base)
          const demoId = q.get("demo")
          if (demoId) {
            const d = DEMO_ROOFS.find((r) => r.id === demoId) ?? (demoId === "1" ? DEMO_ROOF : null)
            if (d) {
              addressAuto.current = false
              setAddressState(d.name)
              setRoof(d.poly, "ai", 1.0, { fit: true })
            }
          }
        }
      })
      .catch((e: Error) => toast.error(e.message, { duration: 10000 }))
    return () => { alive = false }
  }, [setRoof])

  // ------------------------------------------------------------ assessment (debounced)
  const assessKey = roof && config ? JSON.stringify([roof.latlngs, inputs]) : ""
  useEffect(() => {
    if (!assessKey || !roof) return
    const my = ++seq.current
    setAssessing(true)
    const t = setTimeout(async () => {
      try {
        const body = {
          polygon: roof.latlngs,
          monthly_units: clamp(inputs.monthly_units, 0, 100000),
          family_size: clamp(Math.round(inputs.family_size), 1, 100),
          floors: clamp(Math.round(inputs.floors), 1, 30),
          roof_type: inputs.roof_type,
          usable_fraction: clamp(inputs.usable_pct, 5, 100) / 100,
          tariff: inputs.tariff === null ? null : clamp(inputs.tariff, 0, 50),
          sanctioned_load_kw: clamp(inputs.sanctioned_load_kw, 0, 500),
          cost_per_kw: clamp(inputs.cost_per_kw, 10000, 300000),
          panel_w: clamp(Math.round(inputs.panel_w), 100, 800),
          subsidy: inputs.subsidy,
          state_subsidy: inputs.state_subsidy,
          export_rate: inputs.export_rate === null ? null : clamp(inputs.export_rate, 0, 20),
          net_meter_cap: clamp(inputs.net_meter_pct, 0, 100) / 100,
          tanker_price: clamp(inputs.tanker_price, 0, 20000),
          design_rain_mm: clamp(inputs.design_rain_mm, 5, 300),
          rwh_l_per_m2: clamp(inputs.rwh_l_per_m2, 0, 1000),
          chhata: inputs.chhata,
          rrhs_cost_per_m2: clamp(inputs.rrhs_cost_per_m2, 0, 100000),
          rain_override_mm: inputs.rain_override_mm !== null && inputs.rain_override_mm >= 50
            ? Math.min(inputs.rain_override_mm, 12000) : null,
          panels: inputs.panels === null ? null : clamp(Math.round(inputs.panels), 0, 400),
        }
        const r = await api<Assessment>("/api/assess", { body })
        if (my === seq.current) setResult(r)
      } catch (e) {
        if (my === seq.current) toast.error((e as Error).message)
      } finally {
        if (my === seq.current) setAssessing(false)
      }
    }, 280)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessKey])

  // ------------------------------------------------------------ reverse geocode the roof
  useEffect(() => {
    if (!roof || !addressAuto.current) return
    const [lat, lon] = centroid(roof.latlngs)
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
    if (key === lastRev.current) return
    lastRev.current = key
    api<{ name: string }>(`/api/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`)
      .then((r) => { if (r.name && addressAuto.current) setAddressState(r.name) })
      .catch(() => { /* offline - leave blank */ })
  }, [roof])

  const query = useMemo(() => (roof ? buildQuery(roof, inputs, config, address) : ""), [roof, inputs, config, address])

  // keep the address bar shareable
  useEffect(() => {
    if (!query) return
    const t = setTimeout(() => {
      try { history.replaceState(null, "", `/app?${query}`) } catch { /* sandboxed */ }
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  const value = useMemo<DashboardCtx>(() => ({
    config, roof, setRoof, clearRoof, loadDemo, inputs, setInput, address, setAddress,
    result, assessing, query, tab, setTab, mapApi,
  }), [config, roof, setRoof, clearRoof, loadDemo, inputs, setInput, address, setAddress, result, assessing, query, tab, setTab])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboard() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useDashboard must be used inside <DashboardProvider>")
  return c
}
