# ☀️💧 SuryaJal — AI Rooftop Solar + Rainwater Planner

**Find your house on the satellite map → tap the roof → AI outlines it → get your solar kW, subsidy, payback,
rainwater tank and a one‑page *Green Roof Report* with a QR code — in under a minute.**

> **v1.1 (Sep 2026):** new React website and mobile‑first dashboard in a calm sage theme, a new SuryaJal logo, a
> "pre‑flight" loading screen that checks the AI, climate data and imagery live, the scroll‑driven *StackSpread*
> photo story on the landing page, what‑if sliders (bill, panel count), IRR and a 25‑year savings timeline, a
> tank‑fill simulator, and **optional accounts** (sign up · sign in · sign out) with **My roofs**. Guests can still do everything
> except save roofs. The original no‑build tool lives on at `/classic`.

Software project for the Renewable Energy Club tech fest (Nov 2026). It combines SIH25065 (Ministry of Jal Shakti:
on‑spot rooftop rainwater‑harvesting assessment) with rooftop‑solar planning under **PM Surya Ghar: Muft Bijli Yojana**,
and adds AI roof detection plus Karnataka‑specific rules (BESCOM tariff, KERC export rate, BWSSB rainwater law).

| Mobile dashboard: Roof Map · Solar · Rainwater · Report |
|---|
| ![dashboard](docs/screen_v11_mobile.jpg) |

| Landing page | Pre‑flight loader | Sign in |
|---|---|---|
| ![landing](docs/screen_v11_landing.jpg) | ![loader](docs/screen_v11_loader.jpg) | ![login](docs/screen_v11_login.jpg) |

| StackSpread story section | One‑page Green Roof Report |
|---|---|
| ![story](docs/screen_v11_story.jpg) | ![report](docs/sample_report.jpg) |

---

## ✨ Features

| | What it does |
|---|---|
| 🤖 **AI roof detection** | Tap a roof. **MobileSAM** (Segment Anything, mobile version, run as ONNX on the CPU) outlines it in about 1 s. **＋ Add part / － Remove** taps refine the outline in about 0.1 s because the image analysis is reused. |
| ✏️ **Manual fallback** | Draw the roof corners yourself. You can drag the corners of any outline, AI or manual, to fine‑tune it. |
| 🧩 **Auto panel layout** | Places real 540 Wp panels on *your* roof shape with a 0.5 m edge gap, shown on the map and in the PDF. It also checks that the panels physically fit. |
| ☀️ **Solar** | Uses NASA POWER monthly sunlight with a temperature‑corrected performance ratio. Gives recommended kW, number of panels, month‑wise units, cost, PM Surya Ghar subsidy, KERC export income, payback, 25‑year savings, CO₂ saved and a trees equivalent. |
| 💧 **Rainwater** | Uses area × rainfall × runoff coefficient. Gives month‑wise litres, storage‑tank size, a recharge well sized to the BWSSB 20 L/m² rule, days of family water and tankers avoided. |
| 🏅 **Green Score** | 0–100 score and grade (60 points for solar coverage, 40 for rainwater coverage). |
| 📄 **Green Roof Report** | One A4 page showing the roof photo with outline and panels, KPIs, two monthly charts, assumptions and a QR code. |
| 📱 **Take it home** | An on‑screen QR code downloads the PDF on the visitor's phone. Share links keep the whole state in the URL. |
| 📴 **Fest‑proof** | Climate data is cached, and 16 Indian cities are bundled offline. Satellite tiles are cached on disk. A demo‑roof button covers you when a visitor can't find their house. |
| 🌍 **Fest counter** | "Today: 23 roofs · 71 kW · 18 lakh L" is shown live and anonymously; only totals are stored. |
| 🎛 **What‑if planner** | Drag your monthly units or pick your own panel count (up to what fits on the roof) and every number, the panel layout and the PDF update live. "Only know your bill?" converts ₹ to units. |
| 📈 **Money view** | Capital cost, PM Surya Ghar subsidy, net cost, payback, **IRR** and an interactive **25‑year savings timeline** with the break‑even year. |
| 🪣 **Tank simulator** | Tap any month on the rain chart and the tank animation fills to show how that month's rain compares with your tank. |
| 🔐 **Accounts (optional)** | Sign up / sign in / sign out, "keep me signed in", sign out on all devices, delete account. Signed‑in users save roofs to **My roofs** and reopen or re‑download them. |
| 🚦 **Pre‑flight loader** | The animated logo plays while the app *really* checks the server, warms MobileSAM, and verifies climate data, Esri imagery and the subsidy/water rules, printing each spec as it comes online. It shows once per browser session; add `?intro` to replay it. |

---

## 🚀 Run it on your laptop

**Get the code** from GitHub:
```bash
git clone https://github.com/harishankarsahu874-jpg/SuryaJal.git
cd SuryaJal
```
(or on GitHub click **Code → Download ZIP** and unzip it).

**You need Python 3.10+** and internet access for the satellite map. Allow about 1 GB of free RAM; the AI uses about 450 MB.

**Windows:** double‑click `run.bat`
**Linux / macOS:** `./run.sh`

Both scripts create a virtual environment, install the requirements, download the MobileSAM models (~45 MB) and
start the server. Then open **http://localhost:8000** (website) or **http://localhost:8000/app** (dashboard).

The React site is **already built** into `static/site/`, so you do **not** need Node.js to run SuryaJal. You only need
Node 20+ if you want to change the UI (see *Frontend* below).

Manual steps if you prefer:
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/download_models.py                      # MobileSAM ONNX (~45 MB)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Without the model files the app still runs, using a basic OpenCV region‑growing fallback, but MobileSAM is much better.

Run the tests (42 of them: formulas, geometry, panel layout, segmentation on a synthetic image, API, PDF, accounts and My roofs):
```bash
pytest -q
```

---

## 🎪 Fest‑day checklist

1. **Start 30 min early.** Open `http://localhost:8000/?intro` — the pre‑flight loader confirms the AI, climate data
   and imagery are all green. Then open the dashboard and tap **Try the demo roof** once.
2. **Use a phone hotspot.** Connect the laptop and visitors' phones to it. Visitors can then scan the on‑screen QR and the PDF
   downloads on their phone from `http://<laptop-ip>:8000`. `run.sh` prints this address; on Windows, run `ipconfig`.
3. **Pre‑visit likely areas.** Open the college area and a few neighbourhoods visitors come from, so tiles are cached.
4. **If the internet dies,** climate data falls back to bundled NASA data for 16 cities. The satellite map needs internet, so keep
   `docs/sample_report.pdf` and the screenshots ready as backup.
5. **Want a public link?** Deploy to Hugging Face Spaces (below). The QR then works from any phone, anywhere.

### 60‑second pitch
> Every Bengaluru roof gets about **5.5 kWh of sunlight per m² per day** and about **850 mm of rain a year**, but families don't know what
> that's worth. With SuryaJal you find your house and tap your roof. **Segment Anything** outlines it in about a second,
> and you instantly see how many panels fit, the cost after the **PM Surya Ghar** subsidy, the payback, and how much
> rainwater you can store and recharge under **BWSSB rules**. Scan the QR and take your Green Roof Report home.

### Judge Q&A cheat‑sheet
- **How accurate is the area?** Zoom‑19 imagery is about 0.29 m per pixel in Bengaluru, so roof area is typically within ±5–10%.
  Error comes from trees overhanging the roof and tall buildings leaning in the photo. The corners can be dragged to correct it.
- **Why MobileSAM and not the original SAM?** MobileSAM has about 10 M parameters against SAM‑H's 600 M+, uses the same point‑prompt
  interface, and runs on a plain laptop CPU in about 1 s with no GPU.
- **Where do the numbers come from?** NASA POWER 20‑year climatology, PM Surya Ghar subsidy slabs, the CEA grid CO₂ factor,
  KERC 2026 export tariffs and the BWSSB rule. All are listed in the app under *Assumptions* and are editable.
- **What's new compared with existing calculators?** AI roof outline, auto panel layout on the real roof shape, solar *and*
  water in one flow, Karnataka‑specific rules, a Green Score, and a QR take‑home report. It keeps working even with bad Wi‑Fi.
- **Shading?** Not modelled yet. The *usable %* slider covers tanks, stair rooms and trees; see future upgrades.

---

## 🧠 How it works

```
Browser (React + TypeScript + Tailwind + shadcn/ui, Leaflet map; static build served by FastAPI)
   │  tap (lat, lon)                          polygon + inputs                  share state (URL)
   ▼                                          ▼                                  ▼
POST /api/segment                        POST /api/assess                    GET /r?p=…  (PDF)
   │ tiles.py: Esri z19 crop 512×512       │ climate.py: NASA POWER (cached)    │ report.py: reportlab A4
   │ segment.py: MobileSAM encoder         │ layout.py: panel packing           │ roof thumbnail + panels
   │   (embedding cached per crop)         │ solar.py: sizing + money + CO₂     │ charts + QR code
   │   decoder with point prompts          │ rain.py: harvest + tank + well     │
   │ mask → clean → polygon → lat/lon      │ Green Score                        │
```

**Roof detection:**
1. Fetch 3×3 satellite tiles at zoom 19 and crop 512 px centred on the tap (about 150 m × 150 m).
2. MobileSAM's image encoder (ONNX) builds a 64×64×256 embedding.
3. The mask decoder turns the tap into three candidate masks (roof part / roof / whole block). We keep the best one by predicted IoU, provided it contains the tap and is a sensible size.
4. Morphological clean‑up keeps only the region under the tap and fills holes.
5. The outline is simplified with Douglas–Peucker and rescaled so its area matches the mask's pixel count.
6. Pixels are converted to lat/lon with Web‑Mercator maths.

**Auto panel layout:**
1. Find the roof's main axis (minimum‑area rectangle) and rasterise the roof at 10 cm.
2. Shrink it by the 0.5 m edge gap.
3. Try landscape and portrait grids, both axes and 9 grid offsets. Each panel is tested in O(1) with a summed‑area table.
4. Place the recommended number of panels in neat, centred rows.

---

## 📐 The science (all defaults editable in the app)

**Solar**
- Monthly energy: `E_m = kWp × GHI_m × days_m × PR_m`
- Performance ratio: `PR_m = 0.83 × [1 − 0.0035 × (T_air,m + 20 − 25)]`, i.e. PVWatts‑style system losses plus heat loss.
  This gives PR ≈ 0.77 and about 4.2 units/day per kW in Bengaluru.
- Size: `min(roof limit, household need)`
  - Roof limit = `usable area ÷ 10 m² per kW`, also capped by how many panels fit geometrically.
  - Household need = `annual units ÷ yearly units per kW`.
- Savings (monthly net metering): `self‑used units × tariff + exported units × export rate`
- Subsidy: `₹30,000 × min(kW,2) + ₹18,000 × (min(kW,3) − 2)`, capped at ₹78,000.

**Rainwater**
- Harvest: `litres = roof m² × rain mm × runoff C` (1 mm on 1 m² = 1 L). Solar panels don't reduce this.
- Storage tank holds one heavy‑rain day: `area × 50 mm × C`, rounded up to a standard tank size.
- Recharge well: 1 m Ø RCC rings (785 L per metre depth), sized to the BWSSB minimum `20 L × roof m²`.
- Water demand: family × 135 L/person/day (CPHEEO norm).

| Default | Value | Source |
|---|---|---|
| Roof area per kW | 10 m² | PM Surya Ghar national portal FAQ |
| Subsidy | ₹30k/kW up to 2 kW + ₹18k for 3rd kW, max ₹78k | PM Surya Ghar |
| Installed cost | ₹65,000/kW | 2026 market: 3 kW on‑grid ≈ ₹1.65–2.25 lakh |
| Tariff | ₹6.82/unit | BESCOM LT‑1 from May 2026 (₹5.90 + 0.36 + 0.56) |
| Export rate | ₹1.96 / 2.14 / 2.58 (with subsidy), ₹3.89 (without) | KERC order, 25 Aug 2026 |
| Grid CO₂ | 0.71 kg/unit | CEA CO₂ Baseline Database v21 (FY 2024‑25) |
| Runoff C | RCC 0.85, metal 0.90, Mangalore tile 0.75, cement sheet 0.80 | typical engineering values |
| Rainwater law | 20 L per m² of roof (+10 L per m² paved) | BWSSB (Amendment) Act 2009, s.72A |
| Water demand | 135 L/person/day | CPHEEO manual |
| Climate | monthly sunlight, rain, temperature | NASA POWER climatology 2001–2020 |

**Known limitations (be honest with judges):**
- NASA POWER uses a grid of roughly 50 km. For Bengaluru it gives 843 mm of rain against the IMD normal of about 970 mm, so use the
  *annual rainfall* override for local accuracy.
- Shading from neighbouring buildings is not modelled.
- Imagery may be a few years old; use *Draw* for new buildings.
- Costs and tariffs change, so they are editable.

---

## 🔌 API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status and AI engine (`mobilesam` or `opencv`) |
| GET | `/api/config` | Defaults, roof types, sources |
| GET | `/api/geocode?q=` | Place search (Nominatim proxy, throttled to 1 req/s, cached) |
| GET | `/api/reverse?lat=&lon=` | Short address for the report |
| POST | `/api/segment` | `{points:[{lat,lon,label}], zoom}` → roof polygon, area, confidence |
| POST | `/api/assess` | `{polygon:[[lat,lon],…], monthly_units, family_size, …}` → solar, rain, score, panel layout |
| GET | `/r?p=<polyline>&u=&f=&rt=&uf=…` | One‑page PDF report, stateless; this is also what the QR code opens |
| GET | `/api/qr.svg?data=` | QR code as SVG |
| GET | `/api/stats` | Anonymous fest counter |
| GET | `/api/thumb?p=…` | Satellite photo of the roof with the panel layout (JPEG, used by the dashboard) |
| POST | `/api/auth/signup` | `{name, email, password}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, password, remember}` → `{token, user}` (8 wrong tries per 10 min → 429) |
| POST | `/api/auth/logout` | Revokes the current token (`?everywhere=true` → all devices) |
| GET / DELETE | `/api/auth/me` | Current user · delete account (needs `{password}`) |
| GET / POST | `/api/roofs` | List / save a roof (`{query, title}`; the server recomputes the numbers) |
| DELETE | `/api/roofs/{id}` | Remove a saved roof |

Auth uses `Authorization: Bearer <token>`. Pages: `/` website · `/app` dashboard · `/login` · `/signup` · `/account` ·
`/demo` (StackSpread on its own) · `/classic` (original tool). Old `/?p=…` share links redirect to `/app?p=…`.

Interactive docs are at **http://localhost:8000/docs**.

---

## 🗂 Project structure

```
suryajal/
├── app/
│   ├── main.py        FastAPI routes
│   ├── config.py      defaults + sources (single source of truth)
│   ├── segment.py     MobileSAM ONNX + OpenCV fallback + mask→polygon
│   ├── tiles.py       Esri tile fetch, cache, placeholder detection
│   ├── layout.py      auto solar-panel packing
│   ├── solar.py       sizing, economics, CO₂
│   ├── rain.py        harvest, tank, recharge well, Green Score
│   ├── climate.py     NASA POWER + cache + offline fallback
│   ├── geo.py         Web-Mercator, polygon area, encoded polyline
│   ├── report.py      one-page PDF (reportlab) + QR
│   ├── stats.py       anonymous fest counter
│   ├── auth.py        accounts: SQLite users, scrypt passwords, hashed bearer tokens, My roofs
│   └── fonts/         DejaVu Sans (₹ symbol in PDF)
├── frontend/          React + TypeScript + Tailwind v4 + shadcn/ui source (Vite)  → builds into static/site
├── static/
│   ├── site/          built website + dashboard (committed, served at / and /app)
│   └── index.html …   classic no-build tool (served at /classic)
├── data/climate_fallback.json   NASA data for 16 Indian cities
├── models/            MobileSAM ONNX (downloaded)
├── scripts/           download_models.py, prefetch_climate.py
├── tests/             42 pytest tests
├── docs/              screenshots + sample report
├── run.sh · run.bat · Dockerfile · requirements.txt
```

---

## 🎨 Frontend (React + TypeScript + Tailwind CSS + shadcn/ui)

```
frontend/
├── components.json              shadcn config  → aliases: @/components, @/components/ui, @/lib/utils
├── vite.config.ts               @ → src, Tailwind v4 plugin, dev proxy to :8000, build → ../static/site
├── public/brand/                logo-mark.svg, logo-glyph.svg, favicon + app icons, og.png
├── public/images/               Unsplash photos (self-hosted) + dashboard screenshot
└── src/
    ├── components/ui/           shadcn primitives + stack-spread.tsx  ← the integrated component
    ├── components/demo/         stack-spread-demo.tsx (the component's demo, route /demo)
    ├── components/brand/        logo.tsx: LogoMark, AnimatedLogoMark, Logo (wordmark)
    ├── components/preflight-loader.tsx
    ├── components/site/         header, footer, user menu (sign in / sign out)
    ├── features/dashboard/      state (assessment, URL sync), Leaflet map, Solar / Rain / Report views
    ├── pages/                   landing, dashboard, login (+ signup), account (My roofs), demo, 404
    └── lib/                     api.ts (typed client), auth.tsx (AuthProvider), geo.ts, format.ts, utils.ts (cn)
```

**Change the UI:**
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 - hot reload; /api, /r, /app… are proxied to uvicorn on :8000
npm run build    # type-checks, then writes the production site to ../static/site
```

**How this project was set up** (if you start a new one):
```bash
npm create vite@latest frontend -- --template react-ts        # TypeScript
cd frontend && npm install tailwindcss @tailwindcss/vite       # Tailwind v4 (+ plugin in vite.config.ts)
# tsconfig.json + tsconfig.app.json:  "paths": { "@/*": ["./src/*"] }
npx shadcn@latest init -d -b radix                              # writes components.json, src/lib/utils.ts, theme CSS
npx shadcn@latest add button card input label badge dropdown-menu avatar separator switch slider \
    sonner skeleton tabs checkbox tooltip alert-dialog select progress
npm install motion lucide-react react-router-dom leaflet @types/leaflet
```

**Why `src/components/ui`?** It is the folder shadcn's CLI writes into (the `ui` alias in `components.json`), and the
component's demo imports `@/components/ui/stack-spread`. Keeping every reusable primitive there means `npx shadcn add …`
never overwrites your feature code, imports stay short and stable (`@/components/ui/…`), and anyone who knows
shadcn can find things immediately. App‑specific pieces live in `components/site`, `components/brand` and `features/`.

**StackSpread notes:** client‑only (uses `motion/react` scroll + spring hooks, no context provider needed). Props:
`scrollLength`, `bgColor`, `textColor`, `cardRadius`, `stackScale`, `clusterRotation`, `textFadeStart`,
`showScrollHint`, plus SuryaJal additions `title` / `highlight` / `titleEnd` / `subtitle` / `action` / `cards`.
On touch screens (`pointer: coarse`) it switches to a 2‑column stack and drops the pointer parallax; it respects
*reduce motion*. The left column shows rain, the right column sun and the centre the roofs that catch both.

**Accounts & security:** passwords are hashed with scrypt (stdlib), sessions are random 256‑bit tokens stored only as
SHA‑256 hashes, failed logins are throttled, and redirects after sign‑in only allow in‑app paths. Tokens live in
`localStorage` ("keep me signed in") or `sessionStorage` (default — good for the shared fest laptop). Everything is in
`data/suryajal.db`; delete that file to wipe all accounts.

---

## ☁️ Free public deploy (Hugging Face Spaces)

1. Create a new Space and choose **Docker** as the SDK.
2. Upload this folder, leaving out `.venv`, `.cache` and `models/*.onnx`; the Dockerfile downloads the models.
3. Put this at the very top of the Space's `README.md`:
   ```yaml
   ---
   title: SuryaJal
   emoji: ☀️
   sdk: docker
   app_port: 7860
   ---
   ```
4. Wait for the build. You get a public HTTPS link, and the QR codes work from any phone.

---

## 🔭 Future upgrades
- **Shadow analysis:** sun path plus building heights (e.g., Google Open Buildings 2.5D) to find truly shade‑free area.
- **Obstacle detection:** automatically find black water tanks and stair rooms (fine‑tuned YOLO) and use that instead of the usable‑% slider.
- **Kannada / Hindi interface** with voice read‑out of the report.
- **Hybrid/battery and EV‑charging sizing;** add a live IoT generation dashboard (links with the club's hardware projects).
- **Ward‑level heat‑map** of rooftop solar and rainwater potential by batch‑processing OpenStreetMap building footprints.

## 🙏 Credits & licences
- [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) (Apache‑2.0), with the ONNX export by [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM) (MIT).
- [Segment Anything](https://segment-anything.com) by Meta AI (Apache‑2.0).
- [Leaflet](https://leafletjs.com) (BSD‑2).
- [React](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) + Radix UI,
  [motion](https://motion.dev), [lucide](https://lucide.dev) icons (all MIT/ISC).
- *StackSpread* component built with [Hyperiux Vault](https://vault.hyperiux.com).
- Photos from [Unsplash](https://unsplash.com) (Unsplash License); the source URLs are listed in `frontend/src/components/ui/stack-spread.tsx`.
- Fonts: Outfit, Plus Jakarta Sans, JetBrains Mono (SIL OFL) via Fontsource.
- Imagery © Esri, Maxar, Earthstar Geographics & GIS User Community (attribution kept on the map and PDF; educational demo use).
- Climate data from the [NASA POWER](https://power.larc.nasa.gov) Project.
- Search by [Nominatim](https://nominatim.org) / © OpenStreetMap contributors. The app respects the 1 request/s usage policy.
- DejaVu fonts (free licence).

*SuryaJal gives screening estimates for awareness. Get a site survey from an MNRE‑empanelled vendor before buying.*
