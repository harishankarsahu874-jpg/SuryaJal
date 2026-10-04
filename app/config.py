"""
SuryaJal - central configuration. **Odisha edition.**

Everything here is tuned for the State of Odisha: the four Tata Power DISCOMs
(TPCODL / TPNODL / TPWODL / TPSODL), the OERC domestic slab tariff, the PM Surya Ghar
central subsidy **plus** Odisha's own State Financial Assistance, OERC net-metering
settlement, the Odisha Development Authorities rainwater rules and the State's
CHHATA rooftop-rainwater scheme.

Every default below is editable from the UI ("Assumptions" panel) and each one carries
the source it came from, so judges can see exactly where the numbers come from.
"""
import os
from pathlib import Path

APP_NAME = "SuryaJal"
APP_VERSION = "2.0.1"
APP_TAGLINE = "Odisha rooftop solar + rainwater planner"

# ------------------------------------------------------------------ the state we serve
STATE = "Odisha"
STATE_CODE = "IN-OD"
CAPITAL = "Bhubaneswar"
# default map view (Bhubaneswar) and the loose box that covers the whole State
MAP_CENTER = (20.2961, 85.8245)
MAP_ZOOM = 13
ODISHA_BOUNDS = ((17.6, 81.2), (22.7, 87.7))      # south-west, north-east

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
STATIC_DIR = BASE_DIR / "static"
SITE_DIR = STATIC_DIR / "site"            # built React site (frontend/ -> npm run build)
MODELS_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR / "data"             # bundled, read-only data (climate_fallback.json)
# Files the app *writes*: the accounts database and the fest counter (RUNTIME_DIR) and the
# tile + climate cache (CACHE_DIR, safe to delete). Locally they live next to the code. On a
# cloud host (Render, Railway, Fly, HF Spaces...) the container disk is wiped on every deploy
# or restart, so mount a persistent disk and point them at it, e.g.
#     SURYAJAL_DATA_DIR=/var/data      SURYAJAL_CACHE_DIR=/var/data/cache
# (keep the disk *outside* /app/data, or it would hide the bundled climate_fallback.json).
RUNTIME_DIR = Path(os.environ.get("SURYAJAL_DATA_DIR") or DATA_DIR)
CACHE_DIR = Path(os.environ.get("SURYAJAL_CACHE_DIR") or BASE_DIR / ".cache")
FONTS_DIR = APP_DIR / "fonts"

USER_AGENT = "SuryaJal-odisha/2.0 (student renewable-energy project; contact via GitHub)"

# ---------------------------------------------------------------- external data
ESRI_TILE_URL = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
                 "World_Imagery/MapServer/tile/{z}/{y}/{x}")
ESRI_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics & GIS User Community"
NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# bias place search to Odisha (Nominatim viewbox = lon_min,lat_min,lon_max,lat_max)
NOMINATIM_VIEWBOX = "81.2,17.6,87.7,22.7"

MAX_NATIVE_ZOOM = 19        # Esri has real imagery up to z19 over Odisha's cities
SEG_CROP_PX = 512           # crop fed to MobileSAM (at z19 = ~150 m x 150 m)
M_PER_PX_REF_LAT = 20.30    # Bhubaneswar latitude, used for the imagery-resolution spec

# ---------------------------------------------------------------- calendar
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# ================================================================ OERC electricity tariff
# Odisha Electricity Regulatory Commission retail supply tariff, LT "Domestic (other than
# Kutir Jyoti)". Common order dated 24.03.2026 for FY 2026-27 - unchanged for the fifth
# year running, and the same in all four Odisha DISCOMs. Telescopic slabs: each band of
# units is billed at its own rate.
OERC_DOMESTIC_SLABS = (
    (50.0, 2.90),                 # first 50 units
    (200.0, 4.70),                # 51 - 200 units
    (400.0, 5.70),                # 201 - 400 units
    (float("inf"), 6.10),         # above 400 units
)
OERC_FIXED_CHARGE_PER_KW = 20.0   # Rs per kW of sanctioned load per month
OERC_DUTY_PCT = 4.0               # electricity duty, % of (energy + fixed) charges
OERC_REBATE_PER_UNIT = 0.10       # prompt-payment rebate, Rs/unit
OERC_KUTIR_JYOTI_UNITS = 30       # BPL homes up to 30 units/month...
OERC_KUTIR_JYOTI_CHARGE = 70.0    # ...pay a flat Rs 70/month, no energy charge
TARIFF_FY = "FY 2026-27"

# OERC net metering (Order on solar net metering / draft Grid-Interactive Distributed
# Renewable Energy Regulations, 2026):
#   * units exported in a billing cycle carry forward inside the financial year,
#   * whatever is left at the March settlement is paid at the Commission's feed-in tariff,
#   * generation is credited only up to 90 % of the year's consumption,
#   * allowed up to the sanctioned load (max 500 kW) and 75 % of the DT capacity.
OERC_NET_METER_CAP = 0.90
OERC_MAX_NM_KW = 500.0
OERC_DT_CAPACITY_SHARE = 0.75
# Feed-in tariff used for the March settlement: GRIDCO's average power purchase cost
# (APPC) approved for FY 2026-27, ~358.85 paise/unit on merit-order dispatch.
OERC_EXPORT_FIT = 3.59

# ================================================================ subsidies
# Central: PM Surya Ghar - Muft Bijli Yojana (Rs 30,000/kW up to 2 kW, Rs 18,000 for the
# 3rd kW, capped at Rs 78,000).
CFA_PER_KW_FIRST_2 = 30000.0
CFA_THIRD_KW = 18000.0
CFA_CAP = 78000.0

# State: Odisha State Financial Assistance (SFA) approved by the State Cabinet on
# 03.01.2025 for PMSG:MBY - Rs 25,000/kW up to 2 kW plus Rs 10,000 for the 3rd kW
# (max Rs 60,000), for 3 lakh households, FY 2024-25 to FY 2026-27.
SFA_PER_KW_FIRST_2 = 25000.0
SFA_THIRD_KW = 10000.0
SFA_CAP = 60000.0
SFA_WINDOW = "FY 2024-25 to FY 2026-27"

# ================================================================ rainwater (Odisha rules)
# Odisha Development Authorities (Planning & Building Standards) Rules, 2020:
#   * rainwater harvesting is mandatory on every plot above 100 m2,
#   * ground-water recharge is mandatory on plots above 225 m2,
#   * "the dimension of recharging pits or trenches shall be at least 6 cubic metres for
#      every 100 square metre of roof area"  ->  60 litres per m2 of roof,
#   * two 100 mm downpipes per 100 m2 of roof, first-flush valve, inspection before the
#      completion certificate.
ODA_RWH_L_PER_M2 = 60.0           # 6 m3 of recharge per 100 m2 of roof
ODA_RWH_PLOT_MIN_M2 = 100.0       # RWH mandatory above this plot size
ODA_RECHARGE_PLOT_MIN_M2 = 225.0  # ground-water recharge mandatory above this plot size
ODA_DOWNPIPES_PER_100_M2 = 2
ODA_DOWNPIPE_MM = 100

# CHHATA - "Community based Harnessing and Harvesting rooftop rainwater for AugmenTing
# ground wAter", Department of Water Resources, Govt. of Odisha (FY 2022-23 to 2026-27,
# Rs 270 crore, 27 ULBs + 52 water-stressed blocks). Subsidy = 50 % of the cost of the
# rooftop rainwater harvesting system or Rs 55,000, whichever is less; a recharge unit is
# compulsory; roof area 50-200 m2 and at most three floors.
CHHATA = {
    "max_subsidy": 55000.0,
    "share_of_cost": 0.50,
    "roof_min_m2": 50.0,
    "roof_max_m2": 200.0,
    "max_floors": 3,
    "scheme_years": "FY 2022-23 to FY 2026-27",
    "portal": "https://echhata.odisha.gov.in/",
}

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
    "cost_per_kw": 55000,       # Rs, 2026 Odisha market for a 1-5 kW on-grid system
                                # (OREDA-empanelled vendors quote ~Rs 48,000-65,000/kW)
    "subsidy": True,            # PM Surya Ghar central financial assistance (homes only)
    "state_subsidy": True,      # Odisha SFA on top of the central subsidy
    "tariff": None,             # None = auto: OERC domestic slabs for your monthly units
    "sanctioned_load_kw": 3.0,  # for the Rs 20/kW/month fixed charge (unchanged by solar)
    "export_rate": None,        # None = auto (OERC settlement at the APPC feed-in tariff)
    "net_meter_cap": OERC_NET_METER_CAP,   # generation credited up to 90 % of consumption
    "co2_kg_per_kwh": 0.71,     # CEA CO2 Baseline Database v21, FY 2024-25 (~0.71 t/MWh)
    "degradation": 0.005,       # panel output loss per year
    "life_years": 25,
    "kg_co2_per_tree_year": 20.0,  # illustrative "trees planted" equivalent
    # ---- household
    "monthly_units": 250,       # kWh per month (read it on your electricity bill)
    "family_size": 4,
    "floors": 2,                # floors of the building (CHHATA allows at most 3)
    # ---- rainwater
    "roof_type": "rcc",
    "lpcd": 135,                # CPHEEO urban water norm, litres/person/day
    "design_rain_mm": 100,      # one heavy monsoon day the storage tank should capture
    "rwh_l_per_m2": ODA_RWH_L_PER_M2,   # ODA Rules 2020: 6 m3 of recharge per 100 m2 roof
    "chhata": True,             # show the Odisha CHHATA subsidy this roof qualifies for
    "rrhs_cost_per_m2": 600,    # Rs per m2 of roof: PVC pipes + filter bed + recharge pit
    "tanker_litres": 6000,
    "tanker_price": 800,        # Rs per 6,000 L private tanker in Odisha towns
}

# Runoff coefficient by roof type (typical engineering values). Odisha homes are mostly
# RCC or GI-sheet; clay-tile roofs are still common in the southern and western districts.
ROOF_TYPES = {
    "rcc":      {"label": "RCC / concrete flat roof", "c": 0.85},
    "metal":    {"label": "Metal / GI sheet",         "c": 0.90},
    "tile":     {"label": "Clay / terracotta tiles",  "c": 0.75},
    "asbestos": {"label": "Cement / AC sheet",        "c": 0.80},
    "other":    {"label": "Other / mixed",            "c": 0.75},
}

# Odisha's four distribution companies (all Tata Power), areas as per the OERC common
# tariff order of 24.03.2026.
DISCOMS = {
    "TPCODL": {"name": "TP Central Odisha Distribution Ltd.",
               "areas": "Khurda, Cuttack, Puri, Nayagarh, Dhenkanal, Jagatsinghpur, "
                        "Kendrapara, Angul and part of Jajpur",
               "site": "https://www.tpcentralodisha.com/"},
    "TPNODL": {"name": "TP Northern Odisha Distribution Ltd.",
               "areas": "Balasore, Bhadrak, Mayurbhanj, Keonjhar and major part of Jajpur",
               "site": "https://www.tpnorthernodisha.com/"},
    "TPWODL": {"name": "TP Western Odisha Distribution Ltd.",
               "areas": "Sambalpur, Sundargarh, Jharsuguda, Bargarh, Balangir, Deogarh, "
                        "Nuapada, Kalahandi and Subarnapur",
               "site": "https://www.tpwesternodisha.com/"},
    "TPSODL": {"name": "TP Southern Odisha Distribution Ltd.",
               "areas": "Ganjam, Gajapati, Kandhamal, Boudh, Rayagada, Koraput, "
                        "Nabarangpur and Malkangiri",
               "site": "https://www.tpsouthernodisha.com/"},
}

SOURCES = [
    ("Solar & rainfall climatology",
     "NASA POWER API, 2001-2020 monthly climatology - all 30 Odisha districts bundled offline",
     "https://power.larc.nasa.gov/"),
    ("Central subsidy", "PM Surya Ghar: Muft Bijli Yojana - Rs 30,000/kW up to 2 kW + Rs 18,000 "
     "for the 3rd kW, capped at Rs 78,000 (via OREDA / your DISCOM)",
     "https://pmsuryaghar.gov.in/"),
    ("Odisha state subsidy", f"State Financial Assistance of Rs 25,000/kW up to 2 kW + Rs 10,000 "
     f"for the 3rd kW (max Rs 60,000), Cabinet decision 03.01.2025, {SFA_WINDOW}",
     "https://oredaodisha.com/"),
    ("Roof area per kW", "PM Surya Ghar national portal FAQ: ~10 m2 shadow-free area per kW",
     "https://solarrooftop.pmsuryaghar.gov.in/pdf/faq_national_portal2024021301.pdf"),
    ("Electricity tariff", f"OERC retail supply tariff {TARIFF_FY} (order 24.03.2026, unchanged for "
     "the 5th year): domestic Rs 2.90 / 4.70 / 5.70 / 6.10 per unit in telescopic slabs, "
     "Rs 20/kW/month fixed charge, electricity duty extra",
     "https://www.orierc.org/"),
    ("Net metering & export", f"OERC solar net metering: units carry forward within the financial "
     f"year, the balance is settled at the feed-in tariff (GRIDCO APPC ~Rs {OERC_EXPORT_FIT}/unit "
     f"for {TARIFF_FY}), and generation is credited up to {int(OERC_NET_METER_CAP * 100)} % of the "
     "year's consumption; allowed up to the sanctioned load and 75 % of DT capacity",
     "https://www.orierc.org/"),
    ("Grid CO2 factor", "CEA CO2 Baseline Database v21 (FY 2024-25): ~0.71 t CO2/MWh",
     "https://cea.nic.in/"),
    ("Rainwater rule", "Odisha Development Authorities (Planning & Building Standards) Rules, 2020: "
     "rainwater harvesting mandatory on plots above 100 m2, ground-water recharge mandatory above "
     "225 m2, and recharge pits/trenches of at least 6 m3 for every 100 m2 of roof area "
     "(= 60 litres per m2 of roof)",
     "https://urban.odisha.gov.in/"),
    ("CHHATA rainwater subsidy", "Govt. of Odisha CHHATA scheme (Dept. of Water Resources, "
     f"{CHHATA['scheme_years']}): 50 % of the cost of the rooftop rainwater harvesting system or "
     f"Rs {int(CHHATA['max_subsidy']):,}, whichever is less; roof 50-200 m2, at most 3 floors, "
     "recharge unit compulsory", CHHATA["portal"]),
    ("Water demand", "CPHEEO manual: 135 litres per person per day (urban)", ""),
    ("Installed cost", "Odisha market 2026 for 1-5 kW on-grid systems from OREDA-empanelled "
     "vendors (~Rs 48,000-65,000 per kW); edit it in Assumptions to match your quotation",
     "https://oredaodisha.com/"),
]

# Offline fallback data used when NASA POWER is unreachable and no cache exists:
# NASA POWER climatology for all 30 district headquarters of Odisha + Rourkela,
# Paradeep and Berhampur.
FALLBACK_CLIMATE_FILE = DATA_DIR / "climate_fallback.json"
