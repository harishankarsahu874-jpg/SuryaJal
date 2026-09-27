/**
 * Esri World Imagery with automatic zoom fallback.
 *
 * Esri does not have street-level (z19) photos everywhere in Odisha: Bhubaneswar and Cuttack
 * have them, large parts of Berhampur, Rourkela and every village do not. For those tiles the
 * server does not answer 404 - it sends a grey "Map data not yet available" picture with
 * HTTP 200 (~2.5 KB), so a plain L.tileLayer happily paints a grey map.
 *
 * This layer fetches every tile itself, recognises the placeholder by its size (same rule as
 * PLACEHOLDER_MAX_BYTES in app/tiles.py on the server) and paints the matching quarter of the
 * parent tile instead - up to three zoom levels up. You get the "a bit blurry but present"
 * behaviour of Google Maps, and the roof is still there to tap; the backend already crops at
 * the best available zoom for the AI (TileFetcher.crop_around).
 *
 * If fetch() is blocked (offline, CORS proxy...) it degrades to a normal <img> tile.
 */
import L from "leaflet"

const PLACEHOLDER_MAX_BYTES = 3000    // Esri's grey "no data yet" tile is ~2.5 KB; real imagery is 8-40 KB
const MAX_LEVELS_UP = 3               // z19 -> z16 at the most
const CACHE_TTL_MS = 20_000           // siblings request the same parent tile within a few ms
const CACHE_MAX = 300
const FALLBACK_NOTICE_MIN_ZOOM = 17   // only tell the user when it matters (close-ups)

type Bitmap = ImageBitmap | HTMLImageElement
type Fetched = { bmp: Bitmap | null; placeholder: boolean }

export type ImageryFallbackEvent = L.LeafletEvent & { zoom: number; levelsUp: number }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = "async"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("tile failed to load"))
    img.src = url
  })
}

async function decode(blob: Blob): Promise<Bitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export class EsriImagery extends L.GridLayer {
  private readonly urlTemplate: string
  private readonly cache = new Map<string, Promise<Fetched>>()
  private noticed = false

  constructor(urlTemplate: string, options?: L.GridLayerOptions) {
    super(options)
    this.urlTemplate = urlTemplate
  }

  protected createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const size = this.getTileSize()
    const canvas = document.createElement("canvas")
    canvas.width = size.x
    canvas.height = size.y
    void this.paint(canvas, coords).then(
      () => done(undefined, canvas),
      (err: unknown) => done(err instanceof Error ? err : new Error(String(err)), canvas),
    )
    return canvas
  }

  private async paint(canvas: HTMLCanvasElement, coords: L.Coords) {
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas is not available")
    const { x, y, z } = coords
    let placeholder: Bitmap | null = null
    for (let up = 0; up <= MAX_LEVELS_UP && z - up >= 0; up++) {
      const f = 1 << up
      const px = Math.floor(x / f), py = Math.floor(y / f)
      const t = await this.fetchTile(z - up, px, py)
      if (!t.bmp) continue                                  // network error: try a coarser level
      if (t.placeholder) {                                  // "Map data not yet available"
        placeholder = placeholder ?? t.bmp
        if (up < MAX_LEVELS_UP) continue
        break
      }
      // paint the (1/f)-th of the parent tile that covers this tile
      const sw = t.bmp.width / f, sh = t.bmp.height / f
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(t.bmp, (x - px * f) * sw, (y - py * f) * sh, sw, sh, 0, 0, canvas.width, canvas.height)
      if (up > 0 && z >= FALLBACK_NOTICE_MIN_ZOOM && !this.noticed) {
        this.noticed = true
        this.fire("imagery:fallback", { zoom: z, levelsUp: up })
      }
      return
    }
    if (!placeholder) throw new Error("imagery unavailable")
    ctx.drawImage(placeholder, 0, 0, canvas.width, canvas.height)   // nothing better anywhere
  }

  private fetchTile(z: number, x: number, y: number): Promise<Fetched> {
    const key = `${z}/${x}/${y}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const url = L.Util.template(this.urlTemplate, { z, x, y })
    const job = (async (): Promise<Fetched> => {
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" })
        if (!res.ok) return { bmp: null, placeholder: false }
        const blob = await res.blob()
        return { bmp: await decode(blob), placeholder: blob.size <= PLACEHOLDER_MAX_BYTES }
      } catch {
        // fetch blocked (CORS / offline) - a plain <img> needs no CORS to be displayed
        try {
          return { bmp: await loadImage(url), placeholder: false }
        } catch {
          return { bmp: null, placeholder: false }
        }
      }
    })()
    this.cache.set(key, job)
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    setTimeout(() => this.cache.delete(key), CACHE_TTL_MS)
    return job
  }
}
