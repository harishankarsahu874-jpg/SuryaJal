import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { ArrowLeft, ChartColumn, Droplet, Sun } from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { UserMenu } from "@/components/site/user-menu"
import { AiAgent } from "@/features/dashboard/ai-agent"
import { MapPanel } from "@/features/dashboard/map-panel"
import { RainView } from "@/features/dashboard/rain-view"
import { ReportView } from "@/features/dashboard/report-view"
import { SolarView } from "@/features/dashboard/solar-view"
import { DashboardProvider, useDashboard, type Tab } from "@/features/dashboard/state"
import { cn } from "@/lib/utils"

/** result sections - their bar only appears once "Show More" on the map's roof card has opened them */
const SECTIONS: { id: Exclude<Tab, "map">; label: string; icon: typeof Sun }[] = [
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
  const { tab, setTab, assessing, roof } = useDashboard()
  const onMap = tab === "map"
  const panelTab: Tab = onMap ? "solar" : tab
  const scroller = useRef<HTMLDivElement>(null)
  // every section opens at its top - including when you come back to it from the map
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [tab])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
        {/* header: logo tile · name · account */}
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
        <div className="ml-auto flex items-center gap-1.5">
          {/* current location removed: browsers block GPS inside embedded previews
              and broken promises look worse than no button - search finds any place */}
          <UserMenu compact />
        </div>
      </header>

      {/* nothing sits above the map: once a roof is picked, its card's "Show More" opens the results,
          and only then does this bar appear - back to the map, solar, rainwater, report */}
      {!onMap && (
        <motion.nav initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative z-[1050] flex shrink-0 items-center gap-1 border-b bg-card/60 p-2" aria-label="Result sections">
          <button type="button" onClick={() => setTab("map")} aria-label="Back to map" title="Back to map"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <ArrowLeft className="size-4" />
            <span className="max-sm:hidden">Back to map</span>
          </button>
          <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />
          {SECTIONS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "relative inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition sm:gap-2 sm:text-sm",
                tab === t.id ? "text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}>
              {tab === t.id && (
                <motion.span layoutId="section-tab" className="absolute inset-0 rounded-xl bg-primary shadow-sm"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              <t.icon className="relative size-4 shrink-0 max-[359px]:hidden" />
              <span className="relative truncate">{t.label}</span>
            </button>
          ))}
        </motion.nav>
      )}

      <div className="flex min-h-0 flex-1">
        {/* the map, full screen - where every visit starts */}
        <section className={cn("relative min-h-0 flex-1", !onMap && "hidden")}>
          <MapPanel visible={onMap} />
        </section>

        {/* after "Show More": solar / rainwater / report, full width */}
        <div ref={scroller} className={cn("min-h-0 flex-1 overflow-y-auto", onMap && "hidden")}>
          <div className="mx-auto w-full max-w-xl px-3.5 pt-3.5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-5 lg:max-w-3xl">
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

      <AiAgent />
    </div>
  )
}
