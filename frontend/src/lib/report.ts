import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { decodePolyline } from "@/lib/geo"
import { capturePolyCrop } from "@/lib/mapcrop"

/**
 * Report download + open helpers that keep working everywhere:
 *  - normal browsers (a real file in the Downloads folder),
 *  - embedded preview frames (Chrome blocks `Content-Disposition: attachment`
 *    navigations inside cross-origin iframes, which made the old <a href> buttons
 *    silently do nothing — fetching a blob and clicking a temporary link avoids that),
 *  - phones (blob downloads land in the notification shade / Downloads).
 */

/** The PDF's satellite picture is drawn from the tiles this browser already has,
 *  so the report keeps its imagery even when the server has no internet. */
async function browserCrop(query: string): Promise<Record<string, unknown> | null> {
  try {
    const p = new URLSearchParams(query).get("p")
    const poly = p ? decodePolyline(p) : []
    if (poly.length < 3) return null
    const cap = await capturePolyCrop(poly, 640)
    if (!cap) return null
    return { image: cap.canvas.toDataURL("image/png"), origin: [cap.gx0, cap.gy0], z: cap.z }
  } catch {
    return null
  }
}

async function fetchReportPdf(query: string): Promise<{ blob: Blob; name: string }> {
  const accept = { Accept: "application/pdf" }
  // 1) POST with the browser-captured crop (POST /r added in 2.1; falls back below)
  const crop = await browserCrop(query)
  let res = await fetch("/r", {
    method: "POST",
    headers: { ...accept, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${query}&dl=1`, ...(crop ?? {}) }),
  }).catch(() => null)
  // 2) classic GET (share-link path) — works on older servers too
  if (!res || res.status === 404 || res.status === 405) {
    res = await fetch(`/r?${query}&dl=1`, { headers: accept })
  }
  if (!res.ok) {
    let msg = `Could not build the report (HTTP ${res.status})`
    try {
      const j = (await res.json()) as { detail?: unknown }
      if (j && typeof j.detail === "string" && j.detail) msg = j.detail
    } catch { /* plain-text / html error page */ }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")
  const name = m ? decodeURIComponent(m[1].trim()) : "SuryaJal_Green_Roof_Report.pdf"
  return { blob, name }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Spinner state + a `download(query)` action for every "Download report PDF" button. */
export function useReportDownload() {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const download = useCallback(async (query: string) => {
    if (busyRef.current || !query) return
    busyRef.current = true
    setBusy(true)
    try {
      const { blob, name } = await fetchReportPdf(query)
      saveBlob(blob, name)
      // inside embedded preview frames a sandbox can silently block even blob
      // downloads — give the user a one-tap escape hatch when that happens
      const embedded = (() => { try { return window.self !== window.top } catch { return true } })()
      toast.success("Report downloaded 📥", {
        description: `${name} — check your Downloads (on phones: the notification shade).`,
        ...(embedded ? { action: { label: "Not saved? Open", onClick: () => openReport(`/r?${query}`) }, duration: 12_000 } : {}),
      })
    } catch (e) {
      toast.error((e as Error).message || "Download failed", {
        description: "Use “Open” to view the report instead — you can save it from there.",
        duration: 9000,
      })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])
  return { busy, download }
}

/** Open the report in a new tab; if pop-ups are blocked (embedded frames), fall back
 *  to showing it in this tab — Chrome/Firefox render the PDF inline, and Back returns
 *  to the dashboard with everything intact (the query string carries the state). */
export function openReport(url: string) {
  // NOTE: not using the "noopener" feature string — it makes window.open return null
  // even when the pop-up succeeds, which we could not tell apart from a block.
  const w = window.open(url, "_blank")
  if (w) {
    w.opener = null          // same isolation "noopener" would have given us
    return
  }
  toast.info("Pop-ups are blocked here — opening the report in this tab instead.")
  window.location.assign(url)
}
