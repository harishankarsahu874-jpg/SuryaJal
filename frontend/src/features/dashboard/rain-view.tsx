import { useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, CalendarDays, CloudRain, Droplets, Minus, Plus, ShieldCheck, Truck, Users, Waves } from "lucide-react"
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
  const planned = w.tank.litres + well.capacity_l
  const meets = planned >= w.bwssb_min_l
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

      <SectionCard title="Bengaluru rule check" subtitle="BWSSB Act 2009 s.72A: 20 L of storage or recharge per m² of roof"
        right={<Pill tone={meets ? "sage" : "peach"}><ShieldCheck className="size-3.5" /> {meets ? "Meets rule" : "Below rule"}</Pill>}>
        <div className="space-y-2.5">
          <Bar label="Required" value={w.bwssb_min_l} max={Math.max(planned, w.bwssb_min_l)} className="bg-sage-300" />
          <Bar label="Your plan" value={planned} max={Math.max(planned, w.bwssb_min_l)} className="bg-water"
            note={`${fmtIN(w.tank.litres)} L tank + ${fmtIN(well.capacity_l)} L well`} />
        </div>
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
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">People in family</span>
            <div className="flex h-11 items-center justify-between rounded-xl border bg-background px-1.5">
              <Step onClick={() => setInput("family_size", Math.max(1, inputs.family_size - 1))} label="Fewer people"><Minus /></Step>
              <span className="inline-flex items-center gap-1.5 font-semibold tabular"><Users className="size-4 text-muted-foreground" /> {inputs.family_size}</span>
              <Step onClick={() => setInput("family_size", Math.min(100, inputs.family_size + 1))} label="More people"><Plus /></Step>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Solar panels don’t reduce rainwater — rain runs off the panels into the same pipes. Best month: {MONTHS_LONG[w.wettest_month]} ({litres(w.wettest_harvest_l)}).
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

function Bar({ label, value, max, className, note }: { label: string; value: number; max: number; className: string; note?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-heading font-medium tabular">{fmtIN(value)} L</span>
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
