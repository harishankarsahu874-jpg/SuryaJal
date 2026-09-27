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
            {config.engine === "mobilesam" ? "MobileSAM ready" : "OpenCV mode"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => { setTab("map"); setTimeout(() => mapApi.current?.locate(), 80) }}
            className="grid size-10 place-items-center rounded-xl text-foreground/80 transition hover:bg-secondary" aria-label="Go to my location" title="My location">
            <Crosshair className="size-5" />
          </button>
          <UserMenu compact />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* map: a full-screen tab on phones; on desktop it is capped at ~2/5 of the
            screen so the report/numbers keep the room (it used to eat 55-70%) */}
        <section className={cn("relative min-h-0 flex-1 lg:w-[40%] lg:min-w-[360px] lg:max-w-[560px] lg:flex-none",
          tab !== "map" && "max-lg:hidden")}>
          <MapPanel visible={tab === "map" || (typeof window !== "undefined" && window.innerWidth >= 1024)} />
        </section>

        {/* results panel: takes the rest of the screen */}
        <aside className={cn("flex min-h-0 w-full flex-col lg:min-w-0 lg:flex-1 lg:border-l", tab === "map" && "max-lg:hidden")}>
          <nav className="hidden shrink-0 gap-1 border-b bg-card/60 p-2 lg:flex" aria-label="Results">
            {TABS.slice(1).map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={cn(
                  "relative inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
                  panelTab === t.id ? "text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}>
                {panelTab === t.id && (
                  <motion.span layoutId="desk-tab" className="absolute inset-0 rounded-xl bg-primary shadow-sm"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                <t.icon className="relative size-4" />
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </nav>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-xl px-3.5 pt-3.5 pb-28 sm:px-5 lg:pb-8 xl:max-w-2xl 2xl:max-w-3xl">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={panelTab}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}>
                  {panelTab === "solar" ? <SolarView /> : panelTab === "rain" ? <RainView /> : <ReportView />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </aside>
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
