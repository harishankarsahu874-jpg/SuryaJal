import type { ComponentType } from "react"
import {
  BookmarkCheck,
  Check,
  CloudSun,
  Cpu,
  FileText,
  HandCoins,
  Leaf,
  QrCode,
  Satellite,
  ScanLine,
  ShieldCheck,
  Sun,
  Waves,
  Zap,
} from "lucide-react"
import { Link } from "react-router-dom"
import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// These sections keep the landing-page promise connected to the real workflow:
// understand the two assessments, see the take-home report, then check the data.
export function SolarRainwaterSection() {
  return (
    <section id="solar-and-rainwater" aria-labelledby="modules-heading" className="px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="TWO MODULES, ONE ROOF" title="Solar and rainwater, sized for your home" id="modules-heading" />

        <div className="mt-10 grid items-stretch gap-4 lg:mt-14 lg:grid-cols-2 lg:gap-5">
          <ModuleCard
            icon={Sun}
            title="Rooftop solar"
            description="Recommended kW, panel count and a month-by-month generation curve from NASA POWER sunlight data for your district."
            bullets={[
              "Your OERC bill before and after, slab by slab",
              "Cost after PM Surya Ghar + Odisha SFA subsidy",
              "Net metering: credits, the 90% cap and March settlement",
              "Payback, IRR, 25-year savings, CO₂ and trees equivalent",
            ]}
            chart="solar"
          />
          <ModuleCard
            icon={Waves}
            title="Rainwater harvesting"
            description="Roof area × rainfall × runoff coefficient gives your yearly harvest — month by month."
            bullets={[
              "Storage tank and recharge-well size",
              "Odisha rule check: 60 L per m² of roof (ODA Rules 2020)",
              "CHHATA subsidy: 50% of the cost, up to ₹55,000",
              "Tanker and water-bill savings",
            ]}
            chart="rain"
          />
        </div>
      </div>
    </section>
  )
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-bold tracking-[0.2em] text-sage-600 uppercase">{eyebrow}</p>
      <h2 id={id} className="font-heading mt-3 text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl lg:text-[2.8rem]">
        {title}
      </h2>
    </div>
  )
}

type ModuleCardProps = {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  bullets: string[]
  chart: "solar" | "rain"
}

function ModuleCard({ icon: Icon, title, description, bullets, chart }: ModuleCardProps) {
  const isSolar = chart === "solar"
  return (
    <article className={cn(
      "flex min-h-[31rem] flex-col overflow-hidden rounded-[2rem] border p-6 sm:p-8 lg:p-9",
      isSolar ? "border-[#f0e2d0] bg-[#fff6eb]" : "border-[#dceaf0] bg-[#eff7fb]",
    )}>
      <div className={cn(
        "grid size-14 place-items-center rounded-full",
        isSolar ? "bg-sun text-white" : "bg-water text-white",
      )}>
        <Icon className="size-6" />
      </div>
      <h3 className="font-heading mt-6 text-[1.55rem] leading-tight font-medium tracking-tight">{title}</h3>
      <p className="mt-2.5 max-w-lg text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      <ul className="mt-5 space-y-2.5">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2.5 text-sm leading-relaxed sm:text-[15px]">
            <span className={cn(
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
              isSolar ? "border-[#bd7c38] text-[#9a5721]" : "border-water text-water-ink",
            )}>
              <Check className="size-3.5" strokeWidth={2.5} />
            </span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <SeasonalChart kind={chart} />
    </article>
  )
}

const SOLAR_BARS = [54, 58, 76, 83, 92, 62, 53, 56, 60, 66, 53, 48]
const RAIN_BARS = [5, 6, 7, 12, 28, 52, 82, 80, 67, 43, 18, 8]

function SeasonalChart({ kind }: { kind: "solar" | "rain" }) {
  const isSolar = kind === "solar"
  const bars = isSolar ? SOLAR_BARS : RAIN_BARS
  const label = isSolar ? "Illustrative monthly solar generation" : "Illustrative monthly rainwater harvest"
  return (
    <figure className="mt-auto pt-8" role="img" aria-label={`${label} for a demo roof in Bhubaneswar`}>
      <div aria-hidden="true" className="flex h-24 items-end gap-1.5 border-b border-foreground/10 sm:gap-2">
        {bars.map((height, i) => (
          <span key={i} className="flex h-full flex-1 items-end">
            <span
              className={cn(
                "block w-full rounded-t-[0.65rem] transition-[height] duration-500",
                isSolar
                  ? i === 4 ? "bg-earth" : "bg-sun/35"
                  : i === 6 || i === 7 ? "bg-water-ink" : "bg-water/25",
              )}
              style={{ height: `${height}%` }}
            />
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground sm:text-[11px]">
        <span>Jan</span>
        <span className="text-center">Demo roof · Bhubaneswar</span>
        <span>Dec</span>
      </figcaption>
      <span className="sr-only">Month-by-month values vary with local weather and roof conditions.</span>
    </figure>
  )
}

export function ReportSection() {
  return (
    <section id="green-roof-report" aria-labelledby="report-heading" className="px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto grid max-w-6xl items-center gap-8 overflow-hidden rounded-[2rem] border border-sage-200/80 bg-[#edf3ea] px-5 py-9 sm:px-9 sm:py-12 md:grid-cols-[1.1fr_0.9fr] md:gap-5 md:px-12 lg:px-14">
        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-sage-200/70 bg-white/90 px-3 py-1.5 text-sm font-semibold text-sage-800 shadow-sm">
            <FileText className="size-4" /> Green Roof Report
          </span>
          <h2 id="report-heading" className="font-heading mt-5 max-w-3xl text-3xl leading-[1.1] font-medium tracking-tight text-balance sm:text-4xl lg:text-[2.55rem]">
            A clear PDF report any home, school or institution can act on
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Satellite photo with the outline and panel layout, savings, subsidy, rainwater plan, a Green Score and a QR code to reopen it on any phone. Sign in to keep every roof you check in <b className="font-semibold text-foreground">My roofs.</b>
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <FeaturePill icon={QrCode}>QR to take it home</FeaturePill>
            <FeaturePill icon={FileText}>Sources printed on it</FeaturePill>
            <FeaturePill icon={BookmarkCheck}>Save to My roofs</FeaturePill>
          </div>
          <Button asChild className="mt-7 h-11 rounded-xl px-5 font-semibold shadow-sm">
            <Link to="/app">Build my report <span aria-hidden="true">→</span></Link>
          </Button>
        </div>

        <div className="relative mx-auto flex w-full max-w-[390px] items-center justify-center px-5 pt-2 md:max-w-none md:justify-end md:pr-2 md:pt-0">
          <div aria-hidden="true" className="absolute inset-x-10 top-8 bottom-0 rounded-full bg-sage-300/45 blur-3xl" />
          <img
            src="/images/sample-report.webp"
            alt="Sample Green Roof Report with a satellite roof photo, solar and rainwater estimates, Green Score and QR code"
            loading="lazy"
            decoding="async"
            className="relative w-full max-w-[330px] -rotate-2 rounded-xl border border-black/10 bg-white shadow-[0_28px_60px_-24px_rgba(24,34,28,.42)] transition-transform duration-500 hover:rotate-0 sm:max-w-[360px]"
          />
        </div>
      </div>
    </section>
  )
}

function FeaturePill({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/90 bg-white/90 px-3 py-2 text-xs font-semibold text-sage-800 shadow-sm sm:text-[13px]">
      <Icon className="size-4 text-sage-700" /> {children}
    </span>
  )
}

const PROOF_ITEMS: { eyebrow: string; title: string; detail: string; icon: ComponentType<{ className?: string }> }[] = [
  {
    eyebrow: "ROOF AI",
    title: "MobileSAM (Segment Anything)",
    detail: "ONNX Runtime · CPU · 44.7 MB · warmed before use",
    icon: ScanLine,
  },
  {
    eyebrow: "IMAGERY",
    title: "Esri World Imagery",
    detail: "Zoom 19 ≈ 0.28 m per pixel",
    icon: Satellite,
  },
  {
    eyebrow: "CLIMATE",
    title: "NASA POWER 2001–2020",
    detail: "32 Odisha towns — every district — cached for offline demos",
    icon: CloudSun,
  },
  {
    eyebrow: "SUBSIDIES",
    title: "PM Surya Ghar + Odisha SFA",
    detail: "₹78k central + ₹60k state at 3 kW · up to ₹1.38 lakh",
    icon: HandCoins,
  },
  {
    eyebrow: "TARIFF",
    title: "OERC domestic FY 2026–27",
    detail: "₹2.90 / 4.70 / 5.70 / 6.10 per unit (telescopic) + ₹20/kW/month + 4% duty. Export: ₹3.59/unit · 90% credit cap.",
    icon: Zap,
  },
  {
    eyebrow: "WATER RULE",
    title: "ODA Rules 2020 · 6 m³ recharge per 100 m² of roof",
    detail: "60 L per m² · CHHATA subsidy up to ₹55,000",
    icon: Waves,
  },
  {
    eyebrow: "GRID CO₂",
    title: "0.71 kg per unit",
    detail: "CEA CO₂ Baseline Database v21",
    icon: Leaf,
  },
  {
    eyebrow: "STACK",
    title: "FastAPI · React · Leaflet",
    detail: "Tailwind CSS · shadcn/ui · motion · ReportLab",
    icon: Cpu,
  },
  {
    eyebrow: "PRIVACY",
    title: "No sign-up needed",
    detail: "Optional accounts: SQLite + scrypt, tokens hashed",
    icon: ShieldCheck,
  },
]

export function UnderTheHoodSection() {
  return (
    <section id="under-the-hood" aria-labelledby="under-the-hood-heading" className="px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="UNDER THE HOOD" title="Real data, open maths, every source cited" id="under-the-hood-heading" />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3 lg:gap-4">
          {PROOF_ITEMS.map((item) => <ProofCard key={item.eyebrow} {...item} />)}
        </div>
      </div>
    </section>
  )
}

function ProofCard({ eyebrow, title, detail, icon: Icon }: (typeof PROOF_ITEMS)[number]) {
  return (
    <article className="group flex min-h-[145px] gap-3.5 rounded-[1.6rem] border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-sage-700">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{eyebrow}</p>
        <h3 className="font-heading mt-1 text-[1.02rem] leading-snug font-medium tracking-tight sm:text-[1.08rem]">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </article>
  )
}

export function CallToActionBand() {
  return (
    <section aria-labelledby="cta-heading" className="px-4 pt-6 pb-14 sm:px-6 sm:pt-8 sm:pb-16">
      <div className="relative mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-[2rem] bg-sage-900 px-5 py-12 text-center text-white sm:px-10 sm:py-14 lg:py-16">
        <div aria-hidden="true" className="absolute -top-32 left-1/2 size-[540px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(233,162,59,.23),transparent_62%)]" />
        <span className="relative grid size-[4.5rem] place-items-center rounded-2xl bg-white/10 shadow-inner ring-1 ring-white/10">
          <LogoMark className="size-14" title="SuryaJal" />
        </span>
        <h2 id="cta-heading" className="font-heading relative mt-6 text-4xl leading-tight font-medium tracking-tight sm:text-5xl">
          Your roof is waiting.
        </h2>
        <p className="relative mt-3 max-w-xl text-[15px] leading-relaxed text-white/75 sm:text-base">
          Find your house, tap the roof and take home your Green Roof Report — in under a minute.
        </p>
        <div className="relative mt-7 flex w-full flex-col justify-center gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
          <Button asChild className="h-12 rounded-xl bg-white px-6 text-[15px] font-semibold text-sage-900 shadow-sm hover:bg-sage-100">
            <Link to="/app">Check my roof <span aria-hidden="true">→</span></Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl border-white/25 bg-white/5 px-6 text-[15px] font-semibold text-white hover:bg-white/10 hover:text-white">
            <Link to="/signup">Create free account</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
