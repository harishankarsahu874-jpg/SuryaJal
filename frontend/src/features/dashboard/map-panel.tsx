import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import {
  ArrowRight, BedDouble, Building, BusFront, ChartColumn, Check, ChevronDown, Droplet, Eraser, Fuel, GraduationCap,
  Landmark, Loader2, MapPin, Minus, PenLine, Plus, RotateCcw, Search, ShoppingBag, Sparkles, Stethoscope, Sun, Undo2,
  UtensilsCrossed, X,
} from "lucide-react"
import { api, type SegmentResponse } from "@/lib/api"
import { matchesQuery, searchPlaces, type GeoResult, type SearchOutcome } from "@/lib/geosearch"
import { buildingAt, isRoof, keyholeRing, KIND_STYLE, loadCampus, type Campus, type CampusBuilding } from "@/lib/campus"
import { captureCrop } from "@/lib/mapcrop"
import { areaM2, INDIA_BOUNDS, ODISHA_CENTER, ODISHA_CITIES, ODISHA_ZOOM, type LatLng } from "@/lib/geo"
import { EsriImagery } from "@/lib/imagery"
import { fmtIN, litres, rupeesShort, sqft } from "@/lib/format"
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
  if (type === "poi" || type === "campus") return 18          // landmarks: campus / temple level
  return 17
}

export function MapPanel({ visible }: { visible: boolean }) {
  const ctx = useDashboard()
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const elRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<{
    roof: L.Polygon; panels: L.LayerGroup; handles: L.LayerGroup; prompts: L.LayerGroup; draw: L.LayerGroup
    tip: L.Tooltip; rubber: L.Polyline | null; pulse: L.Marker | null; me: L.Marker | null; meC: L.Circle | null
  } | null>(null)
  // the labelled pin showing "where am I" after a search / city pick
  const placePin = useRef<L.Marker | null>(null)
  const dropPlacePin = (lat: number, lon: number, name: string) => {
    const map = mapRef.current
    if (!map) return
    placePin.current?.remove()
    placePin.current = L.marker([lat, lon], { icon: divIcon("sj-place-pin"), interactive: false })
      .addTo(map)
      .bindTooltip(name, { permanent: true, direction: "top", className: "sj-place-label", offset: [0, -14] })
  }
  // interaction state lives in a ref (Leaflet handlers are registered once) + a tick to re-render the UI
  const S = useRef({ mode: "ai" as "ai" | "draw", busy: false, aiPoints: [] as SegPoint[], refine: null as 0 | 1 | null,
    drawPts: [] as LatLng[], zoom: ODISHA_ZOOM }).current
  const [, tick] = useReducer((x: number) => x + 1, 0)
  const [hint, setHintState] = useState<{ html: ReactNode; busy?: boolean }>({ html: <>Search your area, zoom in and <b>tap your roof</b></> })
  const [liveArea, setLiveArea] = useState<number | null>(null)
  // the roof card shows just the area until "Show More" unfolds solar + rainwater; every newly picked
  // roof starts folded again (fine-tuning the current one keeps it open)
  const [more, setMore] = useState(false)
  const setHint = (html: ReactNode, busy = false) => setHintState({ html, busy })
  // a hint that answers what the user just did ("Now at Puri…", "5 hotels…") outlives the idle
  // hints the end of the map flight would otherwise put back right away
  const hintHold = useRef(0)
  const holdHint = (html: ReactNode, ms = 5000) => { hintHold.current = Date.now() + ms; setHint(html) }
  // the mapped NIST University campus (outlines + labels of every building, data/campus_nist.json)
  const [campus, setCampus] = useState<Campus | null>(null)
  const campusRef = useRef<Campus | null>(null)
  campusRef.current = campus
  const campusFx = useRef<{ flash: (id: string) => void } | null>(null)
  const [campusOn, setCampusOn] = useState(false)          // campus outlines on screen (legend)
  const [focus, setFocus] = useState<string | null>(null)  // the section a search asked for
  const [reveal, setReveal] = useState(0)                   // bumped when a tapped building must stay in sight
  const resultPins = useRef<L.LayerGroup | null>(null)     // "hotels in Berhampur" -> every hit pinned

  const idleHint = useCallback(() => {
    if (S.mode === "draw" || Date.now() < hintHold.current) return
    const c = ctxRef.current
    if (c.roof?.method === "mapped") setHint(<>Tap another building, or <b>Show More</b> for solar &amp; rainwater</>)
    else if (c.roof) setHint(<>Tap another roof, drag the <b>yellow dots</b> to fine-tune, or use ＋ / －</>)
    else if (S.zoom >= 16 && campusRef.current && mapRef.current?.getBounds().intersects(campusRef.current.bounds))
      setHint(<>Tap any <b>NIST building</b> to see it and check its roof</>)
    else if (S.zoom < 17) setHint(<>Zoom in closer to your house, then <b>tap its roof</b></>)
    else setHint(<>Tap the <b>middle of your roof</b> 👆</>)
  }, [S])

  /** the free strip of map between the search box and whatever covers the bottom (tool stack, or on
   *  phones the attribution line that sits just above it) - in map container pixels */
  const clearArea = () => {
    const map = mapRef.current, top = topRef.current, stack = stackRef.current, wrap = wrapRef.current
    if (!map || !top || !stack || !wrap) return null
    const attr = map.getContainer().querySelector<HTMLElement>(".leaflet-control-attribution")
    const attrTop = attr ? attr.getBoundingClientRect().top - wrap.getBoundingClientRect().top : Infinity
    return { top: top.offsetTop + top.offsetHeight + 8, bottom: Math.min(stack.offsetTop, attrTop) - 8 }
  }

  /** fit bounds into the part of the map the search box (top) and the tool stack (bottom) leave free */
  const fitClear = (b: L.LatLngBounds, maxZoom: number, fly = true) => {
    const map = mapRef.current
    if (!map) return
    const area = clearArea(), h = map.getSize().y
    const padTop = area ? area.top + 4 : 60
    const padBottom = area ? Math.max(16, h - area.bottom + 4) : 60
    const opts: L.FitBoundsOptions = h - padTop - padBottom > 140
      ? { paddingTopLeft: [16, padTop], paddingBottomRight: [16, padBottom], maxZoom }
      : { padding: [24, 24], maxZoom }                 // tiny screen: just fit
    if (fly) map.flyToBounds(b, { ...opts, duration: 1.1 })
    else map.fitBounds(b, opts)
  }

  // ------------------------------------------------------------ map setup (once)
  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, {
      zoomControl: false, maxZoom: 21, minZoom: 5,
      // India only - SuryaJal is built for Indian (Odisha-first) roofs, and a
      // full-world view helps nobody
      maxBounds: INDIA_BOUNDS, maxBoundsViscosity: 1.0,
    }).setView(ODISHA_CENTER, ODISHA_ZOOM)          // Bhubaneswar, Odisha
    mapRef.current = map
    // Esri has no z19 close-ups in many Odisha towns (it answers with a grey "Map data not yet
    // available" tile). EsriImagery detects that and silently shows the nearest zoom that has a photo.
    new EsriImagery(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: "Imagery © Esri, Vantor, Earthstar Geographics | Search © Esri, OpenStreetMap",
    }).addTo(map)
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
      rubber: null, pulse: null, me: null, meC: null,
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

  // ------------------------------------------------------------ NIST University campus layer
  useEffect(() => {
    let alive = true
    void loadCampus("nist").then((c) => { if (alive && c) setCampus(c) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !campus) return
    // own panes: outlines under the roof outline, labels above it but under the roof's handles
    for (const [name, z] of [["sj-campus", "390"], ["sj-campus-labels", "450"]] as const) {
      if (!map.getPane(name)) {
        const pane = map.createPane(name)
        pane.style.zIndex = z
        pane.style.pointerEvents = "none"
      }
    }
    const byId = new Map(campus.buildings.map((b) => [b.id, b]))
    const style = (b: CampusBuilding): L.PathOptions => {
      const k = KIND_STYLE[b.kind] ?? KIND_STYLE.other
      return { color: k.color, weight: map.getZoom() >= 18 ? 2.2 : 1.6, opacity: 0.95, fillColor: k.color,
        fillOpacity: isRoof(b) ? 0.16 : 0.07, dashArray: k.dash }
    }
    const outlines = L.layerGroup(), labels = L.layerGroup()
    const polys = new Map<string, L.Polygon>()
    for (const b of campus.buildings) {
      polys.set(b.id, L.polygon([b.poly, ...(b.holes ?? [])], { ...style(b), pane: "sj-campus", interactive: false }).addTo(outlines))
    }

    // labels: greedy placement (important buildings first, more detail as you zoom in, a label
    // that would overlap another one steps down to a shorter form or waits for more zoom)
    const fam = getComputedStyle(map.getContainer()).fontFamily || "sans-serif"
    const FONT_B = `700 11.5px ${fam}`, FONT_S = `600 10px ${fam}`, FONT_T = `800 12px ${fam}`
    const cv = document.createElement("canvas").getContext("2d")
    const measure = (t: string, font: string) => {
      if (!cv) return t.length * 7
      cv.font = font
      return cv.measureText(t).width
    }
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]!)
    const kindLine = (b: CampusBuilding) => b.search
      ? [KIND_STYLE[b.kind]?.label, b.floors ? `${b.floors} floors` : ""].filter(Boolean).join(" · ")
      : "Name not confirmed"
    const sectionLine = (b: CampusBuilding) => b.sections?.length
      ? b.sections.slice(0, 3).join(" · ") + (b.sections.length > 3 ? ` +${b.sections.length - 3}` : "")
      : kindLine(b)
    const RANK: Record<string, number> = { academic: 0, research: 1, hostel: 1, sports: 2, facility: 3, transport: 3,
      ground: 4, construction: 5, other: 6 }
    const items = [...campus.buildings]
      .sort((a, b) => (RANK[a.kind] ?? 6) - (RANK[b.kind] ?? 6) || b.area - a.area)
      .map((b) => ({ b, html: "", m: L.marker(b.center, { pane: "sj-campus-labels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: "" }) }) }))
    const itemOf = new Map(items.map((it) => [it.b.id, it]))
    const titleAt = L.latLng(campus.bounds[1][0] + 0.00012, campus.center[1])
    const title = L.marker(titleAt, { pane: "sj-campus-labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="sj-campus-title">${esc(campus.name)}</div>` }) })

    const placeLabels = () => {
      const z = map.getZoom()
      const want = z >= 19 ? 2 : z >= 18 ? 1 : 0
      const boxes: number[][] = []
      const fits = (x: number, y: number, w: number, h: number) => {
        const bx = [x - w / 2 - 3, y - h / 2 - 2, x + w / 2 + 3, y + h / 2 + 2]
        if (boxes.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) return false
        boxes.push(bx)
        return true
      }
      labels.clearLayers()
      if (z < 18) {
        const p = map.project(titleAt, z)
        if (fits(p.x, p.y - 11, measure(campus.name.toUpperCase(), FONT_T) + 30, 24)) labels.addLayer(title)
      }
      for (const it of items) {
        if (!it.b.search && z < 17) continue                  // unnamed blocks: only once there is room
        const p = map.project(it.b.center, z)
        for (let lv = want; lv >= 0; lv--) {
          const sub = lv === 0 ? "" : lv === 1 ? kindLine(it.b) : sectionLine(it.b)
          const w = Math.max(measure(it.b.label, FONT_B), sub ? measure(sub, FONT_S) + 4 : 0) + 26
          if (!fits(p.x, p.y, w, sub ? 37 : 20)) continue
          const html = `<div class="sj-campus-label${it.b.search ? "" : " unnamed"}" style="--k:${(KIND_STYLE[it.b.kind] ?? KIND_STYLE.other).color}">` +
            `<span><i></i>${esc(it.b.label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`
          if (html !== it.html) {
            it.m.setIcon(L.divIcon({ className: "", iconSize: [0, 0], html }))
            it.html = html
          }
          labels.addLayer(it.m)
          break
        }
      }
    }

    // zoomed out: one tappable "NIST University" badge instead of 22 tiny outlines
    const CAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>'
    const badge = L.marker(campus.center, { keyboard: false, zIndexOffset: 400, title: `${campus.name} - tap to open the campus map`,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="sj-campus-badge">${CAP}<span>${esc(campus.name)}</span></div>` }) })
      .on("click", () => fitClear(L.latLngBounds(campus.bounds), campus.zoom))

    let hovered: string | null = null
    const hoverTip = L.tooltip({ direction: "top", className: "sj-place-label", offset: [0, -4], interactive: false })
    const setHover = (b: CampusBuilding | null) => {
      const id = b?.id ?? null
      if (id === hovered) return
      if (hovered) { const ob = byId.get(hovered); if (ob) polys.get(hovered)?.setStyle(style(ob)) }
      hovered = id
      hoverTip.remove()
      if (b) {
        polys.get(b.id)?.setStyle({ weight: 3.2, fillOpacity: isRoof(b) ? 0.34 : 0.16 })
        const it = itemOf.get(b.id)
        if (!it || !labels.hasLayer(it.m)) hoverTip.setLatLng(b.center).setContent(esc(b.name)).addTo(map)
      }
      map.getContainer().style.cursor = b ? "pointer" : "crosshair"
    }
    const onMove = (e: L.LeafletMouseEvent) => {
      if (S.mode === "draw" || S.busy || map.getZoom() < 16) return setHover(null)
      setHover(buildingAt(campus, e.latlng.lat, e.latlng.lng))
    }
    const onOut = () => setHover(null)
    const cb = L.latLngBounds(campus.bounds)
    const update = () => {
      const z = map.getZoom()
      if (z >= 11 && z < 16) badge.addTo(map)
      else badge.remove()
      if (z >= 16) {
        outlines.addTo(map)
        labels.addTo(map)
        polys.forEach((poly, id) => { if (id !== hovered) poly.setStyle({ weight: z >= 18 ? 2.2 : 1.6 }) })
        placeLabels()
      } else {
        outlines.remove()
        labels.remove()
        setHover(null)
      }
      setCampusOn(z >= 16 && map.getBounds().intersects(cb))
    }
    const onMoveEnd = () => setCampusOn(map.getZoom() >= 16 && map.getBounds().intersects(cb))
    campusFx.current = {
      flash: (id) => {
        const poly = polys.get(id), b = byId.get(id)
        if (!poly || !b) return
        poly.setStyle({ weight: 4, fillOpacity: 0.42 })
        setTimeout(() => { if (hovered !== id) poly.setStyle(style(b)) }, 1800)
      },
    }
    map.on("zoomend", update)
    map.on("moveend", onMoveEnd)
    map.on("mousemove", onMove)
    map.on("mouseout", onOut)
    update()
    return () => {
      map.off("zoomend", update)
      map.off("moveend", onMoveEnd)
      map.off("mousemove", onMove)
      map.off("mouseout", onOut)
      ;[outlines, labels, badge, hoverTip].forEach((l) => l.remove())
      campusFx.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus])

  // keep Leaflet's bottom controls (zoom, layers, scale) above our floating tool stack
  useEffect(() => {
    const el = stackRef.current, wrap = wrapRef.current
    if (!el || !wrap) return
    const ro = new ResizeObserver(() => wrap.style.setProperty("--sj-stack", `${Math.round(el.offsetHeight)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the unfolded roof card leaves a phone little map: keep the picked roof in sight in the gap
  // between the search box and the card (also when coming back from the results, and after a
  // campus building was tapped right above the card)
  useEffect(() => {
    if (!visible || (!more && !reveal)) return
    const t = setTimeout(() => {
      const map = mapRef.current, ly = layers.current, area = clearArea()
      if (!map || !ly || !area || !ctxRef.current.roof) return
      const b = ly.roof.getBounds()
      const y1 = map.latLngToContainerPoint(b.getNorthWest()).y
      const y2 = map.latLngToContainerPoint(b.getSouthEast()).y
      const gapTop = area.top, gapBottom = area.bottom
      if (gapBottom - gapTop < 40 || (y1 >= gapTop && y2 <= gapBottom)) return
      map.panBy([0, Math.round((y1 + y2) / 2 - (gapTop + gapBottom) / 2)])
    }, 280)                                         // once the card has finished unfolding
    return () => clearTimeout(t)
  }, [more, visible, reveal])

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
    // draggable corner handles (campus-map outlines are exact - no handles; Draw can still redo one)
    if (roof.method !== "mapped") roof.latlngs.forEach((ll, i) => {
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
      fitClear(ly.roof.getBounds(), 19, false)
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
    hintHold.current = 0
    if (S.mode === "draw") return addDrawPoint(latlng)
    if (S.busy) return void toast("Still tracing the roof… one second ⏳")
    if (map.getZoom() < 16) {
      map.flyTo(latlng, 19, { duration: 0.9 })
      setHint(<>Now tap the <b>middle of your roof</b> 👆</>)
      return
    }
    // a building of the mapped campus: use its traced outline (refining an AI roof still goes to the AI)
    const cmp = campusRef.current
    if (cmp && !(ctxRef.current.roof && S.refine !== null && S.aiPoints.length)) {
      const b = buildingAt(cmp, latlng.lat, latlng.lng)
      if (b) return pickBuilding(b)
    }
    const pt: SegPoint = { lat: latlng.lat, lon: latlng.lng, label: 1 }
    if (ctxRef.current.roof && S.refine !== null && S.aiPoints.length) {
      pt.label = S.refine
      S.aiPoints.push(pt)
    } else {
      S.aiPoints = [pt]
      setMore(false)                     // a new roof: area first, "Show More" for the rest
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
    setHint(<>Tracing your roof…</>, true)
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

  // ------------------------------------------------------------ campus buildings & search results
  /** select a campus building as the roof (its traced outline, courtyards left open) */
  function pickBuilding(b: CampusBuilding, opts: { fly?: boolean; section?: string | null } = {}) {
    const map = mapRef.current, c = campusRef.current
    if (!map || !c) return
    placePin.current?.remove()
    placePin.current = null
    if (!isRoof(b)) {                    // pool, courts, ground, bus park, building site
      campusFx.current?.flash(b.id)
      if (opts.fly) fitClear(L.latLngBounds(b.poly), 19)
      holdHint(<><b>{b.name}</b> — open area, not a roof. Tap a building to check its roof.</>)
      return
    }
    S.aiPoints = []
    S.refine = null
    layers.current?.prompts.clearLayers()
    setMore(false)
    setFocus(opts.section ?? null)
    ctxRef.current.setRoof(keyholeRing(b.poly, b.holes), "mapped", null, { fit: !!opts.fly, address: `${b.name}, ${c.name}, Berhampur` })
    if (!opts.fly) setReveal((n) => n + 1)
    holdHint(<><b>{opts.section ?? b.name}</b> — tap <b>Show More</b> for solar &amp; rainwater</>)
  }

  /** a campus search row / the NIST chip: the whole campus, or straight to one building */
  async function goCampus(g?: GeoResult) {
    const map = mapRef.current
    if (!map) return
    const c = campusRef.current ?? await loadCampus(g?.campus?.id ?? "nist")
    if (!c) {                            // campus data unavailable: behave like a normal place
      if (g) flyToPlace({ ...g, campus: undefined })
      else toast.warning("The campus map could not be loaded - check the connection")
      return
    }
    if (!campusRef.current) { campusRef.current = c; setCampus(c) }
    const b = g?.campus?.building ? c.buildings.find((x) => x.id === g.campus?.building) : undefined
    if (!b) {
      placePin.current?.remove()
      placePin.current = null
      fitClear(L.latLngBounds(c.bounds), c.zoom)
      holdHint(<><b>{c.name}</b> — tap any building to see it and check its roof</>)
      return
    }
    const head = g?.name.split(", ")[0] ?? ""
    pickBuilding(b, { fly: true, section: head !== b.name && b.sections?.includes(head) ? head : null })
  }

  function flyToPlace(g: GeoResult) {
    if (g.campus) return void goCampus(g)
    const name = g.name.split(", ").slice(0, 2).join(", ")
    mapRef.current?.flyTo([g.lat, g.lon], zoomFor(g.type), { duration: 1.2 })
    dropPlacePin(g.lat, g.lon, name)
    holdHint(g.discom
      ? <>Now at <b>{name}</b> — zoom to your house in {g.district} ({g.discom}) and <b>tap its roof</b> 👆</>
      : <>Now at <b>{name}</b> — zoom to your house and <b>tap its roof</b> 👆</>)
  }

  /** category search ("hotels in Berhampur"): pin every hit and frame them all (null clears) */
  function showResultPins(rows: GeoResult[] | null, label = "") {
    const map = mapRef.current
    if (!map) return
    resultPins.current?.clearLayers()
    if (!rows?.length) return
    const group = resultPins.current ?? (resultPins.current = L.layerGroup().addTo(map))
    rows.forEach((r) => {
      L.marker([r.lat, r.lon], { icon: divIcon("sj-result-pin"), keyboard: false, riseOnHover: true })
        .bindTooltip(r.name.split(", ")[0], { direction: "top", className: "sj-place-label", offset: [0, -9] })
        .on("click", () => flyToPlace(r))
        .addTo(group)
    })
    placePin.current?.remove()
    placePin.current = null
    fitClear(L.latLngBounds(rows.map((r) => [r.lat, r.lon] as LatLng)).pad(0.1), 16)
    holdHint(<><b>{rows.length} {label}</b> — tap a pin to go there</>, 8000)
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
      setMore(false)                     // keep the map clear for clicking corners
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

  // "Show More" / "Show Less" on the roof card
  function toggleMore() {
    if (!more && S.refine !== null) setRefine(null)   // the refine chips fold away while it is open
    setMore(!more)
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
    setMore(false)
    const ly = layers.current
    if (ly) {
      ;[ly.draw, ly.prompts].forEach((l) => l.clearLayers())
      if (ly.rubber) { ly.rubber.remove(); ly.rubber = null }
    }
    ctxRef.current.clearRoof()
    tick()
  }

  // keyboard: Esc cancels, Enter finishes drawing, Ctrl+Z undoes
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test((document.activeElement as HTMLElement | null)?.tagName ?? "")
      if (e.key === "Escape") {
        if (S.mode === "draw" && S.drawPts.length) { S.drawPts = []; renderDraw() }
        else if (S.refine !== null) setRefine(null)
        else if (!typing) setMore(false)
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
  const showRefine = !!roof && roof.method !== "manual" && roof.method !== "mapped" && !draw && !more
  const area = liveArea ?? (roof ? areaM2(roof.latlngs) : 0)
  const r = ctx.result
  const ready = !!r && !ctx.assessing
  const waterPct = r ? Math.round(r.rain.coverage * 100) : 0
  // the campus building behind a "mapped" roof (outline starts at the building's first corner)
  const pickedB = roof?.method === "mapped" && campus
    ? campus.buildings.find((b) => Math.abs(b.poly[0][0] - roof.latlngs[0][0]) < 2e-5 && Math.abs(b.poly[0][1] - roof.latlngs[0][1]) < 2e-5) ?? null
    : null
  const legendKinds = campus ? [...new Set(campus.buildings.map((b) => b.kind))] : []

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
      <div ref={topRef} className="absolute inset-x-3 top-3 z-[500] flex flex-col items-start gap-2 sm:left-4 sm:right-auto sm:w-[min(400px,calc(100%-2rem))]">
        <SearchBox onPick={flyToPlace} onShowAll={showResultPins}
          onLatLon={(lat, lon) => {
            mapRef.current?.flyTo([lat, lon], 19, { duration: 1.2 })
            dropPlacePin(lat, lon, "Your spot")
            holdHint(<>Zoom to your house and <b>tap its roof</b> 👆</>)
          }}
          getBias={() => { const c = mapRef.current?.getCenter(); return c ? { lat: c.lat, lon: c.lng } : null }} />
        <div className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
          <button type="button" onClick={() => void goCampus()} title="Open the NIST University campus map"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-sage-950 shadow hover:bg-amber-200">
            <GraduationCap className="size-3.5" /> NIST University
          </button>
          {ODISHA_CITIES.map((c) => (
            <button key={c.name} type="button"
              onClick={() => { mapRef.current?.flyTo([c.lat, c.lon], c.zoom, { duration: 1.1 }); dropPlacePin(c.lat, c.lon, c.name); holdHint(<>Now at <b>{c.name}</b> — zoom to your house and <b>tap its roof</b> 👆</>) }}
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

      {/* campus legend (desktop - on phones the labels and the roof card say it all) */}
      {campus && campusOn && (
        <div className="pointer-events-none absolute top-3 right-3 z-[450] hidden w-56 rounded-xl bg-sage-950/80 p-2.5 text-[11px] text-white shadow-lg backdrop-blur md:block">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
            <GraduationCap className="size-3.5 text-amber-300" /> {campus.name} map
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {legendKinds.map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: KIND_STYLE[k].color }} />{KIND_STYLE[k].label}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-white/65">
            Traced on the {campus.imagery.replace(/^Esri World Imagery - /, "")} image. B1–B7: names not confirmed yet.
          </p>
        </div>
      )}

      {/* bottom stack: refine chips, toolbar, roof summary */}
      <div ref={stackRef} className="pointer-events-none absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[500] flex flex-col items-center gap-2 px-3 lg:bottom-6 [&>*]:pointer-events-auto">
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

        {/* roof card: the selected area first - solar & rainwater stay folded away until "Show More" */}
        <AnimatePresence>
          {roof && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-md rounded-2xl border bg-card p-3.5 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {pickedB ? `${campus?.name ?? "Campus"} · ${pickedB.search ? KIND_STYLE[pickedB.kind].label : "Name not confirmed"}` : "Your roof"}
                  </div>
                  <div className="font-heading text-2xl leading-tight font-medium tabular">
                    {fmtIN(area)} <span className="text-sm text-muted-foreground">m² · <span className="whitespace-nowrap">{fmtIN(sqft(area))} sq ft</span></span>
                  </div>
                  {!pickedB && ctx.address && (
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" /><span className="truncate">{ctx.address}</span>
                    </div>
                  )}
                </div>
                <button type="button" onClick={toggleMore} aria-expanded={more} aria-controls="sj-roof-more"
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90 active:translate-y-px sm:min-w-32 sm:px-4">
                  {more ? "Show Less" : "Show More"}
                  <ChevronDown className={cn("size-4 transition-transform duration-200", more && "rotate-180")} />
                </button>
              </div>

              {pickedB && <BuildingFacts b={pickedB} focus={focus} />}

              <AnimatePresence initial={false}>
                {more && (
                  <motion.div id="sj-roof-more" key="more" className="overflow-hidden"
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
                      <ResultTile tone="sun" icon={Sun} title="Solar" loading={!ready} onClick={() => ctx.setTab("solar")}
                        value={r ? r.solar.kw.toFixed(2) : ""} unit="kW"
                        sub={r && r.solar.panels > 0 ? `Saves ${rupeesShort(r.solar.annual_savings)} / yr` : "Roof too small for panels"} />
                      <ResultTile tone="water" icon={Droplet} title="Rainwater" loading={!ready} onClick={() => ctx.setTab("rain")}
                        value={r ? litres(r.rain.annual_harvest_l) : ""} unit="/ yr"
                        sub={waterPct >= 100 ? "All your water needs" : `${waterPct}% of water needs`} />
                    </div>
                    <button type="button" onClick={() => ctx.setTab("report")}
                      className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-sage-800 transition hover:bg-secondary">
                      <ChartColumn className="size-4" /> Green Score &amp; PDF report <ArrowRight className="size-3.5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
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

/** one result on the unfolded roof card - tapping it opens that full page */
function ResultTile({ tone, icon: Icon, title, value, unit, sub, loading, onClick }: {
  tone: "sun" | "water"; icon: typeof Sun; title: string; value: string; unit: string; sub: string
  loading: boolean; onClick: () => void
}) {
  const sun = tone === "sun"
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "group flex min-h-[5.75rem] min-w-0 flex-col rounded-xl border p-3 text-left transition hover:shadow-md active:translate-y-px",
        sun ? "border-sun/25 bg-sun-soft/50 hover:bg-sun-soft/80" : "border-water/25 bg-water-soft/50 hover:bg-water-soft/80",
      )}>
      <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", sun ? "text-sun-ink" : "text-water-ink")}>
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{title}</span>
        <ArrowRight className="ml-auto size-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100 max-[359px]:hidden" />
      </span>
      {loading ? (
        <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Calculating…
        </span>
      ) : (
        <span className="mt-auto block min-w-0 pt-1.5">
          <span className="font-heading block truncate text-base leading-tight font-medium text-foreground tabular sm:text-lg">
            {value} <span className="font-sans text-xs font-semibold text-muted-foreground">{unit}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{sub}</span>
        </span>
      )}
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

/** name, size and the sections inside a campus building - shown on the roof card */
function BuildingFacts({ b, focus }: { b: CampusBuilding; focus: string | null }) {
  return (
    <div className="mt-2.5 border-t pt-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: KIND_STYLE[b.kind].color }} />
        <span className="truncate">{b.name}</span>
        {b.floors ? <span className="shrink-0 font-normal text-muted-foreground">· {b.floors} floors</span> : null}
      </div>
      {b.sections?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Sections in this building">
          {b.sections.map((x) => (
            <span key={x} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
              x === focus ? "border-primary bg-primary text-primary-foreground" : "bg-secondary/70 text-foreground")}>
              {x}
            </span>
          ))}
        </div>
      ) : b.about ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{b.about}</p> : null}
    </div>
  )
}

const CAT_ICON: Record<string, typeof MapPin> = {
  hotel: BedDouble, food: UtensilsCrossed, college: GraduationCap, campus: Building, health: Stethoscope,
  shop: ShoppingBag, temple: Landmark, landmark: Landmark, gov: Landmark, transport: BusFront, fuel: Fuel,
}

function SearchBox({ onPick, onLatLon, getBias, onShowAll }: {
  onPick: (g: GeoResult) => void
  onLatLon: (lat: number, lon: number) => void
  /** current map centre, used to rank nearby places first (like Google Maps) */
  getBias?: () => { lat: number; lon: number } | null
  /** a category search ("hotels in Berhampur"): pin every result on the map; null clears the pins */
  onShowAll?: (rows: GeoResult[] | null, label?: string) => void
}) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<GeoResult[]>([])
  const [cat, setCat] = useState<SearchOutcome["category"] | null>(null)
  const [resultsFor, setResultsFor] = useState("")      // the text the rows answer
  const [pinned, setPinned] = useState(false)
  const [open, setOpen] = useState(false)               // the list is showing (focus brings it back)
  const [busy, setBusy] = useState(false)
  const [hi, setHi] = useState(-1)
  const boxRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setHi(-1) }
    }
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [])

  const show = (out: SearchOutcome, text: string, reveal = document.activeElement === inputRef.current) => {
    setResults(out.rows)
    setCat(out.category ?? null)
    setResultsFor(text)
    setPinned(false)
    if (reveal) setOpen(true)               // late answers don't pop up once the user has moved on
    setHi(-1)
  }

  // live suggestions while typing (like Google Maps); stale answers are dropped
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const out = await searchPlaces(text, { signal: ctl.signal, bias: getBias?.() ?? undefined })
        if (!ctl.signal.aborted) {
          show(out, text)
          onShowAll?.(null)                  // a new search: earlier result pins go
        }
      } catch {
        if (!ctl.signal.aborted) setResults([])
      } finally {
        if (!ctl.signal.aborted) setBusy(false)
      }
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const setQuery = (v: string) => {
    setQ(v)
    setOpen(true)
    if (v.trim().length < 2) { setResults([]); setCat(null); setHi(-1) }
  }

  const pick = (g: GeoResult) => { setQ(""); setResults([]); setCat(null); setOpen(false); setHi(-1); onPick(g) }

  // every hit pinned on the map: fold the list away so the pins are visible (focus brings it back)
  const showAll = (rows: GeoResult[], c: NonNullable<SearchOutcome["category"]>) => {
    onShowAll?.(rows, `${c.label.toLowerCase()}${c.near ? ` near ${c.near}` : ""}`)
    setPinned(true)
    setOpen(false)
    setHi(-1)
    ;(document.activeElement as HTMLElement | null)?.blur?.()     // phones: drop the keyboard too
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    const m = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/)
    if (m) { setResults([]); setOpen(false); setHi(-1); onLatLon(+m[1], +m[2]); return }
    if (hi >= 0 && results[hi]) return void pick(results[hi])
    const fresh = results.length > 0 && resultsFor === text
    if (fresh && cat) return showAll(results, cat)                    // "hotels in Berhampur" -> all on the map
    if (fresh && matchesQuery(results[0], text)) return void pick(results[0])
    // not answered yet (or only loosely): the deep search adds the server's full geocoder
    setBusy(true)
    try {
      const out = await searchPlaces(text, { deep: true, bias: getBias?.() ?? undefined })
      if (!out.rows.length) return void toast.warning("No place found — try a nearby landmark, area or PIN code")
      show(out, text, true)
      if (out.category) showAll(out.rows, out.category)
      else if (out.rows.length === 1 || matchesQuery(out.rows[0], text)) pick(out.rows[0])
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form ref={boxRef} onSubmit={submit} className="relative z-10 w-full" role="search" autoComplete="off">
      <div className="flex h-12 items-center gap-2 rounded-2xl border bg-card/95 pr-1.5 pl-3.5 shadow-lg backdrop-blur focus-within:ring-3 focus-within:ring-ring/40">
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
        <input ref={inputRef} value={q} onChange={(e) => setQuery(e.target.value)} onFocus={() => { if (results.length) setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, results.length - 1)) }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)) }
            else if (e.key === "Escape") { setOpen(false); setHi(-1) }
          }}
          placeholder="Search a place, hotel, NIST building or PIN…"
          aria-label="Search a place" role="combobox" aria-expanded={open && results.length > 0}
          aria-controls="sj-place-list" aria-autocomplete="list"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
        {q && (
          <button type="button" onClick={() => { setQ(""); setResults([]); setCat(null); setOpen(false); setHi(-1); onShowAll?.(null) }}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Clear search">
            <X className="size-4" />
          </button>
        )}
        <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Go"}
        </button>
      </div>
      <AnimatePresence>
        {open && (results.length > 0 || (busy && q.trim().length >= 2)) && (
          <motion.ul id="sj-place-list" role="listbox" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute inset-x-0 top-[3.4rem] max-h-[min(22rem,55dvh)] overflow-auto rounded-2xl border bg-card p-1.5 shadow-2xl">
            {cat && results.length > 0 && (
              <li role="presentation" className="flex items-center gap-2 px-2.5 pt-1 pb-1.5">
                <span className="min-w-0 truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {results.length} {cat.label}{cat.near ? ` near ${cat.near}` : " near the map"}
                </span>
                {pinned ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <Check className="size-3.5" /> On the map
                  </span>
                ) : (
                  <button type="button" onClick={() => showAll(results, cat)}
                    className="ml-auto shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90">
                    Show all on map
                  </button>
                )}
              </li>
            )}
            {results.map((r, i) => {
              const [head, ...rest] = r.name.split(", ")
              const Icon = CAT_ICON[r.cat ?? ""] ?? MapPin
              const sub = r.campus?.building
                ? `${r.address?.startsWith("In the ") ? r.address : r.kind ?? "Campus building"} · NIST University`
                : r.address
                  ? `${r.kind ?? "Place"} · ${r.address}`
                  : r.district
                    ? `${r.kind ?? "Place"} · ${r.district} district`
                    : `${r.kind ?? "Place"}${rest.length ? " · " : ""}${rest.slice(0, 3).join(", ")}`
              return (
                <li key={`${r.lat},${r.lon},${i}`} role="option" aria-selected={i === hi}>
                  <button type="button" onClick={() => pick(r)} onMouseEnter={() => setHi(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                      i === hi ? "bg-secondary" : "hover:bg-secondary/60",
                    )}>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg",
                      r.campus ? "bg-amber-100 text-amber-800" : "bg-secondary text-muted-foreground")}>
                      <Icon className="size-4" />
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
