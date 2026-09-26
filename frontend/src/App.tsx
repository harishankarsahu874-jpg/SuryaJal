import { lazy, Suspense, useCallback, useState } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { AnimatePresence } from "motion/react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PreflightLoader } from "@/components/preflight-loader"
import { LogoMark } from "@/components/brand/logo"
import { AuthProvider } from "@/lib/auth"
import LandingPage from "@/pages/landing"

// the map dashboard (Leaflet) and the rest load on demand
const DashboardPage = lazy(() => import("@/pages/dashboard"))
const LoginPage = lazy(() => import("@/pages/login"))
const AccountPage = lazy(() => import("@/pages/account"))
const DemoPage = lazy(() => import("@/pages/demo"))
const NotFoundPage = lazy(() => import("@/pages/not-found"))

const BOOT_KEY = "sj_booted"

function shouldShowIntro() {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.has("intro")) return true
    if (q.has("nointro") || window.location.pathname.startsWith("/demo")) return false
    return sessionStorage.getItem(BOOT_KEY) !== "1"
  } catch {
    return true
  }
}

function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <LogoMark className="size-14 animate-pulse" />
    </div>
  )
}

export default function App() {
  const [intro, setIntro] = useState(shouldShowIntro)
  const done = useCallback(() => {
    try { sessionStorage.setItem(BOOT_KEY, "1") } catch { /* private mode */ }
    setIntro(false)
  }, [])
  const replay = useCallback(() => {
    window.scrollTo({ top: 0 })
    setIntro(true)
  }, [])

  return (
    <AuthProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage onReplayIntro={replay} />} />
              <Route path="/app" element={<DashboardPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<LoginPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <AnimatePresence>{intro && <PreflightLoader key="preflight" onDone={done} />}</AnimatePresence>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AuthProvider>
  )
}
