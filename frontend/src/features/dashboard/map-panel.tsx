import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import {
  ArrowRight, Check, Eraser, Loader2, MapPin, Minus, PenLine, Plus, RotateCcw, Search, Sparkles, Undo2, X,
} from "lucide-react"
import { api, type LocationInfo, type SegmentResponse } from "@/lib/api"
import { searchPlaces, type GeoResult } from "@/lib/geosearch"
import { areaM2, latlonToPx, ODISHA_CENTER, ODISHA_CITIES, ODISHA_ZOOM, type LatLng } from "@/lib/geo"
import { EsriImagery, type ImageryFallbackEvent } from "@/lib/imagery"
import { fmtIN, litres, sqft } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useDashboard } from "./state"

type SegPoint = { lat: number; lon: number; label: 0 | 1 }

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const divIcon = (cls: string) => L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [0, 0] })

function zoomFor(type: string) {
  if (["house", "building", "apartments", "residential", "yes", "detached", "school", "college", "university"].includes(type)) return 19
  if (["road", "street", "tertiary", "secondary", "primary", "service", "living_street"].includes(type)) return 18
  if (["neighbourhood", "suburb", "quarter", "hamlet"].includes(type)) return 16
  if (["city", "town", "administrative", "county", "state_district"].includes(type)) return 13
  if (type === "postcode") return 15
  if (type === "postcode_area") return 12
  return 17
}

/** Approximate position from the browser's network - works even when GPS is
 * blocked (e.g. embedded previews without the geolocation permission). */
async function ipLocate(): Promise<{ lat: number; lon: number; city: string | null } | null> {
  const sources: (() => Promise<{ lat: number; lon: number; city: string | null } | null>)[] = [
    async () => {
      const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(5000) })
      const j = await r.json() as { success?: boolean; latitude?: number; longitude?: number; city?: string }
      const lat = Number(j?.latitude), lon = Number(j?.longitude)
      return j?.success !== false && isFinite(lat) && isFinite(lon)
        ? { lat, lon, city: j?.city ?? null } : null
    },
    async () => {
      const r = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(5000) })
      const j = await r.json() as { error?: boolean; latitude?: number; longitude?: number; city?: string }
      const lat = Number(j?.latitude), lon = Number(j?.longitude)
      return !j?.error && isFinite(lat) && isFinite(lon)
        ? { lat, lon, city: j?.city ?? null } : null
    },
  ]
  for (const s of sources) {
    try {
      const hit = await s()
      if (hit) return hit
    } catch { /* try the next source */ }
  }
  return null
}

// ---------------------------------------------------- browser-side crop for the roof AI
const SEG_CROP_PX = 512

function loadTileImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Esri's grey "Map data not yet available" tile is flat - same idea as app/tiles.py. */
function isPlaceholderTile(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas")
    c.width = 32; c.height = 32
    const ctx = c.getContext("2d")
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, 32, 32)
    const d = ctx.getImageData(0, 0, 32, 32).data
    let s = 0, s2 = 0
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
      s += g; s2 += g * g
    }
    const n = d.length / 4
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) < 12
  } catch {
    return false
  }
}

/**
 * Draw the crop the roof AI needs from the browser's own tile access (the map is
 * already showing these tiles), mirroring TileFetcher.crop_around in app/tiles.py:
 * 512 px centered crop, stepping the zoom down while imagery is missing. Sending
 * the image to /api/segment keeps tap-to-trace working even when the backend
 * machine has no internet - only the user's browser needs it.
 */
async function captureCrop(lat: number, lon: number, z0: number):
  Promise<{ image: string; z: number; gx0: number; gy0: number } | null> {
  for (let z = Math.min(z0, 19); z >= 14 && z > Math.min(z0, 19) - 3; z--) {
    const [gx, gy] = latlonToPx(lat, lon, z)
    const gx0 = Math.floor(gx - SEG_CROP_PX / 2), gy0 = Math.floor(gy - SEG_CROP_PX / 2)
    const tx0 = Math.floor(gx0 / 256), ty0 = Math.floor(gy0 / 256)
    const tx1 = Math.floor((gx0 + SEG_CROP_PX - 1) / 256), ty1 = Math.floor((gy0 + SEG_CROP_PX - 1) / 256)
    const canvas = document.createElement("canvas")
    canvas.width = SEG_CROP_PX
    canvas.height = SEG_CROP_PX
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.fillStyle = "#282828"
    ctx.fillRect(0, 0, SEG_CROP_PX, SEG_CROP_PX)
    const jobs: { tx: number; ty: number }[] = []
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty })
    const imgs = await Promise.all(jobs.map(({ tx, ty }) =>
      loadTileImg(`${ESRI}/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`)))
    let bad = 0
    jobs.forEach(({ tx, ty }, i) => {
      const t = imgs[i]
      if (!t || isPlaceholderTile(t)) { bad++; return }
      ctx.drawImage(t, tx * 256 - gx0, ty * 256 - gy0)
    })
    if (bad / jobs.length > 0.25) continue          // imagery missing here: try one zoom out
    try {
      return { image: canvas.toDataURL("image/png"), z, gx0, gy0 }
    } catch {
      return null                                    // tiles without CORS: let the server fetch
    }
  }
  return null
}

export function MapPanel({ visible }: { visible: boolean }) {
  const ctx = useDashboard()
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const elRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<{
    roof: L.Polygon; panels: L.LayerGroup; handles: L.LayerGroup; prompts: L.LayerGroup; draw: L.LayerGroup
    tip: L.Tooltip; rubber: L.Polyline | null; pulse: L.Marker | null; me: L.Marker | null
  } | null>(null)
  // interaction state lives in a ref (Leaflet handlers are registered once) + a tick to re-render the UI
  const S = useRef({ mode: "ai" as "ai" | "draw", busy: false, aiPoints: [] as SegPoint[], refine: null as 0 | 1 | null,
    drawPts: [] as LatLng[], warned: false, zoom: ODISHA_ZOOM }).current
  const [, tick] = useReducer((x: number) => x + 1, 0)
  const [hint, setHintState] = useState<{ html: ReactNode; busy?: boolean }>({ html: <>Search your area, zoom in and <b>tap your roof</b></> })
  const [liveArea, setLiveArea] = useState<number | null>(null)
  const setHint = (html: ReactNode, busy = false) => setHintState({ html, busy })

  const idleHint = useCallback(() => {
    if (S.mode === "draw") return
    const c = ctxRef.current
    if (c.roof) setHint(<>Tap another roof, drag the <b>yellow dots</b> to fine-tune, or use ＋ / －</>)
    else if (S.zoom < 17) setHint(<>Zoom in closer to your house, then <b>tap its roof</b></>)
    else setHint(<>Tap the <b>middle of your roof</b> 👆</>)
  }, [S])

  // ------------------------------------------------------------ map setup (once)
  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, { zoomControl: false, maxZoom: 21, minZoom: 3, worldCopyJump: true })
      .setView(ODISHA_CENTER, ODISHA_ZOOM)          // Bhubaneswar, Odisha
    mapRef.current = map
    // Esri has no z19 close-ups in many Odisha towns (it answers with a grey "Map data not yet
    // available" tile). EsriImagery detects that and shows the nearest zoom that has a photo.
    const imagery = new EsriImagery(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics | Search © OpenStreetMap",
    }).addTo(map)
    imagery.once("imagery:fallback", (e) => {
      const lv = (e as ImageryFallbackEvent).levelsUp
      toast.info(`No street-level satellite photo exists for this spot yet — showing the nearest zoom ` +
        `(${lv} level${lv > 1 ? "s" : ""} out, a little blurry). You can still tap your roof: the AI adapts.`,
        { duration: 9000 })
    })
    const labels = L.layerGroup([
      L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.9 }),
      L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.5 }),
    ]).addTo(map)
    L.control.zoom({ position: "bottomright" }).addTo(map)
    L.control.layers(undefined, { "Place & road labels": labels }, { position: "bottomright", collapsed: true }).addTo(map)
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map)
    map.getContainer().style.cursor = "crosshair"

    layers.current = {
      roof: L.polygon([], { color: "#FACC15", weight: 3, fillColor: "#FACC15", fillOpacity: 0.12 }).addTo(map),
      panels: L.layerGroup().addTo(map),
      handles: L.layerGroup().addTo(map),
      prompts: L.layerGroup().addTo(map),
      draw: L.layerGroup().addTo(map),
      tip: L.tooltip({ permanent: true, direction: "top", className: "sj-area-tip", offset: [0, -8], interactive: false }),
      rubber: null, pulse: null, me: null,
    }

    map.on("zoomend", () => {
      S.zoom = map.getZoom()
      if (!S.busy) idleHint()
    })
    map.on("click", (e: L.LeafletMouseEvent) => onMapClick(e.latlng))
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const ly = layers.current!
      if (S.mode !== "draw" || !S.drawPts.length) {
        if (ly.rubber) { ly.rubber.remove(); ly.rubber = null }
        return
      }
      const last = S.drawPts[S.drawPts.length - 1]
      if (!ly.rubber) ly.rubber = L.polyline([last, e.latlng], { color: "#FACC15", weight: 2, dashArray: "2 6", interactive: false }).addTo(map)
      else ly.rubber.setLatLngs([last, e.latlng])
    })

    ctxRef.current.mapApi.current = {
      locate: () => locate(),
      flyTo: (lat, lon, z) => map.flyTo([lat, lon], z, { duration: 1.2 }),
      invalidate: () => map.invalidateSize(),
    }
    return () => {
      map.remove()
      mapRef.current = null
      layers.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (visible) setTimeout(() => mapRef.current?.invalidateSize(), 50)
  }, [visible])

  // keep Leaflet's bottom controls (zoom, layers, scale) above our floating tool stack
  useEffect(() => {
    const el = stackRef.current, wrap = wrapRef.current
    if (!el || !wrap) return
    const ro = new ResizeObserver(() => wrap.style.setProperty("--sj-stack", `${Math.round(el.offsetHeight)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ roof -> map
  const roof = ctx.roof
  const lastFit = useRef(0)
  useEffect(() => {
    const map = mapRef.current, ly = layers.current
    if (!map || !ly) return
    setLiveArea(null)
    ly.handles.clearLayers()
    if (!roof) {
      ly.roof.setLatLngs([])
      ly.tip.remove()
      ;[ly.panels, ly.prompts, ly.draw].forEach((l) => l.clearLayers())
      S.aiPoints = []
      S.refine = null
      tick()
      idleHint()
      return
    }
    ly.roof.setLatLngs(roof.latlngs)
    placeTip(roof.latlngs)
    // draggable corner handles
    roof.latlngs.forEach((ll, i) => {
      const m = L.marker(ll, { draggable: true, icon: divIcon("sj-vtx"), keyboard: false, zIndexOffset: 1000 })
      const live = roof.latlngs.map((p) => [p[0], p[1]] as LatLng)
      m.on("drag", (e) => {
        const p = (e.target as L.Marker).getLatLng()
        live[i] = [p.lat, p.lng]
        ly.roof.setLatLngs(live)
        ly.panels.clearLayers()
        placeTip(live)
        setLiveArea(areaM2(live))
      })
      m.on("dragend", () => {
        const c = ctxRef.current
        const method = roof.method === "ai" ? "ai-edited" : roof.method
        c.setRoof(live, method, roof.conf, { keepPanels: true })
      })
      m.addTo(ly.handles)
    })
    if (roof.fitNonce && roof.fitNonce !== lastFit.current) {
      lastFit.current = roof.fitNonce
      map.fitBounds(ly.roof.getBounds(), { maxZoom: 19, padding: [60, 60] })
    }
    idleHint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roof])

  function placeTip(ll: LatLng[]) {
    const map = mapRef.current, ly = layers.current
    if (!map || !ly || ll.length < 3) return
    const a = areaM2(ll)
    const north = ll.reduce((m, q) => (q[0] > m[0] ? q : m), ll[0])
    const lngC = ll.reduce((t, q) => t + q[1], 0) / ll.length
    ly.tip.setLatLng([north[0], lngC]).setContent(`${fmtIN(a)} m²`)
    if (!map.hasLayer(ly.tip)) ly.tip.addTo(map)
  }

  // ------------------------------------------------------------ panels from the assessment
  const panels = ctx.result?.layout.panels
  useEffect(() => {
    const ly = layers.current
    if (!ly) return
    ly.panels.clearLayers()
    ;(panels ?? []).forEach((p) => L.polygon(p, {
      color: "#93c5fd", weight: 0.8, fillColor: "#1e3a8a", fillOpacity: 0.92, interactive: false,
    }).addTo(ly.panels))
  }, [panels])

  // ------------------------------------------------------------ clicks
  function onMapClick(latlng: L.LatLng) {
    const map = mapRef.current!
    if (S.mode === "draw") return addDrawPoint(latlng)
    if (S.busy) return void toast("Still tracing the roof… one second ⏳")
    if (map.getZoom() < 16) {
      map.flyTo(latlng, 19, { duration: 0.9 })
      setHint(<>Now tap the <b>middle of your roof</b> 👆</>)
      return
    }
    const pt: SegPoint = { lat: latlng.lat, lon: latlng.lng, label: 1 }
    if (ctxRef.current.roof && S.refine !== null && S.aiPoints.length) {
      pt.label = S.refine
      S.aiPoints.push(pt)
    } else {
      S.aiPoints = [pt]
    }
    void runSegment()
  }

  function showPrompts() {
    const ly = layers.current!
    ly.prompts.clearLayers()
    if (S.aiPoints.length < 2 && S.refine === null) return
    S.aiPoints.forEach((p) =>
      L.marker([p.lat, p.lon], { icon: divIcon(`sj-prompt ${p.label ? "pos" : "neg"}`), interactive: false }).addTo(ly.prompts))
  }

  async function runSegment() {
    const map = mapRef.current!, ly = layers.current!
    const pts = S.aiPoints.slice()
    if (!pts.length) return
    S.busy = true
    tick()
    showPrompts()
    const last = pts[pts.length - 1]
    ly.pulse = L.marker([last.lat, last.lon], { icon: divIcon("sj-pulse"), interactive: false }).addTo(map)
    setHint(<>MobileSAM is tracing your roof…</>, true)
    const zoom = clamp(Math.round(map.getZoom()), 17, 19)
    const t0 = performance.now()
    try {
      // the browser draws the crop from the tiles it already has and sends it along,
      // so the AI works even when the server itself is offline
      const cap = await captureCrop(last.lat, last.lon, zoom)
      const r = await api<SegmentResponse>("/api/segment", {
        body: {
          points: pts,
          zoom,
          ...(cap ? { image: cap.image, origin: [cap.gx0, cap.gy0], z: cap.z } : {}),
        },
      })
      if (!r.ok) {
        toast.warning(r.message ?? "No roof found there.")
        if (S.aiPoints.length > 1) S.aiPoints.pop()
        idleHint()
        return
      }
      ctxRef.current.setRoof(r.polygon, "ai", r.score)
      const secs = ((performance.now() - t0) / 1000).toFixed(1)
      setHint(<>Roof found in {secs}s — drag the <b>yellow dots</b> to fine-tune</>)
      r.warnings?.forEach((w) => toast.warning(w, { duration: 7000 }))
      if (r.method !== "mobilesam" && !S.warned) {
        S.warned = true
        toast.warning("Basic OpenCV mode — for best accuracy run: python scripts/download_models.py", { duration: 7000 })
      }
    } catch (err) {
      toast.error((err as Error).message)
      if (S.aiPoints.length > 1) S.aiPoints.pop()
      idleHint()
    } finally {
      S.busy = false
      if (ly.pulse) { ly.pulse.remove(); ly.pulse = null }
      showPrompts()
      tick()
    }
  }

  // ------------------------------------------------------------ manual drawing
  function addDrawPoint(latlng: L.LatLng) {
    const map = mapRef.current!
    if (S.drawPts.length >= 3) {
      const p0 = map.latLngToContainerPoint(S.drawPts[0])
      if (p0.distanceTo(map.latLngToContainerPoint(latlng)) < 14) return finishDraw()
    }
    S.drawPts.push([latlng.lat, latlng.lng])
    renderDraw()
  }

  function renderDraw() {
    const ly = layers.current!
    ly.draw.clearLayers()
    if (S.drawPts.length) {
      L.polyline(S.drawPts, { color: "#FACC15", weight: 3, dashArray: "6 6", interactive: false }).addTo(ly.draw)
      S.drawPts.forEach((p, i) => {
        const mk = L.marker(p, { icon: divIcon(`sj-vtx ${i === 0 ? "first" : ""}`), keyboard: false })
        if (i === 0) mk.on("click", () => { if (S.drawPts.length >= 3) finishDraw() })
        mk.addTo(ly.draw)
      })
    }
    if (!S.drawPts.length && ly.rubber) { ly.rubber.remove(); ly.rubber = null }
    if (S.mode === "draw") {
      setHint(S.drawPts.length < 3 ? <>Click the roof corners ({S.drawPts.length} so far)</>
        : <>Click the <b>first corner</b> (or ✓ Finish) to close the outline</>)
    }
    tick()
  }

  function finishDraw() {
    const ly = layers.current!
    if (S.drawPts.length < 3) return void toast("Add at least 3 corners first")
    const pts = S.drawPts.slice()
    S.drawPts = []
    ly.draw.clearLayers()
    if (ly.rubber) { ly.rubber.remove(); ly.rubber = null }
    S.aiPoints = []
    ly.prompts.clearLayers()
    setMode("ai")
    ctxRef.current.setRoof(pts, "manual")
    setHint(<>Outline saved — drag the <b>yellow dots</b> to adjust, or draw again</>)
  }

  // ------------------------------------------------------------ toolbar actions
  function setMode(m: "ai" | "draw") {
    const map = mapRef.current!, ly = layers.current!
    S.mode = m
    if (m === "draw") {
      map.doubleClickZoom.disable()
      S.refine = null
      setHint(<>Click each <b>corner</b> of your roof — click the first corner to finish</>)
    } else {
      map.doubleClickZoom.enable()
      S.drawPts = []
      ly.draw.clearLayers()
      if (ly.rubber) { ly.rubber.remove(); ly.rubber = null }
      idleHint()
    }
    tick()
  }

  function setRefine(label: 0 | 1 | null) {
    S.refine = label
    if (label === 1) setHint(<>Tap the part of the roof that was <b>missed</b></>)
    else if (label === 0) setHint(<>Tap the area that is <b>not</b> your roof</>)
    else idleHint()
    showPrompts()
    tick()
  }

  function undo() {
    if (S.mode === "draw") {
      S.drawPts.pop()
      renderDraw()
    } else if (S.aiPoints.length > 1 && !S.busy) {
      S.aiPoints.pop()
      void runSegment()
    }
  }

  function clearAll() {
    S.aiPoints = []
    S.drawPts = []
    S.refine = null
    const ly = layers.current
    if (ly) {
      ;[ly.draw, ly.prompts].forEach((l) => l.clearLayers())
      if (ly.rubber) { ly.rubber.remove(); ly.rubber = null }
    }
    ctxRef.current.clearRoof()
    tick()
  }

  function locate() {
    const map = mapRef.current, ly = layers.current
    if (!map || !ly) return
    toast("Finding you…")

    const arrived = (lat: number, lon: number, opts: { approx?: boolean; accuracy?: number; city?: string | null }) => {
      map.flyTo([lat, lon], opts.approx ? 13 : 19, { duration: 1.2 })
      if (ly.me) ly.me.remove()
      ly.me = L.marker([lat, lon], { icon: divIcon("sj-me"), interactive: false }).addTo(map)
      // tell the user which district and which Odisha DISCOM serves this spot
      api<LocationInfo>(`/api/odisha/locate?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`)
        .then((l) => {
          if (!l.in_odisha) {
            toast.warning("SuryaJal is built for Odisha — tariffs, subsidies and rainwater rules " +
              "are Odisha's. You can still explore, but the numbers won't apply here.")
            return
          }
          const where = `${l.district} district, ${l.discom}`
          if (opts.approx) {
            toast.success(`Approximate location${opts.city ? ` (${opts.city})` : ""} — ${where}. ` +
              "Zoom in to your house and tap its roof!")
          } else {
            toast.success(`You are here (±${Math.round(opts.accuracy ?? 30)} m) — ${where}. Now tap your roof!`)
          }
        })
        .catch(() => toast.success(opts.approx
          ? "Approximate location found — zoom in to your house and tap its roof!"
          : `You are here (±${Math.round(opts.accuracy ?? 30)} m). Now tap your roof!`))
    }

    // GPS blocked (common inside embedded previews) or denied -> ask the network instead
    const fallback = async () => {
      const hit = await ipLocate()
      if (hit) return void arrived(hit.lat, hit.lon, { approx: true, city: hit.city })
      toast.warning("Location is off or blocked — search your area or PIN code above instead. " +
        "(Inside an embedded preview, open the app in its own tab to allow location.)")
    }

    if (!navigator.geolocation) return void fallback()
    navigator.geolocation.getCurrentPosition(
      (pos) => arrived(pos.coords.latitude, pos.coords.longitude, { accuracy: pos.coords.accuracy }),
      () => void fallback(),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  // keyboard: Esc cancels, Enter finishes drawing, Ctrl+Z undoes
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test((document.activeElement as HTMLElement | null)?.tagName ?? "")
      if (e.key === "Escape") {
        if (S.mode === "draw" && S.drawPts.length) { S.drawPts = []; renderDraw() }
        else if (S.refine !== null) setRefine(null)
      }
      if (typing) return
      if (e.key === "Enter" && S.mode === "draw") finishDraw()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo() }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const draw = S.mode === "draw"
  const canUndo = (draw && S.drawPts.length > 0) || (!draw && S.aiPoints.length > 1)
  const showRefine = !!roof && roof.method !== "manual" && !draw
  const area = liveArea ?? (roof ? areaM2(roof.latlngs) : 0)
  const r = ctx.result

  return (
    <div ref={wrapRef} className="sj-map relative h-full w-full overflow-hidden bg-sage-950">
      <div ref={elRef} className="absolute inset-0 z-0" aria-label="Satellite map" />

      {/* scanning veil while the AI works */}
      <AnimatePresence>
        {S.busy && (
          <motion.div className="pointer-events-none absolute inset-0 z-[400] overflow-hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="animate-scan absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-amber-300/20 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* search + hint */}
      <div className="absolute inset-x-3 top-3 z-[500] flex flex-col items-start gap-2 sm:left-4 sm:right-auto sm:w-[min(400px,calc(100%-2rem))]">
        <SearchBox onPick={(g) => {
            mapRef.current?.flyTo([g.lat, g.lon], zoomFor(g.type), { duration: 1.2 })
            setHint(g.discom
              ? <>Zoom in to your house in <b>{g.district}</b> ({g.discom}) and <b>tap its roof</b> 👆</>
              : <>Zoom in to your house and <b>tap its roof</b> 👆</>)
          }}
          onLatLon={(lat, lon) => mapRef.current?.flyTo([lat, lon], 19, { duration: 1.2 })} />
        <div className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
          {ODISHA_CITIES.map((c) => (
            <button key={c.name} type="button"
              onClick={() => { mapRef.current?.flyTo([c.lat, c.lon], c.zoom, { duration: 1.1 }); setHint(<>Zoom in to your house and <b>tap its roof</b> 👆</>) }}
              className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-sage-800 shadow backdrop-blur hover:bg-white">
              {c.name}
            </button>
          ))}
        </div>
        <div className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full bg-sage-950/80 px-3.5 py-2 text-[13px] text-white shadow-lg backdrop-blur",
          hint.busy && "pr-4",
        )}>
          {hint.busy ? <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-300" /> : <Sparkles className="size-3.5 shrink-0 text-amber-300" />}
          <span className="truncate [&_b]:font-semibold [&_b]:text-amber-200">{hint.html}</span>
        </div>
      </div>

      {/* engine badge (mobile/tablet only — on desktop the map is narrower, so the
          engine status lives in the dashboard header instead) */}
      {ctx.config && (
        <div className="absolute top-3 right-3 z-[500] hidden items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-sage-800 shadow sm:inline-flex">
          <span className={cn("size-2 rounded-full", ctx.config.engine === "mobilesam" ? "bg-emerald-500" : "bg-amber-500")} />
          {ctx.config.engine === "mobilesam" ? "MobileSAM ready" : "OpenCV mode"}
        </div>
      )}

      {/* bottom stack: refine chips, toolbar, roof summary */}
      <div ref={stackRef} className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex flex-col items-center gap-2 px-3 lg:bottom-6 [&>*]:pointer-events-auto">
        <AnimatePresence>
          {showRefine && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full bg-white/95 p-1.5 pl-3 text-xs shadow-lg">
              <span className="shrink-0 font-medium text-muted-foreground">Outline not right?</span>
              <Chip on={S.refine === 1} onClick={() => setRefine(S.refine === 1 ? null : 1)} tone="pos"><Plus className="size-3.5" /> Add missed part</Chip>
              <Chip on={S.refine === 0} onClick={() => setRefine(S.refine === 0 ? null : 0)} tone="neg"><Minus className="size-3.5" /> Remove extra</Chip>
              <Chip onClick={() => { setRefine(null); S.aiPoints = []; layers.current?.prompts.clearLayers(); tick(); setHint(<>Tap a roof 👆</>) }}>
                <RotateCcw className="size-3.5" /> New roof
              </Chip>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1 rounded-2xl bg-white/95 p-1.5 shadow-xl backdrop-blur" role="toolbar" aria-label="Roof tools">
          <ToolBtn active={!draw} onClick={() => setMode("ai")} label="AI roof"><Sparkles /></ToolBtn>
          <ToolBtn active={draw} onClick={() => setMode("draw")} label="Draw"><PenLine /></ToolBtn>
          <span className="mx-0.5 h-6 w-px bg-border" />
          {canUndo && <ToolBtn onClick={undo} label="Undo"><Undo2 /></ToolBtn>}
          {draw && S.drawPts.length >= 3 && <ToolBtn onClick={finishDraw} label="Finish" tone="ok"><Check /></ToolBtn>}
          <ToolBtn onClick={clearAll} label="Clear"><Eraser /></ToolBtn>
        </div>

        {/* roof summary sheet (mobile) */}
        <AnimatePresence>
          {roof && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-md rounded-2xl border bg-card p-3.5 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Your roof</div>
                  <div className="font-heading text-2xl leading-tight font-medium tabular">
                    {fmtIN(area)} <span className="text-sm text-muted-foreground">m² · {fmtIN(sqft(area))} sq ft</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {r && !ctx.assessing
                      ? <>☀️ {r.solar.kw.toFixed(2)} kW solar · 💧 {litres(r.rain.annual_harvest_l)} rain / yr</>
                      : <>Calculating solar &amp; rainwater…</>}
                  </div>
                </div>
                <button type="button" onClick={() => ctx.setTab("solar")}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90">
                  Results <ArrowRight className="size-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function ToolBtn({ children, label, onClick, active, tone, className }: {
  children: ReactNode; label: string; onClick: () => void; active?: boolean; tone?: "ok"; className?: string
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition [&_svg]:size-4",
        active ? "bg-primary text-primary-foreground shadow-sm" : tone === "ok" ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "text-sage-800 hover:bg-secondary",
        className,
      )}>
      {children}
      <span className="max-[380px]:hidden">{label}</span>
    </button>
  )
}

function Chip({ children, on, onClick, tone }: { children: ReactNode; on?: boolean; onClick: () => void; tone?: "pos" | "neg" }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 font-semibold transition",
        on && tone === "pos" && "border-emerald-600 bg-emerald-600 text-white",
        on && tone === "neg" && "border-red-600 bg-red-600 text-white",
        !on && "border-border bg-card text-foreground hover:bg-secondary",
      )}>
      {children}
    </button>
  )
}

function SearchBox({ onPick, onLatLon }: { onPick: (g: GeoResult) => void; onLatLon: (lat: number, lon: number) => void }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<GeoResult[]>([])
  const [busy, setBusy] = useState(false)
  const [hi, setHi] = useState(-1)
  const boxRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) { setResults([]); setHi(-1) }
    }
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [])

  // live suggestions while typing (like Google Maps); stale answers are dropped
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const rows = await searchPlaces(text, { signal: ctl.signal })
        if (!ctl.signal.aborted) { setResults(rows); setHi(-1) }
      } catch {
        if (!ctl.signal.aborted) setResults([])
      } finally {
        if (!ctl.signal.aborted) setBusy(false)
      }
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q])

  const setQuery = (v: string) => {
    setQ(v)
    if (v.trim().length < 2) { setResults([]); setHi(-1) }
  }

  const pick = (g: GeoResult) => { setQ(""); setResults([]); setHi(-1); onPick(g) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    const m = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/)
    if (m) { setResults([]); setHi(-1); onLatLon(+m[1], +m[2]); return }
    if (hi >= 0 && results[hi]) return void pick(results[hi])
    if (results.length) return void pick(results[0])
    // nothing yet (paste + instant Enter): run the deep search now
    setBusy(true)
    try {
      const rows = await searchPlaces(text, { deep: true })
      if (!rows.length) toast.warning("No place found — try a nearby landmark, area or PIN code")
      else if (rows.length === 1) pick(rows[0])
      else { setResults(rows); setHi(-1) }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form ref={boxRef} onSubmit={submit} className="relative w-full" role="search" autoComplete="off">
      <div className="flex h-12 items-center gap-2 rounded-2xl border bg-card/95 pr-1.5 pl-3.5 shadow-lg backdrop-blur focus-within:ring-3 focus-within:ring-ring/40">
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
        <input value={q} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)) }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)) }
            else if (e.key === "Escape") { setResults([]); setHi(-1) }
          }}
          placeholder="Search a place, landmark or PIN code in Odisha…"
          aria-label="Search a place" role="combobox" aria-expanded={results.length > 0}
          aria-controls="sj-place-list" aria-autocomplete="list"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
        {q && (
          <button type="button" onClick={() => { setQ(""); setResults([]); setHi(-1) }} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Clear search">
            <X className="size-4" />
          </button>
        )}
        <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Go"}
        </button>
      </div>
      <AnimatePresence>
        {(results.length > 0 || (busy && q.trim().length >= 2)) && (
          <motion.ul id="sj-place-list" role="listbox" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute inset-x-0 top-[3.4rem] max-h-80 overflow-auto rounded-2xl border bg-card p-1.5 shadow-2xl">
            {results.map((r, i) => {
              const [head, ...rest] = r.name.split(", ")
              const sub = r.district
                ? `${r.kind ?? "Place"} · ${r.district} district`
                : `${r.kind ?? "Place"}${rest.length ? " · " : ""}${rest.slice(0, 3).join(", ")}`
              return (
                <li key={`${r.lat},${r.lon},${i}`} role="option" aria-selected={i === hi}>
                  <button type="button" onClick={() => pick(r)} onMouseEnter={() => setHi(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                      i === hi ? "bg-secondary" : "hover:bg-secondary/60",
                    )}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                      <MapPin className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{head}</span>
                      <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                    </span>
                  </button>
                </li>
              )
            })}
            {busy && results.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </form>
  )
}
