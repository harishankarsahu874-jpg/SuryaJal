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
    <footer className="border-t border-border/80 bg-card">
      <div className="mx-auto grid max-w-6xl gap-9 px-4 py-12 sm:px-6 sm:py-14 md:grid-cols-[1.2fr_0.72fr_1fr] md:gap-10">
        <div>
          <Link to="/" className="inline-flex items-center gap-2.5 rounded-xl" aria-label="SuryaJal home">
            <LogoMark className="size-11" />
            <span className="font-heading text-xl font-semibold tracking-tight">Surya<span className="text-water">Jal</span></span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            A free screening tool built by the college Renewable Energy Club for Tech Fest 2026. Get a site survey from an MNRE-empanelled vendor before you buy.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground">Product</h2>
          <nav aria-label="Footer product links" className="mt-3 grid justify-items-start gap-2.5 text-sm text-muted-foreground">
            <Link className="transition-colors hover:text-foreground" to="/app">Roof dashboard</Link>
            <Link className="transition-colors hover:text-foreground" to="/app?demo=1">Demo roof</Link>
            <Link className="transition-colors hover:text-foreground" to="/account">My roofs</Link>
            <a className="transition-colors hover:text-foreground" href="/classic">Classic tool (no-build fallback)</a>
            {onReplayIntro && (
              <button type="button" className="transition-colors hover:text-foreground" onClick={onReplayIntro}>Replay intro</button>
            )}
          </nav>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground">Data &amp; credits</h2>
          <ul className="mt-3 grid gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <li>Climate: NASA POWER</li>
            <li>Imagery © Esri, Maxar, Earthstar Geographics</li>
            <li>Search © OpenStreetMap contributors</li>
            <li>Photos: Unsplash (Unsplash License)</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/80">
        <p className="mx-auto max-w-6xl px-4 py-3 text-[11px] text-muted-foreground/80 sm:px-6">
          © 2026 SuryaJal · A free screening estimate — confirm costs and eligibility with your DISCOM and an empanelled vendor.
        </p>
      </div>
    </footer>
  )
}
