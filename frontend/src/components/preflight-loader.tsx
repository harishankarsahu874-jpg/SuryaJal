import { useCallback, useEffect, useRef, useState, type ComponentType } from "react"
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react"
import {
  BrainCircuit, CheckCircle2, CircleAlert, CloudSun, Droplets, IndianRupee, Loader2, RotateCcw,
  Satellite, Server, XCircle,
} from "lucide-react"
import { AnimatedLogoMark } from "@/components/brand/logo"
import type { Health } from "@/lib/api"
import { fmtIN } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * "Pre-flight check" loader: the animated logo plays while the app really checks
 * the server, warms the roof AI, the climate cache, satellite imagery and the
 * subsidy / water rules - and prints each spec as it comes online.
 */

type Status = "wait" | "run" | "ok" | "warn" | "fail"
type CheckId = "server" | "ai" | "climate" | "imagery" | "solar" | "water"
interface Check {
  id: CheckId
  label: string
  icon: ComponentType<{ className?: string }>
  status: Status
  detail: string
}

const INITIAL: Check[] = [
  { id: "server", label: "SuryaJal server", icon: Server, status: "wait", detail: "FastAPI" },
  { id: "ai", label: "Roof AI", icon: BrainCircuit, status: "wait", detail: "Segment Anything" },
  { id: "climate", label: "Climate data", icon: CloudSun, status: "wait", detail: "NASA POWER" },
  { id: "imagery", label: "Satellite imagery", icon: Satellite, status: "wait", detail: "Esri World Imagery" },
  { id: "solar", label: "Solar rules", icon: IndianRupee, status: "wait", detail: "PM Surya Ghar + Odisha SFA" },
  { id: "water", label: "Rainwater rules", icon: Droplets, status: "wait", detail: "ODA Rules 2020 · CHHATA" },
]

// Esri tile over Odisha (z5) - proves the browser can reach the imagery.
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/14/23"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchHealth(timeout = 6000): Promise<{ h: Health; ms: number }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  const t0 = performance.now()
  try {
    const r = await fetch("/api/health", { signal: ctl.signal, cache: "no-store" })
    if (!r.ok) throw new Error(String(r.status))
    return { h: (await r.json()) as Health, ms: Math.round(performance.now() - t0) }
  } finally {
    clearTimeout(t)
  }
}

function probeImage(url: string, timeout = 6000) {
  return new Promise<boolean>((resolve) => {
    const img = new Image()
    const t = setTimeout(() => resolve(false), timeout)
    img.onload = () => { clearTimeout(t); resolve(true) }
    img.onerror = () => { clearTimeout(t); resolve(false) }
    img.src = `${url}?sj=${Date.now() % 100000}`
  })
}

export function PreflightLoader({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion()
  const [checks, setChecks] = useState<Check[]>(INITIAL)
  const [phase, setPhase] = useState<"running" | "done" | "failed">("running")
  const [run, setRun] = useState(0)
  const finished = useRef(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    onDone()
  }, [onDone])

  const set = useCallback((id: CheckId, patch: Partial<Check>) => {
    setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  // --------------------------------------------------------------- the real checks
  useEffect(() => {
    let alive = true
    const t0 = performance.now()
    const minTotal = reduce ? 700 : 2600
    const stagger = reduce ? 60 : 280
    setChecks(INITIAL)
    setPhase("running")

    // each row starts in turn and resolves no sooner than `minRow` after it starts
    const step = async (i: number, id: CheckId, work: () => Promise<Partial<Check>>) => {
      await sleep(i * stagger)
      if (!alive) return
      const started = performance.now()
      set(id, { status: "run" })
      let patch: Partial<Check>
      try {
        patch = await work()
      } catch {
        patch = { status: "fail", detail: "check failed" }
      }
      const wait = (reduce ? 80 : 420) - (performance.now() - started)
      if (wait > 0) await sleep(wait)
      if (alive) set(id, patch)
      return patch.status
    }

    const healthP = fetchHealth().catch(() => null)

    const tasks = [
      step(0, "server", async () => {
        const r = await healthP
        if (!r) return { status: "fail", detail: "not reachable — start it with run.bat / run.sh" }
        return { status: "ok", detail: `FastAPI · v${r.h.version} · ${r.ms} ms` }
      }),
      step(1, "ai", async () => {
        const r = await healthP
        if (!r) return { status: "fail", detail: "waiting for server" }
        const { h } = r
        if (h.engine !== "mobilesam") return { status: "warn", detail: "basic OpenCV mode (models missing)" }
        const spec = `MobileSAM · ONNX · ${h.specs.model.size_mb} MB`
        if (h.ready) return { status: "ok", detail: `${spec} · warm` }
        set("ai", { detail: `${spec} · warming up…` })
        for (let k = 0; k < 20 && alive; k++) {
          await sleep(800)
          const again = await fetchHealth(3000).catch(() => null)
          if (again?.h.ready) return { status: "ok", detail: `${spec} · warm` }
        }
        return { status: "warn", detail: `${spec} · first tap may take a few seconds` }
      }),
      step(2, "climate", async () => {
        const r = await healthP
        if (!r) return { status: "fail", detail: "waiting for server" }
        const c = r.h.specs.climate
        return { status: "ok", detail: `${c.source} ${c.period.replace("-", "–")} · ${c.offline_cities} Odisha towns offline` }
      }),
      step(3, "imagery", async () => {
        const [ok, r] = await Promise.all([probeImage(TILE), healthP])
        const mpp = r?.h.specs.imagery.m_per_px ?? 0.29
        return ok
          ? { status: "ok", detail: `Esri World Imagery · ~${mpp} m per pixel` }
          : { status: "warn", detail: "offline — you can still draw roofs by hand" }
      }),
      step(4, "solar", async () => {
        const r = await healthP
        if (!r) return { status: "fail", detail: "waiting for server" }
        const s = r.h.specs.solar
        const slabs = s.tariff_slabs ?? []
        const lo = slabs.length ? slabs[0].rate : 2.9
        const hi = slabs.length ? slabs[slabs.length - 1].rate : 6.1
        return { status: "ok", detail: `${s.scheme} ≤ ₹${fmtIN(s.max_subsidy)} · OERC ₹${lo.toFixed(2)}–${hi.toFixed(2)}/unit` }
      }),
      step(5, "water", async () => {
        const r = await healthP
        if (!r) return { status: "fail", detail: "waiting for server" }
        const w = r.h.specs.water
        return { status: "ok", detail: `${w.l_per_m2} L per m² of roof (ODA Rules 2020) · CHHATA ≤ ₹${fmtIN(w.chhata?.max_subsidy ?? 55000)}` }
      }),
    ]

    void Promise.all(tasks).then(async (statuses) => {
      if (!alive) return
      const left = minTotal - (performance.now() - t0)
      if (left > 0) await sleep(left)
      if (!alive) return
      if (statuses[0] === "fail") {
        setPhase("failed")
        return
      }
      setPhase("done")
      await sleep(reduce ? 150 : 650)
      if (alive) finish()
    })
    return () => {
      alive = false
    }
  }, [run, reduce, set, finish])

  // Esc / Enter skips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Enter" && phase !== "running")) finish()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [finish, phase])

  // progress: resolved rows (running rows count half) -> spring -> number
  const done = checks.filter((c) => c.status === "ok" || c.status === "warn" || c.status === "fail").length
  const running = checks.filter((c) => c.status === "run").length
  const target = phase === "done" ? 100 : Math.min(97, ((done + running * 0.45) / checks.length) * 100)
  const spring = useSpring(0, { stiffness: 60, damping: 18 })
  useEffect(() => { spring.set(target) }, [target, spring])
  const width = useTransform(spring, (v) => `${v}%`)
  const [pct, setPct] = useState(0)
  useEffect(() => spring.on("change", (v) => setPct(Math.round(v))), [spring])

  const warnings = checks.filter((c) => c.status === "warn").length

  return (
    <motion.div
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-hidden bg-[#101a14] px-5 text-white"
      initial={{ opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, filter: "blur(8px)" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label="SuryaJal is starting"
    >
      {/* backdrop: map grid + sage glow + radar rings */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(185,207,182,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(185,207,182,.35) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse at center, black 20%, transparent 70%)",
        }}
      />
      <div aria-hidden className="absolute top-1/2 left-1/2 size-[640px] -translate-x-1/2 -translate-y-[62%] rounded-full bg-[radial-gradient(circle,rgba(111,143,112,.35),transparent_62%)]" />
      <button
        type="button"
        onClick={finish}
        className="absolute top-4 right-4 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white/80 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        Skip intro ›
      </button>

      <div className="relative flex w-full max-w-md flex-col items-center">
        <div className="relative">
          {!reduce && [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 size-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sage-300/40"
              initial={{ scale: 0.7, opacity: 0.7 }}
              animate={{ scale: 2.8, opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, delay: i, ease: "easeOut" }}
            />
          ))}
          <AnimatedLogoMark className="relative size-28 drop-shadow-[0_10px_30px_rgba(245,158,11,.25)] sm:size-32" />
        </div>

        <motion.h1
          className="font-heading mt-4 flex text-4xl font-semibold tracking-[-0.03em] sm:text-5xl"
          aria-label="SuryaJal"
        >
          {"SuryaJal".split("").map((ch, i) => (
            <motion.span
              key={i}
              className={i >= 5 ? "text-sky-300" : "text-white"}
              initial={{ opacity: 0, y: reduce ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.5 + i * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.h1>
        <motion.p
          className="mt-2 text-[11px] font-semibold tracking-[0.32em] text-sage-300 uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.95 }}
        >
          Sun + rain, measured from space
        </motion.p>

        {/* progress */}
        <div className="mt-7 w-full" role="status" aria-live="polite">
          <div className="mb-2 flex items-end justify-between font-mono text-[11px] text-white/60">
            <span>
              {phase === "failed" ? "Pre-flight check failed" : phase === "done"
                ? warnings ? `Ready · ${warnings} warning${warnings > 1 ? "s" : ""}` : "All systems go"
                : "Pre-flight check"}
            </span>
            <span className="tabular text-lg leading-none font-semibold text-white">{String(pct).padStart(3, "0")}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-300 via-sage-300 to-sky-400"
              style={{ width }}
            />
          </div>
        </div>

        {/* checklist */}
        <ul className="mt-5 w-full space-y-1 rounded-2xl border border-white/10 bg-white/[0.04] p-2 backdrop-blur-sm">
          {checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>

        {phase === "failed" && (
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => { finished.current = false; setRun((r) => r + 1) }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-sage-900 hover:bg-sage-100"
            >
              <RotateCcw className="size-4" /> Retry
            </button>
            <button
              type="button"
              onClick={finish}
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
            >
              Continue anyway
            </button>
          </div>
        )}
      </div>

      <p className="absolute bottom-4 text-[11px] tracking-wide text-white/35">
        Renewable Energy Club · Tech Fest 2026 · Press Esc to skip
      </p>
    </motion.div>
  )
}

function CheckRow({ check }: { check: Check }) {
  const { icon: Icon, status } = check
  const tone = status === "ok" ? "text-emerald-300" : status === "warn" ? "text-amber-300"
    : status === "fail" ? "text-red-300" : status === "run" ? "text-sky-200" : "text-white/30"
  return (
    <motion.li
      layout
      className={cn(
        "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
        status === "run" && "bg-white/[0.06]",
      )}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.07]", status === "wait" && "opacity-50")}>
        <Icon className={cn("size-4", status === "wait" ? "text-white/50" : "text-white/85")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] font-semibold", status === "wait" ? "text-white/45" : "text-white/90")}>
          {check.label}
        </span>
        <span className="block truncate font-mono text-[11px] text-white/50">{check.detail}</span>
      </span>
      <span className={cn("shrink-0", tone)} aria-label={status}>
        {status === "run" ? <Loader2 className="size-4 animate-spin" />
          : status === "ok" ? <CheckCircle2 className="size-4" />
            : status === "warn" ? <CircleAlert className="size-4" />
              : status === "fail" ? <XCircle className="size-4" />
                : <span className="block size-1.5 rounded-full bg-white/25" />}
      </span>
    </motion.li>
  )
}
