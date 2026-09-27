import { useState, type ReactNode } from "react"
import {
  ArrowLeft, ArrowRight, CalendarDays, CloudRain, Droplets, HandCoins, Info, Minus, Plus, ShieldCheck, Truck,
  Users, Waves,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fmtIN, litres, MONTHS_LONG, rupees } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ViewSkeleton } from "./solar-view"
import { useDashboard } from "./state"
import { CountUp, EmptyState, MonthBars, Pill, SectionCard, StatTile, TankGauge } from "./ui-bits"

export function RainView() {
  const { result: r, roof, inputs, setInput, config, setTab, loadDemo, assessing } = useDashboard()
  const [month, setMonth] = useState<number | null>(null)

  if (!roof) return <EmptyState onDemo={loadDemo} onMap={() => setTab("map")} />
  if (!r) return <ViewSkeleton />

  const w = r.rain, p = r.params
  const sel = month ?? w.wettest_month
  const harvest = w.monthly_harvest_l[sel], demand = w.monthly_demand_l[sel], rainMm = w.monthly_rain_mm[sel]
  const fills = harvest / Math.max(1, w.tank.litres)
  const well = w.recharge_well
  const planned = w.planned_l
  const coverage = Math.round(w.coverage * 100)
  const tag = sel === w.wettest_month ? "Wettest" : sel >= 5 && sel <= 8 ? "Monsoon" : rainMm < 15 ? "Dry" : null

  return (
    <div className={cn("space-y-3.5 transition-opacity", assessing && "opacity-80")}>
      <div className="flex items-center justify-between gap-2">
        <Pill tone="water"><CloudRain className="size-3.5" /> NASA POWER rainfall</Pill>
        <span className="text-xs font-medium text-muted-foreground tabular">
          {fmtIN(w.annual_rain_mm)} mm / year{w.rain_overridden && " (your value)"}
        </span>
      </div>

      {/* hero */}
      <section className="relative overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-br from-water-soft via-sky-50 to-white p-4 sm:p-5">
        <Waves className="absolute -right-6 -bottom-6 size-36 text-sky-200/60" aria-hidden />
        <div className="relative">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-water-ink uppercase">Your roof can harvest</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-heading text-[2.6rem] leading-none font-normal tracking-tight text-water-ink tabular">
              <CountUp value={w.annual_harvest_l} format={(v) => (v >= 1e5 ? (v / 1e5).toFixed(2) : fmtIN(v))} />
            </span>
            <span className="text-sm font-semibold text-water-ink/80">{w.annual_harvest_l >= 1e5 ? "lakh litres" : "litres"} / year</span>
          </div>
          <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-foreground/75">
            {fmtIN(r.area_m2)} m² × {fmtIN(w.annual_rain_mm)} mm × runoff {w.runoff_c} —{" "}
            {coverage >= 100 ? <>enough for <b>all</b> of your family’s water.</> : <>about <b>{coverage}%</b> of your family’s yearly water.</>}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Storage Tank" icon={Droplets} tone="water" value={fmtIN(w.tank.litres)} unit="L"
          sub={`Holds a ${p.design_rain_mm} mm rain day`} />
        <StatTile label="Recharge Well" icon={Waves} tone="water"
          value={`${well.wells > 1 ? `${well.wells}×` : ""}${well.depth_m}`} unit="m deep"
          sub={`${well.diameter_m} m rings · soaks ${fmtIN(well.capacity_l)} L`} />
        <StatTile label="Tankers Avoided" icon={Truck} tone="water" value={<CountUp value={w.tankers_saved} format={(v) => fmtIN(v)} />}
          unit="/ yr" sub={`${rupees(w.tanker_savings)} saved at ${rupees(p.tanker_price)} each`} />
        <StatTile label="Water For" icon={CalendarDays} tone="water" value={<CountUp value={w.days_of_water} format={(v) => fmtIN(v)} />}
          unit="days" sub={`Family of ${p.family_size} @ ${p.lpcd} L/day`} />
      </div>

      <SectionCard title="Monthly Harvest" subtitle="Tap a month to fill your tank" right={<Pill tone="water">Jan – Dec</Pill>}>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-water-soft/70 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full bg-water-ink" />
            <span className="truncate text-sm font-semibold">{MONTHS_LONG[sel]}{tag && <span className="font-normal text-muted-foreground"> ({tag})</span>}</span>
          </div>
          <div className="text-right">
            <span className="font-heading text-2xl font-medium text-water-ink tabular">{fmtIN(harvest)}</span>
            <span className="ml-1 text-xs text-muted-foreground">L</span>
          </div>
        </div>
        <MonthBars values={w.monthly_harvest_l} selected={sel} onSelect={setMonth} activeClass="bg-water-ink"
          baseClass="bg-sky-200/80 hover:bg-sky-300" line={w.monthly_demand_l}
          label={(i) => `${MONTHS_LONG[i]}: ${fmtIN(w.monthly_harvest_l[i])} litres`} />
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sky-200" /> Rain harvested</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-sage-900/55" /> Family use</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-water-ink" /> Selected Month</span>
        </div>
        <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3.5">
          <TankGauge fraction={Math.min(1, fills)}
            label={fills >= 1 ? `Fills your ${fmtIN(w.tank.litres)} L tank ${fills.toFixed(1)}×` : `${Math.round(fills * 100)}% of your ${fmtIN(w.tank.litres)} L tank`}
            sub={`${fmtIN(rainMm)} mm of rain in ${MONTHS_LONG[sel]} · your family uses ~${fmtIN(demand)} L`} />
        </div>
      </SectionCard>

      <SectionCard title="Odisha rule check" subtitle={`${w.rule.short}`}
        right={<Pill tone={w.meets_rule ? "sage" : "peach"}><ShieldCheck className="size-3.5" /> {w.meets_rule ? "Meets rule" : "Below rule"}</Pill>}>
        <div className="space-y-2.5">
          <Bar label={`Required (${w.rule.l_per_m2} L per m² of roof)`} value={w.rule_min_l} max={Math.max(planned, w.rule_min_l)} className="bg-sage-300" />
          <Bar label="Your plan" value={planned} max={Math.max(planned, w.rule_min_l)} className="bg-water"
            note={`${fmtIN(w.tank.litres)} L tank + ${fmtIN(well.capacity_l)} L recharge (${well.wells > 1 ? `${well.wells} wells` : "1 well"}, ${well.diameter_m} m Ø × ${well.depth_m} m)`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone="plain">{w.downpipes.count} × {w.downpipes.diameter_mm} mm downpipes</Pill>
          <Pill tone="plain">First-flush valve + filter bed</Pill>
          <Pill tone="plain">{fmtIN(w.monsoon_harvest_l)} L in the Jul–Oct monsoon ({Math.round(w.monsoon_share * 100)}%)</Pill>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          Under the {w.rule.name}, rainwater harvesting is mandatory on every plot above {fmtIN(w.rule.mandate_plot_m2)} m²
          and ground-water recharge on plots above {fmtIN(w.rule.recharge_plot_m2)} m². The authority checks it before the
          completion certificate is issued.
          {!w.meets_rule && <> You are short by <b className="text-foreground">{litres(w.rule_gap_l)}</b> — deepen the recharge well or add a second one.</>}
        </p>
      </SectionCard>

      <SectionCard title="CHHATA subsidy" subtitle="Govt. of Odisha rooftop rainwater scheme · 50 % of the cost, up to ₹55,000"
        right={<Pill tone={w.chhata.eligible ? "sage" : "peach"}>
          {w.chhata.eligible ? "Eligible" : "Not eligible"}
        </Pill>}>
        {w.chhata.eligible ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-xl bg-water-soft/70 px-3.5 py-3">
              <div>
                <div className="text-[11px] font-semibold tracking-wider text-water-ink/80 uppercase">Subsidy for this roof</div>
                <div className="font-heading text-2xl leading-tight font-medium text-water-ink tabular">
                  <CountUp value={w.chhata.subsidy} format={rupees} />
                </div>
              </div>
              <span className="grid size-11 place-items-center rounded-xl bg-card text-water-ink shadow-sm"><HandCoins className="size-5" /></span>
            </div>
            <Bar label="System cost (estimate)" value={w.chhata.est_cost} max={w.chhata.est_cost} className="bg-sky-300" money
              note={`${fmtIN(r.area_m2)} m² roof × ₹${fmtIN(w.chhata.cost_per_m2)}/m² — pipes, filter bed, recharge well`} />
            <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-medium">You pay</span>
              <span className="font-heading font-medium tabular">{rupees(w.chhata.net_cost)}</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{w.chhata.note}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {w.chhata.reasons.map((why) => (
              <p key={why} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-foreground/80">
                <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {why}
              </p>
            ))}
            <p className="text-xs leading-relaxed text-muted-foreground">
              CHHATA ({w.chhata.scheme_years}) covers roofs of {fmtIN(w.chhata.roof_min_m2)}–{fmtIN(w.chhata.roof_max_m2)} m² in
              buildings of at most {w.chhata.max_floors} floors. Harvesting and recharge are still worth doing — and above{" "}
              {fmtIN(w.rule.mandate_plot_m2)} m² of plot they are the law.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Your home" subtitle="Changes update every number instantly">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Roof type</span>
            <Select value={inputs.roof_type} onValueChange={(v) => setInput("roof_type", v)}>
              <SelectTrigger className="h-11 w-full rounded-xl bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(config?.roof_types ?? {}).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} · runoff {v.c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Floors in the building</span>
            <div className="flex h-11 items-center justify-between rounded-xl border bg-background px-1.5">
              <Step onClick={() => setInput("floors", Math.max(1, inputs.floors - 1))} label="Fewer floors"><Minus /></Step>
              <span className="inline-flex items-center gap-1.5 font-semibold tabular">{inputs.floors}</span>
              <Step onClick={() => setInput("floors", Math.min(30, inputs.floors + 1))} label="More floors"><Plus /></Step>
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">People in family</span>
            <div className="flex h-11 items-center justify-between rounded-xl border bg-background px-1.5">
              <Step onClick={() => setInput("family_size", Math.max(1, inputs.family_size - 1))} label="Fewer people"><Minus /></Step>
              <span className="inline-flex items-center gap-1.5 font-semibold tabular"><Users className="size-4 text-muted-foreground" /> {inputs.family_size}</span>
              <Step onClick={() => setInput("family_size", Math.min(100, inputs.family_size + 1))} label="More people"><Plus /></Step>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Solar panels don’t reduce rainwater — rain runs off the panels into the same pipes. Best month:{" "}
          {MONTHS_LONG[w.wettest_month]} ({litres(w.wettest_harvest_l)}). Rainfall is for{" "}
          {r.location?.district ? `${r.location.district} district` : "your part of Odisha"} from the NASA POWER
          2001–2020 climatology.
        </p>
      </SectionCard>

      <div className="space-y-2.5 pt-1 pb-2">
        <button type="button" onClick={() => setTab("report")}
          className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:translate-y-px">
          See Green Score &amp; Report <ArrowRight className="size-[18px]" />
        </button>
        <button type="button" onClick={() => setTab("solar")}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border bg-muted/60 text-[15px] font-semibold text-foreground/85 transition hover:bg-muted">
          <ArrowLeft className="size-[18px]" /> Back to solar
        </button>
      </div>
    </div>
  )
}

function Bar({ label, value, max, className, note, money }: {
  label: string; value: number; max: number; className: string; note?: string; money?: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-heading font-medium tabular">{money ? rupees(value) : `${fmtIN(value)} L`}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all duration-700", className)} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}
    </div>
  )
}

function Step({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="grid size-8 place-items-center rounded-lg text-sage-800 hover:bg-secondary [&_svg]:size-4">
      {children}
    </button>
  )
}
