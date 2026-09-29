/**
 * Place search for the map: merges
 *   1. the backend's bundled Odisha gazetteer (/api/suggest - works offline, instant)
 *   2. Photon (photon.komoot.io, OpenStreetMap data) queried straight from the
 *      browser - this is what finds real landmarks ("NIST University, Berhampur")
 *      and it keeps working even when the app's own server has no internet.
 *   3. optionally the deep /api/geocode search (adds Nominatim when the server
 *      is online) - used on explicit "Go".
 */
import { api } from "@/lib/api"

export interface GeoResult {
  name: string
  lat: number
  lon: number
  type: string
  district?: string | null
  discom?: string | null
  /** short category for the suggestion row: "University", "Town", "PIN code"… */
  kind?: string
}

// app/geo.py NOMINATIM_VIEWBOX - Odisha (plus a small margin)
const ODISHA = { minLon: 81.0, minLat: 17.4, maxLon: 87.9, maxLat: 22.9 }
const inOdisha = (lat: number, lon: number) =>
  lon >= ODISHA.minLon && lon <= ODISHA.maxLon && lat >= ODISHA.minLat && lat <= ODISHA.maxLat

const pretty = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "")

/** Photon/OSM tags -> the app's zoom classes (zoomFor in map-panel) + a category label. */
function photonType(p: Record<string, string>): { type: string; kind: string } {
  const key = p.osm_key ?? ""
  const val = p.osm_value ?? ""
  const t = p.type ?? ""
  const s = `${key} ${val} ${t}`
  if (/university|college|school|kindergarten/.test(s)) return { type: "", kind: pretty(val || t) }
  if (/hospital|clinic|pharmacy|doctors/.test(s)) return { type: "", kind: pretty(val || t) }
  if (/hotel|hostel|guest_house|restaurant|cafe|fast_food|mall|supermarket|market/.test(s))
    return { type: "", kind: pretty(val || t) }
  if (/temple|church|mosque|shrine|monastery|tourism|museum|attraction|viewpoint/.test(s))
    return { type: "", kind: pretty(val || t) }
  if (/airport|aerodrome|station|railway|bus_stop|bus_station|harbour|ferry/.test(s))
    return { type: "", kind: pretty(val || t) }
  if (/stadium|sports|pitch|park|garden|playground|zoo/.test(s)) return { type: "", kind: pretty(val || t) }
  if (/office|bank|embassy|government|police|post_office|library|townhall/.test(s))
    return { type: "", kind: pretty(val || t) }
  if (/house|building|apartment|hut|address|residential/.test(s)) return { type: "building", kind: "Building" }
  if (/street|road|highway|footway|path|cycleway|trunk|pedestrian/.test(s)) return { type: "road", kind: "Street" }
  if (/postcode|postal/.test(s)) return { type: "postcode", kind: "PIN code" }
  if (/city|town|borough|municipality|county|state|region|district|county/.test(s)) return { type: "town", kind: pretty(val || t) || "Town" }
  if (/suburb|neighbourhood|neighborhood|quarter|hamlet|village|locality|isolated_dwelling/.test(s))
    return { type: "suburb", kind: pretty(val || t) || "Area" }
  return { type: "", kind: pretty(val || t) || "Place" }
}

interface PhotonFeature {
  properties?: Record<string, string>
  geometry?: { coordinates?: number[] }
}

function photonRow(f: PhotonFeature): GeoResult | null {
  const p = f.properties ?? {}
  const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN]
  if (!isFinite(lat) || !isFinite(lon) || !p.name) return null
  const { type, kind } = photonType(p)
  const area = p.city || p.county || p.district || ""
  const tail = [area, p.state].filter((x) => x && x.toLowerCase() !== "india")
  const name = [p.name, ...tail].join(", ") || p.name
  return { name, lat, lon, type, kind, district: null, discom: null }
}

async function photonSearch(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=20.2961&lon=85.8245`
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return []
    const j = await r.json() as { features?: PhotonFeature[] }
    const rows = (j.features ?? []).map(photonRow).filter((x): x is GeoResult => !!x)
    // Odisha first (the app is Odisha-specific), then anything else the user asked for
    rows.sort((a, b) => Number(inOdisha(b.lat, b.lon)) - Number(inOdisha(a.lat, a.lon)))
    return rows
  } catch {
    return []                                  // offline / blocked: the local rows still show
  }
}

const LOCAL_KIND: Record<string, string> = {
  town: "Town", suburb: "Locality", county: "District",
  postcode: "PIN code", postcode_area: "PIN area",
}

/** Suggestion rows: `deep` adds the full /api/geocode pass (Nominatim on live servers). */
export async function searchPlaces(q: string, opts: { deep?: boolean; signal?: AbortSignal } = {}): Promise<GeoResult[]> {
  const text = q.trim()
  if (text.length < 2) return []
  const [local, remote, deep] = await Promise.all([
    api<GeoResult[]>(`/api/suggest?q=${encodeURIComponent(text)}`, { signal: opts.signal }).catch(() => []),
    photonSearch(text, opts.signal),
    opts.deep
      ? api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(text)}`, { signal: opts.signal }).catch(() => [])
      : Promise.resolve([]),
  ])
  const out: GeoResult[] = []
  const dup = (r: GeoResult) => out.some((e) =>
    (Math.abs(e.lat - r.lat) < 0.01 && Math.abs(e.lon - r.lon) < 0.01) ||
    e.name.split(",")[0].trim().toLowerCase() === r.name.split(",")[0].trim().toLowerCase())
  // real POI matches first (like Google), then the bundled gazetteer, then deep rows
  for (const r of [...remote, ...deep, ...local]) {
    if (r && isFinite(r.lat) && isFinite(r.lon) && !dup(r)) {
      out.push(r.kind ? r : { ...r, kind: LOCAL_KIND[r.type] ?? "Place" })
      if (out.length >= 8) break
    }
  }
  return out
}
