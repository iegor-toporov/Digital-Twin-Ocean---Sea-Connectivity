# Digital Twin Ocean — A Graphical Interface to the PMAR engine

A lightweight web application for Lagrangian particle tracking in the ocean. It combines an OGC API Processing backend with an interactive map frontend to simulate how substances and organisms disperse under real ocean currents, and to compute particle density maps with the PMAR engine.

---

## Architecture

```
demo_5/
├── processes/
│   ├── OpenDriftProcess.py              # OGC API process: runs OpenDrift with CMEMS data
│   ├── PMARProcess.py                   # OGC API process: runs PMAR with CMEMS data
│   ├── WindfarmsProcess.py              # OGC API process: EMODnet wind farm preview (bbox query)
│   └── OffshoreInstallationsProcess.py  # OGC API process: EMODnet offshore installations preview
├── frontend/
│   └── src/                             # React + Vite SPA
├── cache/
│   ├── *.nc                             # Downloaded CMEMS NetCDF files (auto-managed)
│   └── emodnet/                         # EMODnet WFS responses (pickle, 7-day TTL)
├── out/                                 # Temporary simulation outputs (auto-cleaned)
├── logs/                                # pygeoapi.log, opendrift.log, windfarms.log, offshore_installations.log
├── pygeoapi-config.yml
└── start.sh
```

**Backend:** [pygeoapi](https://pygeoapi.io) (port 5001) exposes all processes via the OGC API - Processes standard.

**Frontend:** React 18 + Vite SPA with react-leaflet. Served statically; communicates with the backend via `POST /processes/<process>/execution`.

---

## Requirements

- Python 3.12 with a virtual environment (`venv/`)
- pygeoapi (installed from source in `venv/pygeoapi/`)
- OpenDrift and its dependencies
- PMAR library (`pmar/`)
- `copernicusmarine` Python client (requires a free Copernicus Marine account)
- `rasterio` (for GeoTIFF export)
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

## OpenDrift process

**Endpoint:** `POST /processes/opendrift/execution`

### Drift models

| Key | Description | Wind forcing |
|---|---|---|
| `OceanDrift` | Passive tracer — surface currents only | No |
| `PlastDrift` | Plastic debris — Stokes drift + wind drag | Yes |
| `LarvalFish` | Fish larvae/eggs — vertical buoyancy + turbulent mixing | No |
| `OpenOil` | Hydrocarbons — evaporation, emulsification, dispersion | Yes |

### Inputs

| Parameter | Description | Default |
|---|---|---|
| `seeding_type` | `circle` or `rectangle` | `circle` |
| `lon`, `lat`, `radius` | Centre and radius (m) for circle seeding | — |
| `lon_min/max`, `lat_min/max` | Bounding box for rectangle seeding | — |
| `model` | Drift model key (see table above) | `OceanDrift` |
| `start_time` | ISO 8601 datetime | 3 days ago |
| `number` | Number of particles (max 10 000) | 100 |
| `duration_hours` | Simulation duration in hours (max 720) | 24 |

### Output

JSON with `times` (ISO timestamps array), `steps` (per-timestep particle positions `[lon, lat]`), and `model` name.

---

## PMAR process

**Endpoint:** `POST /processes/pmar/execution`

Runs an OpenDrift simulation over the seeded area, then computes a particle density map using the PMAR engine.

### Inputs

| Parameter | Description | Default |
|---|---|---|
| `geojson` | GeoJSON string of the seeding area (drawn on map) | — |
| `shapefile_b64` | Base64-encoded ZIP of a shapefile (alternative to GeoJSON) | — |
| `pressure` | Particle type: `generic`, `plastic`, or `oil` | `generic` |
| `start_time` | ISO 8601 datetime | 10 days ago |
| `duration_days` | Simulation duration in days | 3 |
| `pnum` | Number of particles (max 10 000) | 200 |
| `res` | Grid resolution in degrees | 0.1 |
| `use_source` | Anthropogenic weighting layer: `none`, `windfarms`, or `offshore_installations` | `none` |

### Output

```json
{
  "type": "raster",
  "image_b64": "...",        // transparent PNG for Leaflet overlay
  "geotiff_b64": "...",      // georeferenced GeoTIFF (EPSG:4326, LZW) for download
  "bounds": [[lat_min, lon_min], [lat_max, lon_max]],
  "pressure": "generic|plastic|oil",
  "label_it": "...",
  "label_en": "...",
  "use_source": "none|windfarms|offshore_installations",
  "use_weighted": false,
  "start_time": "YYYYMMDD",
  "end_time": "YYYYMMDD",
  "pnum": 200,
  "windfarms_geojson": {...},       // only if use_source=windfarms
  "offshore_geojson": {...}         // only if use_source=offshore_installations
}
```

### GeoTIFF structure

Single float32 band, `ny × nx` cells. Cell value = raw particle passage counts (or weighted density if `use_weighted` is true). `nodata = 0.0`, CRS EPSG:4326, LZW compression.

### Heatmap colormap

Computed in `_raster_to_png` (PMARProcess.py):
- Transparent: cells with value ≤ 0 or NaN
- Colormap `YlOrRd` with `LogNorm`
- vmin = 2nd percentile of positive values, vmax = 98th percentile (auto-adaptive per run)

---

## Anthropogenic layers

Both layers query [EMODnet Human Activities WFS](https://ows.emodnet-humanactivities.eu/wfs) and cache results as pickle files (7-day TTL) in `cache/emodnet/`.

| `use_source` | Data source | Coverage note |
|---|---|---|
| `windfarms` | `emodnet:windfarmspoly` (polygons) | North Sea, Atlantic, Baltic |
| `offshore_installations` | `emodnet:platforms` (points) | European waters; Mediterranean data concentrated in the Adriatic |

When a layer is active, its features are rasterized onto the simulation grid and used as PMAR weights. Features are also returned in the response as GeoJSON for display on the map.

### Preview processes

Two lightweight processes allow the frontend to preview layer coverage before running a full PMAR simulation:

- `POST /processes/windfarms/execution` — returns a GeoJSON FeatureCollection of wind farm polygons for a given bbox
- `POST /processes/offshore_installations/execution` — returns a GeoJSON FeatureCollection of offshore platforms for a given bbox

Both accept `lon_min`, `lat_min`, `lon_max`, `lat_max` as inputs.

---

## CMEMS data

Ocean currents are downloaded automatically from the Copernicus Marine Service:

- **Primary dataset:** `cmems_mod_med_phy-cur_anfc_0.042deg_PT1H-m` (Mediterranean, hourly)
- **Fallback:** `cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m` (global, daily)

Wind data (for `PlastDrift`, `OpenOil`, and PMAR plastic/oil pressure):

- **Primary:** `cmems_obs-wind_med_phy_nrt_l4_0.125deg_PT1H` (Mediterranean)
- **Fallback:** `cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H` (global)

Files are cached in `cache/` keyed on seeding coordinates, start date, and duration. The spatial domain is centred on the seeding point with a margin proportional to the simulation duration.

---

## Frontend features

### OpenDrift tab

- Interactive seeding: draw a **circle** or **rectangle** on the map to define the release area
- Animated particle trajectories with play/pause, time slider, and speed control
- Stranded particles highlighted in red
- Toggle to show/hide the seeding area overlay

### PMAR tab

- Draw a seeding polygon on the map (or upload a shapefile)
- Select pressure type, simulation duration, particle count, and grid resolution
- Select an anthropogenic weighting layer (`windfarms` or `offshore_installations`)
- Anthropogenic layer features are previewed on the map as soon as a source is selected, before running the simulation
- After the simulation completes, a **PmarControls** bar appears at the bottom with:
  - Toggle heatmap overlay
  - Toggle seeding area overlay
  - Toggle wind farms layer (if windfarms was used)
  - Toggle offshore installations layer (if offshore_installations was used)
  - **Download raster** — downloads the raw GeoTIFF with a descriptive filename:
    `pmar_<pressure>_<start>-<end>_p<pnum>[_<use_source>].tif`
    e.g. `pmar_plastic_20260501-20260504_p500_windfarms.tif`

### Map markers for anthropogenic layers

All anthropogenic layer features use a standardised SVG teardrop pin icon (`createPinIcon` in `App.jsx`):

| Layer | Fill | Stroke |
|---|---|---|
| Wind farms | yellow `#fef08a` | amber `#ca8a04` |
| Offshore installations | peach `#fed7aa` | orange `#ea580c` |

Point features use `pointToLayer`; polygon features display a pin at the centroid of their bounding box.

### General

- **IT / EN** language switch (i18n via `frontend/src/i18n.js`)

---

## Logging

| File | Content |
|---|---|
| `logs/pygeoapi.log` | Server-level logs (DEBUG) |
| `logs/opendrift.log` | OpenDrift simulation logs |
| `logs/windfarms.log` | Wind farms WFS fetch logs |
| `logs/offshore_installations.log` | Offshore installations WFS fetch logs |
