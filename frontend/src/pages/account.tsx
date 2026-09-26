import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import {
  ArrowRight, Download, Droplets, ExternalLink, Leaf, Loader2, LogOut, MonitorSmartphone, Plus, SolarPanel, Star,
  Trash2, TriangleAlert, Zap,
} from "lucide-react"
import { SiteHeader } from "@/components/site/site-chrome"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type SavedRoof } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtIN, initials, litres, rupees, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function AccountPage() {
  const { user, status, signOut, refresh, deleteAccount } = useAuth()
  const nav = useNavigate()
  const [roofs, setRoofs] = useState<SavedRoof[] | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<{ roofs: SavedRoof[] }>("/api/roofs")
      setRoofs(r.roofs)
    } catch (e) {
      toast.error((e as Error).message)
      setRoofs([])
    }
  }, [])

  useEffect(() => { document.title = "My roofs · SuryaJal" }, [])
  useEffect(() => { if (user) void load() }, [user, load])

  if (status === "loading") return <PageShell><Skeleton className="h-40 rounded-3xl" /></PageShell>
  if (!user) return <Navigate to="/login?next=%2Faccount" replace />

  const totals = (roofs ?? []).reduce((t, r) => ({
    kw: t.kw + r.summary.kw, litres: t.litres + r.summary.annual_harvest_l,
    savings: t.savings + r.summary.annual_savings, co2: t.co2 + r.summary.co2_t_year,
  }), { kw: 0, litres: 0, savings: 0, co2: 0 })

  const remove = async (id: number) => {
    const prev = roofs
    setRoofs((rs) => rs?.filter((r) => r.id !== id) ?? null)
    try {
      await api(`/api/roofs/${id}`, { method: "DELETE" })
      toast.success("Roof removed")
      void refresh()
    } catch (e) {
      setRoofs(prev)
      toast.error((e as Error).message)
    }
  }

  return (
    <PageShell>
      {/* profile header */}
      <section className="flex flex-col gap-5 rounded-3xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:p-8">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sage-600 to-sage-800 text-xl font-bold text-white shadow-md">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-3xl font-medium tracking-tight">Namaste, {user.name.split(" ")[0]} 👋</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{user.email} · member since {new Date(user.created_at * 1000).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="h-11 rounded-xl px-4 font-semibold"><Link to="/app"><Plus /> Check a roof</Link></Button>
          <Button variant="outline" className="h-11 rounded-xl bg-card px-4 font-semibold"
            onClick={async () => { await signOut(); toast.success("Signed out — see you soon!"); nav("/") }}>
            <LogOut /> Sign out
          </Button>
        </div>
      </section>

      {/* totals */}
      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total icon={Star} label="Roofs saved" value={roofs ? String(roofs.length) : "–"} />
        <Total icon={SolarPanel} label="Solar potential" value={roofs ? `${totals.kw.toFixed(1)} kW` : "–"} />
        <Total icon={Droplets} label="Rain harvest / yr" value={roofs ? litres(totals.litres) : "–"} />
        <Total icon={Leaf} label="CO₂ avoided / yr" value={roofs ? `${totals.co2.toFixed(1)} t` : "–"} />
      </section>

      <div className="mt-10 mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-medium tracking-tight">My roofs</h2>
          <p className="text-sm text-muted-foreground">Saved from the Report tab. Open one to tweak it, or grab the PDF.</p>
        </div>
      </div>

      {roofs === null ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-3xl" />)}</div>
      ) : roofs.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-sage-300 bg-card/60 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-sun-soft text-sun-ink"><Star className="size-6" /></span>
          <h3 className="font-heading mt-4 text-xl font-medium">No roofs saved yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Check a roof, then tap <b>Save</b> on the Report tab. It will show up here with its numbers.</p>
          <div className="mt-6 flex gap-2">
            <Button asChild className="h-11 rounded-xl font-semibold"><Link to="/app">Check my roof <ArrowRight /></Link></Button>
            <Button asChild variant="outline" className="h-11 rounded-xl bg-card font-semibold"><Link to="/app?demo=1">Demo roof</Link></Button>
          </div>
        </div>
      ) : (
        <motion.div layout className="grid gap-4 md:grid-cols-2">
          <AnimatePresence>
            {roofs.map((r) => <RoofCard key={r.id} roof={r} onDelete={() => void remove(r.id)} />)}
          </AnimatePresence>
        </motion.div>
      )}

      <section className="mt-12 rounded-3xl border bg-card p-6">
        <h3 className="font-semibold">Security</h3>
        <p className="mt-1 text-sm text-muted-foreground">Used SuryaJal on the fest laptop? Sign out everywhere, or delete your account and all saved roofs.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="h-10 rounded-xl bg-card font-semibold"
            onClick={async () => { await signOut(true); toast.success("Signed out on all devices"); nav("/") }}>
            <MonitorSmartphone /> Sign out on all devices
          </Button>
          <DeleteAccount onDelete={async (pw) => { await deleteAccount(pw); toast.success("Account deleted"); nav("/") }} />
        </div>
      </section>
    </PageShell>
  )
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 pt-24 pb-20 sm:px-6">{children}</main>
    </div>
  )
}

function Total({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <Icon className="size-[18px] text-sage-600" />
      <div className="font-heading mt-3 text-2xl font-medium tabular">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function RoofCard({ roof, onDelete }: { roof: SavedRoof; onDelete: () => void }) {
  const s = roof.summary
  const gradeTone = s.score >= 75 ? "bg-emerald-600" : s.score >= 50 ? "bg-amber-500" : "bg-red-600"
  return (
    <motion.article layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
      className="group flex flex-col overflow-hidden rounded-3xl border bg-card shadow-sm transition hover:shadow-lg">
      <div className="relative h-36 overflow-hidden bg-sage-900">
        <img src={`/api/thumb?${roof.query}&size=480`} alt={`Satellite view of ${roof.title}`} loading="lazy"
          className="size-full object-cover transition duration-700 group-hover:scale-105" />
        <span className={cn("absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow", gradeTone)}>
          {s.score} · {s.grade}
        </span>
        <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
          {s.method === "ai" ? "AI outline" : "Hand-drawn"} · {fmtIN(s.area_m2)} m²
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading line-clamp-2 text-lg leading-snug font-medium">{roof.title}</h3>
          <span className="shrink-0 pt-1 text-xs text-muted-foreground">{timeAgo(roof.updated_at)}</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat icon={Zap} k="Solar" v={`${s.kw.toFixed(2)} kW`} />
          <Stat icon={SolarPanel} k="Payback" v={s.payback_years ? `${s.payback_years.toFixed(1)} yrs` : "—"} />
          <Stat icon={Droplets} k="Rain / yr" v={`${fmtIN(s.annual_harvest_l / 1000)} kL`} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{rupees(s.annual_savings)} saved a year · {s.panels} panels · {fmtIN(s.tank_l)} L tank</p>
        <div className="mt-4 flex gap-2 pt-1">
          <Button asChild className="h-10 flex-1 rounded-xl font-semibold"><Link to={`/app?${roof.query}`}><ExternalLink /> Open</Link></Button>
          <Button asChild variant="outline" className="h-10 rounded-xl bg-card font-semibold"><a href={`/r?${roof.query}&dl=1`} aria-label="Download PDF"><Download /> PDF</a></Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="h-10 rounded-xl text-muted-foreground hover:text-red-700" aria-label="Delete roof"><Trash2 /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this roof?</AlertDialogTitle>
                <AlertDialogDescription>“{roof.title}” will be removed from My roofs. You can always check it again.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </motion.article>
  )
}

function Stat({ icon: Icon, k, v }: { icon: typeof Zap; k: string; v: string }) {
  return (
    <div className="rounded-xl bg-muted px-2 py-2.5">
      <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><Icon className="size-3" /> {k}</dt>
      <dd className="font-heading mt-0.5 text-[15px] font-medium tabular">{v}</dd>
    </div>
  )
}

function DeleteAccount({ onDelete }: { onDelete: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <AlertDialog onOpenChange={() => { setPw(""); setErr(null) }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="h-10 rounded-xl font-semibold text-red-700 hover:bg-red-50 hover:text-red-800"><Trash2 /> Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>This removes your account and every saved roof from this server. Type your password to confirm.</AlertDialogDescription>
        </AlertDialogHeader>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" autoComplete="current-password"
          className="h-11 w-full rounded-xl border bg-card px-3 text-sm outline-none focus:ring-3 focus:ring-ring/30" />
        {err && <p className="flex items-center gap-1.5 text-sm text-red-700"><TriangleAlert className="size-4" /> {err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!pw || busy} onClick={async () => {
            setBusy(true); setErr(null)
            try { await onDelete(pw) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
          }}>
            {busy && <Loader2 className="animate-spin" />} Delete forever
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
