import { useCallback, useEffect, useRef, useState } from "react"
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react"
import { AnimatedLogoMark } from "@/components/brand/logo"
import type { Health } from "@/lib/api"

/**
 * Clean boot intro: just the animated SuryaJal logo with a progress ring.
 * The real pre-flight work (server, roof AI, climate, imagery, rules) still runs
 * behind the scenes to warm things up - it just isn't shown as a spec table.
 */

const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/14/23"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TOTAL = 6

async function fetchHealth(timeout = 6000): Promise<{ h: Health; ms: number } | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  const t0 = performance.now()
  try {
    const r = await fetch("/api/health", { signal: ctl.signal, cache: "no-store" })
    if (!r.ok) return null
    return { h: (await r.json()) as Health, ms: Math.round(performance.now() - t0) }
  } catch {
    return null
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

const RING_R = 88
const RING_C = 2 * Math.PI * RING_R

export function PreflightLoader({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion()
  const [progress, setProgress] = useState(0)      // 0..100 from the silent checks
  const finished = useRef(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    onDone()
  }, [onDone])

  // --------------------------------------------------------------- silent warm-up
  useEffect(() => {
    let alive = true
    const t0 = performance.now()
    const minTotal = reduce ? 700 : 2600
    const tick = (delta: number) => setProgress((p) => Math.min(97, p + delta))

    // each probe starts in turn, nudges the ring, and completes it when done
    const step = async (i: number, work: () => Promise<unknown>) => {
      await sleep(i * (reduce ? 60 : 280))
      if (!alive) return
      const started = performance.now()
      tick(100 / TOTAL / 3)
      try {
        await work()
      } catch { /* warm-up only - never block the app */ }
      const wait = (reduce ? 80 : 420) - (performance.now() - started)
      if (wait > 0) await sleep(wait)
      if (alive) tick((100 / TOTAL) * 2 / 3)
    }

    const healthP = fetchHealth()

    void Promise.all([
      step(0, async () => { await healthP }),
      step(1, async () => {
        const r = await healthP
        if (!r || r.h.engine !== "mobilesam" || r.h.ready) return
        for (let k = 0; k < 20 && alive; k++) {          // warm the roof AI
          await sleep(800)
          const again = await fetchHealth(3000)
          if (again?.h.ready) return
        }
      }),
      step(2, async () => { await healthP }),
      step(3, async () => { await probeImage(TILE) }),
      step(4, async () => { await healthP }),
      step(5, async () => { await healthP }),
    ]).then(async () => {
      if (!alive) return
      const left = minTotal - (performance.now() - t0)
      if (left > 0) await sleep(left)
      if (alive) finish()
    })
    return () => {
      alive = false
    }
  }, [reduce, finish])

  // Esc skips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [finish])

  // progress number -> spring -> ring + gentle glow
  const spring = useSpring(0, { stiffness: 60, damping: 18 })
  useEffect(() => { spring.set(progress) }, [progress, spring])
  const dash = useTransform(spring, (v) => RING_C * (1 - Math.min(100, v) / 100))
  const glow = useTransform(spring, (v) => 0.18 + 0.32 * (Math.min(100, v) / 100))

  return (
    <motion.div
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-hidden bg-[#101a14] px-5 text-white"
      initial={{ opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, filter: "blur(8px)" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label="SuryaJal is starting"
    >
      {/* backdrop: map grid + sage glow */}
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
      <motion.div
        aria-hidden
        className="absolute top-1/2 left-1/2 size-[640px] -translate-x-1/2 -translate-y-[62%] rounded-full bg-[radial-gradient(circle,rgba(111,143,112,.35),transparent_62%)]"
        style={{ opacity: glow }}
      />
      <button
        type="button"
        onClick={finish}
        title="Press Esc to skip"
        className="absolute top-4 right-4 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white/80 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        Skip intro ›
      </button>

      {/* the logo is the whole show: radar rings + a progress ring that fills as the app warms up */}
      <div className="relative grid place-items-center">
        {!reduce && [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="pointer-events-none absolute size-32 rounded-full border border-sage-300/40"
            initial={{ scale: 0.7, opacity: 0.7 }}
            animate={{ scale: 2.8, opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, delay: i, ease: "easeOut" }}
          />
        ))}
        <div className="relative grid size-48 place-items-center sm:size-56">
          <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 200 200" aria-hidden>
            <defs>
              <linearGradient id="sj-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FBBF24" />
                <stop offset="55%" stopColor="#BACFB6" />
                <stop offset="100%" stopColor="#38BDF8" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
            <motion.circle
              cx="100" cy="100" r={RING_R} fill="none"
              stroke="url(#sj-ring)" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={RING_C} style={{ strokeDashoffset: dash }}
            />
          </svg>
          <motion.div
            animate={reduce ? undefined : { y: [0, -7, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <AnimatedLogoMark className="size-32 drop-shadow-[0_10px_30px_rgba(245,158,11,.25)] sm:size-36" />
          </motion.div>
        </div>
      </div>

      <motion.h1
        className="font-heading mt-6 flex text-4xl font-semibold tracking-[-0.03em] sm:text-5xl"
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
    </motion.div>
  )
}
