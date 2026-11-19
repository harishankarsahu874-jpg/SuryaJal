import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronDown, Loader2, MessageCircle, Mic, MicOff, RotateCcw, SendHorizontal, Sparkles, Volume2, VolumeX, X } from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { api, type AgentResponse, type AgentTurn, type Assessment } from "@/lib/api"
import { fmtIN, litres, rupees, sqft } from "@/lib/format"
import { areaM2, encodePolyline } from "@/lib/geo"
import { useDashboard, type Inputs, type Roof, type Tab } from "./state"
import { useVoiceAssistant, type MicrophoneAccess, type VoiceLanguage } from "./use-voice-assistant"

interface ChatMsg {
  id: string
  role: "user" | "assistant"
  content: string
}

interface RoofSession {
  messages: ChatMsg[]
  suggestions: string[] | null
}

const DEFAULT_CHIPS: Record<Exclude<Tab, "map">, string[]> = {
  solar: [
    "How much solar subsidy can I get?",
    "How much does panel maintenance cost?",
    "Explain my electricity bill savings",
  ],
  rain: [
    "Am I eligible for CHHATA subsidy?",
    "What tank & recharge pit size do I need?",
    "Do solar panels block rainwater?",
  ],
  bom: [
    "What items should I check in a solar quote?",
    "Is this combined solar and rainwater quote fair?",
    "Where can I verify an OREDA-empanelled vendor?",
  ],
  report: [
    "Summarize my full roof report",
    "Total cost & savings after all subsidies?",
    "How do I apply for PM Surya Ghar & CHHATA?",
  ],
}

function buildWelcome(roof: Roof, r: Assessment | null, address: string): string {
  const area = r ? r.area_m2 : areaM2(roof.latlngs)
  const place = address.trim() || (r?.location?.district ? `${r.location.district} district` : "your selected roof")
  if (!r) {
    return (
      `Namaste! I’m your **SuryaJal** assistant for **${place}** (**${fmtIN(area)} m²** / ${fmtIN(sqft(area))} sq ft).\n\n` +
      `Ask me anything about rooftop solar sizing, subsidies, OERC electricity bills, rainwater harvesting, tank & recharge pit design, or *what-if* scenarios!`
    )
  }
  const s = r.solar
  const w = r.rain
  const g = r.score
  const solarLine = s.panels > 0
    ? `- **Solar:** **${s.kw.toFixed(2)} kW** (${s.panels} panels) · saves **${rupees(s.annual_savings)}/yr**`
    : `- **Solar:** Roof outline is compact for full-size panels (drag corners on map if needed)`
  return (
    `Namaste! I’m your **SuryaJal** assistant for **${place}** (**${fmtIN(area)} m²** roof).\n\n` +
    `${solarLine}\n` +
    `- **Rainwater:** **${litres(w.annual_harvest_l)}/yr** harvest · **${fmtIN(w.tank.litres)} L** tank\n` +
    `- **Green Score:** **${g.score}/100 (Grade ${g.grade})**\n\n` +
    `Feel free to ask any question about your solar & water harvesting report!`
  )
}

function buildAssessFallback(roof: Roof, inputs: Inputs) {
  return {
    polygon: roof.latlngs,
    monthly_units: inputs.monthly_units,
    family_size: Math.round(inputs.family_size),
    floors: Math.round(inputs.floors),
    roof_type: inputs.roof_type,
    usable_fraction: inputs.usable_pct / 100,
    tariff: inputs.tariff,
    sanctioned_load_kw: inputs.sanctioned_load_kw,
    cost_per_kw: inputs.cost_per_kw,
    panel_w: Math.round(inputs.panel_w),
    subsidy: inputs.subsidy,
    state_subsidy: inputs.state_subsidy,
    export_rate: inputs.export_rate,
    net_meter_cap: inputs.net_meter_pct / 100,
    tanker_price: inputs.tanker_price,
    design_rain_mm: inputs.design_rain_mm,
    rwh_l_per_m2: inputs.rwh_l_per_m2,
    chhata: inputs.chhata,
    rrhs_cost_per_m2: inputs.rrhs_cost_per_m2,
    rain_override_mm: inputs.rain_override_mm,
    panels: inputs.panels,
  }
}

export function AiAgent() {
  const { roof, result, address, tab, inputs } = useDashboard()
  const [open, setOpen] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<Record<string, RoofSession>>({})
  const [showMicHelp, setShowMicHelp] = useState(false)
  const voice = useVoiceAssistant()
  const {
    speechInputSupported,
    speechOutputSupported,
    listening,
    voiceReplies,
    microphoneAccess,
    language,
    setLanguage,
    notice: voiceNotice,
    speakingId,
    clearNotice: clearVoiceNotice,
    startListening,
    requestMicrophoneAccess,
    stopListening,
    abortListening: abortVoiceListening,
    speak,
    speakNewReply,
    stopSpeaking,
    toggleVoiceReplies,
  } = voice

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)
  const openRef = useRef(false)
  const changeOpen = useCallback((next: boolean) => {
    openRef.current = next
    setOpen(next)
    if (!next) setShowMicHelp(false)
  }, [])

  const roofKey = useMemo(() => (roof ? encodePolyline(roof.latlngs) : ""), [roof])
  const currentRoofKeyRef = useRef(roofKey)
  const previousRoofKeyRef = useRef(roofKey)
  const session = roofKey ? sessions[roofKey] : undefined
  const messages = useMemo(() => session?.messages ?? [], [session])
  const activeTab: Exclude<Tab, "map"> = tab === "map" ? "solar" : tab
  const chips = session?.suggestions ?? DEFAULT_CHIPS[activeTab]

  useEffect(() => {
    const roofChanged = previousRoofKeyRef.current !== roofKey
    previousRoofKeyRef.current = roofKey
    currentRoofKeyRef.current = roofKey
    openRef.current = open && Boolean(roofKey) && tab !== "map"
    if (!openRef.current || roofChanged) {
      abortVoiceListening()
      stopSpeaking()
      clearVoiceNotice()
    }
  }, [open, roofKey, tab, abortVoiceListening, clearVoiceNotice, stopSpeaking])

  // Scroll to newest message when conversation updates or drawer opens
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [open, messages.length, busy, roofKey])

  // Focus input on desktop when opened; Esc closes the panel
  useEffect(() => {
    if (!open) return
    if (window.matchMedia("(pointer: fine)").matches) {
      const t = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") changeOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, changeOpen])

  const appendMessage = useCallback((key: string, msg: ChatMsg, nextSuggestions?: string[] | null) => {
    setSessions((prev) => {
      const cur = prev[key] ?? { messages: [], suggestions: null }
      return {
        ...prev,
        [key]: {
          messages: [...cur.messages, msg],
          suggestions: nextSuggestions !== undefined ? nextSuggestions : cur.suggestions,
        },
      }
    })
  }, [])

  const ask = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text || busy || !roof || !roofKey) return
    const key = roofKey
    const welcomeMsg = buildWelcome(roof, result, address)
    const history: AgentTurn[] = [
      { role: "assistant", content: welcomeMsg },
      ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    ]
    const uid = ++seqRef.current
    abortVoiceListening()
    stopSpeaking()
    clearVoiceNotice()
    appendMessage(key, { id: `u-${uid}`, role: "user", content: text })
    setDraft("")
    setBusy(true)

    try {
      const res = await api<AgentResponse>("/api/agent", {
        body: {
          message: text,
          tab: activeTab,
          address,
          history,
          ...(result ? { assessment: result } : { assess_request: buildAssessFallback(roof, inputs) }),
        },
      })
      const aid = ++seqRef.current
      const replyId = `a-${aid}`
      appendMessage(
        key,
        { id: replyId, role: "assistant", content: res.reply },
        res.suggestions?.length ? res.suggestions : null,
      )
      if (openRef.current && currentRoofKeyRef.current === key) speakNewReply(res.reply, replyId)
    } catch (err) {
      const eid = ++seqRef.current
      appendMessage(key, {
        id: `e-${eid}`,
        role: "assistant",
        content: `Sorry, I couldn’t reach the SuryaJal assistant right now (${(err as Error).message}). Please try asking again in a moment!`,
      })
    } finally {
      setBusy(false)
    }
  }, [activeTab, abortVoiceListening, address, appendMessage, busy, clearVoiceNotice, inputs, messages, result, roof, roofKey, speakNewReply, stopSpeaking])

  if (!roof || tab === "map") return null

  const welcome = buildWelcome(roof, result, address)

  const resetChat = () => {
    if (!roofKey) return
    abortVoiceListening()
    stopSpeaking()
    clearVoiceNotice()
    setSessions((prev) => {
      const next = { ...prev }
      delete next[roofKey]
      return next
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }

  return (
    <div className="pointer-events-none fixed right-3.5 bottom-[calc(0.9rem+env(safe-area-inset-bottom))] z-[1150] flex flex-col items-end gap-2.5 sm:right-5 sm:bottom-5">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.section
            key="agent-panel"
            role="dialog"
            aria-label="SuryaJal roof assistant"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto relative flex h-[min(35.5rem,calc(100dvh-5.25rem))] w-[min(24.5rem,calc(100vw-1.5rem))] origin-bottom-right flex-col overflow-hidden rounded-3xl border border-sage-200/90 bg-card shadow-[0_20px_55px_-12px_rgba(24,34,28,0.34)]"
          >
            {/* header */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-sage-800/20 bg-gradient-to-r from-sage-900 via-sage-800 to-sage-900 px-3.5 py-3 text-white">
              <LogoMark className="size-9 shrink-0 rounded-xl shadow-sm" />
              <div className="min-w-0 flex-1">
                <span className="font-heading text-[1.05rem] leading-none font-semibold tracking-tight">SuryaJal</span>
                <span className="mt-0.5 block truncate text-[10px] text-white/65">Roof assistant · text &amp; voice</span>
              </div>
              <button
                type="button"
                onClick={toggleVoiceReplies}
                title={!speechOutputSupported ? "Spoken replies are not supported in this browser" : voiceReplies ? "Turn voice replies off" : "Read new answers aloud"}
                aria-label={!speechOutputSupported ? "Spoken replies unavailable" : voiceReplies ? "Turn spoken replies off" : "Turn spoken replies on"}
                aria-pressed={voiceReplies}
                className={`grid size-8 shrink-0 place-items-center rounded-xl transition hover:bg-white/12 ${voiceReplies ? "bg-white/15 text-amber-200" : "text-white/75 hover:text-white"}`}
              >
                {voiceReplies ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={resetChat}
                  title="Reset chat"
                  aria-label="Reset chat"
                  className="grid size-8 shrink-0 place-items-center rounded-xl text-white/75 transition hover:bg-white/12 hover:text-white"
                >
                  <RotateCcw className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => changeOpen(false)}
                title="Minimize assistant"
                aria-label="Minimize assistant"
                className="grid size-8 shrink-0 place-items-center rounded-xl text-white/80 transition hover:bg-white/12 hover:text-white"
              >
                <ChevronDown className="size-4.5" />
              </button>
            </div>

            {/* messages */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/65 px-3.5 py-3.5">
              <Bubble
                role="assistant"
                content={welcome}
                messageId="welcome"
                speechEnabled={speechOutputSupported}
                speaking={speakingId === "welcome"}
                onSpeak={() => speakingId === "welcome" ? stopSpeaking() : speak(welcome, "welcome")}
              />
              {messages.map((m) => (
                <Bubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  messageId={m.id}
                  speechEnabled={speechOutputSupported}
                  speaking={speakingId === m.id}
                  onSpeak={() => speakingId === m.id ? stopSpeaking() : speak(m.content, m.id)}
                />
              ))}
              {busy && (
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-sage-800">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border/80 bg-card px-3.5 py-2.5 text-xs text-muted-foreground shadow-2xs">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>Checking your roof report…</span>
                  </div>
                </div>
              )}
            </div>

            {/* quick suggestion chips */}
            {!busy && chips.length > 0 && (
              <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border/60 bg-card px-3 pt-2 pb-1.5">
                {chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void ask(c)}
                    className="shrink-0 rounded-full border border-sage-200 bg-sage-50/90 px-2.5 py-1 text-[11.5px] font-medium text-sage-900 transition hover:border-primary/40 hover:bg-secondary active:translate-y-px"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* input form and browser-native voice controls */}
            {voiceNotice && (
              <div
                role={voiceNotice.kind === "error" ? "alert" : "status"}
                aria-live="polite"
                className={`flex shrink-0 items-center gap-1.5 border-t border-border/50 px-3 py-1.5 text-[11px] leading-snug ${voiceNotice.kind === "error" ? "text-destructive" : voiceNotice.kind === "success" ? "text-primary" : "text-muted-foreground"}`}
              >
                <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${voiceNotice.kind === "error" ? "bg-destructive" : voiceNotice.kind === "success" ? "bg-primary" : "bg-amber-500"}`} />
                <span>{voiceNotice.message}</span>
              </div>
            )}
            {microphoneAccess === "blocked" && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-rose-200/70 bg-rose-50 px-3 py-1.5">
                <span className="mr-auto text-[10.5px] font-semibold text-rose-800">Microphone blocked</span>
                <button
                  type="button"
                  onClick={() => void requestMicrophoneAccess()}
                  className="rounded-lg bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white transition hover:bg-primary/90"
                >
                  Enable mic
                </button>
                <button
                  type="button"
                  onClick={() => setShowMicHelp(true)}
                  className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-rose-800 transition hover:bg-rose-100"
                >
                  How to allow
                </button>
              </div>
            )}
            <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-2 border-t border-border/80 bg-card p-2.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={1500}
                placeholder="Ask about solar, rainwater, subsidy, bills…"
                aria-label="Ask SuryaJal"
                disabled={busy || listening}
                className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-[13.5px] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-65"
              />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as VoiceLanguage)}
                aria-label="Voice language for microphone and spoken replies"
                title="Voice language: English (India) or Hindi"
                disabled={listening}
                className="h-10 w-[3.75rem] shrink-0 rounded-xl border border-input bg-background px-1 text-center text-xs font-semibold text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="en-IN">EN</option>
                <option value="hi-IN">हि</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (listening) stopListening()
                  else {
                    stopSpeaking()
                    startListening(draft, setDraft)
                  }
                }}
                disabled={busy}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-describedby="voice-help"
                aria-pressed={listening}
                title={!speechInputSupported ? "Voice input isn’t supported in this browser" : listening ? "Stop listening" : "Speak your question"}
                className={`grid size-10 shrink-0 place-items-center rounded-xl border transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${listening ? "border-rose-700 bg-rose-600 text-white hover:bg-rose-700" : "border-input bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              >
                {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button
                type="submit"
                disabled={!draft.trim() || busy}
                aria-label="Send question"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs transition hover:bg-primary/90 active:translate-y-px disabled:opacity-45"
              >
                <SendHorizontal className="size-4" />
              </button>
            </form>
            <p id="voice-help" className="shrink-0 border-t border-border/40 px-3 py-1.5 text-[10px] leading-snug text-muted-foreground">
              Mic uses your browser’s speech service; review the transcript before sending. Turn on the speaker for spoken answers.{" "}
              <button
                type="button"
                onClick={() => setShowMicHelp(true)}
                className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              >
                Need permission help?
              </button>
            </p>
            {showMicHelp && (
              <MicrophoneHelp
                permission={microphoneAccess}
                onClose={() => setShowMicHelp(false)}
                onRequest={async () => {
                  const granted = await requestMicrophoneAccess()
                  if (granted) setShowMicHelp(false)
                }}
              />
            )}
          </motion.section>
        ) : (
          <motion.div
            key="agent-launcher"
            initial={{ opacity: 0, y: 14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.92 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex flex-col items-end gap-2"
          >
            {!nudgeDismissed && messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.22 }}
                className="hidden max-w-[15.5rem] items-center gap-2 rounded-2xl border border-sage-200 bg-card/95 py-2 pr-2 pl-3 text-xs text-foreground shadow-lg backdrop-blur sm:flex"
              >
                <button
                  type="button"
                  onClick={() => {
                    setNudgeDismissed(true)
                    changeOpen(true)
                  }}
                  className="text-left leading-snug font-medium text-sage-900 hover:text-primary"
                >
                  Questions about your solar or water report? <span className="font-semibold text-primary">Ask here →</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNudgeDismissed(true)}
                  aria-label="Dismiss tip"
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            )}

            <button
              type="button"
              onClick={() => {
                setNudgeDismissed(true)
                changeOpen(true)
              }}
              aria-label="Open SuryaJal assistant"
              className="group inline-flex h-13 items-center gap-2.5 rounded-full border border-sage-700/40 bg-gradient-to-r from-sage-900 via-sage-800 to-primary pr-4 pl-2.5 text-white shadow-[0_10px_28px_-6px_rgba(24,34,28,0.48)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(24,34,28,0.55)] active:translate-y-0"
            >
              <LogoMark className="size-8 shrink-0 rounded-full shadow-xs" />
              <span className="flex flex-col items-start leading-none">
                <span className="font-heading text-[14px] font-semibold tracking-tight">SuryaJal</span>
                <span className="mt-0.5 text-[10.5px] font-medium text-white/75 max-[380px]:hidden">Ask about this roof</span>
              </span>
              <MessageCircle className="ml-0.5 size-4 text-amber-200/90 max-sm:hidden" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MicrophoneHelp({
  permission,
  onClose,
  onRequest,
}: {
  permission: MicrophoneAccess
  onClose: () => void
  onRequest: () => Promise<void>
}) {
  const statusText = permission === "blocked"
    ? "Your browser has blocked this site. The website can’t change that setting for you, but the steps below will show where to allow it."
    : permission === "unsupported"
      ? "This browser or page doesn’t support secure microphone requests. Try Chrome or Edge on HTTPS; text chat will still work."
      : permission === "not-found"
        ? "No microphone was detected. Connect a microphone, then request access again."
        : permission === "granted"
          ? "Microphone access is allowed. Close this guide and tap the mic button to speak."
          : permission === "requesting"
            ? "Your browser’s permission prompt should be open. Choose Allow there to continue."
            : "Tap Enable microphone below. Your browser will show its own permission prompt; choose Allow there."

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-sage-950/55 p-3"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mic-help-title"
        aria-describedby="mic-help-description"
        className="max-h-full w-full max-w-[22rem] overflow-y-auto rounded-2xl border border-sage-200 bg-card p-4 text-foreground shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Mic className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="mic-help-title" className="font-heading text-lg font-semibold leading-tight">Allow microphone</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">One quick browser permission</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close microphone help"
            autoFocus
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <p id="mic-help-description" className="mt-3 text-[12px] leading-relaxed text-foreground/85">{statusText}</p>

        {permission === "blocked" && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-950">
            <p className="font-semibold">If you already blocked the prompt:</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>Open this site’s controls beside the address bar (lock, tune, or site-info icon).</li>
              <li>Set <strong>Microphone</strong> to <strong>Allow</strong>.</li>
              <li>Return here and tap the microphone again. Reload if your browser asks.</li>
            </ol>
          </div>
        )}

        {permission === "not-found" && (
          <div className="mt-3 rounded-xl border border-sage-200 bg-sage-50 p-3 text-[11px] leading-relaxed text-sage-900">
            Check that a microphone is connected and isn’t being used exclusively by another app, then try again.
          </div>
        )}

        {permission === "unsupported" && (
          <div className="mt-3 rounded-xl border border-sage-200 bg-sage-50 p-3 text-[11px] leading-relaxed text-sage-900">
            Voice dictation needs browser speech-recognition support and a secure page (HTTPS or localhost). You can still use text chat and spoken replies where available.
          </div>
        )}

        {permission !== "unsupported" && permission !== "granted" && (
          <button
            type="button"
            onClick={() => void onRequest()}
            disabled={permission === "requesting"}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            <Mic className="size-4" />
            {permission === "requesting" ? "Waiting for browser…" : permission === "blocked" ? "Try permission again" : permission === "not-found" ? "Check microphone again" : "Enable microphone"}
          </button>
        )}

        <a
          href={typeof window === "undefined" ? "/app" : window.location.href}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-center text-[11px] font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          Open this preview in a new tab
        </a>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-9 w-full rounded-xl border border-border bg-background text-xs font-semibold text-foreground transition hover:bg-secondary"
        >
          Back to assistant
        </button>
      </section>
    </div>
  )
}

function Bubble({
  role,
  content,
  messageId,
  speechEnabled = false,
  speaking = false,
  onSpeak,
}: {
  role: "user" | "assistant"
  content: string
  messageId?: string
  speechEnabled?: boolean
  speaking?: boolean
  onSpeak?: () => void
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground shadow-2xs">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-sage-800 shadow-2xs">
        <Sparkles className="size-3.5 text-amber-600" />
      </span>
      <div className="min-w-0 max-w-[89%] space-y-2 rounded-2xl rounded-tl-sm border border-border/80 bg-card px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground shadow-2xs tabular">
        <FormattedText text={content} />
        {speechEnabled && messageId && onSpeak && (
          <button
            type="button"
            onClick={onSpeak}
            aria-label={speaking ? "Stop speaking this answer" : "Listen to this answer"}
            title={speaking ? "Stop speaking" : "Listen to answer"}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] font-semibold text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {speaking ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            <span>{speaking ? "Stop" : "Listen"}</span>
          </button>
        )}
      </div>
    </div>
  )
}

function FormattedText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, bi) => {
        const trimmed = block.trim()
        if (!trimmed) return null
        if (trimmed === "---") {
          return <hr key={bi} className="my-2 border-border/80" />
        }
        const lines = trimmed.split("\n")
        const listLines = lines.every((l) => /^[-•]\s+/.test(l.trim()))
        if (listLines) {
          return (
            <ul key={bi} className="space-y-1.5 pl-0.5">
              {lines.map((l, li) => (
                <li key={li} className="flex items-start gap-2">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/80" />
                  <span className="min-w-0 flex-1">{renderInline(l.trim().replace(/^[-•]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          )
        }

        // Mixed heading + bullet list inside one block
        const firstBullet = lines.findIndex((l) => /^[-•]\s+/.test(l.trim()))
        if (firstBullet > 0) {
          const headLines = lines.slice(0, firstBullet)
          const restLines = lines.slice(firstBullet)
          return (
            <div key={bi} className="space-y-1.5">
              <p>{headLines.map((l, i) => <span key={i}>{i > 0 && <br />}{renderInline(l)}</span>)}</p>
              <ul className="space-y-1.5 pl-0.5">
                {restLines.map((l, li) => {
                  const t = l.trim()
                  if (/^[-•]\s+/.test(t)) {
                    return (
                      <li key={li} className="flex items-start gap-2">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/80" />
                        <span className="min-w-0 flex-1">{renderInline(t.replace(/^[-•]\s+/, ""))}</span>
                      </li>
                    )
                  }
                  return <li key={li} className="pt-0.5">{renderInline(t)}</li>
                })}
              </ul>
            </div>
          )
        }

        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(l)}
              </span>
            ))}
          </p>
        )
      })}
    </>
  )
}

function renderInline(line: string): ReactNode[] {
  const tokens = line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\)|`[^`]+`|\*[^*]+\*)/g)
  return tokens.map((tok, i) => {
    if (!tok) return null
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return <strong key={i} className="font-semibold text-sage-950">{tok.slice(2, -2)}</strong>
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">{tok.slice(1, -1)}</code>
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return <em key={i} className="italic text-muted-foreground">{tok.slice(1, -1)}</em>
    }
    const link = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer"
          className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
          {link[1]}
        </a>
      )
    }
    return tok
  })
}
