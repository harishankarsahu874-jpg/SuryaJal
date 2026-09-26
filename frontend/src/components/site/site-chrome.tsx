import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Menu, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Logo, LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { UserMenu } from "@/components/site/user-menu"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#specs", label: "Tech specs" },
]

export function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  const solid = !transparent || scrolled || open
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        solid ? "border-b border-border/70 bg-background/85 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="rounded-xl" aria-label="SuryaJal home">
          <Logo markClassName="size-9" />
        </Link>
        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <UserMenu className="max-md:hidden" />
          <Button asChild className="h-10 rounded-xl px-4 font-semibold max-md:hidden">
            <Link to="/app">
              Open dashboard <ArrowRight />
            </Link>
          </Button>
          <UserMenu compact className="md:hidden" />
          <button
            type="button"
            className="grid size-10 place-items-center rounded-xl border bg-card md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t md:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-3">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-secondary">
                  {n.label}
                </a>
              ))}
              <Button asChild className="mt-1 h-11 rounded-xl font-semibold">
                <Link to="/app" onClick={() => setOpen(false)}>Open dashboard <ArrowRight /></Link>
              </Button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}

export function SiteFooter({ onReplayIntro }: { onReplayIntro?: () => void }) {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            A free screening tool built by the college Renewable Energy Club for Tech Fest 2026. Get a site
            survey from an MNRE-empanelled vendor before you buy.
          </p>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold">Product</div>
          <ul className="space-y-2 text-muted-foreground">
            <li><Link className="hover:text-foreground" to="/app">Roof dashboard</Link></li>
            <li><Link className="hover:text-foreground" to="/app?demo=1">Demo roof</Link></li>
            <li><Link className="hover:text-foreground" to="/account">My roofs</Link></li>
            <li><a className="hover:text-foreground" href="/classic">Classic tool (no-build fallback)</a></li>
            {onReplayIntro && (
              <li><button type="button" className="hover:text-foreground" onClick={onReplayIntro}>Replay intro</button></li>
            )}
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold">Data &amp; credits</div>
          <ul className="space-y-2 text-muted-foreground">
            <li>Climate: NASA POWER</li>
            <li>Imagery © Esri, Maxar, Earthstar Geographics</li>
            <li>Search © OpenStreetMap contributors</li>
            <li>Photos: Unsplash (Unsplash License)</li>
          </ul>
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span className="inline-flex items-center gap-2"><LogoMark className="size-5" /> © 2026 SuryaJal</span>
          <span>MobileSAM · FastAPI · React · Leaflet</span>
        </div>
      </div>
    </footer>
  )
}
