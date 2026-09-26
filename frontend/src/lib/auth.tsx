import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api, ApiError, tokenStore, type AuthResponse, type User } from "@/lib/api"

type Status = "loading" | "ready"

interface AuthState {
  user: User | null
  status: Status
  signIn: (email: string, password: string, remember: boolean) => Promise<User>
  signUp: (name: string, email: string, password: string) => Promise<User>
  signOut: (everywhere?: boolean) => Promise<void>
  refresh: () => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? "loading" : "ready"))

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null)
      setStatus("ready")
      return
    }
    try {
      const r = await api<{ user: User }>("/api/auth/me")
      setUser(r.user)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        tokenStore.clear()
        setUser(null)
      }
    } finally {
      setStatus("ready")
    }
  }, [])

  useEffect(() => {
    void refresh()
    // keep several open tabs in sync (sign out in one tab -> signed out everywhere)
    const onStorage = (e: StorageEvent) => {
      if (e.key === tokenStore.key) void refresh()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const r = await api<AuthResponse>("/api/auth/login", { body: { email, password, remember } })
    tokenStore.set(r.token, remember)
    setUser(r.user)
    return r.user
  }, [])

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const r = await api<AuthResponse>("/api/auth/signup", { body: { name, email, password } })
    tokenStore.set(r.token, true)
    setUser(r.user)
    return r.user
  }, [])

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await api(`/api/auth/logout${everywhere ? "?everywhere=true" : ""}`, { method: "POST" })
    } catch {
      /* offline: still forget the token locally */
    }
    tokenStore.clear()
    setUser(null)
  }, [])

  const deleteAccount = useCallback(async (password: string) => {
    await api("/api/auth/me", { method: "DELETE", body: { password } })
    tokenStore.clear()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, status, signIn, signUp, signOut, refresh, deleteAccount }),
    [user, status, signIn, signUp, signOut, refresh, deleteAccount],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
