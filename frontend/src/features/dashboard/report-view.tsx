import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  BookmarkCheck, BookmarkPlus, ChevronDown, Copy, Download, ExternalLink, FileText, Loader2, QrCode, Settings2, Share2,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { api, ApiError, type SavedRoof } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { usePhoneBase } from "@/lib/net"
import { openReport, useReportDownload } from "@/lib/report"
import { fmtIN, rupees } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useDashboard, type Inputs } from "./state"
import { EmptyState, Pill, ScoreRing, SectionCard } from "./ui-bits"
import { ViewSkeleton } from "./solar-view"

export function ReportView() {
  const { result: r, roof, query, setTab, loadDemo, address } = useDashboard()
  const { user, refresh } = useAuth()
  const [saving, setSaving] = useState(false)
  const [savedFor, setSavedFor] = useState("")
  const { busy: dlBusy, download } = useReportDownload()
  const [qrFailedFor, setQrFailedFor] = useState<string | null>(null)
  const [qrNonce, setQrNonce] = useState(0)
  const phoneBase = usePhoneBase()

  if (!roof) return <EmptyState onDemo={loadDemo} onMap={() => setTab("map")} />
  if (!r) return <ViewSkeleton />

  const s = r.solar, w = r.rain, g = r.score
  // Links that leave this device (QR, copy, share) point at a phone-reachable host:
  // when SuryaJal runs on localhost that is the PC's Wi-Fi/LAN IP, elsewhere the origin.
  const origin = phoneBase || window.location.origin
  const reportAbs = `${origin}/r?${query}`
  const shareUrl = `${origin}/app?${query}`
  const next = encodeURIComponent(`/app?${query}`)
  const saved = savedFor === query
  const qrFailed = qrFailedFor === reportAbs
  const qrHost = (() => { try { return new URL(reportAbs).host } catch { return "" } })()

  const save = async () => {
    setSaving(true)
    try {
      const res = await api<{ roof: SavedRoof }>("/api/roofs", { body: { query, title: address } })
      setSavedFor(query)
      toast.success(res.roof.updated ? "Updated in My roofs" : "Saved to My roofs ⭐")
      void refresh()
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 401 ? "Your session expired — please sign in again." : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success("Link copied")
    } catch {
      toast("Select the link and press Ctrl+C to copy")
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: "My SuryaJal Green Roof Report", text: `My roof: ${s.kw.toFixed(2)} kW solar + ${fmtIN(w.annual_harvest_l)} L rain a year`, url: shareUrl })
    } catch { /* cancelled */ }
  }

  const water = w.coverage >= 1 ? "all of the building’s water" : `${Math.round(w.coverage * 100)}% of the building’s water`
  return (
    <div className="space-y-3.5">
      <SectionCard>
        <div className="flex items-center gap-4">
          <ScoreRing score={g.score} grade={g.grade} size={120} />
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-[1.3rem] leading-tight font-medium">Green Score</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {s.panels ? <>Your roof can cover <b className="text-foreground">{Math.round(s.coverage * 100)}%</b> of your electricity and <b className="text-foreground">{water}</b>.</>
                : <>Too small for panels, but it can still provide {water}.</>}
            </p>
            <div className="mt-3 space-y-1.5">
              <MiniBar label="Solar" pts={g.solar_pts} of={55} className="bg-sun" />
              <MiniBar label="Water" pts={g.water_pts} of={35} className="bg-water" />
              <MiniBar label="Rule" pts={g.rule_pts} of={10} className="bg-sage-400" />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Green Roof Report" subtitle="One page: roof photo, panel layout, savings, rainwater plan and a QR code"
        right={<Pill tone="plain"><FileText className="size-3.5" /> PDF</Pill>}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini k="Solar" v={`${s.kw.toFixed(2)} kW`} />
          <Mini k="Payback" v={s.payback_years ? `${s.payback_years.toFixed(1)} yrs` : "—"} />
          <Mini k="Rain / yr" v={`${fmtIN(w.annual_harvest_l / 1000)} kL`} />
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void download(query)} disabled={dlBusy}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60">
            {dlBusy ? <Loader2 className="size-[18px] animate-spin" /> : <Download className="size-[18px]" />} Download
          </button>
          <a href={`/r?${query}`} target="_blank" rel="noopener"
            onClick={(e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); openReport(`/r?${query}`) } }}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border bg-card font-semibold transition hover:bg-secondary">
            <ExternalLink className="size-[18px]" /> Open
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Download saves the PDF straight to your device — if your browser or viewer blocks it, use Open and save from there.
        </p>
      </SectionCard>

      <SectionCard title="Take it home"
        subtitle={phoneBase
          ? "Scan with any phone on the same Wi-Fi / hotspot — the QR points at this PC's Wi-Fi address"
          : "Scan on your phone (same Wi-Fi / hotspot, or a public link)"}
        right={<QrCode className="size-5 text-sage-600" />}>
        <div className="flex items-center gap-4">
          <div className="w-[124px] shrink-0">
            {qrFailed ? (
              <button type="button" onClick={() => { setQrNonce((n) => n + 1); setQrFailedFor(null) }}
                className="grid size-[124px] place-items-center rounded-xl border border-dashed bg-white p-2 text-center text-[11px] leading-snug text-muted-foreground hover:bg-secondary">
                QR didn’t load.<br />Tap to retry
              </button>
            ) : (
              <img key={`${reportAbs}#${qrNonce}`} src={`/api/qr.svg?data=${encodeURIComponent(reportAbs)}&r=${qrNonce}`}
                alt="QR code for this report" width={124} height={124} onError={() => setQrFailedFor(reportAbs)}
                className="size-[124px] rounded-xl border bg-white p-1.5" />
            )}
            {qrHost && <div className="mt-1 truncate text-center text-[10px] text-muted-foreground" title={reportAbs}>{qrHost}</div>}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <input readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.target.select()}
              className="h-10 w-full rounded-lg border bg-muted/50 px-2.5 text-xs text-muted-foreground outline-none" />
            <div className="flex gap-2">
              <button type="button" onClick={copy} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-sm font-semibold hover:bg-secondary">
                <Copy className="size-4" /> Copy
              </button>
              {typeof navigator.share === "function" && (
                <button type="button" onClick={share} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-sm font-semibold hover:bg-secondary">
                  <Share2 className="size-4" /> Share
                </button>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard className={cn(user ? "" : "border-sage-300 bg-sage-50")}>
        {user ? (
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sun-soft text-sun-ink">
              {saved ? <BookmarkCheck className="size-5" /> : <BookmarkPlus className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{saved ? "Saved to My roofs" : "Keep this roof"}</div>
              <div className="text-xs text-muted-foreground">
                {saved ? <Link to="/account" className="font-semibold text-sage-700 underline-offset-2 hover:underline">Open My roofs →</Link>
                  : `Signed in as ${user.name}`}
              </div>
            </div>
            <button type="button" onClick={save} disabled={saving}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <BookmarkCheck className="size-4" /> : <BookmarkPlus className="size-4" />}
              {saved ? "Save again" : "Save"}
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-sage-700 shadow-sm"><BookmarkPlus className="size-5" /></span>
              <div>
                <div className="font-semibold">Save your roofs</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Sign in to keep this assessment, compare homes, schools and offices and reopen them any time. Guests can still download the PDF.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to={`/login?next=${next}`} className="inline-flex h-11 items-center justify-center rounded-xl border bg-card text-sm font-semibold hover:bg-secondary">Sign in</Link>
              <Link to={`/signup?next=${next}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">Create account</Link>
            </div>
          </div>
        )}
      </SectionCard>

      <Assumptions />

      <p className="px-1 pb-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        Screening estimate for awareness — get a site survey from an MNRE/OREDA-empanelled vendor and register for net
        metering with {r.location?.discom ?? "your Odisha DISCOM"} before buying.
        Climate: {r.climate.source}. {rupees(s.net_cost)} after the PM Surya Ghar + Odisha SFA subsidies.
      </p>
    </div>
  )
}

function MiniBar({ label, pts, of, className }: { label: string; pts: number; of: number; className: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-11 text-muted-foreground">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full transition-all duration-1000", className)} style={{ width: `${(pts / of) * 100}%` }} />
      </span>
      <span className="w-10 text-right font-semibold tabular">{pts}/{of}</span>
    </div>
  )
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-muted px-2 py-2.5">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className="font-heading text-[15px] font-medium tabular">{v}</div>
    </div>
  )
}

function Assumptions() {
  const { inputs, setInput, config, result } = useDashboard()
  const [open, setOpen] = useState(false)
  const num = (k: keyof Inputs, label: ReactNode, step: number, opts: { min?: number; max?: number; optional?: boolean; placeholder?: string } = {}) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span>
      <input type="number" step={step} min={opts.min} max={opts.max} inputMode="decimal" placeholder={opts.placeholder}
        value={(inputs[k] as number | null) ?? ""}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (opts.optional && e.target.value === "") setInput(k, null as never)
          else if (Number.isFinite(v)) setInput(k, v as never)
        }}
        className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
    </label>
  )
  return (
    <section className="rounded-2xl border border-border/80 bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left sm:px-5">
        <Settings2 className="size-[18px] text-sage-600" />
        <span className="flex-1 font-semibold">Assumptions &amp; data sources</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t px-4 pt-4 pb-5 sm:px-5">
          <div className="grid grid-cols-2 gap-3">
            {num("tariff", "Tariff ₹/unit (blank = OERC slabs)", 0.01, { min: 0, optional: true, placeholder: "auto" })}
            {num("sanctioned_load_kw", "Sanctioned load (kW)", 0.5, { min: 0, max: 500 })}
            {num("cost_per_kw", "Installed cost ₹/kW", 500, { min: 10000 })}
            {num("panel_w", "Panel size (Wp)", 5, { min: 100, max: 800 })}
            {num("export_rate", "Export ₹/unit (blank = GRIDCO APPC)", 0.01, { min: 0, optional: true, placeholder: "auto" })}
            {num("net_meter_pct", "Net-meter credit cap %", 5, { min: 0, max: 100 })}
            {num("tanker_price", "Tanker price ₹ (6,000 L)", 50, { min: 0 })}
            {num("design_rain_mm", "Heavy-rain day (mm)", 5, { min: 5, max: 300 })}
            {num("rwh_l_per_m2", "Rule: L per m² of roof", 5, { min: 0, max: 1000 })}
            {num("rrhs_cost_per_m2", "Rainwater system ₹/m²", 50, { min: 0 })}
            {num("rain_override_mm", "Rain mm/yr (blank = NASA)", 10, { min: 50, optional: true, placeholder: "auto" })}
            {num("usable_pct", "Usable roof for panels %", 5, { min: 30, max: 95 })}
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
              <span className="text-sm font-medium">PM Surya Ghar subsidy (central, homes)</span>
              <Switch checked={inputs.subsidy} onCheckedChange={(v) => setInput("subsidy", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
              <span className="min-w-0 text-sm font-medium">
                Odisha SFA state subsidy
                <span className="block text-xs font-normal text-muted-foreground">₹25,000/kW up to 2 kW + ₹10,000 for the 3rd kW, max ₹60,000</span>
              </span>
              <Switch checked={inputs.state_subsidy} onCheckedChange={(v) => setInput("state_subsidy", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
              <span className="min-w-0 text-sm font-medium">
                CHHATA rainwater subsidy
                <span className="block text-xs font-normal text-muted-foreground">Govt. of Odisha: 50% of the cost, up to ₹55,000</span>
              </span>
              <Switch checked={inputs.chhata} onCheckedChange={(v) => setInput("chhata", v)} />
            </label>
          </div>
          {result && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Climate for this roof: {result.climate.source}. Average sunlight {result.climate.ghi_avg.toFixed(2)} kWh/m²/day,
              performance ratio {result.solar.pr_avg.toFixed(2)} (temperature-corrected).
              {result.location?.district && <> Served by {result.location.discom_name} ({result.location.district} district).</>}
              Tariff: {result.solar.tariff_override
                ? `your flat ₹${result.solar.tariff.toFixed(2)}/unit`
                : `OERC domestic slabs, all-in ₹${result.solar.tariff.toFixed(2)}/unit at ${fmtIN(result.solar.annual_units / 12)} units/month`}.
            </p>
          )}
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {(config?.sources ?? []).map(([k, v, u]) => (
              <li key={k}><b className="text-foreground/80">{k}:</b> {v}{u && <> — <a href={u} target="_blank" rel="noopener" className="font-semibold text-sage-700 hover:underline">link</a></>}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
