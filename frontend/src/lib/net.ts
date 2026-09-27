import { useEffect, useState } from "react"
import { api } from "./api"

/**
 * Base URL that a *phone* can open.
 *
 * When you run SuryaJal on your PC (run.bat / run.sh) the site lives on
 * http://localhost:8000 — a QR code pointing there can never be scanned open on a
 * phone, which is why the "QR not working" reports happen. This hook asks the backend
 * for the machine's Wi-Fi/LAN IP (/api/net) and rebuilds share links as
 * http://<lan-ip>:<port>/… so any phone on the same Wi-Fi or hotspot can open them.
 *
 * Returns "" whenever the current origin is already externally reachable
 * (a deployed domain, a tunnel, a preview URL…), so links keep using it untouched.
 */
export function usePhoneBase(): string {
  const [base, setBase] = useState("")
  useEffect(() => {
    const h = window.location.hostname
    if (h !== "localhost" && h !== "127.0.0.1") return
    let alive = true
    api<{ ips: string[]; port: number }>("/api/net")
      .then((n) => {
        const ip = n.ips.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x) && !x.startsWith("127."))
        if (alive && ip) setBase(n.port === 80 ? `http://${ip}` : `http://${ip}:${n.port}`)
      })
      .catch(() => { /* offline / no LAN - keep the localhost origin */ })
    return () => { alive = false }
  }, [])
  return base
}
