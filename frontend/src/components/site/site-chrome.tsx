import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Logo, LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { UserMenu } from "@/components/site/user-menu"
import { cn } from "@/lib/utils"

export function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  const solid = !transparent || scrolled
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        solid ? "border-b border-border/70 bg-background/85 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
        <Link to="/" className="rounded-xl" aria-label="SuryaJal home">
          <Logo markClassName="size-9" />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <UserMenu className="max-sm:hidden" />
          <Button asChild className="h-10 rounded-xl px-4 font-semibold">
            <Link to="/app">
              Open dashboard <ArrowRight className="max-sm:hidden" />
            </Link>
          </Button>
          <UserMenu compact className="sm:hidden" />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter({ onReplayIntro }: { onReplayIntro?: () => void }) {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
        <span className="inline-flex items-center gap-2"><LogoMark className="size-5" /> © 2026 SuryaJal</span>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-medium">
          <Link className="hover:text-foreground" to="/app">Roof dashboard</Link>
          <Link className="hover:text-foreground" to="/app?demo=1">Demo roof</Link>
          <Link className="hover:text-foreground" to="/account">My roofs</Link>
          <a className="hover:text-foreground" href="/classic">Classic tool</a>
          {onReplayIntro && (
            <button type="button" className="hover:text-foreground" onClick={onReplayIntro}>Replay intro</button>
          )}
        </nav>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-3 text-[11px] text-muted-foreground/80 sm:px-6">
          Climate: NASA POWER · Imagery © Esri, Maxar, Earthstar Geographics · Search © OpenStreetMap contributors · Photos: Unsplash
        </p>
      </div>
    </footer>
  )
}
