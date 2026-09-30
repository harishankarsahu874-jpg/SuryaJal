import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { ChartColumn, Crosshair, Droplet, House, Sun } from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { UserMenu } from "@/components/site/user-menu"
import { MapPanel } from "@/features/dashboard/map-panel"
import { RainView } from "@/features/dashboard/rain-view"
import { ReportView } from "@/features/dashboard/report-view"
import { SolarView } from "@/features/dashboard/solar-view"
import { DashboardProvider, useDashboard, type Tab } from "@/features/dashboard/state"
import { cn } from "@/lib/utils"

const TABS: { id: Tab; label: string; icon: typeof Sun }[] = [
  { id: "map", label: "Roof Map", icon: House },
  { id: "solar", label: "Solar", icon: Sun },
  { id: "rain", label: "Rainwater", icon: Droplet },
  { id: "report", label: "Report", icon: ChartColumn },
]

export default function DashboardPage() {
  useEffect(() => {
    document.title = "SuryaJal · Roof dashboard"
  }, [])
  return (
    <DashboardProvider>
      <Dashboard />
    </DashboardProvider>
  )
}

function Dashboard() {
  const { tab, setTab, mapApi, assessing, roof, config } = useDashboard()
  const panelTab: Tab = tab === "map" ? "solar" : tab
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [panelTab])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* header: logo tile · name · locate · account */}
      <header className="relative z-[1100] flex h-16 shrink-0 items-center gap-3 border-b bg-card/95 px-3 backdrop-blur sm:px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-xl" aria-label="SuryaJal home">
          <span className="grid size-11 place-items-center rounded-xl bg-secondary">
            <LogoMark className="size-8" />
          </span>
          <span className="font-heading text-[1.3rem] leading-none font-medium tracking-tight">SuryaJal</span>
        </Link>
        <AnimatePresence>
          {assessing && roof && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="hidden items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground sm:inline-flex">
              <span className="size-1.5 animate-ping rounded-full bg-sage-600" /> Updating
            </motion.span>
          )}
        </AnimatePresence>
        {/* AI engine status (desktop) — on phones it is shown on the map instead */}
        {config && (
          <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground lg:inline-flex">
            <span className={cn("size-2 rounded-full", config.engine === "mobilesam" ? "bg-emerald-500" : "bg-amber-500")} />
            {config.engine === "mobilesam" ? "High-accuracy AI" : "Basic AI"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* current location: real browser tabs only - embedded previews can't
              ask for GPS at all, so we don't show a button there that can't work */}
          {window.self === window.top && (
            <button type="button" onClick={() => { setTab("map"); setTimeout(() => mapApi.current?.locate(), 80) }}
              className="grid size-10 place-items-center rounded-xl text-foreground/80 transition hover:bg-secondary" aria-label="Go to my location" title="My location">
              <Crosshair className="size-5" />
            </button>
          )}
          <UserMenu compact />
        </div>
      </header>

      {/* desktop: one page at a time - 1) roof map, 2) solar, 3) rainwater, 4) report */}
      <nav className="relative z-[1050] hidden shrink-0 gap-1 border-b bg-card/60 p-2 lg:flex" aria-label="Sections">
        {TABS.map((t, i) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "relative inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
              tab === t.id ? "text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}>
            {tab === t.id && (
              <motion.span layoutId="desk-tab" className="absolute inset-0 rounded-xl bg-primary shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <span className="relative text-xs opacity-70">{i + 1}</span>
            <t.icon className="relative size-4" />
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        {/* page 1: the map, full screen */}
        <section className={cn("relative min-h-0 flex-1", tab !== "map" && "hidden")}>
          <MapPanel visible={tab === "map"} />
        </section>

        {/* pages 2-4: solar / rainwater / report, full width */}
        <div ref={scroller} className={cn("min-h-0 flex-1 overflow-y-auto", tab === "map" && "hidden")}>
          <div className="mx-auto w-full max-w-xl px-3.5 pt-3.5 pb-28 sm:px-5 lg:max-w-3xl lg:pb-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={panelTab}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: "easeOut" }}>
                {panelTab === "solar" ? <SolarView /> : panelTab === "rain" ? <RainView /> : <ReportView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* bottom navigation (phones / tablets) */}
      <nav className="safe-bottom relative z-[1100] shrink-0 border-t bg-card/95 backdrop-blur lg:hidden" aria-label="Sections">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={active ? "page" : undefined}
                className="relative flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium">
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute top-1.5 h-8 w-14 rounded-full bg-secondary"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                <t.icon className={cn("relative size-[22px]", active ? "text-primary" : "text-foreground/70")} strokeWidth={active ? 2.2 : 1.8} />
                <span className={cn("relative", active ? "font-semibold text-foreground" : "text-foreground/70")}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
