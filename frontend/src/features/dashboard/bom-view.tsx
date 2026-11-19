import { useMemo, useState } from "react"
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, ExternalLink, Info, MapPinned, ShieldCheck,
} from "lucide-react"
import { fmtIN, rupees } from "@/lib/format"
import type { AppConfig, Assessment } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useDashboard } from "./state"
import { EmptyState, Pill, SectionCard } from "./ui-bits"
import { ViewSkeleton } from "./solar-view"

type PanelType = "topcon" | "mono-perc"
type InverterType = "grid-tied" | "hybrid"
type QuoteScope = "solar" | "rain" | "combined"

interface EstimateLine {
  name: string
  quantity: string
  basis: string
  low: number
  high: number
}

interface EstimateTotal {
  low: number
  high: number
}

const PANEL_OPTIONS: { id: PanelType; name: string; short: string; lowPerKw: number; highPerKw: number }[] = [
  { id: "topcon", name: "TOPCon", short: "Higher-efficiency N-type", lowPerKw: 22_000, highPerKw: 26_000 },
  { id: "mono-perc", name: "Mono-PERC", short: "Established P-type option", lowPerKw: 19_000, highPerKw: 23_000 },
]

const INVERTER_OPTIONS: { id: InverterType; name: string; detail: string; lowPerKw: number; highPerKw: number }[] = [
  { id: "grid-tied", name: "Grid-tied string", detail: "Typical on-grid / net-metered system", lowPerKw: 8_500, highPerKw: 11_000 },
  { id: "hybrid", name: "Hybrid", detail: "Battery-ready; battery not included", lowPerKw: 16_000, highPerKw: 23_000 },
]

const DISCOM_GUIDES = [
  { code: "TPCODL", url: "https://www.tpcentralodisha.com/" },
  { code: "TPNODL", url: "https://www.tpnorthernodisha.com/" },
  { code: "TPWODL", url: "https://www.tpwesternodisha.com/" },
  { code: "TPSODL", url: "https://www.tpsouthernodisha.com/" },
] as const

function totalOf(lines: EstimateLine[]): EstimateTotal {
  return lines.reduce((sum, line) => ({ low: sum.low + line.low, high: sum.high + line.high }), { low: 0, high: 0 })
}

function priceRange(total: EstimateTotal) {
  return `${rupees(total.low)} – ${rupees(total.high)}`
}

function EstimateLines({ lines }: { lines: EstimateLine[] }) {
  if (!lines.length) {
    return <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">No system capacity is available for this part of the estimate.</p>
  }
  return (
    <div className="divide-y divide-border/70">
      {lines.map((line) => (
        <div key={line.name} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-snug">{line.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{line.quantity} · {line.basis}</div>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{priceRange(line)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TotalBand({ label, total, tone }: { label: string; total: EstimateTotal; tone: "sun" | "water" }) {
  return (
    <div className={cn(
      "mt-3 flex items-center justify-between gap-3 rounded-xl px-3.5 py-3",
      tone === "sun" ? "bg-sun-soft text-sun-ink" : "bg-water-soft text-water-ink",
    )}>
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-right text-sm font-bold tabular-nums">{priceRange(total)}</span>
    </div>
  )
}

export function BomView() {
  const { result, roof, loadDemo, setTab, config } = useDashboard()
  if (!roof) return <EmptyState onDemo={loadDemo} onMap={() => setTab("map")} />
  if (!result) return <ViewSkeleton />
  return <BomBuilder result={result} config={config} />
}

function BomBuilder({ result: r, config }: { result: Assessment; config: AppConfig | null }) {
  const [panelType, setPanelType] = useState<PanelType>("topcon")
  const [inverterType, setInverterType] = useState<InverterType>("grid-tied")
  const [scope, setScope] = useState<QuoteScope>("combined")
  const [quote, setQuote] = useState("")

  const solarKw = Math.max(0, r.solar.kw)
  const rainLitres = Math.max(0, r.rain.tank.litres || r.rain.storage_need_l)
  const rechargeLitres = Math.max(0, r.rain.rule_min_l)
  const downpipes = Math.max(1, r.rain.downpipes.count)
  const selectedPanel = PANEL_OPTIONS.find((option) => option.id === panelType) ?? PANEL_OPTIONS[0]
  const selectedInverter = INVERTER_OPTIONS.find((option) => option.id === inverterType) ?? INVERTER_OPTIONS[0]

  const solarLines = useMemo<EstimateLine[]>(() => {
    if (solarKw <= 0) return []
    const perKw: { name: string; low: number; high: number; basis: string }[] = [
      {
        name: `PV modules · ${selectedPanel.name}`,
        low: selectedPanel.lowPerKw,
        high: selectedPanel.highPerKw,
        basis: `₹${fmtIN(selectedPanel.lowPerKw)}–${fmtIN(selectedPanel.highPerKw)} per kWp`,
      },
      {
        name: `Inverter · ${selectedInverter.name}`,
        low: selectedInverter.lowPerKw,
        high: selectedInverter.highPerKw,
        basis: `₹${fmtIN(selectedInverter.lowPerKw)}–${fmtIN(selectedInverter.highPerKw)} per kW`,
      },
      { name: "ACDB + DCDB protection", low: 2_000, high: 3_000, basis: "₹2,000–3,000 per kW" },
      { name: "Earthing & bonding", low: 1_400, high: 2_200, basis: "₹1,400–2,200 per kW allowance" },
      { name: "Lightning arrestor & surge protection", low: 800, high: 1_300, basis: "₹800–1,300 per kW allowance" },
      { name: "Mounting, cabling & installation", low: 10_000, high: 14_000, basis: "₹10,000–14,000 per kW allowance" },
    ]
    return perKw.map((item) => ({
      name: item.name,
      quantity: `${solarKw.toFixed(2)} kW system`,
      basis: item.basis,
      low: solarKw * item.low,
      high: solarKw * item.high,
    }))
  }, [solarKw, selectedInverter, selectedPanel])

  const rainLines = useMemo<EstimateLine[]>(() => {
    if (rainLitres <= 0) return []
    const filterUnits = Math.max(1, Math.ceil(rainLitres / 5_000))
    const pipeMetres = Math.max(6, downpipes * 3)
    return [
      {
        name: "Storage tank / sump allowance",
        quantity: `${fmtIN(rainLitres)} L assessed storage`,
        basis: "₹5–8 per litre; tank/sump specification varies",
        low: rainLitres * 5,
        high: rainLitres * 8,
      },
      {
        name: "Leaf mesh / inlet screens",
        quantity: `${downpipes} downpipe ${downpipes === 1 ? "point" : "points"}`,
        basis: "₹250–450 per point",
        low: downpipes * 250,
        high: downpipes * 450,
      },
      {
        name: "First-flush diverter",
        quantity: `${downpipes} diverter ${downpipes === 1 ? "set" : "sets"}`,
        basis: "₹650–1,100 per set",
        low: downpipes * 650,
        high: downpipes * 1_100,
      },
      {
        name: "Sand + charcoal filter",
        quantity: `${filterUnits} filter ${filterUnits === 1 ? "module" : "modules"} (up to 5,000 L each)`,
        basis: "₹2,200–3,500 per module",
        low: filterUnits * 2_200,
        high: filterUnits * 3_500,
      },
      {
        name: "PVC downpipe & fittings",
        quantity: `Approx. ${pipeMetres} m from ${downpipes} downpipe ${downpipes === 1 ? "point" : "points"}`,
        basis: "₹200–300 per metre, fittings allowance included",
        low: pipeMetres * 200,
        high: pipeMetres * 300,
      },
      {
        name: "Recharge-pit civil work",
        quantity: `${fmtIN(rechargeLitres)} L assessed recharge target`,
        basis: "₹3,500–5,500 per 1,000 L of target capacity",
        low: rechargeLitres / 1_000 * 3_500,
        high: rechargeLitres / 1_000 * 5_500,
      },
    ]
  }, [downpipes, rainLitres, rechargeLitres])

  const solarTotal = useMemo(() => totalOf(solarLines), [solarLines])
  const rainTotal = useMemo(() => totalOf(rainLines), [rainLines])
  const combinedTotal = useMemo<EstimateTotal>(() => ({
    low: solarTotal.low + rainTotal.low,
    high: solarTotal.high + rainTotal.high,
  }), [solarTotal, rainTotal])

  const scopeOptions: { id: QuoteScope; label: string; total: EstimateTotal }[] = [
    ...(solarKw > 0 ? [{ id: "solar" as const, label: "Solar only", total: solarTotal }] : []),
    { id: "rain", label: "Rainwater only", total: rainTotal },
    ...(solarKw > 0 ? [{ id: "combined" as const, label: "Solar + rainwater", total: combinedTotal }] : []),
  ]
  const activeScope = scopeOptions.some((option) => option.id === scope) ? scope : "rain"
  const selectedScope = scopeOptions.find((option) => option.id === activeScope) ?? scopeOptions[0]
  const quoteValue = Number(quote)
  const hasQuote = quote.trim() !== "" && Number.isFinite(quoteValue) && quoteValue > 0
  const quoteStatus: "fair" | "high" | "low" | null = !hasQuote ? null
    : quoteValue > selectedScope.total.high ? "high"
      : quoteValue < selectedScope.total.low ? "low" : "fair"

  const discoms = r.location.discoms ?? config?.odisha?.discoms ?? {}
  const currentDiscom = r.location.discom
  const district = r.location.district
  const nearest = r.location.nearest

  return (
    <div className="space-y-3.5">
      <section className="overflow-hidden rounded-2xl border border-sage-200 bg-gradient-to-br from-sage-50 via-card to-water-soft/50 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/80 text-sage-700 shadow-sm">
            <ClipboardList className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.14em] text-sage-700 uppercase">Planning estimate</div>
            <h2 className="mt-1 font-heading text-2xl font-medium tracking-tight">Auto BOM & fair-quote check</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/70">
              An itemized starting point for this roof, scaled to the assessed solar system and rainwater storage—not a vendor quote or endorsement.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/80 bg-white/75 px-3 py-2.5">
            <div className="text-[11px] font-medium text-muted-foreground">Assessed solar</div>
            <div className="mt-0.5 font-heading text-xl font-medium tabular-nums">{solarKw.toFixed(2)} <span className="text-sm">kW</span></div>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/75 px-3 py-2.5">
            <div className="text-[11px] font-medium text-muted-foreground">Storage tank / sump</div>
            <div className="mt-0.5 font-heading text-xl font-medium tabular-nums">{fmtIN(rainLitres)} <span className="text-sm">L</span></div>
          </div>
          <div className="col-span-2 rounded-xl border border-white/80 bg-white/75 px-3 py-2.5 sm:col-span-1">
            <div className="text-[11px] font-medium text-muted-foreground">Recharge target · ODA rule</div>
            <div className="mt-0.5 font-heading text-xl font-medium tabular-nums">{fmtIN(rechargeLitres)} <span className="text-sm">L</span></div>
          </div>
        </div>
      </section>

      <SectionCard title="Solar bill of materials" subtitle="Choose the quoted module and inverter type to tune the installed-system estimate"
        right={<Pill tone="peach">{solarKw.toFixed(2)} kW</Pill>}>
        {solarKw > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {PANEL_OPTIONS.map((option) => (
                <button key={option.id} type="button" aria-pressed={panelType === option.id} onClick={() => setPanelType(option.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    panelType === option.id ? "border-sun-ink/40 bg-sun-soft ring-1 ring-sun-ink/20" : "border-border bg-card hover:bg-muted/50",
                  )}>
                  <span className="block text-sm font-bold">{option.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{option.short}</span>
                  <span className="mt-2 block text-xs font-semibold tabular-nums">{rupees(option.lowPerKw)}–{rupees(option.highPerKw)} / kWp</span>
                </button>
              ))}
            </div>

            <label className="mt-3 block text-xs font-semibold" htmlFor="bom-inverter-type">Inverter type</label>
            <select id="bom-inverter-type" value={inverterType} onChange={(event) => setInverterType(event.target.value as InverterType)}
              className="mt-1.5 h-11 w-full rounded-xl border bg-card px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring">
              {INVERTER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.name} — {option.detail}</option>
              ))}
            </select>

            <div className="mt-4">
              <EstimateLines lines={solarLines} />
              {inverterType === "hybrid" && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
                  <Info className="mt-0.5 size-4 shrink-0" /> Hybrid estimate excludes the battery pack and backup wiring; ask the vendor to itemize those separately.
                </p>
              )}
              <TotalBand label="Solar estimate · before subsidy" total={solarTotal} tone="sun" />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">The allowance includes mounting, cabling and installation. Subsidies, meter upgrades, roof repairs and unusual civil/electrical work are not deducted or included.</p>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
            This assessment has no installable solar capacity. The solar line items are omitted from the quote comparison; the rainwater BOM remains available.
          </div>
        )}
      </SectionCard>

      <SectionCard title="Rainwater bill of materials" subtitle={`${fmtIN(rainLitres)} L assessed storage · ${fmtIN(rechargeLitres)} L recharge target`}
        right={<Pill tone="water">{fmtIN(rainLitres)} L</Pill>}>
        <EstimateLines lines={rainLines} />
        <TotalBand label="Rainwater estimate · before CHHATA subsidy" total={rainTotal} tone="water" />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Storage tank/sump price is a broad allowance. Pipe run is approximated from the assessed downpipe count; confirm site lengths, filter flow-rate and recharge-pit design with a local installer.
        </p>
      </SectionCard>

      <SectionCard title="Check a vendor quote" subtitle="Compare like-for-like scope against the itemized pre-subsidy estimate"
        right={<ShieldCheck className="size-5 text-sage-600" />}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quote comparison scope">
          {scopeOptions.map((option) => (
            <button key={option.id} type="button" aria-pressed={activeScope === option.id} onClick={() => setScope(option.id)}
              className={cn(
                "min-h-10 rounded-xl border px-3 text-xs font-semibold transition",
                activeScope === option.id ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}>
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm font-semibold" htmlFor="vendor-quote">Vendor quote amount</label>
        <div className="mt-1.5 flex h-12 items-center rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
          <span className="mr-2 text-sm font-semibold text-muted-foreground">₹</span>
          <input id="vendor-quote" type="number" inputMode="decimal" min="0" step="1000" value={quote}
            onChange={(event) => setQuote(event.target.value)} placeholder="Enter total quote amount"
            className="h-full min-w-0 flex-1 bg-transparent text-base font-semibold tabular-nums outline-none placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">{selectedScope.label} estimate</span>
          <span className="text-sm font-bold tabular-nums">{priceRange(selectedScope.total)}</span>
        </div>

        {quoteStatus && (
          <div className={cn(
            "mt-3 rounded-xl border p-3.5",
            quoteStatus === "fair" ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : quoteStatus === "high" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-amber-200 bg-amber-50 text-amber-950",
          )} role="status" aria-live="polite">
            <div className="flex items-start gap-2.5">
              {quoteStatus === "fair" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" />}
              <div>
                <div className="text-sm font-bold">
                  {quoteStatus === "fair" ? "Looks fair — within the estimate range"
                    : quoteStatus === "high" ? "Overpriced vs this estimate"
                      : "Below estimate — verify the scope carefully"}
                </div>
                <p className="mt-1 text-xs leading-relaxed">
                  Your quote is {rupees(quoteValue)}. {quoteStatus === "high"
                    ? `It is ${rupees(quoteValue - selectedScope.total.high)} above the top of this estimate. Ask for a line-by-line specification and warranty before deciding.`
                    : quoteStatus === "low"
                      ? `It is ${rupees(selectedScope.total.low - quoteValue)} below the lower estimate. Check that equipment, installation, taxes and warranty are not missing.`
                      : "It falls between the low and high itemized estimates. Check equipment brands, warranties, taxes and inclusions before signing."}
                </p>
              </div>
            </div>
          </div>
        )}
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" /> Indicative planning ranges only, not live market pricing. Enter a pre-subsidy quote for the same equipment, installation and tax scope. A price outside the range is a prompt to review the quote—not proof of overcharging.
        </p>
      </SectionCard>

      <SectionCard title="District vendor & utility guide" subtitle="Official Odisha links for scheme guidance and the local electricity distributor"
        right={<MapPinned className="size-5 text-sage-600" />}>
        <div className="rounded-xl border border-sage-200 bg-sage-50/70 p-3.5">
          <div className="flex items-start gap-2.5">
            <MapPinned className="mt-0.5 size-4 shrink-0 text-sage-700" />
            <div className="min-w-0">
              <div className="text-sm font-bold">
                {district ? `${district} district` : "District not resolved"}
                {currentDiscom && <span className="font-medium"> · {currentDiscom}</span>}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {nearest ? `Location estimate is matched to the nearest bundled district point (${nearest}${r.location.km_away != null ? `, about ${fmtIN(r.location.km_away)} km away` : ""}). ` : ""}
                Confirm the actual DISCOM from your electricity bill or service connection; district mapping here is approximate, not a boundary lookup.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISCOM_GUIDES.map(({ code, url }) => {
            const discom = discoms[code]
            const active = currentDiscom === code
            return (
              <div key={code} className={cn("rounded-xl border p-3", active ? "border-sage-300 bg-sage-50/70" : "bg-card")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold tracking-wide">{code}</span>
                  {active && <Pill>Estimated service area</Pill>}
                </div>
                <div className="mt-1 text-xs font-medium leading-snug">{discom?.name ?? code}</div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{discom?.areas ?? "Check the utility site for its current service area."}</p>
                <a href={discom?.site ?? url} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sage-700 underline-offset-2 hover:underline">
                  Official DISCOM guidance <ExternalLink className="size-3" />
                </a>
              </div>
            )
          })}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href="https://oredaodisha.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 transition hover:bg-secondary">
            <span><span className="block text-sm font-semibold">OREDA</span><span className="text-xs text-muted-foreground">Solar scheme and empanelled-vendor guidance</span></span>
            <ArrowUpRight className="size-4 shrink-0" />
          </a>
          <a href="https://pmsuryaghar.gov.in/" target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 transition hover:bg-secondary">
            <span><span className="block text-sm font-semibold">PM Surya Ghar</span><span className="text-xs text-muted-foreground">National rooftop-solar portal</span></span>
            <ArrowUpRight className="size-4 shrink-0" />
          </a>
          <a href={r.rain.chhata.portal} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 transition hover:bg-secondary sm:col-span-2">
            <span><span className="block text-sm font-semibold">CHHATA rooftop rainwater scheme</span><span className="text-xs text-muted-foreground">Check current eligibility, ULB coverage and application steps</span></span>
            <ArrowUpRight className="size-4 shrink-0" />
          </a>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          No vendor names are listed here. Confirm current empanelment, registration and scheme eligibility directly with OREDA and your DISCOM before making an advance payment.
        </p>
      </SectionCard>
    </div>
  )
}
