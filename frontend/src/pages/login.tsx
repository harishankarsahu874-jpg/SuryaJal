import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import {
  ArrowLeft, ArrowRight, BookmarkCheck, Eye, EyeOff, GitCompareArrows, Loader2, Lock, LogOut, Mail, RefreshCw,
  ShieldCheck, TriangleAlert, User,
} from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

function strength(pw: string) {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  const level = pw.length < 8 ? 0 : s <= 2 ? 1 : s === 3 ? 2 : 3
  return { level, label: ["Too short", "Fair", "Good", "Strong"][level] }
}

/** Only allow in-app redirects after sign-in (no open redirects). */
function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null
  return raw
}

export default function LoginPage() {
  const loc = useLocation()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const mode: "signin" | "signup" = loc.pathname.startsWith("/signup") ? "signup" : "signin"
  const next = safeNext(params.get("next"))
  const { user, status, signIn, signUp, signOut } = useAuth()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pw = useMemo(() => strength(password), [password])

  useEffect(() => {
    document.title = mode === "signup" ? "Create account · SuryaJal" : "Sign in · SuryaJal"
    setError(null)
  }, [mode])

  const switchMode = (m: "signin" | "signup") => {
    const q = next ? `?next=${encodeURIComponent(next)}` : ""
    nav(`${m === "signup" ? "/signup" : "/login"}${q}`, { replace: true })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === "signup" && password.length < 8) return setError("Password must be at least 8 characters.")
    setBusy(true)
    try {
      const u = mode === "signup" ? await signUp(name, email, password) : await signIn(email, password, remember)
      toast.success(mode === "signup" ? `Account created — welcome, ${u.name.split(" ")[0]}!` : `Welcome back, ${u.name.split(" ")[0]}!`)
      nav(next ?? "/account", { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <main className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ArrowLeft className="size-4" /> Home
          </Link>
          <Link to="/" className="lg:hidden" aria-label="SuryaJal home"><Logo markClassName="size-8" /></Link>
        </div>

        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          {status === "ready" && user ? (
            <SignedInCard name={user.name} email={user.email} next={next}
              onSignOut={async () => { await signOut(); toast.success("Signed out") }} />
          ) : (
            <>
              <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <h1 className="font-heading text-[2.1rem] leading-tight font-medium tracking-tight">
                  {mode === "signup" ? "Create your account" : "Welcome back"}
                </h1>
                <p className="mt-2 text-[15px] text-muted-foreground">
                  {mode === "signup" ? "Save every roof you check and reopen your reports any time." : "Sign in to see your saved roofs and reports."}
                </p>
              </motion.div>

              {/* segmented switch */}
              <div className="mt-7 grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist">
                {(["signin", "signup"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                    className={cn("relative h-10 rounded-lg text-sm font-semibold transition", mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-lg bg-card shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <span className="relative">{m === "signin" ? "Sign in" : "Create account"}</span>
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <AnimatePresence initial={false}>
                  {mode === "signup" && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <Field label="Your name" icon={<User />}>
                        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Asha Rao" maxLength={60}
                          className="h-full w-full bg-transparent outline-none placeholder:text-muted-foreground/70" />
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>
                <Field label="Email" icon={<Mail />}>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required
                    placeholder="you@example.com" className="h-full w-full bg-transparent outline-none placeholder:text-muted-foreground/70" />
                </Field>
                <div>
                  <Field label="Password" icon={<Lock />}
                    trailing={
                      <button type="button" onClick={() => setShow((s) => !s)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label={show ? "Hide password" : "Show password"}>
                        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    }>
                    <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                      autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={mode === "signup" ? "8+ characters" : "Your password"}
                      className="h-full w-full bg-transparent outline-none placeholder:text-muted-foreground/70" />
                  </Field>
                  {mode === "signup" && password && (
                    <div className="mt-2">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors",
                            pw.level > i ? ["", "bg-amber-400", "bg-sage-500", "bg-emerald-600"][pw.level] : "bg-muted")} />
                        ))}
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                        <span>{pw.label}</span><span>Tip: a short phrase like “sun and rain 2026”</span>
                      </div>
                    </div>
                  )}
                </div>

                {mode === "signin" && (
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                    Keep me signed in on this device
                  </label>
                )}

                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button type="submit" disabled={busy} className="h-12 w-full rounded-xl text-[15px] font-semibold">
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {mode === "signup" ? "Create account" : "Sign in"} {!busy && <ArrowRight />}
                </Button>
              </form>

              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <Button asChild variant="outline" className="h-12 w-full rounded-xl bg-card text-[15px] font-semibold">
                <Link to={next ?? "/app"}>Continue as guest</Link>
              </Button>
              <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sage-600" />
                Accounts live only on this SuryaJal server. Passwords are scrypt-hashed and no emails are ever sent. Guests can use every feature except “My roofs”.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function Field({ label, icon, trailing, children }: { label: string; icon: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <span className="flex h-12 items-center gap-2.5 rounded-xl border bg-card pr-1.5 pl-3.5 text-[15px] shadow-[0_1px_2px_rgba(27,38,31,.04)] transition focus-within:border-sage-400 focus-within:ring-3 focus-within:ring-ring/30 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
        {icon}
        {children}
        {trailing}
      </span>
    </label>
  )
}

function SignedInCard({ name, email, next, onSignOut }: { name: string; email: string; next: string | null; onSignOut: () => void }) {
  return (
    <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-sage-600 to-sage-800 text-xl font-bold text-white">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <h1 className="font-heading mt-4 text-2xl font-medium">You’re signed in</h1>
      <p className="mt-1 text-sm text-muted-foreground">{name} · {email}</p>
      <div className="mt-6 grid gap-2">
        <Button asChild className="h-11 rounded-xl font-semibold"><Link to={next ?? "/account"}>{next ? "Continue" : "Go to My roofs"} <ArrowRight /></Link></Button>
        <Button asChild variant="outline" className="h-11 rounded-xl bg-card font-semibold"><Link to="/app">Open the dashboard</Link></Button>
        <Button variant="ghost" className="h-11 rounded-xl font-semibold text-muted-foreground" onClick={onSignOut}><LogOut /> Sign out</Button>
      </div>
    </div>
  )
}

function BrandPanel() {
  const perks = [
    { icon: BookmarkCheck, t: "Keep every Green Roof Report", d: "Your roofs, savings and rain plans in one place." },
    { icon: GitCompareArrows, t: "Compare family homes", d: "See which roof gives the best payback." },
    { icon: RefreshCw, t: "Reopen and tweak any time", d: "Change your bill or panels — numbers update live." },
  ]
  return (
    <aside className="relative hidden overflow-hidden lg:block">
      <img src="/images/login-solar-dusk.webp" alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-sage-950 via-sage-950/75 to-sage-900/25" />
      <div className="relative flex h-full flex-col justify-between p-10 text-white">
        <Link to="/" aria-label="SuryaJal home" className="w-fit"><Logo inverted markClassName="size-10" /></Link>
        <div>
          <h2 className="font-heading max-w-md text-[2.6rem] leading-[1.05] font-medium tracking-tight">Save every roof you check.</h2>
          <ul className="mt-8 space-y-4">
            {perks.map((p, i) => (
              <motion.li key={p.t} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.1 }}
                className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/12 backdrop-blur"><p.icon className="size-5" /></span>
                <span><span className="block font-semibold">{p.t}</span><span className="block text-sm text-white/65">{p.d}</span></span>
              </motion.li>
            ))}
          </ul>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
            className="mt-10 grid max-w-md grid-cols-3 gap-2 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-md">
            {[["2.70 kWp", "solar"], ["1.3 yrs", "payback"], ["2.37 lakh L", "rain / yr"]].map(([v, k]) => (
              <div key={k} className="rounded-xl bg-white/8 px-2 py-2.5 text-center">
                <div className="font-heading text-lg font-semibold">{v}</div>
                <div className="text-[11px] text-white/60">{k}</div>
              </div>
            ))}
            <div className="col-span-3 px-1 pt-1 text-[11px] text-white/55">Demo roof · Ward 27, Bhubaneswar (TPCODL)</div>
          </motion.div>
        </div>
      </div>
    </aside>
  )
}
