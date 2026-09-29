/**
 * Browser-side satellite crop capture + drawing.
 *
 * The map's tiles load in the user's browser, so we can draw the exact crops the
 * server would fetch (TileFetcher.crop_around / crop_bbox in app/tiles.py) right
 * here - and send them along with /api/segment and /r. That keeps roof AI, the
 * panel-layout preview and the PDF report working even when the backend machine
 * has no internet.
 */
import { latlonToPx, type LatLng } from "@/lib/geo"

export const TILE = 256
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"

export interface TileCrop {
  canvas: HTMLCanvasElement
  /** zoom level and global pixel coords of the crop's top-left corner */
  z: number
  gx0: number
  gy0: number
  side: number
}

function tileUrl(z: number, x: number, y: number) {
  return `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`
}

export function loadTileImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Esri's grey "Map data not yet available" tile is flat - same idea as app/tiles.py. */
export function isPlaceholderTile(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas")
    c.width = 32
    c.height = 32
    const ctx = c.getContext("2d")
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, 32, 32)
    const d = ctx.getImageData(0, 0, 32, 32).data
    let s = 0, s2 = 0
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
      s += g
      s2 += g * g
    }
    const n = d.length / 4
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) < 12
  } catch {
    return false
  }
}

/** Meters per output pixel at latitude / zoom (same as app/geo.py). */
export function metersPerPx(lat: number, z: number) {
  return (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z)
}

/** Draw a w x h window whose top-left is global pixel (gx0, gy0) at zoom z. */
export async function captureWindow(z: number, gx0: number, gy0: number, w: number, h: number):
  Promise<(TileCrop & { bad: number }) | null> {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = "#282828"
  ctx.fillRect(0, 0, w, h)
  const tx0 = Math.floor(gx0 / TILE), ty0 = Math.floor(gy0 / TILE)
  const tx1 = Math.floor((gx0 + w - 1) / TILE), ty1 = Math.floor((gy0 + h - 1) / TILE)
  const jobs: { tx: number; ty: number }[] = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty })
  const imgs = await Promise.all(jobs.map(({ tx, ty }) => loadTileImg(tileUrl(z, tx, ty))))
  let bad = 0
  jobs.forEach(({ tx, ty }, i) => {
    const t = imgs[i]
    if (!t || isPlaceholderTile(t)) { bad++; return }
    ctx.drawImage(t, tx * TILE - gx0, ty * TILE - gy0)
  })
  return { canvas, z, gx0, gy0, side: Math.max(w, h), bad: bad / jobs.length }
}

/** 512 px crop around a point - mirrors TileFetcher.crop_around (zoom step-down included). */
export async function captureCrop(lat: number, lon: number, z0: number):
  Promise<{ image: string; z: number; gx0: number; gy0: number } | null> {
  for (let z = Math.min(z0, 19); z >= 14 && z > Math.min(z0, 19) - 3; z--) {
    const [gx, gy] = latlonToPx(lat, lon, z)
    const gx0 = Math.floor(gx - 512 / 2), gy0 = Math.floor(gy - 512 / 2)
    const cap = await captureWindow(z, gx0, gy0, 512, 512)
    if (cap && cap.bad <= 0.25) {
      try {
        return { image: cap.canvas.toDataURL("image/png"), z, gx0, gy0 }
      } catch {
        return null                     // canvas tainted (tiles without CORS): let the server fetch
      }
    }
  }
  return null
}

/**
 * Square crop that fits a polygon with 35 % padding - mirrors TileFetcher.crop_bbox
 * (highest zoom whose padded bbox fits in maxPx, stepping down while imagery is missing).
 */
export async function capturePolyCrop(latLngs: LatLng[], maxPx = 640): Promise<TileCrop | null> {
  if (latLngs.length < 3) return null
  const lats = latLngs.map((p) => p[0]), lons = latLngs.map((p) => p[1])
  const maxLat = Math.max(...lats), minLat = Math.min(...lats)
  const maxLon = Math.max(...lons), minLon = Math.min(...lons)
  for (let z = 19; z >= 13; z--) {
    const [x0, y0] = latlonToPx(maxLat, minLon, z)
    const [x1, y1] = latlonToPx(minLat, maxLon, z)
    const span = Math.max(x1 - x0, y1 - y0)
    const side = Math.max(160, span * 1.7)
    if (side > maxPx) continue
    const sideI = Math.floor(side)
    const gx0 = Math.floor((x0 + x1) / 2 - sideI / 2)
    const gy0 = Math.floor((y0 + y1) / 2 - sideI / 2)
    const cap = await captureWindow(z, gx0, gy0, sideI, sideI)
    if (cap && cap.bad <= 0.25) return cap
  }
  return null
}

/** Dark stand-in when no imagery is reachable at all - still shows the roof + panels. */
export function darkCropFor(latLngs: LatLng[]): TileCrop {
  const z = 18
  const lats = latLngs.map((p) => p[0]), lons = latLngs.map((p) => p[1])
  const [x0, y0] = latlonToPx(Math.max(...lats), Math.min(...lons), z)
  const [x1, y1] = latlonToPx(Math.min(...lats), Math.max(...lons), z)
  const side = Math.floor(Math.max(160, Math.max(x1 - x0, y1 - y0) * 1.7))
  const canvas = document.createElement("canvas")
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#26342b"
  ctx.fillRect(0, 0, side, side)
  return { canvas, z, gx0: Math.floor((x0 + x1) / 2 - side / 2), gy0: Math.floor((y0 + y1) / 2 - side / 2), side }
}

/**
 * Satellite picture of the roof with the suggested panel layout drawn on it -
 * the browser-side twin of app/report.py roof_thumbnail().
 */
export function drawLayoutImage(cap: TileCrop, polygon: LatLng[], panels: LatLng[][], size = 640): string {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(cap.canvas, 0, 0, size, size)
  const f = size / cap.side
  const px = (lat: number, lon: number): [number, number] => {
    const [x, y] = latlonToPx(lat, lon, cap.z)
    return [(x - cap.gx0) * f, (y - cap.gy0) * f]
  }

  const path = (pts: LatLng[]) => {
    ctx.beginPath()
    pts.forEach(([la, lo], i) => {
      const [x, y] = px(la, lo)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.closePath()
  }

  for (const pnl of panels ?? []) {
    path(pnl)
    ctx.fillStyle = "rgba(23, 37, 84, 0.92)"
    ctx.strokeStyle = "#93c5fd"
    ctx.lineWidth = 1.5
    ctx.fill()
    ctx.stroke()
  }
  path(polygon)
  ctx.strokeStyle = "#FACC15"
  ctx.lineWidth = Math.max(2, size / 140)
  ctx.lineJoin = "round"
  ctx.stroke()

  // scale bar (bottom-right) + north arrow (top-right) - like the server thumbnail
  const latC = polygon.reduce((s, q) => s + q[0], 0) / polygon.length
  const mpp = metersPerPx(latC, cap.z) / f
  const barM = [2, 5, 10, 20, 50, 100, 200, 500].find((b) => b / mpp >= size * 0.16) ?? 500
  const bl = barM / mpp
  const x1 = size - 14, y1 = size - 30
  ctx.fillStyle = "rgba(0,0,0,0.47)"
  ctx.fillRect(x1 - bl - 6, y1 - 20, bl + 12, 30)
  ctx.fillStyle = "#fff"
  ctx.fillRect(x1 - bl, y1, bl, 5)
  ctx.font = `600 ${Math.max(10, size / 30)}px system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "bottom"
  ctx.fillText(`${barM} m`, x1 - bl / 2, y1 - 4)
  const nx = size - 24, ny = 16
  ctx.beginPath()
  ctx.moveTo(nx, ny)
  ctx.lineTo(nx - 8, ny + 20)
  ctx.lineTo(nx, ny + 15)
  ctx.lineTo(nx + 8, ny + 20)
  ctx.closePath()
  ctx.fillStyle = "rgba(255,255,255,0.92)"
  ctx.fill()
  ctx.textBaseline = "top"
  ctx.fillText("N", nx, ny + 30)

  return canvas.toDataURL("image/png")
}
