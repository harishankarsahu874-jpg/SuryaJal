/**
 * Place search for the map. Merges, best first:
 *   1. the backend's bundled Odisha gazetteer (/api/suggest - offline, instant): towns, PINs,
 *      localities, landmarks and every section of the NIST University campus.
 *   2. Esri World Geocoder (geocode.arcgis.com, straight from the browser): commercial
 *      business listings - the hotels, restaurants, shops and colleges that OpenStreetMap
 *      simply does not have in most of Odisha - and category searches such as
 *      "hotels in Berhampur" or "restaurants near me".
 *   3. Photon (photon.komoot.io, OpenStreetMap data): typo-tolerant, good at streets and OSM
 *      landmarks. OSM spells some towns differently ("Brahmapur", not "Berhampur"), so those
 *      queries are also sent in OSM's spelling.
 *   4. optionally the deep /api/geocode search (adds Nominatim when the server is online) -
 *      used on an explicit "Go".
 * Every online source is optional: when one is down or blocked the others still answer.
 */
import { api } from "@/lib/api"
import { inIndia } from "@/lib/geo"

export interface GeoResult {
  name: string
  lat: number
  lon: number
  type: string
  district?: string | null
  discom?: string | null
  /** short category for the suggestion row: "University", "Hotel", "PIN code"… */
  kind?: string
  /** icon group for the row: "hotel" | "food" | "college" | "health" | "campus" | … */
  cat?: string
  /** second line of the row (street address), when the source has one */
  address?: string
  /** set on rows that are buildings of a mapped campus (see data/campus_nist.json) */
  campus?: { id: string; building?: string }
}

export interface SearchOutcome {
  rows: GeoResult[]
  /** set when the text was a category search ("hotels in Puri") - the UI can pin them all */
  category?: { label: string; near: string | null }
}

const ODISHA_CENTER = { lat: 20.2961, lon: 85.8245 }
const ESRI_GEOCODE = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
const PHOTON = "https://photon.komoot.io/api/"

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

const inOdisha = (lat: number, lon: number) => lat >= 17.75 && lat <= 22.65 && lon >= 81.3 && lon <= 87.55

// ------------------------------------------------------------------ spellings
/** Odisha town names have several spellings; a token matches if any spelling of it does. */
const SPELLINGS: string[][] = [
  ["berhampur", "brahmapur", "behrampur", "bramhapur", "brahampur"],
  ["bhubaneswar", "bhubaneshwar", "bbsr", "bhubneswar"],
  ["rourkela", "raurkela"], ["balasore", "baleswar", "baleshwar"], ["jeypore", "jaypur"],
  ["angul", "anugul"], ["keonjhar", "kendujhar"], ["bolangir", "balangir"], ["sonepur", "subarnapur"],
  ["boudh", "baudh"], ["deogarh", "debagarh"], ["nowrangpur", "nabarangpur"], ["khurda", "khordha"],
  ["paradeep", "paradip"], ["bargarh", "baragarh"], ["phulbani", "phulabani"], ["cuttack", "kataka"],
  ["golanthara", "golantara"], ["palur", "pallur"],
]
const SPELLING_OF = new Map<string, string[]>()
for (const group of SPELLINGS) for (const w of group) SPELLING_OF.set(w, group)
/** how OpenStreetMap writes the town (Photon only finds that spelling) */
const OSM_SPELLING: Record<string, string> = {
  berhampur: "brahmapur", behrampur: "brahmapur", bramhapur: "brahmapur", brahampur: "brahmapur",
  bhubaneshwar: "bhubaneswar", bbsr: "bhubaneswar", bhubneswar: "bhubaneswar",
  raurkela: "rourkela", baleswar: "balasore", baleshwar: "balasore", pallur: "palur",
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)

function osmSpelling(text: string): string | null {
  let changed = false
  const out = text.replace(/[A-Za-z]+/g, (w) => {
    const r = OSM_SPELLING[w.toLowerCase()]
    if (r) { changed = true; return r }
    return w
  })
  return changed ? out : null
}

/** does `name` contain token `t` (in any of its spellings)? */
function hasToken(name: string, t: string) {
  const alts = SPELLING_OF.get(t) ?? [t]
  return alts.some((a) => name.includes(a))
}

const QUERY_FILLER = new Set(["in", "at", "near", "the", "of", "and", "odisha", "india"])

/** does this row answer every word that was typed? ("sri ranjan berhampur" -> "Hotel Sri Ranjan,
 *  Brahmapur") - then Go / Enter can jump straight to it instead of asking again */
export function matchesQuery(r: GeoResult, text: string) {
  const name = words(`${r.name} ${r.address ?? ""}`).join(" ")
  const tokens = words(text).filter((t) => t.length >= 2 && !QUERY_FILLER.has(t))
  return tokens.length > 0 && tokens.every((t) => hasToken(name, t))
}

// ------------------------------------------------------------------ categories
interface Category { label: string; esri: string; cat: string; re: RegExp }
/** "hotels", "restaurants near me", "petrol pump in puri"… -> Esri business categories */
const CATEGORIES: Category[] = [
  { label: "Hotels", cat: "hotel", esri: "Hotel,Bed and Breakfast,Resort,Motel,Hostel",
    re: /^(hotels?|lodges?|lodging|resorts?|guest ?houses?|homestays?|motels?|places to stay)$/ },
  { label: "Restaurants", cat: "food", esri: "Food",
    re: /^(restaurants?|resturants?|restraunts?|food|foods|dhabas?|eateries|eatery|dining|biryani|thali|fast ?food|hotels? (and|&) restaurants?)$/ },
  { label: "Cafés", cat: "food", esri: "Coffee Shop", re: /^(cafes?|cafés?|coffee|coffee shops?|tea stalls?|chai)$/ },
  { label: "Hospitals", cat: "health", esri: "Hospital", re: /^(hospitals?|nursing homes?|clinics?)$/ },
  { label: "Pharmacies", cat: "health", esri: "Pharmacy", re: /^(pharmac(y|ies)|medical( shops?| stores?)?|chemists?|medicine shops?)$/ },
  { label: "Colleges", cat: "college", esri: "College", re: /^(colleges?|universit(y|ies)|engineering colleges?|institutes?)$/ },
  { label: "Schools", cat: "college", esri: "School", re: /^(schools?)$/ },
  { label: "Banks", cat: "shop", esri: "Bank", re: /^(banks?)$/ },
  { label: "ATMs", cat: "shop", esri: "ATM", re: /^(atms?)$/ },
  { label: "Petrol pumps", cat: "fuel", esri: "Gas Station", re: /^(petrol (pumps?|bunks?|stations?)|fuel( stations?)?|gas stations?|filling stations?)$/ },
  { label: "Temples", cat: "temple", esri: "Temple", re: /^(temples?|mandirs?)$/ },
  { label: "Malls", cat: "shop", esri: "Shopping Center", re: /^(malls?|shopping (malls?|cent(re|er)s?))$/ },
  { label: "Police stations", cat: "gov", esri: "Police Station", re: /^(police|police stations?|thanas?)$/ },
  { label: "Bus stands", cat: "transport", esri: "Bus Station", re: /^(bus (stands?|stations?|stops?))$/ },
  { label: "Railway stations", cat: "transport", esri: "Train Station", re: /^((railway|train) stations?)$/ },
]

/** "best hotels in berhampur" -> { Hotels, place: "berhampur" }; "food near me" -> { Restaurants } */
export function parseCategory(text: string): { category: Category; place: string | null } | null {
  let t = words(text).join(" ")
  t = t.replace(/\b(near ?by|near me|around me|close by|close to me)\b/g, " ")
    .replace(/^(best|good|cheap|top|budget|famous|popular|nearby|nearest|all)\s+/, "")
    .replace(/\s+/g, " ").trim()
  if (!t) return null
  const m = t.match(/^(.+?)\s+(?:in|near|at|around|of|close to)\s+(.+)$/)
  const tries: [string, string | null][] = m ? [[m[1], m[2]]] : []
  tries.push([t, null])
  const parts = t.split(" ")
  for (let i = 1; i < parts.length; i++) {                   // "puri hotels"
    tries.push([parts.slice(i).join(" "), parts.slice(0, i).join(" ")])
  }
  for (const [head, place] of tries) {
    const category = CATEGORIES.find((c) => c.re.test(head))
    if (category) return { category, place: place && place.length >= 2 ? place : null }
  }
  return null
}

// ------------------------------------------------------------------ Photon (OpenStreetMap)
const pretty = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "")

/** OSM tags -> the app's zoom classes (zoomFor in map-panel), a category label and icon group */
function photonType(p: Record<string, string>): { type: string; kind: string; cat?: string } {
  const key = p.osm_key ?? ""
  const val = p.osm_value ?? ""
  const t = p.type ?? ""
  const s = `${key} ${val} ${t}`
  const label = pretty(val || t)
  if (/university|college|school|kindergarten/.test(s)) return { type: "poi", kind: label, cat: "college" }
  if (/hospital|clinic|pharmacy|doctors/.test(s)) return { type: "poi", kind: label, cat: "health" }
  if (/hotel|hostel|guest_house|motel/.test(s)) return { type: "poi", kind: label, cat: "hotel" }
  if (/restaurant|cafe|fast_food|food_court|bakery|ice_cream/.test(s)) return { type: "poi", kind: label, cat: "food" }
  if (/mall|supermarket|market|shop|bank|atm/.test(s)) return { type: "poi", kind: label, cat: "shop" }
  if (/temple|church|mosque|shrine|monastery|place_of_worship/.test(s)) return { type: "poi", kind: label, cat: "temple" }
  if (/tourism|museum|attraction|viewpoint/.test(s)) return { type: "poi", kind: label, cat: "landmark" }
  if (/airport|aerodrome|station|railway|bus_stop|bus_station|harbour|ferry/.test(s)) return { type: "poi", kind: label, cat: "transport" }
  if (/fuel/.test(s)) return { type: "poi", kind: label, cat: "fuel" }
  if (/stadium|sports|pitch|park|garden|playground|zoo/.test(s)) return { type: "poi", kind: label, cat: "landmark" }
  if (/office|embassy|government|police|post_office|library|townhall/.test(s)) return { type: "poi", kind: label, cat: "gov" }
  if (/house|building|apartment|hut|address|residential/.test(s)) return { type: "building", kind: "Building" }
  if (/street|road|highway|footway|path|cycleway|trunk|pedestrian/.test(s)) return { type: "road", kind: "Street" }
  if (/postcode|postal/.test(s)) return { type: "postcode", kind: "PIN code" }
  if (/city|town|borough|municipality|county|state|region|district/.test(s)) return { type: "town", kind: label || "Town" }
  if (/suburb|neighbourhood|neighborhood|quarter|hamlet|village|locality|isolated_dwelling/.test(s))
    return { type: "suburb", kind: label || "Area" }
  return { type: "", kind: label || "Place" }
}

interface PhotonFeature {
  properties?: Record<string, string>
  geometry?: { coordinates?: number[] }
}

function photonRow(f: PhotonFeature): GeoResult | null {
  const p = f.properties ?? {}
  const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN]
  if (!isFinite(lat) || !isFinite(lon) || !p.name) return null
  if (p.countrycode && p.countrycode !== "IN") return null
  const { type, kind, cat } = photonType(p)
  const area = p.city || p.county || p.district || ""
  const tail = [area, p.state].filter((x) => x && x.toLowerCase() !== "india")
  const street = [p.street, p.locality || p.district].filter(Boolean).join(", ")
  return {
    name: [p.name, ...tail].join(", ") || p.name, lat, lon, type, kind, cat,
    address: [street, area, p.postcode].filter(Boolean).join(", ") || undefined,
    district: null, discom: null,
  }
}

async function photonSearch(q: string, bias: { lat: number; lon: number }, signal?: AbortSignal): Promise<GeoResult[]> {
  // bbox keeps the rows in and around India; zoom/location_bias_scale make "near the map" count
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=10&lang=en&bbox=68,6,98,37.5` +
    `&lat=${bias.lat.toFixed(4)}&lon=${bias.lon.toFixed(4)}&zoom=12&location_bias_scale=0.3`
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return []
    const j = await r.json() as { features?: PhotonFeature[] }
    return (j.features ?? []).map(photonRow).filter((x): x is GeoResult => !!x)
  } catch {
    return []                                  // offline / blocked: the other sources still answer
  }
}

// ------------------------------------------------------------------ Esri World Geocoder
interface EsriCandidate {
  address?: string
  location?: { x?: number; y?: number }
  attributes?: Record<string, string | number | null>
}

const ESRI_ADDR_TYPE: Record<string, { type: string; kind: string }> = {
  Locality: { type: "suburb", kind: "Area" }, PostalLoc: { type: "postcode", kind: "PIN area" },
  Postal: { type: "postcode", kind: "PIN code" }, StreetName: { type: "road", kind: "Street" },
  StreetAddress: { type: "building", kind: "Address" }, PointAddress: { type: "building", kind: "Address" },
  StreetInt: { type: "road", kind: "Junction" }, Subregion: { type: "town", kind: "District" },
  Region: { type: "town", kind: "State" },
}

/** Esri business type ("Indian Food", "Bed and Breakfast", "College"…) -> icon group */
function esriCat(t: string): string | undefined {
  const s = t.toLowerCase()
  if (/hotel|bed and breakfast|resort|motel|hostel|lodg/.test(s)) return "hotel"
  if (/food|restaurant|coffee|cafe|bakery|sweet|pizza|burger|snack|tea|juice|ice cream|bar\b|pub|dessert|sandwich/.test(s)) return "food"
  if (/college|school|university|education|library/.test(s)) return "college"
  if (/hospital|pharmacy|doctor|clinic|dentist|medical|health/.test(s)) return "health"
  if (/temple|church|mosque|religious|shrine/.test(s)) return "temple"
  if (/gas station|fuel/.test(s)) return "fuel"
  if (/station|bus|airport|port|transport|railway/.test(s)) return "transport"
  if (/bank|atm|shop|store|market|mall|center|centre|supermarket|grocery/.test(s)) return "shop"
  if (/police|government|office|post/.test(s)) return "gov"
  if (/park|garden|museum|attraction|landmark|monument|stadium|beach|lake|zoo/.test(s)) return "landmark"
  return undefined
}

function esriRow(c: EsriCandidate): GeoResult | null {
  const a = c.attributes ?? {}
  const lat = Number(c.location?.y), lon = Number(c.location?.x)
  if (!isFinite(lat) || !isFinite(lon)) return null
  const addrType = String(a.Addr_type ?? "")
  const place = String(a.PlaceName ?? "") || String(c.address ?? "").split(",")[0]
  if (!place) return null
  const typeName = String(a.Type ?? "")
  const addr = String(a.Place_addr ?? "").replace(/,\s*(India|IND)$/i, "")
  if (addrType === "POI" || (!ESRI_ADDR_TYPE[addrType] && typeName)) {
    const city = String(a.City ?? "") || String(a.Subregion ?? "")
    return {
      name: city && !place.toLowerCase().includes(city.toLowerCase()) ? `${place}, ${city}` : place,
      lat, lon, type: "poi", kind: typeName || "Place", cat: esriCat(typeName),
      address: addr || undefined, district: null, discom: null,
    }
  }
  const m = ESRI_ADDR_TYPE[addrType] ?? { type: "", kind: "Place" }
  return { name: String(c.address ?? place), lat, lon, type: m.type, kind: m.kind, district: null, discom: null }
}

const ESRI_FIELDS = "PlaceName,Place_addr,Type,Addr_type,City,Subregion,Region"

async function esriSearch(q: string, bias: { lat: number; lon: number }, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `${ESRI_GEOCODE}?f=json&SingleLine=${encodeURIComponent(q)}&countryCode=IND&maxLocations=8` +
    `&location=${bias.lon.toFixed(5)},${bias.lat.toFixed(5)}&outFields=${ESRI_FIELDS}&langCode=EN`
  return esriFetch(url, signal)
}

/** every business of a category inside a box (Esri World Geocoder category search) */
async function esriCategory(cat: Category, at: { lat: number; lon: number }, radiusDeg: number,
  signal?: AbortSignal): Promise<GeoResult[]> {
  const ext = [at.lon - radiusDeg, at.lat - radiusDeg, at.lon + radiusDeg, at.lat + radiusDeg].map((v) => v.toFixed(4)).join(",")
  const url = `${ESRI_GEOCODE}?f=json&SingleLine=&category=${encodeURIComponent(cat.esri)}&maxLocations=30` +
    `&location=${at.lon.toFixed(5)},${at.lat.toFixed(5)}&searchExtent=${ext}&outFields=${ESRI_FIELDS}&langCode=EN`
  const rows = await esriFetch(url, signal)
  return rows.map((r) => ({ ...r, cat: r.cat ?? cat.cat }))
}

const esriCache = new Map<string, GeoResult[]>()

async function esriFetch(url: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const hit = esriCache.get(url)
  if (hit) return hit
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return []
    const j = await r.json() as { candidates?: EsriCandidate[] }
    const rows = (j.candidates ?? []).map(esriRow).filter((x): x is GeoResult => !!x)
    if (esriCache.size > 200) esriCache.clear()
    esriCache.set(url, rows)
    return rows
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ merging
const LOCAL_KIND: Record<string, string> = {
  town: "Town", suburb: "Locality", county: "District",
  postcode: "PIN code", postcode_area: "PIN area", poi: "Landmark", campus: "NIST campus",
}
const isArea = (r: GeoResult) => ["town", "suburb", "county", "postcode", "postcode_area"].includes(r.type)
const NAME_NOISE = new Set(["hotel", "the", "and", "restaurant", "odisha", "india", "pvt", "ltd", "new", "sri", "shri", "shree"])
const nameKey = (r: GeoResult) => words(r.name.split(",")[0]).filter((w) => !NAME_NOISE.has(w))

/** same place from two sources? (same name nearby, or one name inside the other at ~the same spot) */
function samePlace(a: GeoResult, b: GeoResult) {
  const km = distanceKm(a.lat, a.lon, b.lat, b.lon)
  const ka = nameKey(a), kb = nameKey(b)
  const same = ka.join(" ") === kb.join(" ")
  if (same && km < (isArea(a) || isArea(b) ? 5 : 0.4)) return true
  if (km < 0.04 && ka.length && kb.length) {
    const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
    if (s.every((w) => l.includes(w))) return true
  }
  return false
}

function merge(groups: GeoResult[][], limit: number): GeoResult[] {
  const out: GeoResult[] = []
  for (const r of groups.flat()) {
    if (!r || !isFinite(r.lat) || !isFinite(r.lon)) continue
    if (!inIndia(r.lat, r.lon)) continue                    // never suggest rows the map can't reach
    if (out.some((e) => samePlace(e, r))) continue
    out.push(r.kind ? r : { ...r, kind: LOCAL_KIND[r.type] ?? "Place" })
    if (out.length >= limit) break
  }
  return out
}

/** where a category search should look: a named town/landmark, else the map view */
async function resolvePlace(place: string, bias: { lat: number; lon: number }, signal?: AbortSignal) {
  const local = await api<GeoResult[]>(`/api/suggest?q=${encodeURIComponent(place)}`, { signal }).catch(() => [])
  const pick = local.find((r) => words(r.name).some((w) => hasToken(w, words(place)[0] ?? ""))) ?? local[0]
  if (pick) return { lat: pick.lat, lon: pick.lon, name: pick.name.split(",")[0], area: pick.type === "town" || pick.type === "county" }
  const remote = await esriSearch(place, bias, signal)
  if (remote[0]) return { lat: remote[0].lat, lon: remote[0].lon, name: remote[0].name.split(",")[0], area: isArea(remote[0]) }
  return null
}

/** Suggestion rows for the search box. `deep` adds the full /api/geocode pass (Nominatim on
 *  live servers). Rows outside India are dropped (the map is India-only) and everything is
 *  ranked by name match + closeness to the current map view - like a real map app. */
export async function searchPlaces(q: string, opts: {
  deep?: boolean; signal?: AbortSignal; bias?: { lat: number; lon: number }
} = {}): Promise<SearchOutcome> {
  const text = q.trim()
  if (text.length < 2) return { rows: [] }
  const bias = opts.bias ?? ODISHA_CENTER
  const signal = opts.signal

  // ---- "hotels in Berhampur", "restaurants near me", "petrol pump"…
  const cat = parseCategory(text)
  if (cat) {
    const where = cat.place ? await resolvePlace(cat.place, bias, signal) : null
    const at = where ?? bias
    const radius = where ? (where.area ? 0.07 : 0.035) : 0.05
    const [rows, local] = await Promise.all([
      esriCategory(cat.category, at, radius, signal),
      api<GeoResult[]>(`/api/suggest?q=${encodeURIComponent(text)}`, { signal }).catch(() => [] as GeoResult[]),
    ])
    const near = rows
      .map((r) => ({ r, km: distanceKm(r.lat, r.lon, at.lat, at.lon) }))
      .sort((a, b) => a.km - b.km)
      .map((x) => x.r)
    // campus buildings ("NIST hostels") stay on top - they are what the user meant at the college
    const campusRows = local.filter((r) => r.campus && r.type === "campus")
    const merged = merge([campusRows, near], 30)
    if (merged.length) return { rows: merged, category: { label: cat.category.label, near: where?.name ?? null } }
    // nothing in that category here (or offline): fall through to the normal name search
  }

  const osmText = osmSpelling(text)
  const [local, esri, photon, photonOsm, deep] = await Promise.all([
    api<GeoResult[]>(`/api/suggest?q=${encodeURIComponent(text)}`, { signal }).catch(() => [] as GeoResult[]),
    esriSearch(text, bias, signal),
    photonSearch(text, bias, signal),
    osmText ? photonSearch(osmText, bias, signal) : Promise.resolve([] as GeoResult[]),
    opts.deep
      ? api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(text)}`, { signal }).catch(() => [] as GeoResult[])
      : Promise.resolve([] as GeoResult[]),
  ])
  // mapped campus rows (the backend only sends them when the text names the campus or one of its
  // buildings) are exact: they stay on top in the backend's order. Online copies of the campus
  // itself ("National Institute of Science…" a few hundred metres off) are dropped.
  const campusRows = local.filter((r) => r.campus)
  const site = campusRows.find((r) => !r.campus?.building) ?? campusRows[0]
  const dupOfCampus = (r: GeoResult) => !!site && distanceKm(r.lat, r.lon, site.lat, site.lon) < 0.8 &&
    /\bnist\b|national institute of science/i.test(r.name)
  const seen = merge([campusRows, esri, photonOsm, photon, deep, local.filter((r) => !r.campus)], 40)
    .filter((r) => r.campus || !dupOfCampus(r))

  const nq = words(text).join(" ")
  const tokens = words(text).filter((t) => t.length >= 2)
  const score = (r: GeoResult, idx: number) => {
    const name = words(r.name).join(" ")
    const head = words(r.name.split(",")[0]).join(" ")
    let s = -idx * 3
    if (head === nq || (SPELLING_OF.get(nq)?.includes(head) ?? false)) s += 400
    else if (tokens.length && tokens.every((t) => hasToken(name, t))) s += 220
    else if (tokens.some((t) => hasToken(name, t))) s += 80
    if (r.discom || inOdisha(r.lat, r.lon)) s += 120           // SuryaJal is Odisha-first
    const km = distanceKm(r.lat, r.lon, bias.lat, bias.lon)
    s += km < 3 ? 170 : km < 15 ? 140 : km < 50 ? 110 : km < 200 ? 70 : km < 600 ? 30 : 0   // near the map view
    return s
  }
  const ranked = seen
    .filter((r) => !r.campus)
    .map((r, i) => ({ r, s: score(r, i) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)
  return { rows: [...seen.filter((r) => r.campus), ...ranked].slice(0, Math.max(10, campusRows.length + 2)) }
}
