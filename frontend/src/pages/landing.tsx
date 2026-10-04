import { useEffect, type ComponentType } from "react"
import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "motion/react"
import { ArrowRight, Droplets, ScanLine, SolarPanel, Sparkles } from "lucide-react"
import StackSpread from "@/components/ui/stack-spread"
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome"
import { Button } from "@/components/ui/button"
import { CallToActionBand, ReportSection, SolarRainwaterSection, UnderTheHoodSection } from "@/features/landing/landing-sections"
import { cn } from "@/lib/utils"

export default function LandingPage({ onReplayIntro }: { onReplayIntro: () => void }) {
  useEffect(() => { document.title = "SuryaJal — AI rooftop solar + rainwater planner for Odisha" }, [])
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader transparent />
      <Hero />
      <StackSpread
        id="story"
        bgColor="#eef2eb"
        textColor="#1b261f"
        cardRadius={14}
        scrollLength={280}
        subtitle="Sunlight becomes electricity. Rain becomes groundwater."
        action={
          <Button asChild className="h-11 rounded-xl px-5 font-semibold">
            <Link to="/app">Measure my roof <ArrowRight /></Link>
          </Button>
        }
      />
      <SolarRainwaterSection />
      <ReportSection />
      <UnderTheHoodSection />
      <CallToActionBand />
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
    <section className="relative overflow-hidden pt-28 pb-14 sm:pt-32 lg:pb-20">
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
          <motion.p {...fade(0.2)} className="mt-6 max-w-md text-[17px] leading-relaxed text-muted-foreground">
            Tap your roof on the map. Solar and rainwater numbers, in under a minute.
          </motion.p>
          <motion.div {...fade(0.28)} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-xl px-6 text-[15px] font-semibold shadow-lg shadow-sage-700/20">
              <Link to="/app">Check my roof <ArrowRight /></Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-xl bg-card px-6 text-[15px] font-semibold">
              <Link to="/app?demo=1"><Sparkles className="text-sun-ink" /> Try the demo roof</Link>
            </Button>
          </motion.div>
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
