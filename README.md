# SuryaJal

**AI rooftop solar + rainwater planner for Odisha — FastAPI backend + React dashboard.**

SuryaJal turns a satellite map into a household energy-and-water plan. You find your house, tap your
roof, an AI model outlines it, and the app returns how many solar panels fit, what the system costs
after subsidy, what your electricity bill becomes, how much rainwater you can harvest and store, and
a one-page Green Roof Report with a QR code you can take home.

Every rule, tariff and subsidy in the app is Odisha's: the OERC domestic slab tariff and electricity
duty, net metering under TPCODL / TPNODL / TPWODL / TPSODL, the PM Surya Ghar central subsidy plus
Odisha's own State Financial Assistance, the Odisha Development Authorities rainwater norm and the
State's CHHATA rooftop-rainwater subsidy. Climate data for all 30 districts is bundled for offline use.

| | |
|---|---|
| Version | 2.0.1 |
| Backend | Python 3.10+ · FastAPI · ONNX Runtime (MobileSAM) · reportlab · SQLite |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Leaflet |
| Data | NASA POWER climatology · Esri World Imagery · Nominatim/OpenStreetMap · OERC tariff orders |
| Tests | 92 pytest tests (`pytest -q`) |

> This is a software project for the Renewable Energy Club tech fest (Nov 2026). It combines the
> problem statement SIH25065 (Ministry of Jal Shakti: on-spot rooftop rainwater-harvesting assessment)
> with rooftop-solar planning under **PM Surya Ghar: Muft Bijli Yojana** and **Odisha's State
> Financial Assistance**.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Feature summary](#2-feature-summary)
3. [Architecture](#3-architecture)
4. [Repository structure](#4-repository-structure)
5. [Backend](#5-backend-python--fastapi)
6. [API reference](#6-api-reference)
7. [Frontend](#7-frontend-react--typescript--tailwind--shadcnui)
8. [Methods and assumptions](#8-methods-and-assumptions)
9. [Getting started](#9-getting-started)
10. [Configuration](#10-configuration)
11. [Deployment](#11-deployment)
12. [Screenshots and sample report](#12-screenshots-and-sample-report)
13. [Demo checklist and anticipated questions](#13-demo-checklist-and-anticipated-questions)
14. [Known limitations](#14-known-limitations)
15. [Roadmap](#15-roadmap)
16. [Data sources, credits and licences](#16-data-sources-credits-and-licences)

---

## 1. What it does

The whole flow takes under a minute:

1. **Find the roof.** Search an address, town or PIN code, or pan the map to the house.
2. **Outline the roof.** Tap once and MobileSAM (Segment Anything, mobile version, running as ONNX on
   the CPU) returns the roof polygon in about a second. "Add part" / "Remove" taps refine it, and any
   corner can be dragged. A manual draw mode is available as a fallback.
3. **Get the numbers.** The app sizes the plant to the roof and to the household load, packs real
   540 Wp panels onto the actual roof shape, computes the OERC bill before and after solar, applies
   the central and State subsidies, and sizes the rainwater tank and recharge well.
4. **Take the report.** A one-page PDF with the roof image, panel layout, KPIs, monthly solar and
   rainfall charts, assumptions and a QR code. On a PC the QR points at the machine's Wi-Fi/LAN
   address, so a visitor's phone can download the PDF immediately.

Guests can do everything except save roofs. Signed-in users get "My roofs" and can reopen or
re-download any saved roof.

---

## 2. Feature summary

### Roof detection and layout

| Feature | Details |
|---|---|
| AI roof detection | MobileSAM ONNX encoder + point-prompt decoder, about 1 s per tap on a laptop CPU, no GPU. |
| Refinement | "Add part" / "Remove" taps reuse the cached image embedding, so each refinement takes about 0.1 s. |
| Manual fallback | Draw the roof corners by hand; AI and manual outlines are both editable by dragging corners. |
| Surface classification | The mask is classified (RCC, metal/GI, tile, cement sheet, mixed) to pick the runoff coefficient. |
| Auto panel layout | 540 Wp modules placed on the real roof shape with a 0.5 m edge gap, shown on the map and in the PDF, with a physical fit check. |

### Solar

| Feature | Details |
|---|---|
| Sizing | `min(roof limit, household need)`, with the roof limit also capped by how many panels fit geometrically. |
| Energy model | NASA POWER monthly irradiance with a temperature-corrected performance ratio (~3.7 units/day per kW in Bhubaneswar). |
| Bill before and after | OERC telescopic slabs, ₹20/kW fixed charge, 4% electricity duty, Kutir Jyoti handling — no flat ₹/unit shortcut. |
| Net metering | Credits carry forward within the financial year, generation credited up to 90% of yearly consumption, March settlement at the GRIDCO APPC feed-in tariff. |
| Subsidies | PM Surya Ghar CFA plus Odisha SFA, each independently switchable, capped by the system cost. |
| Money view | Capital cost, net cost, payback, IRR, and an interactive 25-year savings timeline with the break-even year. |
| Warnings | Flags plants larger than the sanctioned load, larger than the 90% net-metering cap can credit, or needing a load enhancement. |

### Rainwater

| Feature | Details |
|---|---|
| Harvest | `area × rainfall × runoff coefficient`, month by month. |
| Storage | Tank sized to one heavy-rain day, rounded up to a standard tank size, with a tank-fill simulator. |
| Recharge | Recharge well sized to the Odisha norm of 60 L per m² of roof (6 m³ per 100 m²), plus the required 100 mm downpipes. |
| Demand | Days of family water at the CPHEEO norm of 135 L/person/day, and tankers avoided. |
| CHHATA | Eligibility check and subsidy amount (50% of system cost or ₹55,000, whichever is less), with the reason when a roof misses out. |

### App and reporting

| Feature | Details |
|---|---|
| Green Score | 0–100 score and grade: 55 points for solar coverage, 35 for rainwater coverage, 10 for meeting the Odisha recharge rule. |
| Green Roof Report | A4 PDF with roof thumbnail, panel layout, KPIs, two monthly charts, assumptions and QR code; downloadable from the dashboard. |
| Share links | The complete assessment state travels in the URL, so a link reopens the same roof. |
| District + DISCOM | Any point in the State is matched to its district and to its distribution company. |
| What-if planner | Drag monthly units or pick a panel count (up to what fits) and every number, the layout and the PDF update live. "Only know your bill?" converts ₹ to units. |
| Accounts (optional) | Sign up, sign in, sign out, keep-me-signed-in, sign out everywhere, delete account; saved roofs under "My roofs". |
| Pre-flight loader | An animated loader that really checks the server, warms MobileSAM and verifies climate data, imagery and rules, printing each check as it comes online. |
| Offline resilience | Climate data cached and bundled for 32 Odisha towns (all 30 districts); satellite tiles cached on disk; three demo roofs for when a visitor cannot find their house. |
| Fest counter | Live anonymous totals ("today: 23 roofs, 71 kW, 18 lakh L"); only aggregates are stored. |

### What changed in 2.0.1

- Download buttons work everywhere: the PDF is fetched as a blob and saved with a temporary link, so
  embedded preview frames and strict browsers that block `Content-Disposition` navigation no longer
  break the click. Includes a spinner, success/error toasts and an "Open instead" fallback.
- `/api/net` reports the machine's LAN IPv4 address, so the QR code and share links work when SuryaJal
  runs on `localhost` and a phone scans from the same Wi-Fi. A tap-to-retry tile covers failures.
- The desktop dashboard is now one page at a time (Roof Map, Solar, Rainwater, Report) with the map
  full-screen instead of a fixed-height split; phones and tablets keep the bottom tab bar.
- The report PDF can be built from the imagery the browser already has (`POST /r`), so the satellite
  picture survives when the server has no internet.
- Type-ahead place suggestions (`/api/suggest`) come from bundled PIN-code, town and district data.

---

## 3. Architecture

```
Browser — React 19 + TypeScript + Tailwind + shadcn/ui, Leaflet map
   │  tap (lat, lon)                 polygon + inputs                share state (URL)
   ▼                                 ▼                                ▼
POST /api/segment                POST /api/assess                 GET/POST /r  (PDF)
   │ tiles.py: Esri z19 512×512     │ climate.py: NASA POWER (cached) │ report.py: reportlab A4
   │ segment.py: MobileSAM encoder  │ layout.py: panel packing        │ roof thumbnail + panels
   │   (embedding cached per crop)  │ solar.py: sizing + money + CO2  │ charts + QR code
   │ decoder with point prompts     │ rain.py: harvest, tank, well    │
   │ mask → clean → polygon → WGS84 │ green_score                     │
```

The FastAPI process serves the API, the built React site (`static/site`, mounted at `/` and `/app`)
and the original no-build tool (`/classic`). There is one backend, one frontend source tree and one
build step; the frontend never talks to a second service.

### Request lifecycle

1. **Segment.** The server fetches a 3×3 block of zoom-19 Esri tiles, crops 512 px around the tap
   (about 150 m × 150 m), runs MobileSAM's image encoder once and caches the 64×64×256 embedding for
   that crop. The decoder turns each tap into three candidate masks; the best one by predicted IoU
   that contains the tap and is a sensible size is kept.
2. **Clean and vectorise.** Morphological cleanup keeps the region under the tap and fills holes, the
   outline is simplified with Douglas–Peucker, the area is rescaled to match the mask's pixel count,
   and pixels are converted to latitude/longitude with Web-Mercator maths.
3. **Assess.** Climate data is read from cache, from the bundled Odisha table, or from NASA POWER;
   the panel layout, solar sizing and economics, rainwater sizing, subsidy checks and Green Score are
   computed in pure Python modules with no I/O.
4. **Report.** The PDF is rendered with reportlab using the browser-supplied crop when available
   (otherwise the server's cached tiles), and the QR code encodes the share URL.

### Backend module map

| Module | Responsibility |
|---|---|
| `app/main.py` | FastAPI routes, request models, static site serving |
| `app/config.py` | Every default, tariff, subsidy and source in one place (single source of truth) |
| `app/segment.py` | MobileSAM ONNX inference, OpenCV fallback, mask → polygon |
| `app/tiles.py` | Esri tile fetch, disk cache, placeholder detection, crop helpers |
| `app/layout.py` | Automatic solar-panel packing on the roof polygon |
| `app/solar.py` | Sizing, bill before/after, net metering, subsidies, CO₂, IRR |
| `app/rain.py` | Harvest, tank, recharge well, ODA rule check, CHHATA, Green Score |
| `app/tariff.py` | OERC telescopic domestic bill (slabs, fixed charge, duty, Kutir Jyoti) |
| `app/odisha.py` | Districts, DISCOM lookup, bundled NASA POWER table for the State |
| `app/climate.py` | NASA POWER client, cache and offline fallback |
| `app/geo.py` | Web-Mercator maths, polygon area, encoded polylines |
| `app/pincode.py`, `app/places.py` | Bundled PIN-code and place index for offline search and suggestions |
| `app/report.py` | A4 PDF report, QR SVG, roof thumbnail |
| `app/auth.py` | Accounts, scrypt password hashing, hashed bearer tokens, saved roofs |
| `app/stats.py` | Anonymous fest counter |
| `app/fonts/` | DejaVu Sans (needed for the ₹ symbol in the PDF) |

---

## 4. Repository structure

```
SuryaJal/
├── app/                        FastAPI backend (routes, models and pure-Python calculators)
├── frontend/                   React + TypeScript + Tailwind v4 + shadcn/ui source (Vite)
│   └── src/                    pages, features, components, lib
├── static/
│   ├── site/                   built React site, served at / and /app
│   └── index.html, css, js/    original no-build tool, served at /classic
├── data/
│   ├── climate_fallback.json   NASA POWER climatology for 32 Odisha towns + district/DISCOM map
│   └── suryajal.db             accounts + saved roofs (created at runtime)
├── models/                     MobileSAM ONNX files (downloaded by scripts/download_models.py)
├── scripts/
│   ├── download_models.py      fetch and verify the MobileSAM ONNX models
│   └── prefetch_climate.py     warm the climate cache for the bundled towns
├── tests/                      pytest suite (92 tests)
├── docs/                       screenshots and the sample report
├── run.sh · run.bat            one-click local start (venv + deps + models + uvicorn)
├── Dockerfile                  production image (downloads models at build time)
├── requirements.txt            Python dependencies
└── pytest.ini
```

---

## 5. Backend (Python / FastAPI)

**Stack:** FastAPI + uvicorn, Pydantic v2 models, httpx for outbound calls, OpenCV (headless) for
image work, ONNX Runtime for MobileSAM, Pillow for image compositing, reportlab for the PDF, and
SQLite (standard library) for accounts and saved roofs.

**Run directly:**

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Behaviour notes**

- The server binds to `0.0.0.0` so phones on the same network can open it; `run.sh` prints the LAN URL.
- MobileSAM is warmed in the background at startup, and `/api/health` reports `engine` and `ready`.
- Without the model files the app still runs using an OpenCV region-growing fallback; MobileSAM is
  considerably better.
- Outbound requests carry a descriptive `User-Agent`, and Nominatim usage is throttled to 1 request
  per second and cached.
- Caches live in `.cache/` (tiles and climate); deleting it is always safe.

**Accounts and security.** Passwords are hashed with scrypt (standard library), sessions are random
256-bit tokens stored only as SHA-256 hashes, failed logins are throttled, and post-sign-in redirects
only allow in-app paths. Tokens live in `localStorage` ("keep me signed in") or `sessionStorage`
(default, better for a shared laptop). All account data is in `data/suryajal.db` — delete that file to
wipe every account and saved roof.

---

## 6. API reference

Interactive docs: `http://localhost:8000/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status, AI engine (`mobilesam` or `opencv`), readiness |
| GET | `/api/config` | Defaults, roof types, sources, plus the Odisha block (DISCOMs, tariff slabs, rainwater rule, CHHATA, bundled towns) |
| GET | `/api/odisha/table` | Sunlight, rainfall, district and DISCOM for every bundled Odisha town |
| GET | `/api/odisha/locate?lat=&lon=` | District + DISCOM for a point |
| GET | `/api/odisha/tariff?units=&load_kw=` | Itemised OERC domestic bill for a month |
| GET | `/api/suggest?q=` | Offline type-ahead suggestions (PIN codes, towns, districts, localities) |
| GET | `/api/geocode?q=` | Place search (Nominatim proxy, throttled, cached, biased to Odisha, tagged with district + DISCOM) |
| GET | `/api/reverse?lat=&lon=` | Short address for the report |
| GET | `/api/net` | This machine's LAN IPv4 addresses and port, used for QR/share links on `localhost` |
| POST | `/api/segment` | `{points:[{lat,lon,label}], zoom}` → roof polygon, area, confidence |
| POST | `/api/assess` | `{polygon:[[lat,lon],…], monthly_units, family_size, …}` → solar, rainwater, score, panel layout |
| GET | `/r?p=<polyline>&u=&f=&rt=&uf=…` | One-page PDF report, stateless — this is what the QR code opens |
| POST | `/r` | Same report, built from a browser-captured satellite crop (used when the server is offline) |
| GET | `/api/qr.svg?data=` | QR code as SVG |
| GET | `/api/thumb?p=…` | Satellite photo of the roof with the panel layout (JPEG) |
| GET | `/api/stats` | Anonymous fest counter |
| POST | `/api/auth/signup` | `{name, email, password}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, password, remember}` → `{token, user}` (8 failed tries per 10 min → 429) |
| POST | `/api/auth/logout` | Revoke the current token (`?everywhere=true` for all devices) |
| GET / DELETE | `/api/auth/me` | Current user; delete account (requires `{password}`) |
| GET / POST | `/api/roofs` | List / save a roof (`{query, title}`; the server recomputes the numbers) |
| DELETE | `/api/roofs/{id}` | Remove a saved roof |

Authentication uses `Authorization: Bearer <token>`.

**Pages:** `/` landing · `/app` dashboard · `/login` · `/signup` · `/account` (My roofs) · `/demo`
(StackSpread component demo) · `/classic` (original tool). Legacy `/?p=…` share links redirect to
`/app?p=…`.

---

## 7. Frontend (React + TypeScript + Tailwind + shadcn/ui)

```
frontend/
├── components.json              shadcn config → aliases: @/components, @/components/ui, @/lib/utils
├── vite.config.ts               @ → src, Tailwind v4 plugin, dev proxy to :8000, build → ../static/site
├── public/brand/                logo mark, glyph, favicon, app icons, og image
├── public/images/               self-hosted photos + dashboard screenshot
└── src/
    ├── components/ui/           shadcn primitives + stack-spread.tsx
    ├── components/demo/         the StackSpread demo (route /demo)
    ├── components/brand/        LogoMark, AnimatedLogoMark, Logo wordmark
    ├── components/preflight-loader.tsx
    ├── components/site/         header, footer, user menu
    ├── features/dashboard/      state (assessment + URL sync), Leaflet map, Solar / Rainwater / Report views
    ├── features/landing/        landing-page sections
    ├── pages/                   landing, dashboard, login (+ signup), account, demo, 404
    └── lib/                     api.ts (typed client), auth.tsx, geo.ts, mapcrop.ts, report.ts, net.ts, format.ts, utils.ts
```

**Routes:** `/` landing, `/app` dashboard, `/login`, `/signup`, `/account`, `/demo`, 404 fallback.
The dashboard has four tabs — Roof Map, Solar, Rainwater, Report — with a bottom tab bar on phones
and tablets and a top tab strip on desktop.

**Develop the UI:**

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 with hot reload; /api, /r, /app and /static proxy to uvicorn on :8000
npm run build    # type-checks, then writes the production site to ../static/site
```

The built site is committed into `static/site/`, so Node.js is **not** required to run SuryaJal —
only to change the UI (Node 20+).

**Layout of concerns.** Every reusable primitive lives in `src/components/ui` (the folder shadcn's CLI
writes into, so `npx shadcn add …` never overwrites feature code); app-specific pieces live in
`components/site`, `components/brand` and `features/`.

**Report downloads** (`src/lib/report.ts`) deliberately avoid plain `<a download>` navigation: the PDF
is fetched as a blob and saved through a temporary object URL, which keeps working inside embedded
preview frames and strict browsers. If the server cannot reach Esri tiles, the browser captures the
satellite crop from the map it already rendered and posts it with the request, so the report keeps its
imagery.

**Accounts.** `lib/auth.tsx` provides the auth context; tokens are held in memory plus
`localStorage`/`sessionStorage` depending on "keep me signed in".

**StackSpread.** The landing-page photo story is client-only (`motion/react` scroll and spring hooks,
no context provider). Props: `scrollLength`, `bgColor`, `textColor`, `cardRadius`, `stackScale`,
`clusterRotation`, `textFadeStart`, `showScrollHint`, plus SuryaJal additions `title`, `highlight`,
`titleEnd`, `subtitle`, `action`, `cards`. On touch screens it switches to a two-column stack and
drops pointer parallax, and it respects *reduce motion*. The left column shows rain, the right column
sun, and the centre the roofs that catch both.

**How the frontend was scaffolded** (if you start a new one):

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install tailwindcss @tailwindcss/vite
npx shadcn@latest init -d -b radix
npx shadcn@latest add button card input label badge dropdown-menu avatar separator switch slider \
    sonner skeleton tabs checkbox tooltip alert-dialog select progress
npm install motion lucide-react react-router-dom leaflet @types/leaflet
```

---

## 8. Methods and assumptions

Every default below is editable in the app's **Assumptions** panel, and each carries its source so the
numbers can be audited.

### Solar

- Monthly energy: `E_m = kWp × GHI_m × days_m × PR_m`.
- Performance ratio: `PR_m = 0.83 × [1 − 0.0035 × (T_air,m + 20 − 25)]` — PVWatts-style system losses
  plus heat loss. This gives PR ≈ 0.75 and about **3.7 units/day per kW in Bhubaneswar**
  (1,352 kWh/kWp/year; 3.9–4.1 in western Odisha).
- Sizing: `min(roof limit, household need)`, where the roof limit is `usable area ÷ 10 m² per kW`
  (also capped by how many panels physically fit) and the household need is
  `annual units ÷ yearly units per kW`.
- **Bill, not a flat rate.** The home is billed twice — before and after solar — with the telescopic
  slabs, ₹20/kW/month fixed charge and 4% duty. `saving = bill_before − bill_after + exported units ×
  feed-in tariff`. A solar unit therefore displaces the dearest unit you would have bought
  (₹6.10 above 400 units/month, ₹2.90 in the first slab), not an average one. Kutir Jyoti households
  (≤ 30 units/month) pay a flat ₹70, which the model handles.
- **Net metering (OERC).** Credits carry forward inside the financial year, generation is credited
  only up to **90% of the year's consumption**, and the balance on 31 March is settled at the GRIDCO
  APPC feed-in tariff (₹3.59/unit for FY 2026-27). Fixed charges and levies are always payable.
  Plant size is limited to the sanctioned load (max 500 kW) and to 75% of the DT capacity.
- **Subsidies** (both for homes, up to 3 kW):
  - PM Surya Ghar CFA: `₹30,000 × min(kW,2) + ₹18,000 × (min(kW,3) − 2)`, capped at ₹78,000.
  - Odisha SFA: `₹25,000 × min(kW,2) + ₹10,000 × (min(kW,3) − 2)`, capped at ₹60,000 → **₹1,38,000 at 3 kW**.
  - Neither can exceed the system cost, and each can be switched off.

### Rainwater

- Harvest: `litres = roof m² × rain mm × runoff C` (1 mm on 1 m² = 1 L). Solar panels do not reduce it.
- Storage tank: one heavy-rain day, `area × 100 mm × C`, rounded up to a standard tank size. Odisha's
  monsoon delivers 60–80% of the year's rain between July and October.
- Recharge well: 1 m Ø RCC rings (785 L per metre of depth), sized to the Odisha norm
  `60 L × roof m²` (6 m³ per 100 m²), plus the two 100 mm downpipes per 100 m² the rules require.
- Water demand: `family × 135 L/person/day` (CPHEEO urban norm).
- **CHHATA subsidy:** `min(50% of system cost, ₹55,000)` for roofs of 50–200 m² in buildings of at most
  three floors, with a recharge unit compulsory.

### Defaults

| Parameter | Value | Source |
|---|---|---|
| Roof area per kW | 10 m² | PM Surya Ghar national portal FAQ |
| Central subsidy | ₹30k/kW up to 2 kW + ₹18k for the 3rd kW, max ₹78k | PM Surya Ghar: Muft Bijli Yojana |
| Odisha subsidy (SFA) | ₹25k/kW up to 2 kW + ₹10k for the 3rd kW, max ₹60k | State Cabinet decision 03.01.2025 (FY 2024-25 → 2026-27) |
| Installed cost | ₹55,000/kW | 2026 Odisha market, OREDA-empanelled vendors (~₹48k–65k/kW for 1–5 kW) |
| Tariff | ₹2.90 / 4.70 / 5.70 / 6.10 per unit in telescopic slabs, ₹20/kW/month fixed, 4% duty extra | OERC retail supply tariff, FY 2026-27 (order 24.03.2026, unchanged for the 5th year) |
| Kutir Jyoti | flat ₹70/month up to 30 units | OERC domestic tariff |
| Export / settlement | ₹3.59 per unit, credited up to 90% of yearly consumption | GRIDCO APPC FY 2026-27; OERC net-metering orders |
| Panel | 540 Wp, 2.278 m × 1.134 m, 0.5 m edge setback | common 2025-26 mono-PERC / TOPCon module |
| Runoff coefficient | RCC 0.85, metal/GI 0.90, clay tile 0.75, cement sheet 0.80 | typical engineering values |
| Rainwater rule | 60 L per m² of roof (6 m³ per 100 m²); mandatory above a 100 m² plot, recharge above 225 m² | Odisha Development Authorities (Planning & Building Standards) Rules, 2020 |
| CHHATA subsidy | 50% of cost or ₹55,000, whichever is less; roof 50–200 m², ≤ 3 floors | Dept. of Water Resources, Govt. of Odisha (FY 2022-23 → 2026-27) |
| Rainwater system cost | ₹600 per m² of roof | Odisha market for pipes, filter bed and recharge pit |
| Water demand | 135 L/person/day | CPHEEO manual |
| Grid CO₂ | 0.71 kg/unit | CEA CO₂ Baseline Database v21 (FY 2024-25) |
| Climate | monthly sunlight, rain and temperature for 32 Odisha towns | NASA POWER climatology 2001–2020 |

---

## 9. Getting started

### Requirements

- Python 3.10 or newer and internet access for the satellite map.
- About 1 GB of free RAM (MobileSAM uses roughly 450 MB during a detection).
- Node.js 20+ **only** if you want to modify the UI.

### Quick start

```bash
git clone https://github.com/harishankarsahu874-jpg/SuryaJal.git
cd SuryaJal
```

- **Windows:** double-click `run.bat`
- **Linux / macOS:** `./run.sh`

Both scripts create a virtual environment, install `requirements.txt`, download the MobileSAM models
(~45 MB) and start the server. Then open:

- `http://localhost:8000` — website
- `http://localhost:8000/app` — dashboard
- `http://localhost:8000/classic` — original no-build tool

### Manual setup

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/download_models.py                     # MobileSAM ONNX (~45 MB)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Tests

```bash
pytest -q
```

The suite has 92 tests: OERC tariff slabs, both subsidies, the net-metering cap, solar and rainwater
formulas, CHHATA eligibility, district/DISCOM lookup, geometry, panel layout, segmentation on a
synthetic image, the API, the PDF, accounts and saved roofs.

---

## 10. Configuration

Environment variables (all optional):

| Variable | Purpose |
|---|---|
| `PORT` | Port to bind (injected by Render / Hugging Face Spaces; defaults to 8000 locally, 7860 in Docker) |
| `SURYAJAL_DATA_DIR` | Writable directory for `suryajal.db` (accounts, saved roofs) and the fest counter — point it at a mounted persistent disk on cloud hosts |
| `SURYAJAL_CACHE_DIR` | Tile and climate cache directory (safe to delete) |
| `SURYAJAL_THREADS` | ONNX Runtime thread count (auto-detects the container's CPU quota by default) |
| `SURYAJAL_API` | Backend URL used by the Vite dev proxy (defaults to `http://127.0.0.1:8000`) |

Keep `SURYAJAL_DATA_DIR` outside `app/data`, or it will hide the bundled `climate_fallback.json`.

Runtime files: `data/suryajal.db` (accounts, saved roofs), `data/stats.json` (fest counter) and
`.cache/` (tiles, climate). All can be deleted; only accounts are lost.

---

## 11. Deployment

### Docker

The `Dockerfile` installs the Python wheels and downloads the MobileSAM models **into the image**, so
cold starts never re-download them:

```bash
docker build -t suryajal .
docker run -p 7860:7860 suryajal
```

### Hugging Face Spaces

1. Create a new Space and choose **Docker** as the SDK.
2. Upload this folder, leaving out `.venv`, `.cache` and `models/*.onnx` (the Dockerfile fetches them).
3. Put this at the very top of the Space's `README.md`:
   ```yaml
   ---
   title: SuryaJal
   emoji: ☀️
   sdk: docker
   app_port: 7860
   ---
   ```
4. Wait for the build. The public HTTPS link then makes QR codes work from any phone, anywhere.

### Render (Docker)

The same `Dockerfile` works on [Render](https://render.com) with no code changes and no API keys —
NASA POWER, Esri imagery and Nominatim are all key-less.

1. **New → Web Service**, connect the repository and fill in:

   | Field | Value |
   | --- | --- |
   | Language | **Docker** (Render finds the `Dockerfile` at the repo root) |
   | Branch | `main` |
   | Region | **Singapore** is closest to Odisha; Oregon works too, about 200 ms further away |
   | Root Directory | leave empty |
   | Instance type | **Starter** (512 MB) or better — see the memory note below |
   | Advanced → Health Check Path | `/api/health` |
   | Environment variables | none required (`PORT` is injected by Render) |

2. Click **Deploy web service**. The first build takes roughly 5 minutes.
3. Open `https://<your-service>.onrender.com/api/health` — expect `"engine": "mobilesam"` and, a few
   seconds later, `"ready": true`. Share links and QR codes use the public HTTPS URL automatically
   (`--proxy-headers` is set in the Dockerfile).

**Keep accounts across deploys (optional).** Container disk is wiped on every deploy or restart, so
add a persistent disk (Starter plan or higher):

| Setting | Value |
| --- | --- |
| Disk → Mount path | `/var/data` (not `/app/data`, which would hide the bundled `climate_fallback.json`) |
| `SURYAJAL_DATA_DIR` | `/var/data` |
| `SURYAJAL_CACHE_DIR` | `/var/data/cache` (optional — keeps the tile and climate cache warm) |

**Memory and CPU.** MobileSAM runs on the CPU. The app idles at ~100 MB and the ONNX encoder needs a
few hundred MB more on the first tap, so a 512 MB instance is workable but tight; if the service
restarts with an out-of-memory event, move to the 2 GB instance. The Free instance also works for
demos, but it sleeps after 15 minutes of inactivity and cannot have a persistent disk.

---

## 12. Screenshots and sample report

Screenshots are kept in `docs/` and are intentionally not embedded here, to keep this README readable:

| File | Shows |
|---|---|
| `docs/screen_v11_landing.jpg` | Landing page |
| `docs/screen_v11_loader.jpg` | Pre-flight loader |
| `docs/screen_v11_login.jpg` | Sign-in page |
| `docs/screen_v11_story.jpg` | StackSpread photo story |
| `docs/screen_v11_desktop.jpg` | Desktop dashboard |
| `docs/screen_v11_mobile.jpg` | Mobile dashboard |
| `docs/sample_report.pdf` | Generated Green Roof Report (also as `docs/sample_report.jpg`) |

---

## 13. Demo checklist and anticipated questions

### Before demoing

1. **Start 30 minutes early.** Open `http://localhost:8000/?intro` and let the pre-flight loader
   confirm the AI, climate data and imagery are green. Then open the dashboard and tap a demo roof once.
2. **Use a phone hotspot** and connect the laptop and visitors' phones to it, so the QR code works
   from `http://<laptop-ip>:8000`. `run.sh` prints that address; on Windows run `ipconfig`.
3. **Pre-visit likely areas** so their tiles are already cached.
4. **If the internet dies,** climate data falls back to the bundled NASA POWER table for all 30
   districts. The satellite map needs internet, so keep `docs/sample_report.pdf` ready as a backup.
5. **Want a public link?** Deploy to Hugging Face Spaces or Render (see above); the QR then works from
   any phone, anywhere.

### 60-second pitch

> An Odisha roof gets about 4.8–5.1 kWh of sunlight per m² per day and 1,300–1,850 mm of rain a year,
> but families don't know what that is worth. With SuryaJal you find your house and tap your roof.
> Segment Anything outlines it in about a second, and you instantly see how many panels fit, the cost
> after the PM Surya Ghar subsidy plus Odisha's SFA (up to ₹1.38 lakh at 3 kW), your OERC bill before
> and after solar, the payback, and how much rainwater you must store and recharge under the Odisha
> Development Authorities rules — with the CHHATA subsidy you can claim for it. It even tells you which
> DISCOM bills you. Scan the QR and take your Green Roof Report home.

### Technical questions

- **How accurate is the area?** Zoom-19 imagery is about 0.28 m per pixel at Bhubaneswar's latitude, so
  roof area is typically within ±5–10%. Error comes from trees overhanging the roof and tall buildings
  leaning in the photo; corners can be dragged to correct it.
- **Why MobileSAM and not the original SAM?** MobileSAM has about 10 M parameters against SAM-H's
  600 M+, uses the same point-prompt interface, and runs on a laptop CPU in about a second with no GPU.
- **Where do the numbers come from?** NASA POWER 20-year climatology for all 30 districts, PM Surya
  Ghar subsidy slabs, Odisha's SFA (Cabinet decision 03.01.2025), the CEA grid CO₂ factor, the OERC
  retail supply tariff order for FY 2026-27, OERC's net-metering orders, GRIDCO's APPC, the Odisha
  Development Authorities Rules 2020 and the CHHATA scheme guidelines. All are listed in the app under
  *Assumptions* and are editable.
- **Why is export income often zero?** That is Odisha's rule, not a bug: OERC caps credited generation
  at 90% of yearly consumption, and anything above that is settled in March. The honest advice is to
  size the plant to your own bill — SuryaJal says so and shows how many units would lapse.
- **What is new compared with existing calculators?** AI roof outline, auto panel layout on the real
  roof shape, solar and water in one flow, a true telescopic OERC bill before and after solar,
  Odisha's State subsidy, district/DISCOM detection, the ODA rainwater norm with CHHATA, a Green
  Score, and a QR take-home report that keeps working on bad Wi-Fi.
- **Is shading modelled?** Not yet. The *usable %* slider accounts for tanks, stair rooms and trees;
  see the roadmap.

---

## 14. Known limitations

- NASA POWER uses a grid of roughly 0.25° (~25 km). For Bhubaneswar it gives about 1,573 mm of rain a
  year against the IMD normal of roughly 1,500 mm. Coastal and southern Odisha vary more (Paradeep
  ~1,850 mm, Bhawanipatna ~1,335 mm), so use the *annual rainfall* override for local accuracy; nearby
  towns can share a grid cell (Cuttack ≈ Bhubaneswar).
- Shading from neighbouring buildings and trees is not modelled.
- Satellite imagery may be a few years old; use *Draw* for new buildings.
- Costs, tariffs and subsidy windows change, so they are editable in the app.
- The figures are screening estimates for awareness, not a substitute for a site survey.

---

## 15. Roadmap

- **Shadow analysis:** sun path plus building heights (for example Google Open Buildings 2.5D) to find
  genuinely shade-free area.
- **Obstacle detection:** find black water tanks and stair rooms automatically (fine-tuned YOLO) and
  use that instead of the usable-% slider.
- **Odia / Hindi interface** with voice read-out of the report.
- **Hybrid, battery and EV-charging sizing**, plus a live IoT generation dashboard (links with the
  club's hardware projects).
- **Ward-level heat map** of rooftop solar and rainwater potential by batch-processing OpenStreetMap
  building footprints for BMC, CMC and the other Odisha ULBs in the CHHATA scheme.
- **DISCOM workflow:** pre-filled net-metering and OREDA/CHHATA application forms per DISCOM,
  including the sanctioned-load enhancement the plant needs.

---

## 16. Data sources, credits and licences

- [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) (Apache-2.0), with the ONNX export by
  [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM) (MIT); [Segment Anything](https://segment-anything.com)
  by Meta AI (Apache-2.0).
- [FastAPI](https://fastapi.tiangolo.com), [ONNX Runtime](https://onnxruntime.ai),
  [OpenCV](https://opencv.org), [Pillow](https://python-pillow.org),
  [reportlab](https://www.reportlab.com) (open-source libraries, respective licences).
- [React](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com),
  [shadcn/ui](https://ui.shadcn.com) + Radix UI, [motion](https://motion.dev),
  [lucide](https://lucide.dev) icons, [Leaflet](https://leafletjs.com) (MIT/ISC/BSD-2).
- *StackSpread* component built with [Hyperiux Vault](https://vault.hyperiux.com).
- Photos from [Unsplash](https://unsplash.com) (Unsplash License); source URLs are listed in
  `frontend/src/components/ui/stack-spread.tsx`.
- Fonts: Outfit, Plus Jakarta Sans, JetBrains Mono (SIL OFL) via Fontsource; DejaVu fonts (free licence).
- Imagery © Esri, Maxar, Earthstar Geographics & GIS User Community (attribution kept on the map and in
  the PDF; educational demo use).
- Climate data from the [NASA POWER](https://power.larc.nasa.gov) Project.
- Search by [Nominatim](https://nominatim.org) / © OpenStreetMap contributors (1 request/s policy respected).
- Scheme and tariff references: [PM Surya Ghar](https://pmsuryaghar.gov.in/),
  [OREDA](https://oredaodisha.com/), [OERC](https://www.orierc.org/),
  [CEA](https://cea.nic.in/), [Odisha CHHATA](https://echhata.odisha.gov.in/).

**Disclaimer.** SuryaJal gives screening estimates for awareness. Get a site survey from an
MNRE/OREDA-empanelled vendor, apply on pmsuryaghar.gov.in, and register for net metering with your
Odisha DISCOM before buying.
