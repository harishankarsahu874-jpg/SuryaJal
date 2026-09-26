import { useId } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * SuryaJal mark: a roof (white chevron) splits one circle into the sun above
 * (Surya) and water below (Jal) - one roof, two harvests.
 */

// Sun rays sit on an arc above the circle (centre 32,34 · r 18).
const RAYS = [-90, -60, -120, -30, -150].map((deg) => {
  const a = (deg * Math.PI) / 180
  return {
    x1: 32 + 22.5 * Math.cos(a),
    y1: 34 + 22.5 * Math.sin(a),
    x2: 32 + 26.5 * Math.cos(a),
    y2: 34 + 26.5 * Math.sin(a),
  }
})
const ROOF = "M9.5 47 L32 28.5 L54.5 47"
const SUN_AREA = "M0 0 H64 V54.8 L32 28.5 L0 54.8 Z"
const DROP = "M32 35.5c2.9 3.8 4.6 6.4 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-2 1.7-4.6 4.6-8.4z"

type MarkProps = {
  className?: string
  title?: string
  /** draw the rounded-square app-icon background */
  tile?: boolean
}

export function LogoMark({ className, title = "SuryaJal", tile = true }: MarkProps) {
  const id = useId().replace(/:/g, "")
  return (
    <svg viewBox="0 0 64 64" className={cn("size-9 shrink-0", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6A8A6F" />
          <stop offset="1" stopColor="#3B5341" />
        </linearGradient>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={`${id}water`} x1="0" y1="0.3" x2="0" y2="1">
          <stop offset="0" stopColor="#7DD3FC" />
          <stop offset="1" stopColor="#0284C7" />
        </linearGradient>
        <clipPath id={`${id}disc`}>
          <circle cx="32" cy="34" r="18" />
        </clipPath>
      </defs>
      {tile && <rect width="64" height="64" rx="16" fill={`url(#${id}bg)`} />}
      <g stroke="#FBBF24" strokeWidth="3.2" strokeLinecap="round">
        {RAYS.map((r, i) => (
          <line key={i} {...r} />
        ))}
      </g>
      <g clipPath={`url(#${id}disc)`}>
        <rect width="64" height="64" fill={`url(#${id}water)`} />
        <path d={SUN_AREA} fill={`url(#${id}sun)`} />
      </g>
      <path d={ROOF} fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={DROP} fill="#fff" />
    </svg>
  )
}

/** Animated version used by the loader: rays spin in, sun rises, water fills, roof draws. */
export function AnimatedLogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "")
  const reduce = useReducedMotion()
  const t = (delay: number, duration = 0.7) =>
    reduce ? { duration: 0 } : { delay, duration, ease: [0.22, 1, 0.36, 1] as const }
  return (
    <svg viewBox="0 0 64 64" className={cn("size-24", className)} role="img" aria-label="SuryaJal">
      <defs>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={`${id}water`} x1="0" y1="0.3" x2="0" y2="1">
          <stop offset="0" stopColor="#7DD3FC" />
          <stop offset="1" stopColor="#0284C7" />
        </linearGradient>
        <clipPath id={`${id}disc`}>
          <circle cx="32" cy="34" r="18" />
        </clipPath>
        <clipPath id={`${id}sky`}>
          <path d={SUN_AREA} />
        </clipPath>
      </defs>
      {/* faint disc outline */}
      <circle cx="32" cy="34" r="18" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      {/* rays */}
      <motion.g
        stroke="#FBBF24"
        strokeWidth="3.2"
        strokeLinecap="round"
        style={{ transformOrigin: "32px 34px" }}
        initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={t(0.55, 0.9)}
      >
        {RAYS.map((r, i) => (
          <line key={i} {...r} />
        ))}
      </motion.g>
      <g clipPath={`url(#${id}disc)`}>
        {/* water rises from the bottom */}
        <motion.g initial={{ y: 22 }} animate={{ y: 0 }} transition={t(0.25, 1.1)}>
          <rect x="0" y="30" width="64" height="40" fill={`url(#${id}water)`} />
          <path
            className="sj-wave"
            d="M-32 31 q8 -3 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 V40 H-32 Z"
            fill="#7DD3FC"
            opacity="0.9"
          />
        </motion.g>
        {/* sun rises behind the roof */}
        <g clipPath={`url(#${id}sky)`}>
          <motion.circle
            cx="32"
            cy="34"
            r="18"
            fill={`url(#${id}sun)`}
            initial={{ y: 18 }}
            animate={{ y: 0 }}
            transition={t(0.1, 1)}
          />
        </g>
      </g>
      <motion.path
        d={ROOF}
        fill="none"
        stroke="#fff"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={t(0.35, 0.8)}
      />
      <motion.path
        d={DROP}
        fill="#fff"
        style={{ transformOrigin: "32px 42px" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { delay: 0.95, type: "spring", stiffness: 380, damping: 16 }}
      />
    </svg>
  )
}

type LogoProps = {
  className?: string
  markClassName?: string
  /** small grey line under the name */
  tagline?: string | null
  /** optional pill next to the name (the dashboard shows "AI") */
  badge?: string | null
  inverted?: boolean
}

export function Logo({ className, markClassName, tagline = null, badge = null, inverted = false }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "font-heading text-[1.28rem] font-semibold tracking-[-0.02em]",
              inverted ? "text-white" : "text-foreground",
            )}
          >
            Surya<span className={inverted ? "text-sky-300" : "text-water"}>Jal</span>
          </span>
          {badge && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider uppercase",
                inverted ? "bg-white/15 text-white" : "bg-secondary text-secondary-foreground",
              )}
            >
              {badge}
            </span>
          )}
        </span>
        {tagline && (
          <span className={cn("mt-1 truncate text-xs", inverted ? "text-white/65" : "text-muted-foreground")}>
            {tagline}
          </span>
        )}
      </span>
    </span>
  )
}
