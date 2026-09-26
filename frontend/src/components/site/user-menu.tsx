import { Link, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Home, LayoutDashboard, LogIn, LogOut, MonitorSmartphone, Star, User, UserPlus } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Avatar menu when signed in; sign-in / create-account entry when signed out. */
export function UserMenu({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { user, status, signOut } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const next = encodeURIComponent(loc.pathname + loc.search)

  if (status === "loading") return <Skeleton className={cn("size-10 rounded-xl", className)} />

  const doSignOut = async (everywhere = false) => {
    await signOut(everywhere)
    toast.success(everywhere ? "Signed out on all devices" : "Signed out — see you soon!")
    if (loc.pathname.startsWith("/account")) nav("/")
  }

  if (!user) {
    if (!compact) {
      return (
        <div className={cn("flex items-center gap-1.5", className)}>
          <Button asChild variant="ghost" className="h-10 rounded-xl px-3.5 text-sm font-semibold">
            <Link to={`/login?next=${next}`}>Sign in</Link>
          </Button>
          <Button asChild variant="secondary" className="h-10 rounded-xl px-4 text-sm font-semibold max-sm:hidden">
            <Link to={`/signup?next=${next}`}>Create account</Link>
          </Button>
        </div>
      )
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "grid size-10 place-items-center rounded-xl bg-sage-700 text-white shadow-sm transition hover:bg-sage-800 focus-visible:ring-3 focus-visible:ring-ring/50",
              className,
            )}
            aria-label="Account"
          >
            <User className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
          <DropdownMenuLabel className="px-2 py-1.5">
            <div className="text-sm font-semibold text-foreground">You're a guest</div>
            <div className="text-xs font-normal text-muted-foreground">Sign in to save your roofs</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => nav(`/login?next=${next}`)}>
            <LogIn /> Sign in
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nav(`/signup?next=${next}`)}>
            <UserPlus /> Create free account
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => nav("/")}>
            <Home /> SuryaJal home
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar className="size-10 rounded-xl after:rounded-xl">
            <AvatarFallback className="rounded-xl bg-gradient-to-br from-sage-600 to-sage-800 text-sm font-bold text-white">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1.5">
          <div className="truncate text-sm font-semibold text-foreground">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => nav("/account")}>
            <Star /> My roofs
            {typeof user.roofs === "number" && user.roofs > 0 && (
              <span className="ml-auto rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-secondary-foreground">
                {user.roofs}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nav("/app")}>
            <LayoutDashboard /> Roof dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nav("/")}>
            <Home /> SuryaJal home
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doSignOut(false)}>
          <LogOut /> Sign out
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void doSignOut(true)} className="text-muted-foreground">
          <MonitorSmartphone /> Sign out on all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
