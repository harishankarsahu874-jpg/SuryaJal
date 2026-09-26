import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react"
import { MapPinned, Sparkles } from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { MONTH_LETTERS, MONTHS } from "@/lib/format"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------------ layout pieces
export function SectionCard({ title, subtitle, right, children, className }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-2xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(27,38,31,0.04)] sm:p-5", className)}>
      {(title || right) && (
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="font-heading text-[1.3rem] leading-tight font-medium tracking-tight">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Pill({ children, tone = "sage", className }: {
  children: ReactNode; tone?: "sage" | "peach" | "water" | "plain"; className?: string
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
      tone === "sage" && "bg-secondary text-secondary-foreground",
      tone === "peach" && "bg-sun-soft text-sun-ink",
      tone === "water" && "bg-water-soft text-water-ink",
      tone === "plain" && "bg-muted text-muted-foreground",
      className,
    )}>
      {children}
    </span>
  )
}

export function StatTile({ label, icon: Icon, value, unit, sub, tone = "sage" }: {
  label: string; icon: ComponentType<{ className?: string }>; value: ReactNode; unit?: string; sub?: ReactNode
  tone?: "sage" | "sun" | "water"
}) {
  return (
    <div className="flex min-h-[124px] flex-col rounded-2xl border border-border/80 bg-card p-3.5 shadow-[0_1px_2px_rgba(27,38,31,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-medium text-foreground/80">{label}</span>
        <Icon className={cn("mt-0.5 size-[18px] shrink-0",
          tone === "sun" ? "text-sun-ink" : tone === "water" ? "text-water" : "text-sage-600")} />
      </div>
      <div className="mt-auto pt-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-heading text-[1.9rem] leading-none font-normal tracking-tight tabular">{value}</span>
          {unit && <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{unit}</span>}
        </div>
        {sub && <div className="mt-1.5 text-xs leading-snug text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ animated number
export function CountUp({ value, format, duration = 0.9 }: { value: number; format: (v: number) => string; duration?: number }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const fmt = useRef(format)
  fmt.current = format
  const [text, setText] = useState(() => format(reduce ? value : 0))
  useEffect(() => mv.on("change", (v) => setText(fmt.current(v))), [mv])
  useEffect(() => {
    if (reduce) { mv.set(value); setText(fmt.current(value)); return }
    const c = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] })
    return () => c.stop()
  }, [value, duration, mv, reduce])
  return <span className="tabular">{text}</span>
}

// ------------------------------------------------------------------ interactive monthly bars
export function MonthBars({ values, selected, onSelect, activeClass, baseClass = "bg-sage-200 hover:bg-sage-300", line, height = 150, label }: {
  values: number[]; selected: number; onSelect: (i: number) => void; activeClass: string; baseClass?: string
  line?: number[]; height?: number; label: (i: number) => string
}) {
  const reduce = useReducedMotion()
  const max = Math.max(...values, ...(line ?? [0]), 1) * 1.04
  const pts = line?.map((v, i) => `${((i + 0.5) / 12) * 100},${100 - (v / max) * 100}`).join(" ")
  return (
    <div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 flex items-end gap-[5px] sm:gap-1.5" role="listbox" aria-label="Months">
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === selected}
              aria-label={label(i)}
              onClick={() => onSelect(i)}
              onMouseEnter={(e) => { if (e.buttons === 0 && window.matchMedia("(hover: hover)").matches) onSelect(i) }}
              className="group relative flex h-full flex-1 items-end outline-none"
            >
              <motion.span
                className={cn("block w-full rounded-t-[5px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                  i === selected ? activeClass : baseClass)}
                initial={reduce ? false : { height: 0 }}
                animate={{ height: `${Math.max(1.5, (v / max) * 100)}%` }}
                transition={{ duration: 0.7, delay: reduce ? 0 : i * 0.035, ease: [0.22, 1, 0.36, 1] }}
              />
            </button>
          ))}
        </div>
        {pts && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke" className="text-sage-900/55" />
          </svg>
        )}
      </div>
      <div className="mt-2 flex gap-[5px] sm:gap-1.5">
        {MONTH_LETTERS.map((m, i) => (
          <span key={i} className={cn("flex-1 text-center text-[11px] font-medium",
            i === selected ? "text-foreground" : "text-muted-foreground")} title={MONTHS[i]}>
            {m}
          </span>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ green score ring
export function ScoreRing({ score, grade, size = 132 }: { score: number; grade: string; size?: number }) {
  const color = score >= 75 ? "#4f8a55" : score >= 50 ? "#e9a23b" : "#c2410c"
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r="50" fill="none" stroke="#e6eee3" strokeWidth="11" />
        <motion.circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: score / 100 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-4xl leading-none font-medium tabular"><CountUp value={score} format={(v) => String(Math.round(v))} /></span>
        <span className="mt-1 text-xs font-bold" style={{ color }}>Grade {grade}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ water tank gauge
export function TankGauge({ fraction, label, sub }: { fraction: number; label: string; sub: string }) {
  const id = useId().replace(/:/g, "")
  const f = Math.max(0, Math.min(1, fraction))
  const top = 16 + (1 - f) * 108
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 140" className="h-36 w-[104px] shrink-0" aria-hidden>
        <defs>
          <clipPath id={`${id}t`}><rect x="10" y="16" width="80" height="108" rx="12" /></clipPath>
          <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#1d6f98" />
          </linearGradient>
        </defs>
        <rect x="34" y="4" width="32" height="12" rx="4" fill="#d5e3d2" />
        <rect x="10" y="16" width="80" height="108" rx="12" fill="#eef5f9" stroke="#bcd9e8" strokeWidth="2" />
        <g clipPath={`url(#${id}t)`}>
          <motion.g initial={{ y: 108 }} animate={{ y: top - 16 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
            <rect x="0" y="22" width="100" height="120" fill={`url(#${id}w)`} />
            <path className="sj-wave" d="M-40 22 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V30 H-40 Z" fill="#7dd3fc" />
          </motion.g>
        </g>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1="78" x2="88" y1={16 + (1 - t) * 108} y2={16 + (1 - t) * 108} stroke="#9cc3d6" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="min-w-0">
        <div className="font-heading text-4xl leading-none font-normal tabular text-water-ink">
          <CountUp value={Math.round(f * 100)} format={(v) => `${Math.round(v)}%`} />
        </div>
        <div className="mt-1.5 text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 25-year savings timeline
export function SavingsTimeline({ yearly, netCost, format }: { yearly: number[]; netCost: number; format: (v: number) => string }) {
  const cum = useMemo(() => {
    let t = 0
    return [0, ...yearly.map((v) => (t += v))]
  }, [yearly])
  const n = cum.length - 1
  const max = Math.max(cum[n], netCost) * 1.08 || 1
  const breakEven = cum.findIndex((v) => v >= netCost)
  const [year, setYear] = useState(() => (breakEven > 0 ? breakEven : Math.min(10, n)))
  useEffect(() => { setYear(breakEven > 0 ? breakEven : Math.min(10, n)) }, [breakEven, n])
  const W = 300, H = 110
  const x = (i: number) => (i / n) * W
  const y = (v: number) => H - (v / max) * H
  const area = `M0,${H} ` + cum.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + ` L${W},${H} Z`
  const lineD = cum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const ref = useRef<SVGSVGElement>(null)
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setYear(Math.max(1, Math.min(n, Math.round(((clientX - r.left) / r.width) * n))))
  }
  const profit = cum[year] - netCost
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">By year {year}</div>
          <div className="font-heading text-xl font-medium tabular">{format(cum[year])} <span className="text-xs font-sans font-medium text-muted-foreground">saved</span></div>
        </div>
        <Pill tone={profit >= 0 ? "sage" : "peach"}>{profit >= 0 ? `+${format(profit)} profit` : `${format(-profit)} to go`}</Pill>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H + 18}`} className="w-full touch-none select-none"
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} role="img"
        aria-label={`Cumulative savings, break-even in year ${breakEven}`}>
        <path d={area} fill="#d5e3d2" opacity="0.7" />
        <path d={lineD} fill="none" stroke="#56735a" strokeWidth="2" />
        <line x1="0" x2={W} y1={y(netCost)} y2={y(netCost)} stroke="#7b5230" strokeWidth="1.4" strokeDasharray="5 4" />
        <text x="4" y={y(netCost) - 5} fontSize="9.5" fill="#7b5230" fontWeight="600">cost after subsidy</text>
        {breakEven > 0 && (
          <g>
            <circle cx={x(breakEven)} cy={y(cum[breakEven])} r="4" fill="#7b5230" />
          </g>
        )}
        <line x1={x(year)} x2={x(year)} y1="0" y2={H} stroke="#1b261f" strokeOpacity="0.35" strokeWidth="1" />
        <circle cx={x(year)} cy={y(cum[year])} r="5" fill="#fff" stroke="#1b261f" strokeWidth="2" />
        {[0, 5, 10, 15, 20, 25].filter((t) => t <= n).map((t) => (
          <text key={t} x={Math.min(W - 8, Math.max(6, x(t)))} y={H + 14} fontSize="9.5" textAnchor="middle" fill="#65726a">{t === 0 ? "0" : `${t}y`}</text>
        ))}
      </svg>
    </div>
  )
}

// ------------------------------------------------------------------ empty state
export function EmptyState({ onDemo, onMap }: { onDemo: () => void; onMap: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-sage-300 bg-card/70 px-6 py-10 text-center">
      <div className="relative">
        <LogoMark className="size-20 animate-float" />
        <span className="absolute -right-2 -bottom-1 grid size-8 place-items-center rounded-full bg-sun-soft text-sun-ink shadow">
          <Sparkles className="size-4" />
        </span>
      </div>
      <h3 className="font-heading mt-5 text-2xl font-medium tracking-tight">Tap your roof to begin</h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
        Find your house on the satellite map and tap its roof — MobileSAM outlines it in about a second, then your solar
        and rainwater plan appears here.
      </p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <button type="button" onClick={onMap}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 lg:hidden">
          <MapPinned className="size-[18px]" /> Open the roof map
        </button>
        <button type="button" onClick={onDemo}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border bg-card font-semibold hover:bg-secondary">
          <Sparkles className="size-[18px] text-sun-ink" /> Try the demo roof
        </button>
      </div>
    </div>
  )
}
