import base64
import glob
import importlib
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
from processes.OpenDriftProcess import _get_forcing_file, _get_wind_file, _LOG_DIR, OUT_DIR, CACHE_DIR

EMODNET_CACHE_DIR = os.path.join(CACHE_DIR, 'emodnet')
os.makedirs(EMODNET_CACHE_DIR, exist_ok=True)

logger = logging.getLogger('pmar_process')
if not logger.handlers:
    _fh = logging.FileHandler(os.path.join(_LOG_DIR, 'pmar_process.log'))
    _fh.setFormatter(logging.Formatter(
        '[%(asctime)sZ] {%(filename)s:%(lineno)d} %(levelname)s - %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S',
    ))
    logger.addHandler(_fh)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

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
        'use_source': {
            'title': 'Anthropogenic use layer',
            'description': '"none" (default) or "windfarms" (EMODnet Human Activities).',
            'schema': {'type': 'string', 'default': 'none'},
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

        geojson_input = data.get('geojson')
        shapefile_b64 = data.get('shapefile_b64')
        pressure      = data.get('pressure', 'generic')
        duration_days = int(data.get('duration_days', 3))
        pnum          = min(int(data.get('pnum', 200)), 10000)
        res           = float(data.get('res', 0.1))
        use_source    = data.get('use_source', 'none')

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

        with tempfile.TemporaryDirectory() as tmpdir:
            shp_path = _resolve_shapefile(geojson_input, shapefile_b64, tmpdir)

            gdf    = gpd.read_file(shp_path).to_crs('EPSG:4326')
            bounds = gdf.total_bounds   # [minx, miny, maxx, maxy]
            lon_c  = float((bounds[0] + bounds[2]) / 2)
            lat_c  = float((bounds[1] + bounds[3]) / 2)

            logger.info(
                f'PMAR: pressure={pressure}, pnum={pnum}, '
                f'duration={duration_days}d, start={start_time.isoformat()}, '
                f'bounds={bounds.tolist()}'
            )

            forcing_paths = [_get_forcing_file(lon_c, lat_c, start_time, end_time)]

            pm = PRESSURE_MODELS[pressure]
            if pm['needs_wind']:
                wind_path = _get_wind_file(lon_c, lat_c, start_time, end_time)
                if wind_path:
                    forcing_paths.append(wind_path)
                else:
                    logger.warning(f'Vento non disponibile per {pressure}: simulazione solo a correnti')

            logger.debug(f'Forcing files: {forcing_paths}')

            module = importlib.import_module(pm['module'])
            cls    = getattr(module, pm['class'])
            o      = cls(loglevel=50)
            o.set_config('general:coastline_action', 'stranding')
            o.add_readers_from_list(forcing_paths)

            nc_output = os.path.join(OUT_DIR, f'pmar_{uuid.uuid4().hex}.nc')
            try:
                o.seed_from_shapefile(shapefile=shp_path, number=pnum, time=start_time)
                o.run(
                    duration=timedelta(days=duration_days),
                    time_step=3600,
                    outfile=nc_output,
                )

                pmar_basedir = os.path.join(tmpdir, 'pmar_out')
                p = PMAR(context=None, pressure=pressure, basedir=pmar_basedir, loglevel=50)
                p.ds = xr.open_dataset(nc_output)

                margin     = max(1.0, duration_days * 0.05)
                study_area = [
                    float(bounds[0]) - margin, float(bounds[1]) - margin,
                    float(bounds[2]) + margin, float(bounds[3]) + margin,
                ]
                p.study_area = study_area
                p.grid       = p.xgrid(res=res, study_area=study_area)

                # ── Use layer (pesi attività antropiche) ──────────────────────
                use_raster    = None
                use_geojson   = None
                use_weighted  = False

                if use_source == 'windfarms':
                    logger.info('Recupero wind farms da EMODnet...')
                    gdf_wf = _fetch_windfarms(study_area, EMODNET_CACHE_DIR)
                    if not gdf_wf.empty:
                        use_raster = _gdf_to_use_raster(gdf_wf, p.grid)
                        if float(use_raster.max()) > 0:
                            use_weighted = True
                            use_geojson  = json.loads(
                                gdf_wf[['geometry']].to_crs('EPSG:4326')
                                .simplify(0.01).to_json()
                            )
                            logger.info(f'Wind farms raster pronto: {len(gdf_wf)} feature')
                        else:
                            logger.warning('Nessuna wind farm sovrapposta all\'area di seeding')
                            use_raster = None
                    else:
                        logger.warning('Nessuna wind farm trovata nell\'area di studio')

                h = p.get_histogram(
                    res=res,
                    study_area=study_area,
                    normalize=use_weighted,
                    assign=False,
                    dim=['trajectory', 'time'],
                    block_size=len(p.ds.time),
                    use=use_raster,
                )

                img_b64, map_bounds = _raster_to_png(h)

                logger.info(
                    f'PMAR completato: particles={pnum}, steps={len(p.ds.time)}, '
                    f'use_source={use_source}, weighted={use_weighted}, bounds={map_bounds}'
                )

                result = {
                    'type':       'raster',
                    'image_b64':  img_b64,
                    'bounds':     map_bounds,
                    'pressure':   pressure,
                    'label_it':   pm['label_it'],
                    'label_en':   pm['label_en'],
                    'use_source': use_source,
                    'use_weighted': use_weighted,
                }
                if use_geojson:
                    result['windfarms_geojson'] = use_geojson

                return 'application/json', result

            except ValueError as e:
                logger.error(f'PMAR fallita: {e}')
                if 'first timestep' in str(e):
                    raise ProcessorExecuteError(
                        "Nessun dato CMEMS nell'area selezionata. "
                        "Sposta l'area in mare aperto."
                    )
                raise ProcessorExecuteError(str(e))
            except Exception as e:
                logger.error(f'PMAR fallita: {e}')
                raise ProcessorExecuteError(str(e))
            finally:
                try:
                    os.remove(nc_output)
                except OSError:
                    pass

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


def _raster_to_png(h):
    """
    Convert a PMAR histogram DataArray (y=lat, x=lon) to a base64 PNG
    and the corresponding Leaflet-format bounds [[lat_min, lon_min], [lat_max, lon_max]].
    """
    arr = h.values.astype(float)  # shape (ny, nx)

    # Flip vertically: L.imageOverlay expects row 0 = north (max lat)
    arr_plot  = np.flipud(arr)
    valid_mask = (arr_plot > 0) & np.isfinite(arr_plot)

    if not valid_mask.any():
        return '', None

    valid = arr_plot[valid_mask]
    vmin  = max(float(np.percentile(valid, 2)), 1e-12)
    vmax  = float(np.percentile(valid, 98))
    if vmax <= vmin:
        vmax = vmin * 10

    try:
        norm = mcolors.LogNorm(vmin=vmin, vmax=vmax)
    except Exception:
        norm = mcolors.Normalize(vmin=vmin, vmax=vmax)

    cmap = plt.get_cmap('YlOrRd').copy()
    cmap.set_bad(alpha=0)

    masked_arr = np.ma.masked_where(~valid_mask, arr_plot)
    ny, nx = arr_plot.shape

    fig = plt.figure(figsize=(max(nx / 100, 2), max(ny / 100, 2)), dpi=100)
    ax  = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.imshow(masked_arr, aspect='auto', cmap=cmap, norm=norm,
              interpolation='nearest', origin='upper')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight',
                pad_inches=0, transparent=True)
    plt.close(fig)
    buf.seek(0)
    img_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    x_vals = h.coords['x'].values  # type: ignore[index]
    y_vals = h.coords['y'].values  # type: ignore[index]

    lat_min = float(y_vals.min())
    lat_max = float(y_vals.max())
    lon_min = float(x_vals.min())
    lon_max = float(x_vals.max())

    if len(x_vals) > 1:
        dx = float(x_vals[1] - x_vals[0])
        lon_max += dx
    if len(y_vals) > 1:
        dy = float(y_vals[1] - y_vals[0])
        lat_max += dy

    map_bounds = [[lat_min, lon_min], [lat_max, lon_max]]
    return img_b64, map_bounds


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
