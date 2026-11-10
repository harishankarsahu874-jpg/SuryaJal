/**
 * Mapped campuses (served by /api/campus/<id>, built from data/campus_nist.json).
 *
 * NIST University, Berhampur is missing from OpenStreetMap, so its buildings are traced by
 * hand on the same Esri imagery the map shows - every section gets an exact outline and a
 * label, and tapping a building uses that outline as the roof (no AI guess needed).
 */
import { api } from "@/lib/api"
import type { LatLng } from "@/lib/geo"

export interface CampusBuilding {
  id: string
  name: string
  /** short map label ("LHC", "Einstein Hall", "B3") */
  label: string
  kind: "academic" | "research" | "hostel" | "sports" | "ground" | "transport" | "facility" | "construction" | "other"
  about?: string
  aliases?: string[]
  /** departments / facilities inside ("Central Library", "Stephen Hawking Cineplex") */
  sections?: string[]
  floors?: number
  /** false for unnamed buildings (they still get an outline) */
  search: boolean
  /** false for open ground, pools and building sites - they can't be a solar roof */
  roof?: boolean
  area: number
  center: LatLng
  poly: LatLng[]
  /** open courtyards inside the outline */
  holes?: LatLng[][]
}

export interface Campus {
  id: string
  name: string
  short: string
  full_name: string
  address: string
  aliases: string[]
  center: LatLng
  zoom: number
  bounds: [LatLng, LatLng]
  boundary: LatLng[]
  imagery: string
  attribution: string
  buildings: CampusBuilding[]
}

const cache = new Map<string, Promise<Campus | null>>()

/** the campus layer data - fetched once per page, null when the server has none */
export function loadCampus(id = "nist"): Promise<Campus | null> {
  let p = cache.get(id)
  if (!p) {
    p = api<Campus>(`/api/campus/${id}`).catch(() => {
      cache.delete(id)                        // offline blip: try again next time
      return null
    })
    cache.set(id, p)
  }
  return p
}

export const KIND_STYLE: Record<CampusBuilding["kind"], { color: string; label: string; dash?: string }> = {
  academic: { color: "#7dd3fc", label: "Academic" },
  research: { color: "#c4b5fd", label: "Research" },
  hostel: { color: "#fdba74", label: "Hostel" },
  sports: { color: "#6ee7b7", label: "Sports" },
  ground: { color: "#86efac", label: "Ground", dash: "5 5" },
  transport: { color: "#fde047", label: "Transport", dash: "5 5" },
  facility: { color: "#f9a8d4", label: "Facility" },
  construction: { color: "#fb923c", label: "Construction", dash: "3 6" },
  other: { color: "#e5e7eb", label: "Building" },
}

export const isRoof = (b: CampusBuilding) => b.roof !== false

/** shoelace sign/size in degrees, relative to the first corner (raw degrees cancel badly) */
function signedArea(r: LatLng[]) {
  const [y0, x0] = r[0]
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const [y1, x1] = r[i], [y2, x2] = r[(i + 1) % r.length]
    a += (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  }
  return a / 2
}

/** One ring for the roof tools: each courtyard is joined to the outline by a zero-width slit,
 *  so area sums, panel layout and Leaflet's even-odd fill all leave the courtyards open. */
export function keyholeRing(poly: LatLng[], holes: LatLng[][] = []): LatLng[] {
  let ring = poly.map((p) => [p[0], p[1]] as LatLng)
  const outer = Math.sign(signedArea(ring))
  for (const h0 of holes) {
    if (h0.length < 3) continue
    const h = h0.map((p) => [p[0], p[1]] as LatLng)
    if (Math.sign(signedArea(h)) === outer) h.reverse()
    let bi = 0, bj = 0, bd = Infinity
    ring.forEach((p, i) => h.forEach((q, j) => {
      const d = (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * 0.945) ** 2
      if (d < bd) { bd = d; bi = i; bj = j }
    }))
    const loop = [...h.slice(bj), ...h.slice(0, bj), h[bj]]
    ring = [...ring.slice(0, bi + 1), ...loop, ...ring.slice(bi)]
  }
  return ring
}

/** the building under a point (outline minus courtyards), smallest first */
export function buildingAt(c: Campus, lat: number, lon: number): CampusBuilding | null {
  const inside = (r: LatLng[]) => {
    let hit = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, xi] = r[i], [yj, xj] = r[j]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  const hits = c.buildings.filter((b) => inside(b.poly) && !(b.holes ?? []).some(inside))
  return hits.sort((a, b) => a.area - b.area)[0] ?? null
}
