"""
SuryaJal - central configuration.

Every default below is editable from the UI ("Assumptions" panel) and each one
carries the source it came from, so judges can see where numbers come from.
"""
from pathlib import Path

APP_NAME = "SuryaJal"
APP_VERSION = "1.1.0"

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
STATIC_DIR = BASE_DIR / "static"
SITE_DIR = STATIC_DIR / "site"            # built React site (frontend/ -> npm run build)
MODELS_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = BASE_DIR / ".cache"          # tiles + climate cache (safe to delete)
FONTS_DIR = APP_DIR / "fonts"

USER_AGENT = "SuryaJal-student-project/1.0 (college renewable-energy club demo)"

# ---------------------------------------------------------------- external data
ESRI_TILE_URL = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
                 "World_Imagery/MapServer/tile/{z}/{y}/{x}")
ESRI_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics & GIS User Community"
NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

MAX_NATIVE_ZOOM = 19        # Esri has real imagery up to z19 over Indian cities
SEG_CROP_PX = 512           # crop fed to MobileSAM (at z19 = ~150 m x 150 m)

# ---------------------------------------------------------------- calendar
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# ---------------------------------------------------------------- defaults
DEFAULTS = {
    # ---- roof / solar
    "usable_fraction": 0.70,    # share of roof free from water tanks, stair room, shade
    "m2_per_kw": 10.0,          # PM Surya Ghar national portal FAQ: 1 kW needs ~10 m2 shadow-free
    "panel_w": 540,             # common 2025-26 mono-PERC / TOPCon module
    "panel_len_m": 2.278,       # 540 Wp module size (approx.)
    "panel_wid_m": 1.134,
    "edge_setback_m": 0.5,      # walkway / parapet clearance for the auto panel layout
    "system_eff": 0.83,         # PVWatts-style losses (~14 %) x inverter (~96.5 %)
    "temp_coeff": -0.0035,      # power loss per deg C above 25 C (typical mono-PERC)
    "cell_temp_rise": 20.0,     # cell heats ~20 C above the monthly mean air temperature
    "cost_per_kw": 65000,       # Rs, 2026 market: 3 kW on-grid = Rs 1.65-2.25 lakh
    "subsidy": True,            # PM Surya Ghar: Muft Bijli Yojana (residential only)
    "tariff": 6.82,             # Rs/unit BESCOM LT-1 from May 2026 (5.90 + 0.36 + 0.56)
    "export_rate": None,        # None = auto (KERC Aug-2026 rates below)
    "co2_kg_per_kwh": 0.71,     # CEA CO2 Baseline Database v21, FY 2024-25 (~0.71 t/MWh)
    "degradation": 0.005,       # panel output loss per year
    "life_years": 25,
    "kg_co2_per_tree_year": 20.0,  # illustrative "trees planted" equivalent
    # ---- household
    "monthly_units": 250,       # kWh per month (read it on your electricity bill)
    "family_size": 4,
    # ---- rainwater
    "roof_type": "rcc",
    "lpcd": 135,                # CPHEEO urban water norm, litres/person/day
    "design_rain_mm": 50,       # one heavy-rain day that the storage tank should capture
    "bwssb_l_per_m2": 20,       # BWSSB (Amendment) Act 2009 s.72A: 20 L per m2 of roof
    "tanker_litres": 6000,
    "tanker_price": 800,        # Rs per 6,000 L tanker (edit for your area)
}

# Runoff coefficient by roof type (typical engineering values)
ROOF_TYPES = {
    "rcc":      {"label": "RCC / concrete flat roof", "c": 0.85},
    "metal":    {"label": "Metal / GI sheet",         "c": 0.90},
    "tile":     {"label": "Mangalore clay tiles",     "c": 0.75},
    "asbestos": {"label": "Cement / asbestos sheet",  "c": 0.80},
    "other":    {"label": "Other / mixed",            "c": 0.75},
}

# KERC distributed-solar export tariffs, order of 25-Aug-2026 (valid to Jun-2029)
KERC_EXPORT_NO_SUBSIDY = 3.89
KERC_EXPORT_WITH_SUBSIDY = [(2.0, 1.96), (3.0, 2.14), (float("inf"), 2.58)]

SOURCES = [
    ("Solar & rainfall climatology", "NASA POWER API (2001-2020 monthly climatology)",
     "https://power.larc.nasa.gov/"),
    ("Subsidy", "PM Surya Ghar: Rs 30,000/kW up to 2 kW + Rs 18,000 for the 3rd kW, max Rs 78,000",
     "https://pmsuryaghar.gov.in/"),
    ("Roof area per kW", "PM Surya Ghar national portal FAQ: ~10 m2 shadow-free area per kW",
     "https://solarrooftop.pmsuryaghar.gov.in/pdf/faq_national_portal2024021301.pdf"),
    ("Grid CO2 factor", "CEA CO2 Baseline Database v21 (FY 2024-25): ~0.71 t CO2/MWh",
     "https://cea.nic.in/"),
    ("Export tariff", "KERC order 25-Aug-2026: Rs 3.89 (no subsidy); Rs 1.96/2.14/2.58 with subsidy",
     "https://kerc.karnataka.gov.in/"),
    ("Electricity tariff", "BESCOM LT-1 domestic ~Rs 6.82/unit (May 2026, incl. surcharges)",
     "https://bescom.karnataka.gov.in/"),
    ("Rainwater rule", "BWSSB Act 2009 s.72A: 20 L per m2 of roof + 10 L per m2 paved area",
     "https://bwssb.karnataka.gov.in/"),
    ("Water demand", "CPHEEO manual: 135 litres per person per day (urban)", ""),
]

# Offline fallback city used when NASA POWER is unreachable and no cache exists.
FALLBACK_CLIMATE_FILE = DATA_DIR / "climate_fallback.json"
