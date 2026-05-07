import base64
import math
import glob
import io
import json
import logging
import os
import tempfile
import time as _time
import uuid
import zipfile

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
import geopandas as gpd
from datetime import datetime, timedelta

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError
from processes.OpenDriftProcess import _get_forcing_file, _get_wind_file, _build_model, _ROOT, _LOG_DIR, OUT_DIR, CACHE_DIR

EMODNET_CACHE_DIR = os.path.join(CACHE_DIR, 'emodnet')
os.makedirs(EMODNET_CACHE_DIR, exist_ok=True)

SCENARIOS_DIR     = os.path.join(_ROOT, 'scenarios')
SCENARIOS_SHP_DIR = os.path.join(SCENARIOS_DIR, 'shapefiles')
os.makedirs(SCENARIOS_DIR,     exist_ok=True)
os.makedirs(SCENARIOS_SHP_DIR, exist_ok=True)

SCENARIOS = {
    'adriatico_generic': {
        'label_it':        'Adriatico – Tracciante 2024',
        'label_en':        'Adriatic Sea – Tracer 2024',
        'shapefile':       os.path.join(SCENARIOS_SHP_DIR, 'adriatico.shp'),
        'pressure':        'generic',
        'pnum':            100000,
        'duration_days':   365,
        'time_step_hours': 24,
        'start_time':      '2024-04-27T00:00:00',
        'res':             0.05,
        'nc_filename':     'adriatico_generic_20240427_365d.nc',
    },
    'adriatico_plastic': {
        'label_it':        'Adriatico – Plastica 2024',
        'label_en':        'Adriatic Sea – Plastic 2024',
        'shapefile':       os.path.join(SCENARIOS_SHP_DIR, 'adriatico.shp'),
        'pressure':        'plastic',
        'pnum':            100000,
        'duration_days':   365,
        'time_step_hours': 24,
        'start_time':      '2024-04-27T00:00:00',
        'res':             0.05,
        'nc_filename':     'adriatico_plastic_20240427_365d.nc',
    },
}

from processes.logging_utils import setup_logger
logger = setup_logger('pmar_process', 'pmar', 'pmar.log')

PRESSURE_MODELS = {
    'generic': {
        'module':    'opendrift.models.oceandrift',
        'class':     'OceanDrift',
        'needs_wind': False,
        'label_it':  'Tracciante passivo',
        'label_en':  'Passive tracer',
    },
    'plastic': {
        'module':    'opendrift.models.plastdrift',
        'class':     'PlastDrift',
        'needs_wind': True,   # wind drag + Stokes drift
        'label_it':  'Plastica',
        'label_en':  'Plastic',
    },
    'oil': {
        'module':    'opendrift.models.openoil',
        'class':     'OpenOil',
        'needs_wind': True,   # evaporazione, emulsione
        'label_it':  'Idrocarburi',
        'label_en':  'Hydrocarbons',
    },
}

PROCESS_METADATA = {
    'version': '0.1.0',
    'id': 'pmar',
    'title': {'en': 'PMAR Particle Density Analysis'},
    'description': {
        'en': 'Lagrangian particle density raster computed with PMAR (CNR-ISMAR).'
    },
    'jobControlOptions': ['sync-execute'],
    'keywords': ['pmar', 'particles', 'density', 'raster', 'ocean'],
    'inputs': {
        'geojson': {
            'title': 'Seeding area as GeoJSON FeatureCollection',
            'description': 'JSON string containing a GeoJSON FeatureCollection with polygon(s).',
            'schema': {'type': 'string'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'shapefile_b64': {
            'title': 'Shapefile ZIP encoded as base64',
            'description': 'Base64-encoded ZIP archive containing .shp, .shx, .dbf files.',
            'schema': {'type': 'string'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'pressure': {
            'title': 'Pressure type',
            'description': 'One of: generic (OceanDrift), plastic (PlastDrift), oil (OpenOil).',
            'schema': {'type': 'string', 'default': 'generic'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'start_time': {
            'title': 'Simulation start time (ISO 8601)',
            'schema': {'type': 'string'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'duration_days': {
            'title': 'Simulation duration (days)',
            'schema': {'type': 'integer', 'default': 3},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'pnum': {
            'title': 'Number of particles',
            'schema': {'type': 'integer', 'default': 200},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'res': {
            'title': 'Output grid resolution in degrees',
            'schema': {'type': 'number', 'default': 0.1},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'time_step_hours': {
            'title': 'Simulation time step (hours)',
            'description': 'Integration and output step in hours. 1 = hourly (default), 24 = daily.',
            'schema': {'type': 'integer', 'default': 1},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'use_source': {
            'title': 'Anthropogenic use layer',
            'description': '"none" (default), "windfarms" or "offshore_installations" (EMODnet Human Activities).',
            'schema': {'type': 'string', 'default': 'none'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'scenario_id': {
            'title': 'Pre-computed scenario ID',
            'description': 'If set, skip simulation and use the cached trajectory NC file.',
            'schema': {'type': 'string'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
    },
    'outputs': {
        'result': {
            'title': 'Raster result',
            'schema': {'type': 'object', 'contentMediaType': 'application/json'},
        }
    },
}


class PMARProcessor(BaseProcessor):

    def __init__(self, processor_def):
        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data):
        import xarray as xr
        from pmar.pmar import PMAR
        from pmar.utils import make_grid
        # pmar.py (riga 41) setta PROJ_LIB a un path conda hardcoded inesistente su questo sistema,
        # corrompendo PROJ per pyproj e rasterio. Lo rimuoviamo così entrambe le librerie
        # usano i propri data dir di default, che funzionano correttamente.
        os.environ.pop('PROJ_LIB', None)
        os.environ.pop('PROJ_DATA', None)

        scenario_id = data.get('scenario_id')
        use_source  = data.get('use_source', 'none')

        with tempfile.TemporaryDirectory() as tmpdir:

            # ── Scenario mode: usa traiettorie pre-calcolate ──────────────
            if scenario_id:
                if scenario_id not in SCENARIOS:
                    raise ProcessorExecuteError(f'Scenario sconosciuto: {scenario_id!r}')
                sc        = SCENARIOS[scenario_id]
                nc_output = os.path.join(SCENARIOS_DIR, sc['nc_filename'])
                if not os.path.exists(nc_output):
                    raise ProcessorExecuteError(
                        f'Scenario "{scenario_id}" non ancora pre-calcolato. '
                        f'Esegui prima: python processes/precompute_scenarios.py'
                    )
                pressure   = sc['pressure']
                res        = float(data.get('res', sc['res']))
                start_time = datetime.fromisoformat(sc['start_time'])
                end_time   = start_time + timedelta(days=sc['duration_days'])
                pnum       = sc['pnum']
                gdf        = gpd.read_file(sc['shapefile']).to_crs('EPSG:4326')
                bounds     = gdf.total_bounds
                logger.info(
                    f'Scenario: id={scenario_id}, use_source={use_source}, '
                    f'res={res}, nc={sc["nc_filename"]}'
                )

            # ── Custom mode: simula e poi analizza ────────────────────────
            else:
                geojson_input   = data.get('geojson')
                shapefile_b64   = data.get('shapefile_b64')
                pressure        = data.get('pressure', 'generic')
                duration_days   = int(data.get('duration_days', 3))
                pnum            = min(int(data.get('pnum', 200)), 100000)
                res             = float(data.get('res', 0.1))
                time_step_hours = int(data.get('time_step_hours', 1))
                time_step_hours = max(1, min(time_step_hours, 24))

                if pressure not in PRESSURE_MODELS:
                    raise ProcessorExecuteError(
                        f'Unknown pressure "{pressure}". '
                        f'Available: {", ".join(PRESSURE_MODELS)}'
                    )

                start_time_str = data.get('start_time')
                if start_time_str:
                    try:
                        start_time = datetime.fromisoformat(start_time_str)
                    except ValueError:
                        raise ProcessorExecuteError(
                            f'Invalid start_time: {start_time_str!r}. Use ISO 8601.'
                        )
                else:
                    start_time = datetime.utcnow() - timedelta(days=10)

                end_time = start_time + timedelta(days=duration_days)

                shp_path = _resolve_shapefile(geojson_input, shapefile_b64, tmpdir)
                gdf      = gpd.read_file(shp_path).to_crs('EPSG:4326')
                bounds   = gdf.total_bounds
                lon_c    = float((bounds[0] + bounds[2]) / 2)
                lat_c    = float((bounds[1] + bounds[3]) / 2)

                logger.info(
                    f'PMAR: pressure={pressure}, pnum={pnum}, '
                    f'duration={duration_days}d, time_step={time_step_hours}h, '
                    f'start={start_time.isoformat()}, bounds={bounds.tolist()}'
                )

                pm_cfg = PRESSURE_MODELS[pressure]
                forcing_paths = [_get_forcing_file(lon_c, lat_c, start_time, end_time, time_step_hours)]
                if pm_cfg['needs_wind']:
                    wind_path = _get_wind_file(lon_c, lat_c, start_time, end_time)
                    if wind_path:
                        forcing_paths.append(wind_path)
                    else:
                        logger.warning(f'Vento non disponibile per {pressure}: simulazione solo a correnti')

                logger.debug(f'Forcing files: {forcing_paths}')

                o = _build_model(pm_cfg['class'], pm_cfg)
                o.set_config('general:coastline_action', 'stranding')
                o.add_readers_from_list(forcing_paths)

                nc_output = os.path.join(OUT_DIR, f'pmar_{uuid.uuid4().hex}.nc')
                try:
                    o.seed_from_shapefile(shapefile=shp_path, number=pnum, time=start_time)
                    ts = timedelta(hours=time_step_hours)
                    logger.info(
                        f'Avvio simulazione: model={pm_cfg["class"]}, pnum={pnum}, '
                        f'duration={duration_days}d, time_step={time_step_hours}h'
                    )
                    _t0 = _time.monotonic()
                    o.run(
                        duration=timedelta(days=duration_days),
                        time_step=ts,
                        time_step_output=ts,
                        outfile=nc_output,
                    )
                    _elapsed = (_time.monotonic() - _t0) / 60
                    logger.info(f'Fine simulazione. Ci ha messo {_elapsed:.1f} minuti')
                except ValueError as e:
                    logger.error(f'PMAR fallita: {e}', exc_info=True)
                    if 'first timestep' in str(e):
                        raise ProcessorExecuteError(
                            "Nessun dato CMEMS nell'area selezionata. "
                            "Sposta l'area in mare aperto."
                        )
                    raise ProcessorExecuteError(str(e))
                except Exception as e:
                    logger.error(f'PMAR fallita: {e}', exc_info=True)
                    raise ProcessorExecuteError(str(e))
                finally:
                    pass  # DEBUG: pulizia NC disabilitata temporaneamente

            # ── Analisi PMAR (comune a entrambe le modalità) ──────────────
            pm = PRESSURE_MODELS[pressure]
            try:
                pmar_basedir = os.path.join(tmpdir, 'pmar_out')
                p = PMAR(context=None, pressure=pressure, basedir=pmar_basedir, loglevel=50)
                p.ds = xr.open_dataset(nc_output)

                margin     = 1.0
                study_area = [
                    float(bounds[0]) - margin, float(bounds[1]) - margin,
                    float(bounds[2]) + margin, float(bounds[3]) + margin,
                ]
                p.study_area = study_area
                p.grid       = make_grid(res=res, study_area=study_area)

                use_raster   = None
                use_geojson  = None
                use_weighted = False

                if use_source == 'windfarms':
                    logger.info('Recupero wind farms da EMODnet...')
                    gdf_wf = _fetch_windfarms(study_area, EMODNET_CACHE_DIR)
                    if not gdf_wf.empty:
                        use_raster = _gdf_to_use_raster(gdf_wf, p.grid)
                        if float(use_raster.max()) > 0:
                            use_weighted = True
                            use_geojson  = json.loads(
                                gdf_wf[['geometry']].simplify(0.01).to_json()
                            )
                            logger.info(f'Wind farms raster pronto: {len(gdf_wf)} feature')
                        else:
                            logger.warning("Nessuna wind farm sovrapposta all'area di seeding")
                            use_raster = None
                    else:
                        logger.warning("Nessuna wind farm trovata nell'area di studio")

                elif use_source == 'offshore_installations':
                    logger.info('Recupero impianti offshore da EMODnet...')
                    gdf_oi = _fetch_offshore_installations(study_area, EMODNET_CACHE_DIR)
                    if not gdf_oi.empty:
                        use_raster = _gdf_to_use_raster(gdf_oi, p.grid)
                        if float(use_raster.max()) > 0:
                            use_weighted = True
                            use_geojson  = json.loads(gdf_oi[['geometry']].to_json())
                            logger.info(f'Impianti offshore raster pronto: {len(gdf_oi)} feature')
                        else:
                            logger.warning("Nessun impianto offshore sovrapposto all'area di seeding")
                            use_raster = None
                    else:
                        logger.warning("Nessun impianto offshore trovato nell'area di studio")

                if use_weighted:
                    p.set_weights(res=res, study_area=study_area, use=use_raster, normalize=True)

                h = p.get_histogram(
                    res=res,
                    study_area=study_area,
                    weighted=use_weighted,
                    dim=['trajectory', 'time'],
                    block_size=len(p.ds.time),
                )

                map_bounds, colorbar_b64, vmin, vmax = _raster_to_png(h)
                geotiff_b64 = _histogram_to_geotiff(h)

                x_vals    = h.coords['x'].values
                y_vals    = h.coords['y'].values
                arr_clean = np.where(np.isfinite(h.values) & (h.values > 0), h.values, 0.0)

                logger.info(
                    f'PMAR completato: particles={pnum}, steps={len(p.ds.time)}, '
                    f'use_source={use_source}, weighted={use_weighted}, bounds={map_bounds}'
                )

                result = {
                    'type':           'raster',
                    'raster_values':  np.round(arr_clean, 3).tolist(),
                    'raster_lon_min': float(x_vals.min()),
                    'raster_lat_min': float(y_vals.min()),
                    'raster_res':     float(res),
                    'raster_nx':      int(len(x_vals)),
                    'raster_ny':      int(len(y_vals)),
                    'vmin':           float(vmin),
                    'vmax':           float(vmax),
                    'colorbar_b64':   colorbar_b64,
                    'geotiff_b64':    geotiff_b64,
                    'bounds':         map_bounds,
                    'pressure':       pressure,
                    'label_it':       pm['label_it'],
                    'label_en':       pm['label_en'],
                    'use_source':     use_source,
                    'use_weighted':   use_weighted,
                    'start_time':     start_time.strftime('%Y%m%d'),
                    'end_time':       end_time.strftime('%Y%m%d'),
                    'pnum':           pnum,
                    'scenario_id':    scenario_id,
                }
                if use_geojson:
                    if use_source == 'windfarms':
                        result['windfarms_geojson'] = use_geojson
                    elif use_source == 'offshore_installations':
                        result['offshore_geojson'] = use_geojson

                return 'application/json', result

            except ValueError as e:
                logger.error(f'PMAR fallita (analisi): {e}', exc_info=True)
                raise ProcessorExecuteError(str(e))
            except Exception as e:
                logger.error(f'PMAR fallita (analisi): {e}', exc_info=True)
                raise ProcessorExecuteError(str(e))

    def __repr__(self):
        return '<PMARProcessor>'


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_shapefile(geojson_input, shapefile_b64, tmpdir):
    """Return path to a local .shp from either GeoJSON string/dict or base64 ZIP."""
    if geojson_input is not None:
        geojson = (
            json.loads(geojson_input)
            if isinstance(geojson_input, str)
            else geojson_input
        )
        if geojson.get('type') == 'FeatureCollection':
            features = geojson['features']
        elif geojson.get('type') == 'Feature':
            features = [geojson]
        else:
            features = [{'type': 'Feature', 'geometry': geojson, 'properties': {}}]

        gdf      = gpd.GeoDataFrame.from_features(features, crs='EPSG:4326')
        shp_path = os.path.join(tmpdir, 'seeding.shp')
        gdf.to_file(shp_path)
        return shp_path

    if shapefile_b64 is not None:
        zip_bytes = base64.b64decode(shapefile_b64)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmpdir)
        shp_files = glob.glob(os.path.join(tmpdir, '**', '*.shp'), recursive=True)
        if not shp_files:
            raise ProcessorExecuteError('Nessun file .shp trovato nello ZIP.')
        return shp_files[0]

    raise ProcessorExecuteError('Fornire geojson oppure shapefile_b64.')


def _histogram_to_geotiff(h):
    """Serialize a PMAR histogram DataArray to a GeoTIFF (EPSG:4326) and return it as base64."""
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.crs import CRS

    arr = h.values.astype(np.float32)       # shape (ny, nx), row 0 = south
    x_vals = h.coords['x'].values
    y_vals = h.coords['y'].values
    nx, ny = len(x_vals), len(y_vals)

    dx = float(x_vals[1] - x_vals[0]) if nx > 1 else 0.1
    dy = float(y_vals[1] - y_vals[0]) if ny > 1 else 0.1

    west  = float(x_vals.min()) - dx / 2
    east  = float(x_vals.max()) + dx / 2
    south = float(y_vals.min()) - dy / 2
    north = float(y_vals.max()) + dy / 2

    # rasterio is north-up: row 0 = north → flip
    arr_geo   = np.flipud(arr)
    transform = from_bounds(west, south, east, north, nx, ny)

    buf = io.BytesIO()
    with rasterio.open(
        buf, 'w',
        driver='GTiff',
        height=ny, width=nx,
        count=1,
        dtype=arr_geo.dtype,
        crs=CRS.from_epsg(4326),
        transform=transform,
        compress='lzw',
        nodata=0.0,
    ) as dst:
        dst.write(arr_geo, 1)
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def _raster_to_png(h):
    """
    Compute colormap bounds (vmin/vmax), generate a vertical colorbar PNG,
    and return Leaflet-format cell-edge bounds. The raster is rendered client-side.
    Returns (map_bounds, colorbar_b64, vmin, vmax).
    """
    import matplotlib.ticker as ticker

    arr        = h.values.astype(float)
    valid_mask = (arr > 0) & np.isfinite(arr)

    if not valid_mask.any():
        return None, '', 0.0, 0.0

    valid = arr[valid_mask]
    vmin  = max(float(np.percentile(valid, 2)), 1e-12)
    vmax  = float(np.percentile(valid, 98))
    if vmax <= vmin:
        vmax = vmin * 10

    try:
        norm = mcolors.LogNorm(vmin=vmin, vmax=vmax)
    except Exception:
        norm = mcolors.Normalize(vmin=vmin, vmax=vmax)

    cmap = plt.get_cmap('Spectral_r').copy()

    # ── Colorbar ─────────────────────────────────────────────────────────────
    fig_cb = plt.figure(figsize=(0.65, 2.8), dpi=150)
    cb_ax  = fig_cb.add_axes([0.18, 0.06, 0.38, 0.88])
    sm     = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cb = fig_cb.colorbar(sm, cax=cb_ax)
    cb.ax.tick_params(colors='white', labelsize=6.5, length=3, width=0.5, pad=2)
    cb.outline.set_edgecolor('white')
    cb.outline.set_linewidth(0.5)
    cb.outline.set_alpha(0.5)
    cb.ax.yaxis.set_major_formatter(
        ticker.FuncFormatter(lambda x, _: f'{x:.3g}')
    )
    for lbl in cb.ax.get_yticklabels():
        lbl.set_color('white')
        lbl.set_fontsize(6.5)

    buf_cb = io.BytesIO()
    fig_cb.savefig(buf_cb, format='png', dpi=150, transparent=True,
                   bbox_inches='tight', pad_inches=0.05)
    plt.close(fig_cb)
    buf_cb.seek(0)
    colorbar_b64 = base64.b64encode(buf_cb.getvalue()).decode('utf-8')

    # ── Bounds (cell edges, not centres) ─────────────────────────────────────
    x_vals = h.coords['x'].values
    y_vals = h.coords['y'].values
    dx = float(x_vals[1] - x_vals[0]) if len(x_vals) > 1 else 0.1
    dy = float(y_vals[1] - y_vals[0]) if len(y_vals) > 1 else 0.1
    map_bounds = [
        [float(y_vals.min()) - dy / 2, float(x_vals.min()) - dx / 2],
        [float(y_vals.max()) + dy / 2, float(x_vals.max()) + dx / 2],
    ]

    return map_bounds, colorbar_b64, vmin, vmax


def _fetch_windfarms(study_area, cache_dir):
    """Query EMODnet WFS for wind farm polygons within study_area, with 7-day file cache."""
    import hashlib
    import pickle

    lon_min, lat_min, lon_max, lat_max = study_area
    cache_key  = hashlib.md5(
        f'wf_{lon_min:.3f}_{lat_min:.3f}_{lon_max:.3f}_{lat_max:.3f}'.encode()
    ).hexdigest()
    cache_file = os.path.join(cache_dir, f'windfarms_{cache_key}.pkl')

    if os.path.exists(cache_file):
        age = _time.time() - os.path.getmtime(cache_file)
        if age < 7 * 86400:
            with open(cache_file, 'rb') as f:
                return pickle.load(f)

    bbox_str = f'{lon_min},{lat_min},{lon_max},{lat_max},EPSG:4326'
    base_url = 'https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&OUTPUTFORMAT=application/json'
    gdf = None
    for layer in ('emodnet:windfarmspoly', 'emodnet:windfarms'):
        url = f'{base_url}&TYPENAMES={layer}&BBOX={bbox_str}'
        try:
            candidate = gpd.read_file(url)
            if not candidate.empty:
                gdf = candidate
                logger.info(f'EMODnet layer usato: {layer}, features: {len(gdf)}')
                break
            logger.debug(f'EMODnet layer {layer}: 0 features nell\'area')
        except Exception as exc:
            logger.warning(f'EMODnet WFS {layer} fallito: {exc}')

    if gdf is None:
        return gpd.GeoDataFrame(geometry=gpd.GeoSeries([], dtype='geometry', crs='EPSG:4326'))

    if gdf.crs is None:
        gdf = gdf.set_crs('EPSG:4326')
    else:
        gdf = gdf.to_crs('EPSG:4326')

    os.makedirs(cache_dir, exist_ok=True)
    with open(cache_file, 'wb') as f:
        pickle.dump(gdf, f)

    return gdf


def _fetch_offshore_installations(study_area, cache_dir):
    """Query EMODnet WFS for offshore installation features within study_area, with 7-day file cache."""
    import hashlib
    import pickle

    lon_min, lat_min, lon_max, lat_max = study_area
    cache_key  = hashlib.md5(
        f'oi_{lon_min:.3f}_{lat_min:.3f}_{lon_max:.3f}_{lat_max:.3f}'.encode()
    ).hexdigest()
    cache_file = os.path.join(cache_dir, f'offshore_{cache_key}.pkl')

    if os.path.exists(cache_file):
        age = _time.time() - os.path.getmtime(cache_file)
        if age < 7 * 86400:
            with open(cache_file, 'rb') as f:
                return pickle.load(f)

    bbox_str = f'{lon_min},{lat_min},{lon_max},{lat_max},EPSG:4326'
    base_url = 'https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&OUTPUTFORMAT=application/json'
    gdf = None
    for layer in ('emodnet:offshorefacilities', 'emodnet:offshore_installations', 'emodnet:platforms'):
        url = f'{base_url}&TYPENAMES={layer}&BBOX={bbox_str}'
        try:
            candidate = gpd.read_file(url)
            if not candidate.empty:
                gdf = candidate
                logger.info(f'EMODnet layer usato: {layer}, features: {len(gdf)}')
                break
            logger.debug(f'EMODnet layer {layer}: 0 features nell\'area')
        except Exception as exc:
            logger.warning(f'EMODnet WFS {layer} fallito: {exc}')

    if gdf is None:
        return gpd.GeoDataFrame(geometry=gpd.GeoSeries([], dtype='geometry', crs='EPSG:4326'))

    if gdf.crs is None:
        gdf = gdf.set_crs('EPSG:4326')
    else:
        gdf = gdf.to_crs('EPSG:4326')

    os.makedirs(cache_dir, exist_ok=True)
    with open(cache_file, 'wb') as f:
        pickle.dump(gdf, f)

    return gdf


def _gdf_to_use_raster(gdf, grid):
    """Rasterize a GeoDataFrame of wind farm polygons onto the PMAR grid.

    Returns an xarray DataArray with dims ['y', 'x'] and value 1.0 inside
    wind farm areas, 0.0 elsewhere.
    """
    import xarray as xr
    from rasterio.transform import from_bounds
    from rasterio.features import rasterize
    from shapely.geometry import mapping

    x_vals = grid.coords['x_c'].values
    y_vals = grid.coords['y_c'].values
    nx, ny = len(x_vals), len(y_vals)

    dx = float(x_vals[1] - x_vals[0]) if nx > 1 else 0.1
    dy = float(y_vals[1] - y_vals[0]) if ny > 1 else 0.1

    west  = float(x_vals.min()) - dx / 2
    east  = float(x_vals.max()) + dx / 2
    south = float(y_vals.min()) - dy / 2
    north = float(y_vals.max()) + dy / 2

    # Buffer point geometries to ~5 km (≈ 0.045°)
    gdf_work = gdf.copy()
    is_point = gdf_work.geom_type.isin(['Point', 'MultiPoint'])
    if is_point.any():
        gdf_work.loc[is_point, 'geometry'] = (
            gdf_work.loc[is_point, 'geometry'].buffer(0.045)
        )

    transform = from_bounds(west, south, east, north, nx, ny)
    shapes = [
        (mapping(geom), 1.0)
        for geom in gdf_work.geometry
        if geom is not None and not geom.is_empty
    ]

    if shapes:
        arr = rasterize(
            shapes, out_shape=(ny, nx),
            transform=transform, fill=0.0, dtype=np.float32,
        )
    else:
        arr = np.zeros((ny, nx), dtype=np.float32)

    # rasterio uses north-up (row 0 = north); PMAR y-axis increases southward → flip
    arr = np.flipud(arr)
    return xr.DataArray(arr, coords={'y': y_vals, 'x': x_vals}, dims=['y', 'x'])
