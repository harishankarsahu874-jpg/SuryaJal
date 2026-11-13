import { useState, type ComponentType, type ReactNode } from "react"
import {
  AlertTriangle, Building2, CalendarCheck2, CheckCircle2, Clock, Droplets,
  IndianRupee, ShieldCheck, Sparkles, Wrench, XCircle, Zap,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fmtIN, litres, MONTHS_LONG, rupees } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useDashboard } from "./state"
import { CountUp, MonthBars, Pill, SectionCard, StatTile } from "./ui-bits"

export function SolarMaintenanceSection() {
  const { result: r, inputs, setInput, config } = useDashboard()
  const [planMode, setPlanMode] = useState<"diy" | "amc">("diy")
  const [month, setMonth] = useState<number>(0)

  if (!r) return null

  const s = r.solar
  const m = s.maintenance
  const w = r.rain
  const sel = month
  const cleansInMonth = m.monthly_cleans[sel] ?? 0
  const rainInMonth = w.monthly_rain_mm[sel] ?? 0
  const postAnnual = planMode === "diy" ? m.diy_annual_cost : m.amc_annual_cost
  const lifeMaint = planMode === "diy" ? m.lifetime_cost_diy : m.lifetime_cost_amc
  const netProfitAfterMaint = s.lifetime_profit - lifeMaint
  const maxBar = Math.max(s.lifetime_savings, lifeMaint, 1)

  return (
    <div id="solar-maintenance" className="scroll-mt-3 space-y-3.5 pt-2">
      {/* Maintenance header banner inside the Solar report */}
      <section className="rounded-2xl border border-sage-200 bg-gradient-to-br from-sage-100/90 via-sage-50 to-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-sage-700 uppercase">
            Maintenance · Rooftop &amp; Panels
          </span>
          <Pill tone="peach">
            <ShieldCheck className="size-3.5" /> {m.free_cmc_years}-Yr Free Vendor CMC
          </Pill>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-[1.28rem] leading-tight font-medium tracking-tight">
              Maintenance Plan &amp; Cost Breakdown
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/75">
              {s.panels > 0 ? (
                <>
                  Tailored for <b>{s.panels} panels ({s.kw.toFixed(2)} kW · {m.panel_area_m2.toFixed(1)} m² glass)</b> on
                  your <b>{fmtIN(r.area_m2)} m²</b> {m.roof_type_label.toLowerCase()} — what is required, why, how to do
                  it safely, and total upkeep cost.
                </>
              ) : (
                <>
                  With the 0.5 m walkway clearance, no full-size panels fit this {fmtIN(r.area_m2)} m² outline yet. Expand
                  your roof outline on the map to calculate exact panel cleaning water and maintenance costs.
                </>
              )}
            </p>
          </div>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-sage-800">
            <Wrench className="size-5" />
          </span>
        </div>

        {s.panels > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pill tone="plain" className="bg-white/85">{fmtIN(m.total_weight_kg)} kg total load</Pill>
            <Pill tone="plain" className="bg-white/85">{m.load_kg_per_m2} kg/m² (safe &lt; {m.safe_rcc_load_kg_m2} kg/m²)</Pill>
            <Pill tone="plain" className="bg-white/85">{m.cleans_per_year} washes/yr</Pill>
          </div>
        )}
      </section>

      {s.panels > 0 && (
        <>
          {/* 4 Maintenance KPI tiles */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label={`Years 1–${m.free_cmc_years} Vendor AMC`}
              icon={ShieldCheck}
              value="₹0"
              unit="/ yr"
              sub={`Free under PM Surya Ghar (~${rupees(m.years_1_to_5_annual_cost)}/yr wiper supplies)`}
            />
            <StatTile
              label={`Year ${m.free_cmc_years + 1}+ Upkeep`}
              icon={IndianRupee}
              tone="sun"
              value={<CountUp value={postAnnual} format={(v) => rupees(v)} />}
              unit="/ yr"
              sub={`~${rupees(postAnnual / 12)}/mo · ${planMode === "diy" ? "Self-clean + check" : "Full vendor AMC"}`}
            />
            <StatTile
              label="Cleaning Schedule"
              icon={Droplets}
              tone="water"
              value={<CountUp value={m.cleans_per_year} format={(v) => String(Math.round(v))} />}
              unit="washes/yr"
              sub={`${m.water_per_wash_l.toFixed(0)} L water · ~${m.minutes_per_wash} mins/wash`}
            />
            <StatTile
              label="Output Protected"
              icon={Zap}
              value={<CountUp value={m.savings_protected_yr} format={(v) => rupees(v)} />}
              unit="/ yr"
              sub={`Prevents ~${fmtIN(m.kwh_protected_yr)} kWh/yr (${m.dust_loss_pct}% dust loss)`}
            />
          </div>

          {/* Why maintenance is required */}
          <SectionCard
            title="Why Maintenance Is Required"
            subtitle={`How dust, bird droppings & coastal haze affect your ${s.kw.toFixed(2)} kW system`}
            right={<Pill tone="peach">−{m.dust_loss_pct}% if uncleaned</Pill>}
          >
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-baseline justify-between text-xs font-semibold">
                  <span className="text-sage-800">Regularly cleaned ({m.cleans_per_year}×/yr)</span>
                  <span className="tabular">{fmtIN(s.annual_gen)} kWh/yr · {rupees(s.annual_savings)}/yr</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-full rounded-full bg-primary" />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-xs font-semibold text-muted-foreground">
                  <span>Left dusty / unwashed in dry months</span>
                  <span className="tabular">
                    {fmtIN(s.annual_gen - m.kwh_protected_yr)} kWh/yr · {rupees(s.annual_savings - m.savings_protected_yr)}/yr
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${100 - m.dust_loss_pct}%` }} />
                </div>
              </div>
              <p className="rounded-xl bg-sage-50 px-3.5 py-2.5 text-xs leading-relaxed text-foreground/80">
                Solar panels have <b>no moving parts</b>, so maintenance is simply keeping the glass clean, trimming new tree
                shadows, and checking rooftop drains &amp; electrical joints once a year. Just <b>~{m.minutes_per_wash} minutes</b>{" "}
                every two weeks in dry months protects <b>{rupees(m.savings_protected_yr)}/year</b> of electricity savings!
              </p>
            </div>
          </SectionCard>

          {/* Cost of panel maintenance */}
          <SectionCard
            title="Cost of Panel Maintenance"
            subtitle={`Complete ${m.lifetime_years}-year upkeep budget for ${s.panels} panels (${s.kw.toFixed(2)} kW)`}
          >
            <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl bg-muted p-1">
              <button
                type="button"
                onClick={() => setPlanMode("diy")}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold transition",
                  planMode === "diy" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Self-Clean + Annual Check
              </button>
              <button
                type="button"
                onClick={() => setPlanMode("amc")}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold transition",
                  planMode === "amc" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Full Vendor AMC
              </button>
            </div>

            <div className="space-y-3">
              <CostRow
                icon={ShieldCheck}
                title={`Years 1 – ${m.free_cmc_years}: OREDA / PM Surya Ghar Free CMC`}
                sub="Empanelled installer must provide 5 years free quarterly health check, inverter & structure service; only soft mop/wiper supplies needed at home"
                value={`${rupees(m.years_1_to_5_annual_cost)} / yr`}
                badge="₹0 Vendor Fee"
              />
              <CostRow
                icon={Wrench}
                title={
                  planMode === "diy"
                    ? `Years ${m.free_cmc_years + 1} – ${m.lifetime_years}: Home Cleaning + Annual Electrician Check`
                    : `Years ${m.free_cmc_years + 1} – ${m.lifetime_years}: Full Professional AMC Contract`
                }
                sub={
                  planMode === "diy"
                    ? `Microfiber pole/squeegee supplies + once-a-year technician check of MC4 connectors, earthing & SPD (~${rupees(m.diy_annual_cost / 12)}/month)`
                    : `Hands-off vendor contract @ ~₹1,200/kW/yr covering scheduled inspections, bolt torque & electrical testing (single pro wash visit: ~${rupees(m.pro_visit_cost)})`
                }
                value={`${rupees(postAnnual)} / yr`}
              />
              <CostRow
                icon={Zap}
                title={`Around Year ${m.inverter_replacement_year}: Mid-Life Inverter Reserve`}
                sub="Solar panels last 25+ years (80%+ output warranty), while on-grid string inverters typically need one replacement or overhaul in Year 12–15"
                value={rupees(m.inverter_replacement_cost)}
                badge="One-time"
              />

              <div className="mt-2 space-y-2.5 rounded-xl border border-sage-200 bg-sage-50/75 p-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold tracking-wider text-sage-800 uppercase">
                    {m.lifetime_years}-year lifecycle comparison
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Maintenance is only <b>{Math.round((lifeMaint / Math.max(1, s.lifetime_savings)) * 100)}%</b> of savings
                  </span>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{m.lifetime_years}-yr Bill Savings</span>
                    <span className="font-heading font-semibold text-sage-900 tabular">{rupees(s.lifetime_savings)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(s.lifetime_savings / maxBar) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{m.lifetime_years}-yr Total Maintenance (incl. inverter)</span>
                    <span className="font-heading font-semibold text-sun-ink tabular">{rupees(lifeMaint)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-sun" style={{ width: `${(lifeMaint / maxBar) * 100}%` }} />
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-t border-sage-200 pt-2">
                  <span className="text-sm font-semibold">Net 25-Yr Profit (after capex &amp; maintenance)</span>
                  <span className="font-heading text-lg font-medium text-sage-900 tabular">
                    {rupees(netProfitAfterMaint)}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Monthly cleaning schedule */}
          <SectionCard
            title="Monthly Cleaning Calendar"
            subtitle="Tuned to Odisha’s dry dusty months vs monsoon rains"
            right={<Pill tone="water">{fmtIN(m.annual_wash_water_l)} L water/yr</Pill>}
          >
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {MONTHS_LONG[sel]}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({rainInMonth >= 150 ? "Monsoon rain washes dust" : cleansInMonth >= 2 ? "Dry & dusty — every 15 days" : "Transition month"})
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  ~{fmtIN(rainInMonth)} mm local rain · {m.water_per_wash_l.toFixed(0)} L water &amp; ~{m.minutes_per_wash} mins per wash
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="font-heading text-2xl font-medium text-primary tabular">{cleansInMonth}×</span>
                <span className="ml-1 text-xs text-muted-foreground">/ mo</span>
              </div>
            </div>

            <MonthBars
              values={m.monthly_cleans}
              selected={sel}
              onSelect={setMonth}
              activeClass="bg-primary"
              baseClass="bg-sage-200 hover:bg-sage-300"
              height={120}
              label={(i) => `${MONTHS_LONG[i]}: ${m.monthly_cleans[i]} washes`}
            />

            <p className="mt-3.5 rounded-xl border border-sky-200/70 bg-water-soft/55 px-3.5 py-2.5 text-xs leading-relaxed text-water-ink">
              <b>Solar + Rainwater Synergy:</b> Cleaning all {s.panels} panels for an entire year needs just{" "}
              <b>{fmtIN(m.annual_wash_water_l)} L</b> of water — less than <b>1%</b> of the{" "}
              <b>{litres(w.annual_harvest_l)}</b> your roof harvests! Harvested rainwater is naturally soft (zero TDS), so it
              leaves <b>zero white hard-water limescale</b> on solar glass.
            </p>
          </SectionCard>

          {/* How to clean & maintain panels safely */}
          <SectionCard
            title="How to Clean & Maintain Panels"
            subtitle="Step-by-step homeowner guide — no specialist tools required"
            right={<Pill><Clock className="size-3.5" /> ~{m.minutes_per_wash} mins</Pill>}
          >
            <ol className="space-y-2.5 text-[13px] leading-relaxed">
              <StepItem n={1} title="Clean early morning (6:00 – 8:00 AM) or after sunset">
                Panels get 55–65°C hot in afternoon sun. Spraying cold water at midday causes <b>thermal shock</b> that can
                micro-crack tempered glass and void warranty.
              </StepItem>
              <StepItem n={2} title="Stand on the 0.5 m walkway & switch off DC/AC isolator">
                Use a long telescopic insulated microfiber water-fed pole from your safe roof walkway. For close wet cleaning,
                turn off the inverter AC/DC switch first.
              </StepItem>
              <StepItem n={3} title={`Rinse with ~${m.water_per_wash_l.toFixed(0)} L plain/rain water, then wipe gently`}>
                Hose or pour low-pressure water to float abrasive grit off first, then pull a soft sponge + rubber squeegee
                top-to-bottom. For sticky bird droppings, soak with plain water for 2 minutes before wiping.
              </StepItem>
              <StepItem n={4} title="Check inverter green LED & trim new shadows">
                Glance at your inverter status light or mobile app weekly. Keep inverter air vents dust-free and trim growing
                coconut/mango branches that shade panels between 9 AM and 3 PM.
              </StepItem>
            </ol>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-emerald-900 uppercase">
                  <CheckCircle2 className="size-4 text-emerald-700" /> Best Practices
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-emerald-950/85">
                  <li>• Soft microfiber cloth, sponge &amp; rubber wiper</li>
                  <li>• Low-TDS / harvested rainwater</li>
                  <li>• Keep space under panels clear for cooling airflow</li>
                </ul>
              </div>
              <div className="rounded-xl border border-amber-200/90 bg-amber-50/70 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-950 uppercase">
                  <XCircle className="size-4 text-destructive" /> Never Do This
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-amber-950/85">
                  <li>• Never walk, sit, or dry clothes/pickles on panels</li>
                  <li>• No detergent bars, acid, or metal scrubbers</li>
                  <li>• No high-pressure car-wash jets on panel seals</li>
                </ul>
              </div>
            </div>
          </SectionCard>

          {/* Rooftop care & structural safety */}
          <SectionCard
            title="Rooftop Structure, Waterproofing & Cyclone Care"
            subtitle="Protecting both your terrace slab and mounting frame in Odisha"
            right={<Building2 className="size-5 text-sage-600" />}
          >
            <div className="mb-3">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Selected rooftop surface</span>
              <Select value={inputs.roof_type} onValueChange={(v) => setInput("roof_type", v)}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(config?.roof_types ?? {}).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5 text-[13px] leading-relaxed">
              <div className="rounded-xl bg-muted/70 p-3">
                <div className="text-xs font-semibold text-muted-foreground">Recommended Mounting System</div>
                <div className="mt-0.5 font-medium text-foreground">{m.mounting_type}</div>
              </div>
              <div className="rounded-xl bg-muted/70 p-3">
                <div className="text-xs font-semibold text-muted-foreground">Rooftop Waterproofing &amp; Drainage Care</div>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{m.rooftop_care_note}</p>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-sage-200 bg-sage-50/70 p-3 text-xs leading-relaxed text-foreground/85">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-sun-ink" />
                <div>
                  <b>Odisha Pre-Monsoon &amp; Cyclone Check (Every May):</b> Tighten M8/M10 stainless-steel module clamps, check
                  hot-dip galvanised legs for any rust spots, verify DC surge protection (SPD) &amp; earthing pit moisture, and
                  clear rainwater gutters + first-flush pipe before monsoon storms.
                </div>
              </div>
            </div>
          </SectionCard>

          {/* At-a-glance maintenance checklist */}
          <SectionCard
            title="Complete Maintenance Timetable"
            subtitle="Everything needed across the 25-year panel life"
            right={<CalendarCheck2 className="size-5 text-sage-600" />}
          >
            <div className="divide-y text-[13px]">
              <ScheduleRow when="Every 15 days (Oct–May)" what={`Morning soft-water wipe (${m.water_per_wash_l.toFixed(0)} L, ~${m.minutes_per_wash} mins)`} who="Homeowner" />
              <ScheduleRow when="Monthly (Jun–Sep)" what="Monsoon rain cleans dust — check bird droppings & inverter app" who="Homeowner" />
              <ScheduleRow when="Every May (Pre-monsoon)" what="Clear roof drains/downpipes, check waterproofing & wind bolts" who="Homeowner / Vendor" />
              <ScheduleRow when="Once a year" what="Torque check, MC4 connectors, DC/AC SPD & earthing resistance" who={`Free Yr 1–${m.free_cmc_years} · Technician Yr ${m.free_cmc_years + 1}+`} />
              <ScheduleRow when={`Year 12 – 15 (~Yr ${m.inverter_replacement_year})`} what={`On-grid string inverter overhaul / replacement (~${rupees(m.inverter_replacement_cost)})`} who="Service Engineer" />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}

function CostRow({ icon: Icon, title, sub, value, badge }: {
  icon: ComponentType<{ className?: string }>; title: string; sub: string; value: string; badge?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-sage-700" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold leading-snug">{title}</span>
            {badge && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold tracking-wide text-secondary-foreground uppercase">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{sub}</p>
        </div>
      </div>
      <span className="font-heading shrink-0 text-base font-medium whitespace-nowrap text-foreground tabular">{value}</span>
    </div>
  )
}

function StepItem({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl bg-muted/55 p-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function ScheduleRow({ when, what, who }: { when: string; what: string; who: string }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="text-xs font-bold text-sage-800">{when}</div>
        <div className="text-xs text-foreground/85">{what}</div>
      </div>
      <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
        <Sparkles className="size-3 text-sun-ink" /> {who}
      </span>
    </div>
  )
}
