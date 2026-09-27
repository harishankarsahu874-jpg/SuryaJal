import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { animate, motion, useInView, useReducedMotion } from "motion/react"
import {
  ArrowRight, BadgeCheck, BrainCircuit, CheckCircle2, CloudSun, Cpu, Droplets, FileText, Hourglass, IndianRupee, Leaf,
  QrCode, Satellite, ScanLine, Search, ShieldCheck, Sparkles, SolarPanel, Sun, Waves, Zap,
} from "lucide-react"
import StackSpread from "@/components/ui/stack-spread"
import { LogoMark } from "@/components/brand/logo"
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome"
import { Button } from "@/components/ui/button"
import { api, type Health } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtIN } from "@/lib/format"
import { cn } from "@/lib/utils"

// the bundled Bhubaneswar demo roof: 177 m², 2.70 kW, 250 units/month (NASA POWER 2001-2020)
const DEMO_GEN = [277, 296, 363, 384, 394, 301, 260, 266, 276, 300, 275, 259]
const DEMO_RAIN = [1634, 2529, 3501, 6143, 15403, 31709, 51669, 51389, 43317, 24644, 3523, 1447]

export default function LandingPage({ onReplayIntro }: { onReplayIntro: () => void }) {
  useEffect(() => { document.title = "SuryaJal — AI rooftop solar + rainwater planner for Odisha" }, [])
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader transparent />
      <Hero />
      <StatsStrip />
      <StackSpread
        id="story"
        bgColor="#eef2eb"
        textColor="#1b261f"
        cardRadius={14}
        action={
          <Button asChild className="h-11 rounded-xl px-5 font-semibold">
            <Link to="/app">Measure my roof <ArrowRight /></Link>
          </Button>
        }
      />
      <HowItWorks />
      <Features />
      <Specs />
      <CtaBand />
      <SiteFooter onReplayIntro={onReplayIntro} />
    </div>
  )
}

// ------------------------------------------------------------------ hero
function Hero() {
  const reduce = useReducedMotion()
  const fade = (d: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: d, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  })
  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 lg:pb-24">
      <div aria-hidden className="absolute inset-0 -z-0 opacity-60"
        style={{
          backgroundImage: "linear-gradient(rgba(86,115,90,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(86,115,90,.09) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
        }} />
      <div aria-hidden className="absolute -top-40 -right-40 size-[620px] rounded-full bg-[radial-gradient(circle,rgba(233,162,59,.18),transparent_60%)]" />
      <div aria-hidden className="absolute top-60 -left-52 size-[560px] rounded-full bg-[radial-gradient(circle,rgba(61,131,168,.14),transparent_60%)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <motion.h1 {...fade(0.08)} className="font-heading text-[2.7rem] leading-[1.02] font-medium tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.1rem]">
            Every roof is a{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10">power plant</span>
              <span aria-hidden className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.28em] rounded-full bg-sun/40" />
            </span>{" "}
            and a{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10">rain reservoir</span>
              <span aria-hidden className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.28em] rounded-full bg-water/30" />
            </span>
            .
          </motion.h1>
          <motion.p {...fade(0.2)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
            Tap your house on a satellite map. On-device AI outlines the roof in about a second, then NASA climate data sizes
            your solar plant and rainwater tank — with the OERC slab tariff, the PM Surya Ghar + Odisha SFA subsidies, net
            metering and the Odisha rainwater rule built in.
          </motion.p>
          <motion.div {...fade(0.28)} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-xl px-6 text-[15px] font-semibold shadow-lg shadow-sage-700/20">
              <Link to="/app">Check my roof <ArrowRight /></Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-xl bg-card px-6 text-[15px] font-semibold">
              <Link to="/app?demo=1"><Sparkles className="text-sun-ink" /> Try the demo roof</Link>
            </Button>
          </motion.div>
          <motion.div {...fade(0.32)} className="mt-6 flex flex-wrap gap-1.5">
            {["TPCODL", "TPNODL", "TPWODL", "TPSODL", "All 30 districts"].map((t) => (
              <span key={t} className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-semibold text-sage-700">{t}</span>
            ))}
          </motion.div>
          <motion.ul {...fade(0.36)} className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["No sign-up needed", "Free PDF report", "Works on any phone"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-sage-600" /> {t}</li>
            ))}
          </motion.ul>
        </div>

        <PhoneShowcase />
      </div>
    </section>
  )
}

function PhoneShowcase() {
  const reduce = useReducedMotion()
  const chip = (d: number) => ({
    initial: { opacity: 0, scale: reduce ? 1 : 0.85, y: reduce ? 0 : 10 },
    animate: { opacity: 1, scale: 1, y: 0 },
    transition: { delay: d, type: "spring" as const, stiffness: 260, damping: 20 },
  })
  return (
    <div className="relative mx-auto w-full max-w-[420px] lg:mr-0">
      <div aria-hidden className="absolute inset-x-6 top-10 bottom-4 rounded-[3rem] bg-gradient-to-br from-sage-300/60 via-sage-200/40 to-sky-200/50 blur-2xl" />
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 30, rotate: reduce ? 0 : 2 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ delay: 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto w-[300px] rounded-[2.6rem] border-[10px] border-sage-950 bg-sage-950 shadow-[0_40px_80px_-30px_rgba(24,34,28,.55)] sm:w-[320px]"
      >
        <div className="absolute top-2 left-1/2 z-10 size-3 -translate-x-1/2 rounded-full bg-sage-950 ring-2 ring-sage-900/40" />
        <div className="aspect-[390/844] overflow-hidden rounded-[2rem] bg-background">
          <img src="/images/app-phone.webp?v=2" alt="The SuryaJal dashboard on a phone" className="size-full object-cover object-top" />
        </div>
      </motion.div>

      <motion.div {...chip(0.7)} className="absolute top-[22%] -left-2 sm:-left-14">
        <FloatChip icon={ScanLine} tone="sun" title="Roof found" value="in 1.2 s" delay={0} />
      </motion.div>
      <motion.div {...chip(0.85)} className="absolute top-[40%] -right-2 sm:-right-10">
        <FloatChip icon={SolarPanel} tone="sage" title="2.70 kWp" value="5 panels · Bhubaneswar" delay={1.2} />
      </motion.div>
      <motion.div {...chip(1)} className="absolute bottom-[24%] -left-3 sm:-left-14">
        <FloatChip icon={Droplets} tone="water" title="2.37 lakh L" value="rain / year" delay={0.6} />
      </motion.div>
      <motion.div {...chip(1.15)} className="absolute -right-1 bottom-[8%] sm:-right-10">
        <FloatChip icon={Hourglass} tone="sage" title="1.3 yrs" value="payback with subsidy" delay={1.8} />
      </motion.div>
    </div>
  )
}

function FloatChip({ icon: Icon, title, value, tone, delay }: {
  icon: ComponentType<{ className?: string }>; title: string; value: string; tone: "sun" | "sage" | "water"; delay: number
}) {
  return (
    <div className="animate-float flex items-center gap-2.5 rounded-2xl border bg-card/95 py-2 pr-3.5 pl-2 shadow-xl backdrop-blur"
      style={{ animationDelay: `${delay}s` }}>
      <span className={cn("grid size-9 place-items-center rounded-xl",
        tone === "sun" ? "bg-sun-soft text-sun-ink" : tone === "water" ? "bg-water-soft text-water-ink" : "bg-secondary text-sage-700")}>
        <Icon className="size-[18px]" />
      </span>
      <span className="leading-tight">
        <span className="font-heading block text-[15px] font-semibold">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{value}</span>
      </span>
    </div>
  )
}

// ------------------------------------------------------------------ stats
function Counter({ to, format }: { to: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const [text, setText] = useState(format(0))
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!inView) return
    if (reduce) { setText(format(to)); return }
    const c = animate(0, to, { duration: 1.4, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setText(format(v)) })
    return () => c.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, to, reduce])
  return <span ref={ref} className="tabular">{text}</span>
}

function StatsStrip() {
  const items: { v: ReactNode; l: string; icon: ComponentType<{ className?: string }> }[] = [
    { v: <Counter to={1.2} format={(v) => `${v.toFixed(1)} s`} />, l: "AI roof outline on a laptop CPU", icon: BrainCircuit },
    { v: <Counter to={138000} format={(v) => `₹${fmtIN(v)}`} />, l: "Max subsidy at 3 kW: PM Surya Ghar + Odisha SFA", icon: IndianRupee },
    { v: <Counter to={25} format={(v) => `${Math.round(v)} yrs`} />, l: "Savings modelled, with degradation", icon: Zap },
    { v: <Counter to={60} format={(v) => `< ${Math.round(v)} s`} />, l: "From address to PDF report", icon: FileText },
  ]
  return (
    <section className="border-y bg-card">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border md:grid-cols-4">
        {items.map((it) => (
          <div key={it.l} className="flex items-center gap-3.5 bg-card px-4 py-6 sm:px-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-sage-700"><it.icon className="size-5" /></span>
            <div>
              <div className="font-heading text-2xl font-medium sm:text-3xl">{it.v}</div>
              <div className="text-xs leading-snug text-muted-foreground sm:text-[13px]">{it.l}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ how it works
function HowItWorks() {
  const steps = [
    { icon: Search, t: "Find your house", d: "Search your area or landmark, paste coordinates, or tap “my location”. The satellite map zooms to your street." },
    { icon: ScanLine, t: "Tap the roof", d: "MobileSAM (Segment Anything) traces the outline in about a second. Add or remove parts with a tap — or draw it by hand." },
    { icon: FileText, t: "Get your plan", d: "Solar kW, panels, subsidy, payback and the rain tank + recharge well appear instantly — with a 3-page PDF (map, solar, rainwater) and QR code." },
  ]
  return (
    <section id="how" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="How it works" title="Three taps from address to action plan" />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div key={s.t}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="group relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              <span className="font-heading absolute -top-4 right-3 text-[6.5rem] leading-none font-semibold text-sage-100 transition group-hover:text-sage-200">{i + 1}</span>
              <span className="relative grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-sage-700/20">
                <s.icon className="size-[22px]" />
              </span>
              <h3 className="font-heading relative mt-6 text-xl font-medium">{s.t}</h3>
              <p className="relative mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ features
function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-card py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="Two modules, one roof" title="Solar and rainwater, sized for your home" />
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <ModuleCard tone="sun" icon={Sun} title="Rooftop solar" lead="Recommended kW, panel count and a month-by-month generation curve from NASA POWER sunlight data for your district."
            points={["Your OERC bill before and after, slab by slab", "Cost after PM Surya Ghar + Odisha SFA subsidy",
              "Net metering: credits, the 90% cap and March settlement", "Payback, IRR, 25-year savings, CO₂ and trees equivalent"]}
            bars={DEMO_GEN} />
          <ModuleCard tone="water" icon={Droplets} title="Rainwater harvesting" lead="Roof area × rainfall × runoff coefficient gives your yearly harvest — month by month."
            points={["Storage tank and recharge-well size", "Odisha rule check: 60 L per m² of roof (ODA Rules 2020)",
              "CHHATA subsidy: 50% of the cost, up to ₹55,000", "Tanker and water-bill savings"]}
            bars={DEMO_RAIN} />
        </div>
        <div className="mt-4 grid items-center gap-8 overflow-hidden rounded-3xl border bg-gradient-to-br from-sage-50 to-sage-100 p-6 sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-sage-700 shadow-sm"><FileText className="size-3.5" /> Green Roof Report</span>
            <h3 className="font-heading mt-4 text-3xl font-medium tracking-tight">A clear PDF report any home, school or institution can act on</h3>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Satellite photo with the outline and panel layout, savings, subsidy, rainwater plan, a Green Score and a QR code to
              reopen it on any phone. Sign in to keep every roof you check in <b className="text-foreground">My roofs</b>.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[{ i: QrCode, t: "QR to take it home" }, { i: ShieldCheck, t: "Sources printed on it" }, { i: BadgeCheck, t: "Save to My roofs" }].map((x) => (
                <span key={x.t} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold"><x.i className="size-3.5 text-sage-600" />{x.t}</span>
              ))}
            </div>
          </div>
          <motion.img src="/images/sample-report.webp" alt="Sample SuryaJal Green Roof Report" loading="lazy"
            initial={{ rotate: 6, y: 30, opacity: 0 }} whileInView={{ rotate: 3, y: 0, opacity: 1 }} viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-60 rounded-lg border bg-white shadow-2xl sm:w-72 lg:-mb-24" />
        </div>
      </div>
    </section>
  )
}

function ModuleCard({ tone, icon: Icon, title, lead, points, bars }: {
  tone: "sun" | "water"; icon: ComponentType<{ className?: string }>; title: string; lead: string; points: string[]; bars: number[]
}) {
  const max = Math.max(...bars)
  const peak = bars.indexOf(max)
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6 }}
      className={cn("relative overflow-hidden rounded-3xl border p-6 sm:p-8",
        tone === "sun" ? "bg-gradient-to-br from-sun-soft/70 to-card" : "bg-gradient-to-br from-water-soft/80 to-card")}>
      <span className={cn("grid size-12 place-items-center rounded-2xl", tone === "sun" ? "bg-sun text-white" : "bg-water text-white")}>
        <Icon className="size-6" />
      </span>
      <h3 className="font-heading mt-5 text-2xl font-medium">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{lead}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-[15px]"><CheckCircle2 className={cn("mt-0.5 size-[18px] shrink-0", tone === "sun" ? "text-sun-ink" : "text-water")} /> {p}</li>
        ))}
      </ul>
      <div className="mt-7 flex h-24 items-end gap-1.5" aria-hidden>
        {bars.map((b, i) => (
          <motion.span key={i} className={cn("flex-1 rounded-t-md", i === peak ? (tone === "sun" ? "bg-earth" : "bg-water-ink") : tone === "sun" ? "bg-sun/35" : "bg-water/30")}
            initial={{ height: 0 }} whileInView={{ height: `${Math.max(6, (b / max) * 100)}%` }} viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.04, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-medium text-muted-foreground"><span>Jan</span><span>Demo roof · Bhubaneswar</span><span>Dec</span></div>
    </motion.div>
  )
}

// ------------------------------------------------------------------ specs (live from /api/health)
function Specs() {
  const [h, setH] = useState<Health | null>(null)
  const [today, setToday] = useState<{ roofs: number; kw: number; litres: number } | null>(null)
  useEffect(() => {
    api<Health>("/api/health").then(setH).catch(() => {})
    api<{ today: { roofs: number; kw: number; litres: number } }>("/api/stats").then((s) => setToday(s.today)).catch(() => {})
  }, [])
  const sp = h?.specs
  const specs = [
    { icon: BrainCircuit, k: "Roof AI", v: sp ? `${sp.model.name}` : "MobileSAM (Segment Anything)", s: sp ? `${sp.model.runtime} · ${sp.model.size_mb} MB · ${sp.model.warm ? "warm" : "warming"}` : "ONNX Runtime · CPU" },
    { icon: Satellite, k: "Imagery", v: sp?.imagery.source ?? "Esri World Imagery", s: `Zoom ${sp?.imagery.max_zoom ?? 19} ≈ ${sp?.imagery.m_per_px ?? 0.29} m per pixel` },
    { icon: CloudSun, k: "Climate", v: `${sp?.climate.source ?? "NASA POWER"} ${sp?.climate.period.replace("-", "–") ?? "2001–2020"}`, s: `${sp?.climate.offline_cities ?? 32} Odisha towns — every district — cached for offline demos` },
    { icon: IndianRupee, k: "Subsidies", v: "PM Surya Ghar + Odisha SFA", s: "₹78k central + ₹60k state at 3 kW · up to ₹1.38 lakh" },
    { icon: Zap, k: "Tariff", v: sp?.solar.tariff_label ?? "OERC domestic slabs ₹2.90–₹6.10/unit", s: `Export settled at ₹${sp?.solar.export_rate ?? 3.59}/unit (GRIDCO APPC) · ${Math.round((sp?.solar.net_meter_cap ?? 0.9) * 100)}% credit cap` },
    { icon: Waves, k: "Water rule", v: sp?.water.rule ?? "ODA Rules 2020 · 6 m³ per 100 m² of roof", s: `${sp?.water.l_per_m2 ?? 60} L per m² of roof · CHHATA subsidy up to ₹${fmtIN(sp?.water.chhata?.max_subsidy ?? 55000)}` },
    { icon: Leaf, k: "Grid CO₂", v: `${sp?.solar.co2_kg_per_kwh ?? 0.71} kg per unit`, s: "CEA CO₂ Baseline Database v21" },
    { icon: Cpu, k: "Stack", v: "FastAPI · React · Leaflet", s: "Tailwind CSS · shadcn/ui · motion · reportlab" },
    { icon: ShieldCheck, k: "Privacy", v: "No sign-up needed", s: "Optional accounts: SQLite + scrypt, tokens hashed" },
  ]
  return (
    <section id="specs" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="Under the hood" title="Real data, open maths, every source cited" />
        {today && today.roofs > 0 && (
          <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full bg-sage-900 px-4 py-2 text-sm text-white">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            Today at the fest: <b>{today.roofs}</b> roofs · <b>{today.kw.toFixed(1)} kW</b> solar · <b>{fmtIN(today.litres)} L</b> rain
          </div>
        )}
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {specs.map((s, i) => (
            <motion.div key={s.k} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ delay: (i % 3) * 0.06, duration: 0.5 }}
              className="flex items-start gap-3.5 rounded-2xl border bg-card p-4 transition hover:border-sage-300 hover:shadow-md">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-sage-700"><s.icon className="size-5" /></span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{s.k}</div>
                <div className="mt-0.5 font-semibold">{s.v}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{s.s}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CtaBand() {
  const { user } = useAuth()
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-sage-900 px-6 py-14 text-center text-white sm:px-12">
        <div aria-hidden className="absolute -top-24 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(233,162,59,.25),transparent_60%)]" />
        <LogoMark className="relative mx-auto size-16" />
        <h2 className="font-heading relative mt-6 text-4xl font-medium tracking-tight sm:text-5xl">Your roof is waiting.</h2>
        <p className="relative mx-auto mt-3 max-w-md text-white/70">Find your house, tap the roof and take home your Green Roof Report — in under a minute.</p>
        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild className="h-12 rounded-xl bg-white px-6 text-[15px] font-semibold text-sage-900 hover:bg-sage-100">
            <Link to="/app">Check my roof <ArrowRight /></Link>
          </Button>
          {!user && (
            <Button asChild variant="outline" className="h-12 rounded-xl border-white/25 bg-transparent px-6 text-[15px] font-semibold text-white hover:bg-white/10 hover:text-white">
              <Link to="/signup">Create free account</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

function SectionHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-xs font-bold tracking-[0.2em] text-sage-600 uppercase">{kicker}</span>
      <h2 className="font-heading mt-3 text-3xl font-medium tracking-[-0.025em] text-balance sm:text-[2.6rem] sm:leading-[1.1]">{title}</h2>
    </div>
  )
}
