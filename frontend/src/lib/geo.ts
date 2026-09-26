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

export function niceStep(v: number) {
  if (v <= 0) return 1
  const e = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v - 1e-12) return m * e
  return 10 * e
}

/** Demo roof - a real Jayanagar (Bengaluru) house outlined by MobileSAM. */
export const DEMO_ROOF = {
  name: "Demo roof · Jayanagar, Bengaluru",
  poly: [[12.9285874, 77.5820667], [12.9284642, 77.5820639], [12.9284589, 77.5820694], [12.9284562, 77.5821079],
    [12.9284589, 77.5821931], [12.9284642, 77.5821986], [12.9284964, 77.5822041], [12.9285821, 77.5822041],
    [12.9285874, 77.5821931], [12.9285901, 77.5821464]] as LatLng[],
}
