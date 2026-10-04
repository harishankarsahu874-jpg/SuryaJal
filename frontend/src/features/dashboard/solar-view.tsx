import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle, ArrowRight, Building2, Download, Grid2x2, Hourglass, Landmark, Leaf, Loader2, MapPin, Minus,
  PenLine, Percent, Plus, Receipt, RotateCcw, Satellite, SolarPanel, Sun, TrendingUp, Zap,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { fmtIN, MONTHS_LONG, rupees, sqft } from "@/lib/format"
import type { LatLng } from "@/lib/geo"
import { capturePolyCrop, darkCropFor, drawLayoutImage, type TileCrop } from "@/lib/mapcrop"
import { useReportDownload } from "@/lib/report"
import { cn } from "@/lib/utils"
import { useDashboard } from "./state"
import { CountUp, EmptyState, MonthBars, Pill, SavingsTimeline, SectionCard, StatTile } from "./ui-bits"

export function SolarView() {
  const { result: r, roof, address, inputs, setInput, setTab, query, loadDemo, assessing, config } = useDashboard()
  const [month, setMonth] = useState<number | null>(null)
  const [thumbQ, setThumbQ] = useState("")
  const [bill, setBill] = useState("")
  const { busy: dlBusy, download } = useReportDownload()

  // refresh the satellite layout picture only when a new result lands (not on every slider tick)
  useEffect(() => {
    if (r && query) {
      setThumbQ((old) => (old === query ? old : query))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])

  const peak = useMemo(() => {
    if (!r) return 0
    const g = r.solar.monthly_gen
    return g.indexOf(Math.max(...g))
  }, [r])

  if (!roof) return <EmptyState onDemo={loadDemo} onMap={() => setTab("map")} />
  if (!r) return <ViewSkeleton />

  const s = r.solar, p = r.params
  const sel = month ?? peak
  const gen = s.monthly_gen[sel], use = s.monthly_consumption[sel]
  const low = s.monthly_gen.indexOf(Math.min(...s.monthly_gen))
  const tag = sel === peak ? "Peak Season" : sel === low ? "Lowest" : sel >= 5 && sel <= 8 ? "Monsoon" : null
  const sunHours = r.climate.ghi_avg
  const lat = r.centroid[0]
  const tilt = Math.round(Math.abs(lat))
  // all-in ₹/unit you actually pay: OERC slabs + ₹20/kW fixed charge + 4 % duty
  // (or your own flat rate, if you typed one in Report → Assumptions)
  const allIn = s.tariff > 0 ? s.tariff : 5.05
  const discom = r.location?.discom ?? "your Odisha DISCOM"
  const tcfg = config?.odisha?.tariff
  const fy = tcfg?.tariff_fy ?? "FY 2026-27"
  const fixedPerKw = tcfg?.fixed_charge_per_kw ?? 20
  const dutyPct = tcfg?.duty_pct ?? 4
  const SLABS = tcfg?.tariff_slabs?.length ? tcfg.tariff_slabs : FALLBACK_SLABS
  const maxPanels = Math.max(0, s.roof_max_panels)
  const offline = !!r.climate.offline

  return (
    <div className={cn("space-y-3.5 transition-opacity", assessing && "opacity-80")}>
      {/* data source row */}
      <div className="flex items-center justify-between gap-2">
        <Pill><Satellite className="size-3.5" /> NASA POWER Climatology API</Pill>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className={cn("size-2 rounded-full", offline ? "bg-amber-500" : "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.18)]")} />
          {offline ? "Offline data" : "Live data"}
        </span>
      </div>

      {/* analysed rooftop */}
      <section className="rounded-2xl border border-sage-200 bg-sage-100/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-[0.14em] text-sage-700 uppercase">Analyzed rooftop</div>
            <div className="mt-1.5 flex items-start gap-1.5">
              <MapPin className="mt-1 size-4 shrink-0 text-sage-700" />
              <h2 className="font-heading text-[1.35rem] leading-tight font-medium tracking-tight">{address || "Your roof"}</h2>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-foreground/75">
              Usable roof area: {fmtIN(sqft(s.usable_area_m2))} sq.ft • {sunHours.toFixed(1)} peak sun-hours/day
            </p>
            {r.location?.district && (
              <p className="mt-1 text-[12px] text-foreground/60">
                {r.location.district} district · served by {r.location.discom_name ?? r.location.discom}
              </p>
            )}
          </div>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sun-soft text-sun-ink">
            <Sun className="size-5" />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill tone="plain" className="bg-white/70">{fmtIN(r.area_m2)} m² roof</Pill>
          <Pill tone="plain" className="bg-white/70">
            {roof.method === "manual" ? "Hand-drawn outline" : roof.method === "ai-edited" ? "AI + hand-tuned"
              : `AI outline${roof.conf != null ? ` · ${Math.round(Math.min(1, roof.conf) * 100)}%` : ""}`}
          </Pill>
          <button type="button" onClick={() => setTab("map")}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-sage-700 hover:bg-white/70 lg:hidden">
            <PenLine className="size-3.5" /> Edit on map
          </button>
        </div>
      </section>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Recommended System" icon={SolarPanel} value={<CountUp value={s.kw} format={(v) => v.toFixed(2)} />}
          unit="kWp" sub={s.limited_by === "roof" ? "Limited by roof space" : s.limited_by === "choice" ? "Your chosen size" : "Sized to your bill"} />
        <StatTile label="Photovoltaics" icon={Grid2x2} value={<CountUp value={s.panels} format={(v) => String(Math.round(v))} />}
          unit="Panels" sub={`Mono-PERC ${p.panel_w} W`} />
        <StatTile label="Annual Yield" icon={Zap} tone="sun" value={<CountUp value={s.annual_gen} format={(v) => fmtIN(v)} />}
          unit="kWh/yr" sub={`~${fmtIN(s.annual_gen / 12)} kWh/mo avg`} />
        <StatTile label="CO₂ Offset" icon={Leaf} value={<CountUp value={s.co2_t_year} format={(v) => v.toFixed(1)} />}
          unit="Tonnes/yr" sub={`${fmtIN(s.trees_equiv)} mature trees eq.`} />
      </div>

      {/* interactive plan */}
      <SectionCard title="Plan your system" subtitle="Drag to see how the numbers change"
        right={s.user_chosen ? (
          <button type="button" onClick={() => setInput("panels", null)}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground hover:bg-sage-200">
            <RotateCcw className="size-3" /> Auto size
          </button>
        ) : <Pill>Auto-sized</Pill>}>
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium">Electricity use</span>
              <span className="font-heading text-lg font-medium tabular">{fmtIN(inputs.monthly_units)} <span className="font-sans text-xs text-muted-foreground">units / month</span></span>
            </div>
            <Slider value={[Math.min(1500, inputs.monthly_units)]} min={0} max={1500} step={10}
              onValueChange={([v]) => setInput("monthly_units", v)} aria-label="Monthly electricity use" />
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Only know your bill?</span>
              <div className="flex h-8 items-center rounded-lg border bg-background px-2 focus-within:ring-2 focus-within:ring-ring/40">
                <span className="text-muted-foreground">₹</span>
                <input inputMode="numeric" value={bill} placeholder="2,000" aria-label="Monthly bill in rupees"
                  onChange={(e) => {
                    setBill(e.target.value)
                    const b = parseFloat(e.target.value.replace(/,/g, ""))
                    if (Number.isFinite(b) && b > 0) setInput("monthly_units", Math.round(b / allIn))
                  }}
                  className="w-16 bg-transparent pl-1 text-foreground outline-none" />
              </div>
              <span className="max-sm:hidden">÷ ₹{allIn.toFixed(1)} per unit</span>
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Panels on the roof</span>
              <div className="flex items-center gap-1">
                <StepBtn label="One panel less" disabled={s.panels <= 0} onClick={() => setInput("panels", Math.max(0, s.panels - 1))}><Minus /></StepBtn>
                <span className="font-heading w-10 text-center text-lg font-medium tabular">{s.panels}</span>
                <StepBtn label="One panel more" disabled={s.panels >= maxPanels} onClick={() => setInput("panels", Math.min(maxPanels, s.panels + 1))}><Plus /></StepBtn>
              </div>
            </div>
            <Slider value={[s.panels]} min={0} max={Math.max(1, maxPanels)} step={1} disabled={maxPanels === 0}
              onValueChange={([v]) => setInput("panels", v)} aria-label="Number of panels" />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Your roof fits up to <b className="text-foreground">{maxPanels} panels ({s.roof_max_kw.toFixed(1)} kW)</b>.
              {s.auto_panels !== s.panels && <> Your bill needs about {s.auto_panels}.</>}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* monthly generation */}
      <SectionCard title="Monthly Generation" subtitle="Tap bars to view estimated yield" right={<Pill tone="plain">Jan – Dec</Pill>}>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full bg-earth" />
            <span className="truncate text-sm font-semibold">{MONTHS_LONG[sel]}{tag && <span className="font-normal text-muted-foreground"> ({tag})</span>}</span>
          </div>
          <div className="text-right">
            <span className="font-heading text-2xl font-medium text-earth tabular">{fmtIN(gen)}</span>
            <span className="ml-1 text-xs text-muted-foreground">kWh</span>
          </div>
        </div>
        <MonthBars values={s.monthly_gen} selected={sel} onSelect={setMonth} activeClass="bg-earth"
          line={s.monthly_consumption} label={(i) => `${MONTHS_LONG[i]}: ${fmtIN(s.monthly_gen[i])} kWh`} />
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sage-200" /> Standard Output</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-sage-900/55" /> Your use</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-earth" /> Selected Month</span>
        </div>
        <p className="mt-3 rounded-lg bg-sage-50 px-3 py-2 text-xs leading-relaxed text-foreground/75">
          In {MONTHS_LONG[sel]} you use ~{fmtIN(use)} kWh:{" "}
          {gen >= use
            ? <>solar covers it all and <b>{fmtIN(gen - use)} kWh</b> goes to the {discom} grid as a credit that carries
                forward inside the financial year.</>
            : <>solar covers <b>{Math.round((gen / Math.max(1, use)) * 100)}%</b>; {discom} supplies the remaining
                {fmtIN(use - gen)} kWh.</>}
        </p>
      </SectionCard>

      {/* finance */}
      {s.panels > 0 && (
        <SectionCard title="Financial Modeling" subtitle={`OERC net metering · ${fy} · PM Surya Ghar + Odisha SFA`}
          right={s.irr != null ? <Pill tone="peach"><TrendingUp className="size-3.5" /> {(s.irr * 100).toFixed(1)}% IRR</Pill> : undefined}>
          <div className="space-y-3">
            <Row icon={Receipt} label="Estimated Capital Cost" value={rupees(s.gross_cost)}
              sub={`${s.kw.toFixed(2)} kW × ${fmtIN(p.cost_per_kw)} per kW (OREDA-empanelled vendor)`} />
            <Row icon={Landmark} label="PM Surya Ghar subsidy (central)"
              sub={s.subsidy_central
                ? "₹30,000/kW up to 2 kW + ₹18,000 for the 3rd kW · paid by DBT after installation"
                : "Not applied (switch it on in Report → Assumptions)"}
              value={s.subsidy_central ? `−${rupees(s.subsidy_central)}` : "₹0"} valueClass="text-sage-700" />
            <Row icon={Building2} label="Odisha SFA (state top-up)"
              sub={s.subsidy_state
                ? "₹25,000/kW up to 2 kW + ₹10,000 for the 3rd kW · State Cabinet, Jan 2025"
                : "Switched off in Assumptions"}
              value={s.subsidy_state ? `−${rupees(s.subsidy_state)}` : "₹0"} valueClass="text-sage-700" />
            <div className="flex items-center justify-between rounded-xl bg-muted px-3.5 py-3">
              <span className="text-sm font-semibold">Net Out-of-Pocket</span>
              <span className="font-heading text-[1.7rem] leading-none font-medium tabular"><CountUp value={s.net_cost} format={rupees} /></span>
            </div>

            {/* the bill itself, before and after - this is where the savings come from */}
            <div className="rounded-xl border border-sage-200 bg-sage-50/70 p-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-sage-800/80 uppercase">
                <Percent className="size-3.5" /> Your {discom} bill
              </div>
              <BillLine label="Today, without solar" value={rupees(s.bill_before)}
                sub={`${fmtIN(s.annual_units)} units/yr at ~₹${s.tariff.toFixed(2)}/unit all-in`} />
              <BillLine label="With solar (import only)" value={rupees(s.bill_after)} highlight
                sub={`${fmtIN(s.annual_units_after)} units bought · fixed charge and duty still apply`} />
              <BillLine label="Export settled every March" value={rupees(s.export_income)}
                sub={s.export_paid > 0
                  ? `${fmtIN(s.export_paid)} units at ₹${s.export_rate.toFixed(2)}/unit feed-in tariff`
                  : "Nothing left to settle — the plant is sized to your own use"} />
              <div className="mt-2 flex items-baseline justify-between border-t border-sage-200 pt-2">
                <span className="text-sm font-semibold">Saving per year</span>
                <span className="font-heading text-xl font-medium text-sage-800 tabular">
                  <CountUp value={s.annual_savings} format={rupees} /> <span className="font-sans text-xs text-muted-foreground">/ yr</span>
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-sage-200/80 p-3.5">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-card text-sage-800 shadow-sm"><Hourglass className="size-5" /></span>
                <div>
                  <div className="text-[11px] font-semibold tracking-wider text-sage-800/80 uppercase">Simple payback</div>
                  <div className="font-heading text-2xl leading-tight font-medium text-sage-900">
                    {s.payback_years ? <><CountUp value={s.payback_years} format={(v) => v.toFixed(1)} /> Years</> : "—"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-sage-800/80">Estimated Savings</div>
                <div className="font-heading text-lg font-medium text-sage-900 tabular">{rupees(s.annual_savings)} <span className="text-xs font-sans">/ yr</span></div>
              </div>
            </div>

            {!s.net_metering.ok && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                OERC allows net metering only up to your sanctioned load. A {s.kw.toFixed(2)} kW plant needs a sanctioned
                load of at least {s.kw.toFixed(1)} kW; yours is {s.net_metering.limit_kw.toFixed(1)} kW. Ask {discom} for a
                load enhancement along with the net-meter application.
              </p>
            )}
            {s.export_lapsed > 1 && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                About {fmtIN(s.export_lapsed)} units of export would lapse on 31 March: OERC credits solar generation only
                up to {Math.round(s.net_meter_cap * 100)}% of your yearly consumption ({fmtIN(s.credit_limit_units)} units).
                A slightly smaller plant would earn the same money.
              </p>
            )}

            <div className="rounded-xl border border-dashed border-sage-300 p-3.5">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{s.lifetime_years}-year savings · drag across the chart</div>
              <SavingsTimeline yearly={s.yearly_savings} netCost={s.net_cost} format={rupees} />
            </div>
          </div>
        </SectionCard>
      )}

      {/* OERC tariff + net-metering rules */}
      <SectionCard title="Your tariff, by law" subtitle={`OERC domestic slab tariff · ${fy} · the same in all four Odisha DISCOMs`}>
        <div className="space-y-2">
          {SLABS.map((sl) => {
            const active = inputs.monthly_units > sl.from && (sl.to === null || inputs.monthly_units <= sl.to)
            return (
              <div key={sl.label}
                className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                  active ? "bg-sun-soft font-semibold text-sun-ink" : "bg-muted/60")}>
                <span className="inline-flex items-center gap-2">
                  <span className="tabular">{sl.label}</span>
                  {active && <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">you</span>}
                </span>
                <span className="tabular">₹{sl.rate.toFixed(2)} / unit</span>
              </div>
            )
          })}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Pill tone="plain">₹{fmtIN(fixedPerKw)}/kW/month fixed</Pill>
            <Pill tone="plain">{dutyPct}% electricity duty</Pill>
            <Pill tone="plain">Export ₹{s.export_rate.toFixed(2)}/unit</Pill>
            <Pill tone="plain">{Math.round(s.net_meter_cap * 100)}% credit cap</Pill>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Odisha bills are telescopic, so every solar unit you generate replaces your <b className="text-foreground">dearest</b>{" "}
            unit — today that is ₹{s.tariff_marginal.toFixed(2)}/unit. Surplus carries forward month to month and whatever is
            left on 31 March is settled at the feed-in tariff{s.export_rate_auto ? " (GRIDCO's average power purchase cost)" : " you set"}.
            {inputs.tariff != null && <> You overrode the slabs with your own flat rate of ₹{inputs.tariff.toFixed(2)}/unit.</>}
          </p>
        </div>
      </SectionCard>

      {/* satellite layout simulation */}
      <SectionCard
        title={<span className="inline-flex items-center gap-2"><SolarPanel className="size-5 text-sage-600" /> AI Panel Layout Simulation</span>}
        right={<Pill tone="plain">Azimuth 180° · South</Pill>}>
        <div className="relative aspect-square overflow-hidden rounded-xl bg-sage-900">
          <LayoutThumb polygon={r.polygon} panels={r.layout.panels} serverQuery={thumbQ} />
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
            <span className="size-2 rounded-full bg-amber-300" /> Tilt ≈ {tilt}° · optimised for {Math.abs(lat).toFixed(1)}°{lat >= 0 ? "N" : "S"}
          </span>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          {s.panels} × {p.panel_w} W panels packed with a 0.5 m walkway from the roof edge. Fixed panels face south, tilted
          about your latitude, for the most units across the year.
        </p>
      </SectionCard>

      <div className="space-y-2.5 pt-1 pb-2">
        <button type="button" onClick={() => setTab("rain")}
          className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:translate-y-px">
          Simulate Rainwater Potential <ArrowRight className="size-[18px]" />
        </button>
        <button type="button" onClick={() => void download(query)} disabled={dlBusy}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border bg-muted/60 text-[15px] font-semibold text-foreground/85 transition hover:bg-muted disabled:opacity-60">
          {dlBusy ? <Loader2 className="size-[18px] animate-spin" /> : <Download className="size-[18px]" />}
          {dlBusy ? "Building your PDF…" : "Export Green Roof Report (PDF)"}
        </button>
      </div>
    </div>
  )
}

/** Satellite + panel-layout preview, drawn in the browser from the map's own tiles
 *  (works even when the backend has no internet); /api/thumb is the fallback. */
function LayoutThumb({ polygon, panels, serverQuery }: {
  polygon: LatLng[]; panels: LatLng[][]; serverQuery: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [fallback, setFallback] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setFallback(false)
    setLoaded(false)
    void (async () => {
      let cap: TileCrop | null = null
      try { cap = await capturePolyCrop(polygon, 640) } catch { cap = null }
      if (!alive) return
      if (cap) {
        try {
          setSrc(drawLayoutImage(cap, polygon, panels, 640))
          setLoaded(true)
          return
        } catch { /* fall through to the server image */ }
      }
      setFallback(true)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverQuery])

  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,#26342b,#34473a,#26342b)] bg-[length:200%_100%]" />}
      {src && (
        <img src={src} alt="Satellite view of your roof with the suggested panel layout"
          className="absolute inset-0 size-full object-cover" />
      )}
      {fallback && !src && (
        <img src={`/api/thumb?${serverQuery}&size=640`} alt="Satellite view of your roof with the suggested panel layout"
          onLoad={() => setLoaded(true)}
          onError={() => {
            // last resort: still show the roof + panel outlines on a dark backdrop
            try { setSrc(drawLayoutImage(darkCropFor(polygon), polygon, panels, 640)) } catch { /* give up quietly */ }
            setLoaded(true)
          }}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")} />
      )}
    </>
  )
}

function Row({ icon: Icon, label, sub, value, valueClass }: {
  icon: typeof Receipt; label: string; sub?: string; value: string; valueClass?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-sage-700" />
        <div className="min-w-0">
          <div className="text-[15px] leading-snug">{label}</div>
          {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        </div>
      </div>
      <span className={cn("font-heading text-lg font-medium whitespace-nowrap tabular", valueClass)}>{value}</span>
    </div>
  )
}

const FALLBACK_SLABS = [
  { from: 0, to: 50, label: "0 – 50 units", rate: 2.9 },
  { from: 51, to: 200, label: "51 – 200 units", rate: 4.7 },
  { from: 201, to: 400, label: "201 – 400 units", rate: 5.7 },
  { from: 401, to: null as number | null, label: "above 400 units", rate: 6.1 },
]

function BillLine({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 py-1", highlight && "text-sage-900")}>
      <div className="min-w-0">
        <div className={cn("text-[13px] leading-snug", highlight ? "font-semibold" : "text-foreground/80")}>{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <span className="font-heading text-[15px] font-medium whitespace-nowrap tabular">{value}</span>
    </div>
  )
}

function StepBtn({ children, onClick, disabled, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="grid size-8 place-items-center rounded-lg border bg-card text-sage-800 transition hover:bg-secondary disabled:opacity-40 [&_svg]:size-4">
      {children}
    </button>
  )
}

export function ViewSkeleton() {
  return (
    <div className="space-y-3.5">
      <Skeleton className="h-7 w-2/3 rounded-full" />
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[124px] rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}
