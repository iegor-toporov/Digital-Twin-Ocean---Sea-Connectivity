# Digital Twin Ocean — A Graphical Interface to the PMAR engine

Note: consider that the README could be NOT updated to the latest commit.

A lightweight web application for Lagrangian particle tracking in the ocean. It combines an OGC API Processing backend with an interactive map frontend to simulate how substances and organisms disperse under real ocean currents.

---

## Architecture

```
demo_5/
├── processes/
│   └── OpenDriftProcess.py   # OGC API process: runs OpenDrift with CMEMS data
|   └── PMARProcess.py        #                : runs PMAR with CMEMS data
|   └── WindfarmsProcess.py   #                : runs PMAR with CMEMS + EmodNet data for windfarms
├── frontend/
│   └── src/                  # React + Vite SPA
├── cache/                    # Downloaded CMEMS NetCDF files (auto-managed)
├── out/                      # Temporary simulation outputs (auto-cleaned)
├── logs/                     # pygeoapi.log, opendrift.log
├── pygeoapi-config.yml
└── start.sh
```

**Backend:** [pygeoapi](https://pygeoapi.io) (port 5001) exposes the `opendrift` process via the OGC API - Processes standard.

**Frontend:** React 18 + Vite SPA with react-leaflet. Served statically; communicates with the backend via `POST /processes/opendrift/execution`.

---

## Requirements

- Python 3.12 with a virtual environment (`venv/`)
- pygeoapi (installed from source in `venv/pygeoapi/`)
- OpenDrift and its dependencies
- `copernicusmarine` Python client (requires a free Copernicus Marine account)
- Node.js ≥ 18 (for frontend development only)

---

## Getting started

### Backend

```bash
source venv/bin/activate
./start.sh
```

`start.sh` regenerates the OpenAPI spec from `pygeoapi-config.yml` and starts the server on port 5001.

### Frontend (development)

```bash
cd frontend
npm install
npm run dev
```

Vite proxies API requests to `http://localhost:5001` automatically.

### Frontend (production build)

```bash
cd frontend
npm run build
```

The built files go to `frontend/dist/` and are served as static assets by pygeoapi.

---

## Drift models

| Key | Description | Wind forcing |
|---|---|---|
| `OceanDrift` | Passive tracer — surface currents only | No |
| `PlastDrift` | Plastic debris — Stokes drift + wind drag | Yes |
| `LarvalFish` | Fish larvae/eggs — vertical buoyancy + turbulent mixing | No |
| `OpenOil` | Hydrocarbons — evaporation, emulsification, dispersion | Yes |

---

## Simulation inputs

| Parameter | Description | Default |
|---|---|---|
| `seeding_type` | `circle` or `rectangle` | `circle` |
| `lon`, `lat`, `radius` | Centre and radius (m) for circle seeding | — |
| `lon_min/max`, `lat_min/max` | Bounding box for rectangle seeding | — |
| `model` | Drift model key (see table above) | `OceanDrift` |
| `start_time` | ISO 8601 datetime | 3 days ago |
| `number` | Number of particles (max 10 000) | 100 |
| `duration_hours` | Simulation duration in hours (max 720) | 24 |

---

## CMEMS data

Ocean currents are downloaded automatically from the Copernicus Marine Service:

- **Primary dataset:** `cmems_mod_med_phy-cur_anfc_0.042deg_PT1H-m` (Mediterranean, hourly)
- **Fallback:** `cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m` (global, daily)

Wind data (for `PlastDrift` and `OpenOil`):

- **Primary:** `cmems_obs-wind_med_phy_nrt_l4_0.125deg_PT1H` (Mediterranean)
- **Fallback:** `cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H` (global)

Files are cached in `cache/` keyed on seeding coordinates, start date, and duration. The spatial domain is centred on the seeding point with a margin of `5° + n_days × 0.02°` in each direction.

---

## Frontend features

- Interactive seeding: draw a **circle** or **rectangle** on the map to define the release area
- Animated particle trajectories with play/pause, time slider, and speed control
- Stranded particles highlighted in red
- Toggle to show/hide the seeding area overlay
- **IT / EN** language switch

---

## Logging

- `logs/pygeoapi.log` — server-level logs (DEBUG)
- `logs/opendrift.log` — simulation logs (DEBUG), one entry per run with model, seeding parameters, and result summary
