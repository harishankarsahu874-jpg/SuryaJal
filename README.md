# SuryaJal

SuryaJal is a rooftop solar and rainwater planning application for Odisha. It combines satellite-based roof mapping, AI-assisted roof detection, solar estimates and rainwater assessment in a single workflow.

Users can identify a roof, adjust household assumptions, compare energy and water outcomes, and download a Green Roof Report. Estimates use the Odisha-specific tariff, subsidy and rainwater settings defined in the backend.

> SuryaJal provides preliminary planning estimates, not an installation design, subsidy approval or compliance certificate. Verify current scheme rules and obtain a professional site survey before making an investment.

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Development and testing](#development-and-testing)
- [API overview](#api-overview)
- [Calculation assumptions](#calculation-assumptions)
- [Configuration and deployment](#configuration-and-deployment)
- [Limitations](#limitations)
- [Sources and credits](#sources-and-credits)

## Capabilities

| Area | Available functionality |
| --- | --- |
| Roof mapping | Satellite map, address and PIN-code search, offline place suggestions, AI-assisted outlines, manual drawing and editable roof corners. |
| Panel layout | Automatic panel placement on the roof polygon, with edge clearance and physical fit checks. |
| Solar assessment | Recommended capacity, monthly generation, installation cost, central and Odisha subsidy estimates, electricity bills before and after solar, net-metering estimates, payback, IRR and a 25-year savings view. |
| Rainwater assessment | Monthly harvest, storage tank and recharge sizing, water-demand coverage, tanker savings and CHHATA eligibility estimates. |
| Location context | District and DISCOM lookup, with bundled climate data covering all 30 Odisha districts. |
| What-if planning | Adjustable consumption, panel count and household assumptions, with updated calculations and layouts. |
| Reporting | Three-page A4 PDF covering the roof, solar and rainwater results, with a QR code and shareable assessment links. |
| Optional accounts | Sign up, sign in, save and reopen roofs, revoke sessions and delete an account. Guests can assess roofs without signing in. |

The dashboard uses separate **Roof Map**, **Solar**, **Rainwater** and **Report** views. Desktop navigation appears at the top; mobile and tablet navigation appears at the bottom. The map occupies its own view rather than sharing a fixed-width results panel.

Report downloads use a fetched PDF rather than relying solely on browser navigation, with an open-report fallback. The browser can supply a satellite crop to the backend for report generation when server-side imagery is unavailable. When opened locally, the application can obtain a LAN address for phone-accessible QR links; the phone must be on the same reachable network.

## Architecture

The project has a React frontend and a Python/FastAPI backend. FastAPI serves the API and the committed production frontend from `static/site/`.

1. The map supplies roof coordinates or a drawn polygon.
2. The backend uses MobileSAM through ONNX Runtime for AI segmentation, with an OpenCV fallback when models are unavailable.
3. The assessment endpoint combines roof geometry, panel packing, climate data, household inputs and configured Odisha rules.
4. The reporting endpoint generates the PDF from the assessment and available imagery.
5. Optional accounts and saved roofs are stored in SQLite.

### Repository layout

```text
SuryaJal/
├── app/                 FastAPI backend and calculation modules
├── frontend/            React and TypeScript source
├── static/site/         Built frontend served by FastAPI
├── static/              Original no-build tool and its assets
├── data/                Bundled climate data; default runtime storage
├── models/              Downloaded MobileSAM ONNX models
├── scripts/             Model download and climate-prefetch utilities
├── tests/               Backend, calculation, segmentation and account tests
├── docs/                Historical screenshots and sample report
├── Dockerfile           Container build and server startup
├── requirements.txt     Python dependencies
└── run.sh / run.bat      Local setup and launch scripts
```

### Backend modules

| Module | Responsibility |
| --- | --- |
| `main.py` | API routes, request validation and frontend serving. |
| `config.py` | Shared defaults, tariff and scheme parameters, environment settings and source references. |
| `segment.py`, `tiles.py` | Roof segmentation, satellite fetching, cropping and tile caching. |
| `geo.py`, `layout.py` | Coordinate conversion, polygon measurements and panel placement. |
| `solar.py`, `tariff.py` | Solar sizing, electricity bills, subsidies and financial estimates. |
| `rain.py` | Rainwater harvest, storage, recharge, scheme checks and Green Score. |
| `climate.py`, `odisha.py` | Climate retrieval and fallback, district and DISCOM lookup. |
| `pincode.py`, `places.py` | Bundled PIN-code lookup and place suggestions. |
| `report.py` | Three-page PDF, QR code and roof thumbnail generation. |
| `auth.py`, `stats.py` | Accounts, saved roofs and anonymous aggregate statistics. |

The frontend keeps dashboard views in `frontend/src/features/dashboard/`, route pages in `frontend/src/pages/`, shared components in `frontend/src/components/`, and API, authentication, mapping and report helpers in `frontend/src/lib/`.

## Getting started

### Requirements

- Python 3.10 or newer.
- Internet access for new satellite imagery and online address searches. Cached data is not a complete offline map.
- Sufficient memory for CPU-based AI inference; allow approximately 1 GB of free RAM and monitor actual usage.
- Node.js compatible with the installed Vite version, only when developing or rebuilding the frontend. Use a current Node.js LTS release that satisfies Vite's engine requirement.

### Quick start

```bash
git clone https://github.com/harishankarsahu874-jpg/SuryaJal.git
cd SuryaJal
```

On Linux or macOS, run `./run.sh`. On Windows, run `run.bat`.

These scripts create a virtual environment, install Python dependencies, download the models and start the server. The built frontend is already included, so Node.js is not required for this path.

| Address | Purpose |
| --- | --- |
| `http://localhost:8000` | Website |
| `http://localhost:8000/app` | Planning dashboard |
| `http://localhost:8000/docs` | Interactive API documentation |
| `http://localhost:8000/classic` | Original no-build tool |

### Manual setup

```bash
python -m venv .venv
source .venv/bin/activate
# Windows Command Prompt: .venv\Scripts\activate.bat
pip install -r requirements.txt
python scripts/download_models.py
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Model files are downloaded into `models/` and are not committed to Git. If they are unavailable, the backend uses a less capable OpenCV segmentation fallback. Check `/api/health` for the active engine and readiness.

## Development and testing

### Frontend development

Start the backend on port 8000, then use a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies API and report requests to the backend. Browser-facing requests use relative paths; `SURYAJAL_API` configures the server-side development proxy, not a browser API address.

```bash
npm run build    # Type-check and rebuild ../static/site/
npm run lint     # Run the frontend linter
```

After changing frontend source, rebuild `static/site/` before running or deploying the production application. The Dockerfile uses this existing build; it does not run a Node.js build.

### Backend tests

From the repository root, with the virtual environment active:

```bash
pytest -q
```

The current suite collects 92 test cases. Coverage includes tariffs, subsidies, solar and rainwater calculations, geometry, panel layout, segmentation, location lookup, API responses, PDF generation, accounts and saved roofs. Tests requiring unavailable model files may be skipped.

### Keeping changes consistent

- Update backend calculation defaults and sources in `app/config.py`, then check API responses and frontend types in `frontend/src/lib/api.ts`.
- Verify changes in the assessment, dashboard, saved-roof and PDF flows rather than only updating displayed labels.
- Keep the backend application version, frontend package metadata and lockfile consistent when releasing.
- Update documentation to describe implemented behaviour, and keep proposed features separate from current capabilities.

## API overview

Use `/docs` for complete request schemas, optional parameters and response formats.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health`, `/api/config` | Service status, AI readiness, defaults and source references. |
| GET | `/api/odisha/table`, `/api/odisha/locate`, `/api/odisha/tariff` | Bundled climate table, district/DISCOM lookup and itemised bills. |
| GET | `/api/suggest`, `/api/geocode`, `/api/reverse` | Offline suggestions, online place search and reverse geocoding. |
| POST | `/api/segment` | Roof outline from labelled map points. |
| POST | `/api/assess` | Solar, rainwater, score and panel layout from a polygon and household inputs. |
| GET / POST | `/r`, `/api/report` | PDF report; POST accepts a query and optional browser-captured imagery. |
| GET | `/api/qr.svg`, `/api/thumb` | QR SVG and roof thumbnail. |
| GET | `/api/net`, `/api/stats` | LAN-link information and anonymous aggregate statistics. |
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | Account creation and session management. |
| GET / DELETE | `/api/auth/me` | Current account or account deletion. |
| GET / POST | `/api/roofs` | List or save assessments; saved results are recomputed by the backend. |
| DELETE | `/api/roofs/{id}` | Delete a saved roof. |

Authenticated requests use `Authorization: Bearer <token>`. Account deletion requires password confirmation. Passwords use scrypt hashing; session tokens are stored as hashes on the server. The frontend uses session storage by default and local storage for persistent sign-in. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Calculation assumptions

These are **implemented defaults**, not independently verified current entitlements. Source references and configurable values are maintained in `app/config.py` and returned by `/api/config`.

| Calculation | Model or configured default |
| --- | --- |
| Solar generation | Capacity × monthly daily irradiance × days × temperature-adjusted performance ratio. |
| Recommended capacity | Household energy need constrained by usable roof area and physical panel fit. |
| Panels and clearance | 540 Wp modules; 0.5 m edge setback. |
| Installation cost | INR 55,000 per kW by default; adjust to a vendor quotation. |
| Electricity bill | OERC domestic slabs, fixed charge and electricity duty; bills are calculated before and after solar. |
| Net metering | Configured annual credit cap, financial-year carry-forward and March settlement assumptions. |
| Solar subsidies | PM Surya Ghar central assistance and Odisha State Financial Assistance; combined configured maximum INR 138,000 at 3 kW, subject to eligibility and cost limits. |
| Rainwater harvest | Roof area in m² × rainfall in mm × roof-material runoff coefficient = litres. |
| Storage | A design rain event, with capacity rounded to a standard tank size. |
| Recharge | Configured Odisha norm of 60 litres per m² of roof; plot-area triggers require separate verification. |
| CHHATA | Preliminary checks using roof area, floors and configured scheme coverage; 50% of estimated cost up to INR 55,000. |
| Water demand | 135 litres per person per day by default. |

Climate estimates use NASA POWER monthly climatology, with cache and bundled fallback data. Tariffs, costs, eligibility and scheme windows must be verified with the relevant authority before an application or installation.

## Configuration and deployment

| Variable | Scope and purpose |
| --- | --- |
| `PORT` | Read by `run.sh` and Docker startup; defaults to 8000 and 7860 respectively. `run.bat` uses port 8000; manual uvicorn commands use `--port`. |
| `SURYAJAL_DATA_DIR` | Writable storage for accounts, saved roofs and aggregate statistics. Defaults to `data/`. |
| `SURYAJAL_CACHE_DIR` | Climate and imagery cache. Defaults to `.cache/`. |
| `SURYAJAL_THREADS` | Override ONNX Runtime's automatically selected thread count. |
| `SURYAJAL_API` | Vite's backend proxy target. Defaults to `http://127.0.0.1:8000`. |

### Docker

```bash
docker build -t suryajal .
docker run --rm -p 7860:7860 suryajal
```

Open `http://localhost:7860`. The image installs Python dependencies and downloads models during the build. Standard data services do not require API keys, but external-service availability and usage policies still apply.

For Render or another Docker host, deploy the root `Dockerfile`, configure the assigned `PORT`, and use `/api/health` as the health-check path. For Hugging Face Spaces, select the Docker SDK and configure `app_port: 7860` in the Space's README metadata.

Use HTTPS for public deployments. Restrict trusted forwarding proxies appropriately if adapting the supplied Docker command for a different network.

### Persistent storage

Mount a writable disk at `/var/data` and set:

```text
SURYAJAL_DATA_DIR=/var/data
SURYAJAL_CACHE_DIR=/var/data/cache
```

Do not mount over `/app/data`: that would hide the bundled climate fallback file. Without persistent storage, accounts, saved roofs and statistics can be lost on container replacement. Deleting cache files is safe; deleting `suryajal.db` removes accounts and saved roofs.

## Limitations

- Roof outlines depend on satellite resolution, imagery age and nearby obstructions. Review and correct the polygon before assessing.
- Automated shading and structural safety analysis are not implemented. The usable-roof fraction is an approximation, not a survey.
- Climate data represents regional long-term conditions, not roof-level measurements or a forecast.
- Cached imagery and bundled climate data improve resilience but do not make the entire application offline.
- QR links using a LAN address require network reachability and a suitable firewall configuration. Use a public deployment for remote sharing.
- Subsidy eligibility, installation costs, tariffs and local requirements may change. Final approvals remain with the relevant authorities.

Historical screenshots and a sample report remain in `docs/` as reference material. They are not embedded here and may not match the current interface or PDF layout.

## Sources and credits

- Climate: [NASA POWER](https://power.larc.nasa.gov/).
- Solar schemes and regulation: [PM Surya Ghar](https://pmsuryaghar.gov.in/), [OREDA](https://oredaodisha.com/), [OERC](https://www.orierc.org/) and [CEA](https://cea.nic.in/).
- Rainwater references: [Odisha Housing and Urban Development](https://urban.odisha.gov.in/) and [CHHATA](https://echhata.odisha.gov.in/).
- Roof segmentation: [MobileSAM](https://github.com/ChaoningZhang/MobileSAM), the [Acly ONNX export](https://huggingface.co/Acly/MobileSAM) and Meta's [Segment Anything](https://segment-anything.com/).
- Backend: FastAPI, ONNX Runtime, OpenCV, Pillow and ReportLab.
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix UI, Motion, Lucide and Leaflet. The StackSpread component uses [Hyperiux Vault](https://vault.hyperiux.com/).
- Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community; retain attribution on maps and reports.
- Search: [Nominatim](https://nominatim.org/) and OpenStreetMap contributors. The backend caches and throttles Nominatim requests.
- Photography and fonts: Unsplash; Outfit, Plus Jakarta Sans, JetBrains Mono and DejaVu Sans. Retain the respective asset and dependency licences.
