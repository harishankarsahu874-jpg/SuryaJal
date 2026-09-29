/** Geometry helpers - same maths as app/geo.py so the UI and the report agree. */
export type LatLng = [number, number]

export function encodePolyline(pts: LatLng[], precision = 6): string {
  const f = 10 ** precision
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1
    let s = ""
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    return s + String.fromCharCode(v + 63)
  }
  let out = "", plat = 0, plon = 0
  for (const [lat, lon] of pts) {
    const a = Math.round(lat * f), b = Math.round(lon * f)
    out += enc(a - plat) + enc(b - plon)
    plat = a
    plon = b
  }
  return out
}

export function decodePolyline(str: string, precision = 6): LatLng[] {
  const f = 10 ** precision, pts: LatLng[] = []
  let i = 0, lat = 0, lon = 0
  while (i < str.length) {
    const vals: number[] = []
    for (let k = 0; k < 2; k++) {
      let shift = 0, result = 0, b: number
      do {
        if (i >= str.length) throw new Error("bad polyline")
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      vals.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += vals[0]
    lon += vals[1]
    pts.push([lat / f, lon / f])
  }
  return pts
}

const RE = 6371008.8
function toLocal(ll: LatLng[]): [number, number][] {
  const lat0 = ll.reduce((s, p) => s + p[0], 0) / ll.length
  const lon0 = ll.reduce((s, p) => s + p[1], 0) / ll.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  return ll.map(([la, lo]) => [((lo - lon0) * Math.PI) / 180 * RE * k, ((la - lat0) * Math.PI) / 180 * RE])
}

export function areaM2(ll: LatLng[]): number {
  if (ll.length < 3) return 0
  const p = toLocal(ll)
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

export function perimeterM(ll: LatLng[]): number {
  const p = toLocal(ll)
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    s += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  return s
}

export const centroid = (ll: LatLng[]): LatLng => [
  ll.reduce((s, p) => s + p[0], 0) / ll.length,
  ll.reduce((s, p) => s + p[1], 0) / ll.length,
]

/** Global pixel coordinates of a lat/lon at zoom z (same maths as app/geo.py). */
export function latlonToPx(lat: number, lon: number, z: number): [number, number] {
  const n = 256 * 2 ** z
  const x = ((lon + 180) / 360) * n
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  return [x, y]
}

/** India (with a small margin): the map never leaves it. */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [[6.0, 67.5], [37.5, 98.0]]
export const inIndia = (lat: number, lon: number) =>
  lat >= 6.0 && lat <= 37.5 && lon >= 67.5 && lon <= 98.0

export function niceStep(v: number) {
  if (v <= 0) return 1
  const e = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v - 1e-12) return m * e
  return 10 * e
}

/**
 * Demo roofs - real house footprints from OpenStreetMap in three of Odisha's DISCOM
 * zones, so the "Load demo roof" button always works offline (no imagery, no NASA POWER,
 * no Nominatim needed).
 */
export interface DemoRoof {
  id: string
  name: string
  city: string
  district: string
  discom: string
  lat: number
  lon: number
  zoom: number
  poly: LatLng[]
}

export const DEMO_ROOFS: DemoRoof[] = [
  {
    id: "bhubaneswar",
    name: "Demo roof · Ward 27, Bhubaneswar",
    city: "Bhubaneswar", district: "Khurda", discom: "TPCODL",
    lat: 20.2954, lon: 85.81397, zoom: 19,
    // ~140 m² house, South West Zone, Bhubaneswar Municipal Corporation
    poly: [[20.2954465, 85.8139218], [20.2953165, 85.8139877], [20.2953639, 85.8140812],
      [20.2954939, 85.8140152]] as LatLng[],
  },
  {
    id: "cuttack",
    name: "Demo roof · Friends Colony, Cuttack",
    city: "Cuttack", district: "Cuttack", discom: "TPCODL",
    lat: 20.46467, lon: 85.87466, zoom: 19,
    // L-shaped ~18 x 14 m house
    poly: [[20.4645817, 85.8746642], [20.4646428, 85.8747010], [20.4646883, 85.8747161],
      [20.4647307, 85.8747328], [20.4647479, 85.8746307], [20.4646977, 85.8746089],
      [20.4646585, 85.8745905], [20.4646428, 85.8746424], [20.4645895, 85.8746139]] as LatLng[],
  },
  {
    id: "berhampur",
    name: "Demo roof · Berhampur (Ganjam)",
    city: "Berhampur", district: "Ganjam", discom: "TPSODL",
    lat: 19.30617, lon: 84.79661, zoom: 19,
    // ~13 x 10 m house, southern Odisha
    poly: [[19.3061409, 84.7966584], [19.3062323, 84.7965990], [19.3062186, 84.7965754],
      [19.3061826, 84.7965988], [19.3061651, 84.7965684], [19.3061147, 84.7965583],
      [19.3061096, 84.7966044]] as LatLng[],
  },
]

/** The default demo roof (Bhubaneswar). */
export const DEMO_ROOF = DEMO_ROOFS[0]

/** Odisha cities the map offers as one-tap jumps: [name, lat, lon, zoom]. */
export const ODISHA_CITIES: { name: string; lat: number; lon: number; zoom: number; district: string }[] = [
  { name: "Bhubaneswar", lat: 20.2961, lon: 85.8245, zoom: 13, district: "Khurda" },
  { name: "Cuttack", lat: 20.4625, lon: 85.8830, zoom: 13, district: "Cuttack" },
  { name: "Rourkela", lat: 22.2600, lon: 84.8400, zoom: 13, district: "Sundargarh" },
  { name: "Berhampur", lat: 19.3131, lon: 84.7941, zoom: 13, district: "Ganjam" },
  { name: "Sambalpur", lat: 21.4670, lon: 83.9840, zoom: 13, district: "Sambalpur" },
  { name: "Puri", lat: 19.8048, lon: 85.8181, zoom: 13, district: "Puri" },
  { name: "Balasore", lat: 21.4991, lon: 86.9317, zoom: 13, district: "Balasore" },
  { name: "Baripada", lat: 21.9336, lon: 86.7239, zoom: 13, district: "Mayurbhanj" },
  { name: "Bhadrak", lat: 21.0545, lon: 86.4960, zoom: 13, district: "Bhadrak" },
  { name: "Angul", lat: 20.8386, lon: 85.0870, zoom: 13, district: "Angul" },
  { name: "Keonjhar", lat: 21.6318, lon: 85.5590, zoom: 13, district: "Keonjhar" },
  { name: "Koraput", lat: 18.8140, lon: 82.7100, zoom: 13, district: "Koraput" },
]

/** Default map view: Bhubaneswar, the capital. */
export const ODISHA_CENTER: LatLng = [20.2961, 85.8245]
export const ODISHA_ZOOM = 13
