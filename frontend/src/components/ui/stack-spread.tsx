// Built using Hyperiux Vault: https://vault.hyperiux.com
// Adapted for SuryaJal: Unsplash photos (self-hosted copies in /public/images/stack),
// SuryaJal headline props, lucide-react scroll icon, lazy images and hover captions.

"use client";

import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useMotionValue,
  useSpring,
  useMotionValueEvent,
  type MotionValue,
} from "motion/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Unsplash photos (Unsplash License - free to use). Original files:
 *   rain-ripples      https://images.unsplash.com/photo-1438449805896-28a666819a20
 *   sunrise-meadow    https://images.unsplash.com/photo-1470252649378-9c29740c9fa8
 *   monsoon-street    https://images.unsplash.com/photo-1566552881560-0be862a7c445
 *   city-rooftops     https://images.unsplash.com/photo-1596176530529-78163a4f7af2
 *   solar-sky         https://images.unsplash.com/photo-1508514177221-188b1cf16e9d
 *   monsoon-umbrella  https://images.unsplash.com/photo-1519692933481-e162a57d6721
 *   roof-installer    https://images.unsplash.com/photo-1624397640148-949b1732bb0a
 *   rooftop-sunset    https://images.unsplash.com/photo-1613665813446-82a78c468a1d
 * Copies are bundled so the fest demo still works on slow Wi-Fi.
 */
const IMG_BASE = "/images/stack";

const IMG = {
  rooftopSunset: `${IMG_BASE}/rooftop-sunset.webp`,
  roofInstaller: `${IMG_BASE}/roof-installer.webp`,
  monsoonUmbrella: `${IMG_BASE}/monsoon-umbrella.webp`,
  solarSky: `${IMG_BASE}/solar-sky.webp`,
  cityRooftops: `${IMG_BASE}/city-rooftops.webp`,
  monsoonStreet: `${IMG_BASE}/monsoon-street.webp`,
  sunriseMeadow: `${IMG_BASE}/sunrise-meadow.webp`,
  rainRipples: `${IMG_BASE}/rain-ripples.webp`,
} as const;

// per-image rest scale, keyed by img index (1-8). default 1, drop below to shrink.
const SCALE: Partial<Record<number, number>> = {
  1: 0.9,
  2: 0.8,
  3: 0.9,
  4: 0.8,
  5: 0.8,
  6: 0.9,
  7: 0.9,
  8: 0.7,
};
const s = (i: number) => SCALE[i] ?? 1;

// array order = stack order, back (z 2) -> front (z 9)
// Left column = rain (Jal), right column = sun (Surya), centre = the roofs that catch both.
const CARDS: StackSpreadCard[] = [
  // top-left — sm row 1 left
  {
    item: { src: IMG.rainRipples, alt: "Raindrops rippling on water", label: "Rain" },
    stackOffset: { x: -8, y: -10 },
    stackRotate: -18,
    target: { x: -20, y: -34, rotate: 0, scale: s(8), w: 17, h: 22 },
    targetSm: { x: -22, y: -40 },
    z: 2,
  },
  // top-right — sm row 1 right
  {
    item: { src: IMG.sunriseMeadow, alt: "Sun rising over a meadow", label: "Sunlight" },
    stackOffset: { x: 14, y: -10 },
    stackRotate: 20,
    target: { x: 32, y: -30, rotate: 0, scale: s(7), w: 18, h: 32 },
    targetSm: { x: 22, y: -40 },
    z: 3,
  },
  // mid-left (tall) — sm row 2 left
  {
    item: { src: IMG.monsoonStreet, alt: "Monsoon rain reflecting on a city street", label: "Monsoon" },
    stackOffset: { x: -16, y: 0 },
    stackRotate: -4,
    target: { x: -36, y: -2, rotate: 0, scale: s(6), w: 15, h: 32 },
    targetSm: { x: -22, y: -19 },
    z: 4,
  },
  // top-centre — sm row 2 right
  {
    item: { src: IMG.cityRooftops, alt: "An Indian city of rooftops at dusk", label: "Every roof" },
    stackOffset: { x: 1, y: -10 },
    stackRotate: -2,
    target: { x: 6, y: -32, rotate: 0, scale: s(5), w: 25, h: 30 },
    targetSm: { x: 22, y: -19 },
    z: 5,
  },
  // mid-right — sm row 3 left
  {
    item: { src: IMG.solarSky, alt: "Solar panels under a blue sky", label: "Solar power" },
    stackOffset: { x: 18, y: 1 },
    stackRotate: 6,
    target: { x: 37, y: 6, rotate: 0, scale: s(4), w: 18, h: 32 },
    targetSm: { x: -22, y: 20 },
    z: 6,
  },
  // bottom-left — sm row 3 right
  {
    item: { src: IMG.monsoonUmbrella, alt: "Walking home under an umbrella in the rain", label: "Rainwater" },
    stackOffset: { x: -6, y: 10 },
    stackRotate: 6,
    target: { x: -24, y: 34, rotate: 0, scale: s(3), w: 22, h: 25 },
    targetSm: { x: 22, y: 20 },
    z: 7,
  },
  // bottom-centre — sm row 4 left
  {
    item: { src: IMG.roofInstaller, alt: "Installer fitting a rooftop solar panel", label: "Installation" },
    stackOffset: { x: 8, y: 7 },
    stackRotate: 3,
    target: { x: 2, y: 36, rotate: 0, scale: s(2), w: 20, h: 26 },
    targetSm: { x: -22, y: 40 },
    z: 8,
  },
  // bottom-right (top of the stack) — sm row 4 right
  {
    item: { src: IMG.rooftopSunset, alt: "Rooftop solar plant at sunset", label: "Rooftop solar" },
    stackOffset: { x: 20, y: 12 },
    stackRotate: -7,
    target: { x: 30, y: 34, rotate: 0, scale: s(1), w: 16, h: 20 },
    targetSm: { x: 22, y: 40 },
    z: 9,
  },
];

// ---------------------------------------------------------------------------
// Mechanism
// ---------------------------------------------------------------------------

// Scroll progress where the cluster starts scattering and where it finishes.
const SCATTER_START = 0.12;
const SCATTER_END = 0.9;

const PARALLAX_X = 2.6;
const PARALLAX_Y = 2.2;
const PARALLAX_SPRING = { stiffness: 90, damping: 22, mass: 0.6 };
const parallaxDepth = (i: number, total: number) =>
  total <= 1 ? 1 : 0.55 + (i / (total - 1)) * 0.75;

const SUB =
  "Sunlight becomes electricity. Rain becomes groundwater. SuryaJal measures both from one tap on a satellite map.";

const RESPONSIVE = {
  desktop: {
    scale: null as number | null,
    small: false,
    colX: null as number | null,
    card: null as { w: number; h: number } | null,
  },
  small: {
    scale: 0.72,
    small: true,
    colX: 22,
    card: { w: 40, h: 20 },
  },
};

function useResponsive() {
  const [r, setR] = useState(RESPONSIVE.desktop);
  useEffect(() => {
    // Touch vs. mouse, not raw width: a narrow but mouse-driven frame (21st
    // preview, split editor) keeps the desktop scatter + pointer parallax;
    // only real touch devices drop to the stacked column layout.
    const mq = window.matchMedia("(pointer: coarse)");
    const read = () => setR(mq.matches ? RESPONSIVE.small : RESPONSIVE.desktop);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return r;
}

function usePointerParallax(active: boolean, enabled: boolean) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, PARALLAX_SPRING);
  const y = useSpring(rawY, PARALLAX_SPRING);

  useEffect(() => {
    if (!enabled) return;

    if (!active) {
      rawX.set(0);
      rawY.set(0);
      return;
    }

    const onMove = (event: PointerEvent) => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1);
      rawY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [active, enabled, rawX, rawY]);

  return { x, y };
}

export interface StackSpreadItem {
  src: string;
  alt?: string;
  /** small caption revealed on hover once the cards have spread */
  label?: string;
}

export interface StackSpreadTarget {
  x: number;
  y: number;
  rotate: number;
  scale?: number;
  w: number;
  h: number;
}

export interface StackSpreadCard {
  item: StackSpreadItem;
  target: StackSpreadTarget;
  /** final x/y (vw/vh) for tablet + mobile; falls back to `target` */
  targetSm?: { x: number; y: number };
  /** angle while clustered */
  stackRotate?: number;
  /** offset while clustered (vw/vh) */
  stackOffset?: { x: number; y: number };
  /** paint order, higher on top */
  z?: number;
}

function Card({
  card,
  progress,
  reduce,
  clusterRotation,
  scaleMul,
  isSmall,
  colX,
  fixedCard,
  stackScale,
  cardRadius,
  pointer,
  depth,
}: {
  card: StackSpreadCard;
  progress: MotionValue<number>;
  reduce: boolean | null;
  clusterRotation: boolean;
  /** uniform rest-scale for every card; null = use each card's own scale */
  scaleMul: number | null;
  isSmall: boolean;
  colX: number | null;
  fixedCard: { w: number; h: number } | null;
  /** scale of the cards while clustered, before the scatter */
  stackScale: number;
  /** corner radius on each card, in px (desktop) */
  cardRadius: number;
  pointer: { x: MotionValue<number>; y: MotionValue<number> };
  depth: number;
}) {
  const { item, target } = card;

  const flat = reduce === true;
  const stackRotate = flat ? 0 : clusterRotation ? card.stackRotate ?? 0 : 0;
  const stackOffset = card.stackOffset ?? { x: 0, y: 0 };
  const restScale = scaleMul ?? target.scale ?? 1;

  // final resting spot: column grid on small screens, scatter on desktop
  const sm = isSmall && card.targetSm ? card.targetSm : null;
  const endX = sm
    ? colX != null
      ? Math.sign(sm.x) * colX
      : sm.x
    : target.x;
  const endY = sm ? sm.y : target.y;
  const endRotate = flat || isSmall ? 0 : target.rotate;

  // -50% keeps card centred on its anchor
  const translate = useTransform(
    [progress, pointer.x, pointer.y],
    ([p, px, py]: number[]) => {
      const tx = stackOffset.x + (endX - stackOffset.x) * p;
      const ty = stackOffset.y + (endY - stackOffset.y) * p;
      const drift = depth * p;
      const dx = tx - px * PARALLAX_X * drift;
      const dy = ty - py * PARALLAX_Y * drift;
      return `calc(-50% + ${dx}vw) calc(-50% + ${dy}vh)`;
    },
  );
  const rotate = useTransform(progress, [0, 1], [stackRotate, endRotate]);
  const scale = useTransform(progress, [0, 1], [stackScale, restScale]);

  return (
    <motion.div
      className="absolute left-1/2 top-1/2 will-change-transform"
      style={{
        width: `${fixedCard ? fixedCard.w : target.w}vw`,
        height: `${fixedCard ? fixedCard.h : target.h}vh`,
        zIndex: card.z ?? 1,
        translate,
        rotate,
        scale,
      }}
    >
      <CardFace item={item} cardRadius={cardRadius} />
    </motion.div>
  );
}

function CardFace({
  item,
  cardRadius,
}: {
  item: StackSpreadItem;
  cardRadius: number;
}) {
  return (
    <div
      className="group relative h-full w-full overflow-hidden shadow-[0_18px_40px_-18px_rgba(20,35,25,0.45)] max-md:rounded-[4vw]"
      style={{ borderRadius: `${cardRadius}px` }}
    >
      <img
        src={item.src}
        alt={item.alt ?? ""}
        draggable={false}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
      />
      {item.label && (
        <span className="pointer-events-none absolute bottom-2 left-2 translate-y-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 max-md:hidden">
          {item.label}
        </span>
      )}
    </div>
  );
}

interface StackSpreadStageProps {
  cards: StackSpreadCard[];
  /** scatter scroll distance, in vh */
  scrollLength?: number;
  bgColor?: string;
  /** fan the clustered stack (default) or start flat */
  clusterRotation?: boolean;
  /** scale of the cards while clustered, before the scatter */
  stackScale?: number;
  /** corner radius on each card, in px (desktop only — mobile keeps its responsive radius) */
  cardRadius?: number;
  /** color of the centre headline and subtitle */
  textColor?: string;
  /** scroll progress (0-1) where the centre text starts fading in */
  textFadeStart?: number;
  /** show the "scroll to spread" hint at the bottom until the scatter begins */
  showScrollHint?: boolean;
  /** centre headline: `title` + dimmed `highlight` + `titleEnd` */
  title?: string;
  highlight?: string;
  titleEnd?: string;
  subtitle?: ReactNode;
  /** optional element under the subtitle (e.g. a call-to-action) */
  action?: ReactNode;
  id?: string;
}

function StackSpreadStage({
  cards,
  scrollLength = 350,
  bgColor = "#ececeb",
  clusterRotation = true,
  stackScale = 0.82,
  cardRadius = 8,
  textColor = "#141414",
  textFadeStart = 0.3,
  showScrollHint = true,
  title = "One Roof.",
  highlight = "Two",
  titleEnd = "Harvests.",
  subtitle = SUB,
  action,
  id,
}: StackSpreadStageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scale: scaleMul, small: isSmall, colX, card: fixedCard } =
    useResponsive();

  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start start", "end end"],
  });

  // hold, scatter, then settle
  const progress = useTransform(
    scrollYProgress,
    [0, SCATTER_START, SCATTER_END, 1],
    [0, 0, 1, 1],
  );

  // centre text always fades in on scroll; the scale-in is dropped only when
  // reduced motion is confirmed (`true`), not on the null SSR value.
  const [spread, setSpread] = useState(false);
  useMotionValueEvent(progress, "change", (p) => {
    setSpread((was) => (was ? p > 0.985 : p >= 0.999));
  });
  const parallaxEnabled = reduce !== true && !isSmall;
  const pointer = usePointerParallax(spread, parallaxEnabled);

  const noScale = reduce === true;
  const copyOpacity = useTransform(progress, [textFadeStart, textFadeStart + 0.35], [0, 1]);
  const copyScale = useTransform(progress, [textFadeStart, 0.9], [0.85, 1]);

  // scroll hint: visible while clustered, gone by the time the scatter starts
  const hintOpacity = useTransform(progress, [0, SCATTER_START], [1, 0]);

  return (
    <section
      id={id}
      ref={wrapRef}
      className="relative w-full"
      style={{ height: `${scrollLength}vh`, backgroundColor: bgColor }}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        {/* centre text */}
        <motion.div
          className="absolute inset-0 z-[5] flex flex-col items-center justify-center px-6 text-center max-md:px-8"
          style={{
            opacity: copyOpacity,
            scale: noScale ? 1 : copyScale,
            pointerEvents: spread ? "auto" : "none",
          }}
        >
          <h2
            className="font-heading w-full whitespace-pre-line text-[4.5vw] font-normal leading-none! tracking-tight max-md:text-[10vw]"
            style={{ color: textColor }}
          >
            {title}
            <span className="opacity-60"> {highlight} </span>
            {titleEnd}
          </h2>
          <p
            className="mt-[1.2vw] w-full max-w-[42ch] text-[1.15vw] leading-relaxed tracking-tight max-md:mt-3 max-md:text-[3.6vw]"
            style={{ color: textColor, opacity: 0.6 }}
          >
            {subtitle}
          </p>
          {/* the stacked phone layout has no room for an extra button */}
          {action && <div className="mt-[1.6vw] pointer-coarse:hidden">{action}</div>}
        </motion.div>

        {/* scattering cards */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {cards.map((card, i) => (
            <div key={i} style={{ pointerEvents: "auto" }}>
              <Card
                card={card}
                progress={progress}
                reduce={reduce}
                clusterRotation={clusterRotation}
                scaleMul={scaleMul}
                isSmall={isSmall}
                colX={colX}
                fixedCard={fixedCard}
                stackScale={stackScale}
                cardRadius={cardRadius}
                pointer={pointer}
                depth={parallaxEnabled ? parallaxDepth(i, cards.length) : 0}
              />
            </div>
          ))}
        </div>

        {/* scroll hint */}
        {showScrollHint && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-[3vh] z-20 flex flex-col items-center gap-[0.6vh] text-[0.8vw] font-medium uppercase tracking-[0.2em] max-md:bottom-6 max-md:gap-1 max-md:text-[2.8vw]"
            style={{ color: textColor, opacity: hintOpacity }}
          >
            <span>Scroll</span>
            <ChevronDown
              className="size-4 animate-bounce max-md:h-[4vw] max-md:w-[4vw]"
              strokeWidth={2}
              aria-hidden="true"
            />
          </motion.div>
        )}
      </div>
    </section>
  );
}

export interface StackSpreadProps {
  /** scatter scroll distance, in vh */
  scrollLength?: number;
  bgColor?: string;
  /** fan the clustered stack (default) or start flat */
  clusterRotation?: boolean;
  /** scale of the cards while clustered, before the scatter */
  stackScale?: number;
  /** corner radius on each card, in px (desktop only — mobile keeps its responsive radius) */
  cardRadius?: number;
  /** color of the centre headline and subtitle */
  textColor?: string;
  /** scroll progress (0-1) where the centre text starts fading in */
  textFadeStart?: number;
  /** show the "scroll to spread" hint at the bottom until the scatter begins */
  showScrollHint?: boolean;
  /** swap in your own photos (defaults to the SuryaJal sun + rain set) */
  cards?: StackSpreadCard[];
  title?: string;
  highlight?: string;
  titleEnd?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
}

export default function StackSpread({
  scrollLength = 350,
  bgColor = "#ececeb",
  clusterRotation = true,
  stackScale = 0.82,
  cardRadius = 8,
  textColor = "#141414",
  textFadeStart = 0.3,
  showScrollHint = true,
  cards = CARDS,
  ...copy
}: StackSpreadProps) {
  return (
    <StackSpreadStage
      cards={cards}
      scrollLength={scrollLength}
      bgColor={bgColor}
      clusterRotation={clusterRotation}
      stackScale={stackScale}
      cardRadius={cardRadius}
      textColor={textColor}
      textFadeStart={textFadeStart}
      showScrollHint={showScrollHint}
      {...copy}
    />
  );
}
