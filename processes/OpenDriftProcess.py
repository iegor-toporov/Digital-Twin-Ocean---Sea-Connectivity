import hashlib
import logging
import math
import os
import uuid
import numpy as np
from datetime import datetime, timedelta

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

_ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR   = os.path.join(_ROOT, 'out')
CACHE_DIR = os.path.join(_ROOT, 'cache')
_LOG_DIR  = os.path.join(_ROOT, 'logs')
os.makedirs(OUT_DIR,   exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(_LOG_DIR,  exist_ok=True)

logger = logging.getLogger('opendrift_process')
if not logger.handlers:
    _fh = logging.FileHandler(os.path.join(_LOG_DIR, 'opendrift.log'))
    _fh.setFormatter(logging.Formatter(
        '[%(asctime)sZ] {%(filename)s:%(lineno)d} %(levelname)s - %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S',
    ))
    logger.addHandler(_fh)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

# ── Dataset CMEMS per correnti (usati da tutti i modelli) ────────────────────
CMEMS_CURRENT_DATASETS = [
    {'dataset_id': 'cmems_mod_med_phy-cur_anfc_0.042deg_PT1H-m', 'variables': ['uo', 'vo']},
    {'dataset_id': 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',  'variables': ['uo', 'vo']},
]

# ── Modelli disponibili con metadati UI ──────────────────────────────────────
AVAILABLE_MODELS = {
    'OceanDrift': {
        'label':       'Tracciante passivo',
        'description': 'Particelle passive trasportate solo dalle correnti superficiali.',
        'module':      'opendrift.models.oceandrift',
        'class':       'OceanDrift',
        'needs_wind':  False,
    },
    'PlastDrift': {
        'label':       'Plastica',
        'description': 'Detriti plastici con galleggiabilità, deriva di Stokes e wind drag.',
        'module':      'opendrift.models.plastdrift',
        'class':       'PlastDrift',
        'needs_wind':  True,
    },
    'LarvalFish': {
        'label':       'Larve/uova di pesce',
        'description': 'Larve e uova di pesce con galleggiabilità verticale e mixing turbolento.',
        'module':      'opendrift.models.larvalfish',
        'class':       'LarvalFish',
        'needs_wind':  False,
    },
    'OpenOil': {
        'label':       'Idrocarburi (petrolio)',
        'description': 'Sversamento di idrocarburi con evaporazione, emulsione e dispersione.',
        'module':      'opendrift.models.openoil',
        'class':       'OpenOil',
        'needs_wind':  True,
    },
}

PROCESS_METADATA = {
    'version': '0.5.0',
    'id': 'opendrift',
    'title': {'en': 'OpenDrift Simulation'},
    'description': {'en': 'Lagrangian particle tracking with real CMEMS ocean currents.'},
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['opendrift', 'drift', 'particles', 'ocean', 'cmems'],
    'inputs': {
        'seeding_type': {
            'title': 'Seeding type',
            'description': '"circle" (default) or "rectangle".',
            'schema': {'type': 'string', 'default': 'circle'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lon': {
            'title': 'Longitude (circle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lat': {
            'title': 'Latitude (circle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'radius': {
            'title': 'Seed radius in metres (circle)',
            'schema': {'type': 'number', 'default': 1000},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lon_min': {
            'title': 'West longitude (rectangle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lon_max': {
            'title': 'East longitude (rectangle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lat_min': {
            'title': 'South latitude (rectangle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'lat_max': {
            'title': 'North latitude (rectangle)',
            'schema': {'type': 'number'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'model': {
            'title': 'Drift model',
            'description': f'One of: {", ".join(AVAILABLE_MODELS.keys())}. Default: OceanDrift.',
            'schema': {'type': 'string', 'default': 'OceanDrift'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'start_time': {
            'title': 'Start time',
            'description': 'ISO 8601 datetime. Defaults to 3 days ago.',
            'schema': {'type': 'string'},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'number': {
            'title': 'Number of particles',
            'schema': {'type': 'integer', 'default': 100},
            'minOccurs': 0, 'maxOccurs': 1,
        },
        'duration_hours': {
            'title': 'Duration (hours)',
            'schema': {'type': 'number', 'default': 24},
            'minOccurs': 0, 'maxOccurs': 1,
        },
    },
    'outputs': {
        'trajectory': {
            'title': 'Trajectory data',
            'schema': {'type': 'object', 'contentMediaType': 'application/json'},
        }
    },
}


class OpenDriftProcessor(BaseProcessor):

    def __init__(self, processor_def):
        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data):
        seeding_type   = data.get('seeding_type', 'circle')
        model_name     = data.get('model', 'OceanDrift')
        number         = min(int(data.get('number', 100)), 10000)
        duration_hours = float(data.get('duration_hours', 24))

        if model_name not in AVAILABLE_MODELS:
            raise ProcessorExecuteError(
                f'Unknown model "{model_name}". '
                f'Available: {", ".join(AVAILABLE_MODELS.keys())}'
            )
        model_meta = AVAILABLE_MODELS[model_name]

        start_time_str = data.get('start_time')
        if start_time_str:
            try:
                start_time = datetime.fromisoformat(start_time_str)
            except ValueError:
                raise ProcessorExecuteError(
                    f'Invalid start_time: {start_time_str!r}. Use ISO 8601.'
                )
        else:
            start_time = datetime.utcnow() - timedelta(days=3)

        end_time  = start_time + timedelta(hours=duration_hours)
        nc_output = os.path.join(OUT_DIR, f'opendrift_{uuid.uuid4().hex}.nc')

        if seeding_type == 'rectangle':
            try:
                lon_min = float(data['lon_min'])
                lon_max = float(data['lon_max'])
                lat_min = float(data['lat_min'])
                lat_max = float(data['lat_max'])
            except (KeyError, ValueError) as e:
                raise ProcessorExecuteError(
                    f'Rectangle seeding requires lon_min, lon_max, lat_min, lat_max: {e}'
                )
            center_lon = (lon_min + lon_max) / 2
            center_lat = (lat_min + lat_max) / 2
            logger.info(
                f'Avvio simulazione: model={model_name}, seeding=rectangle, '
                f'bbox=[{lon_min:.3f},{lat_min:.3f} → {lon_max:.3f},{lat_max:.3f}], '
                f'start={start_time.isoformat()}, duration={duration_hours}h, particles={number}'
            )
        else:
            lon = data.get('lon')
            lat = data.get('lat')
            if lon is None or lat is None:
                raise ProcessorExecuteError('Circle seeding requires lon and lat')
            lon    = float(lon)
            lat    = float(lat)
            radius = float(data.get('radius', 1000))
            center_lon = lon
            center_lat = lat
            logger.info(
                f'Avvio simulazione: model={model_name}, seeding=circle, '
                f'lon={lon}, lat={lat}, radius={radius}m, '
                f'start={start_time.isoformat()}, duration={duration_hours}h, particles={number}'
            )

        forcing_paths = [_get_forcing_file(center_lon, center_lat, start_time, end_time)]
        if model_meta['needs_wind']:
            wind_path = _get_wind_file(center_lon, center_lat, start_time, end_time)
            if wind_path:
                forcing_paths.append(wind_path)

        logger.debug(f'Forcing files: {forcing_paths}')

        try:
            o = _build_model(model_name, model_meta)
            o.add_readers_from_list(forcing_paths)

            if seeding_type == 'rectangle':
                lons = np.random.uniform(lon_min, lon_max, number)
                lats = np.random.uniform(lat_min, lat_max, number)
                o.seed_elements(lon=lons, lat=lats, number=number, time=start_time)
            else:
                o.seed_elements(lon=lon, lat=lat, number=number, radius=radius, radius_type='uniform', time=start_time)

            o.run(duration=timedelta(hours=duration_hours), time_step=3600, outfile=nc_output)
            result = _read_trajectories(nc_output)
        except ValueError as e:
            logger.error(f'Simulazione fallita: {e}')
            if 'first timestep' in str(e):
                raise ProcessorExecuteError(
                    "La simulazione si è fermata subito: l'area di seeding è "
                    "interamente su terraferma o fuori dal dominio dei dati CMEMS. "
                    "Sposta il punto di rilascio in mare aperto."
                )
            raise ProcessorExecuteError(str(e))
        except Exception as e:
            logger.error(f'Simulazione fallita: {e}')
            raise
        finally:
            try:
                os.remove(nc_output)
            except OSError:
                pass

        logger.info(
            f'Simulazione completata: model={model_name}, '
            f'steps={len(result["times"])}, particles={len(result["steps"][0])}'
        )
        result['model'] = model_name
        return 'application/json', result

    def __repr__(self):
        return '<OpenDriftProcessor>'


# ── Model factory ────────────────────────────────────────────────────────────

def _build_model(model_name, model_meta):
    import importlib
    logger.debug(f'Inizializzazione modello: {model_name}')
    module = importlib.import_module(model_meta['module'])
    cls    = getattr(module, model_meta['class'])
    o      = cls(loglevel=50)

    if model_name == 'OpenOil':
        try:
            o.set_config('processes:evaporation', True)
            o.set_config('processes:emulsification', True)
            o.set_config('processes:dispersion', False)
        except Exception:
            pass

    elif model_name == 'PlastDrift':
        try:
            o.set_config('drift:stokes_drift', True)
            o.set_config('drift:wind_drift_factor', 0.01)
        except Exception:
            pass

    elif model_name == 'LarvalFish':
        try:
            o.set_config('drift:vertical_mixing', True)
        except Exception:
            pass

    return o


# ── Cache helpers — correnti ─────────────────────────────────────────────────

def _cache_key(lon, lat, start_time, end_time, suffix='cur'):
    snap_lon   = round(lon)
    snap_lat   = round(lat)
    snap_start = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
    n_days     = math.ceil((end_time - snap_start).total_seconds() / 86400) + 1

    raw    = f'{snap_lon}|{snap_lat}|{snap_start.strftime("%Y%m%d")}|{n_days}|{suffix}'
    digest = hashlib.md5(raw.encode()).hexdigest()[:8]
    label  = f'{snap_lon:+03d}_{snap_lat:+03d}_{snap_start.strftime("%Y%m%d")}_{n_days}d_{suffix}'

    return (
        os.path.join(CACHE_DIR, f'cmems_{label}_{digest}.nc'),
        snap_lon, snap_lat, snap_start, n_days,
    )


def _get_forcing_file(lon, lat, start_time, end_time):
    cache_path, snap_lon, snap_lat, snap_start, n_days = _cache_key(
        lon, lat, start_time, end_time, suffix='cur'
    )
    if os.path.exists(cache_path):
        logger.debug(f'Cache correnti: HIT — {os.path.basename(cache_path)}')
    else:
        logger.info(f'Cache correnti: MISS — avvio download ({n_days} giorni)')
        _download_currents(snap_lon, snap_lat, snap_start, n_days, cache_path)
    return cache_path


def _get_wind_file(lon, lat, start_time, end_time):
    cache_path, snap_lon, snap_lat, snap_start, n_days = _cache_key(
        lon, lat, start_time, end_time, suffix='wind'
    )
    if os.path.exists(cache_path):
        logger.debug(f'Cache vento: HIT — {os.path.basename(cache_path)}')
        return cache_path
    logger.info(f'Cache vento: MISS — avvio download ({n_days} giorni)')
    try:
        _download_wind(snap_lon, snap_lat, snap_start, n_days, cache_path)
        return cache_path
    except Exception as e:
        logger.warning(f'Download vento fallito (non bloccante): {e}')
        return None


def _build_bbox(snap_lon, snap_lat, snap_start, n_days):
    margin   = 5.0 + n_days * 0.02                             # -> TODO da vedere se va bene cosi o è da cambiare
    snap_end = snap_start + timedelta(days=n_days)
    return dict(
        minimum_longitude = snap_lon - margin,
        maximum_longitude = snap_lon + margin,
        minimum_latitude  = snap_lat - margin,
        maximum_latitude  = snap_lat + margin,
        minimum_depth     = 0,
        maximum_depth     = 0.5,
        start_datetime    = snap_start.strftime('%Y-%m-%dT%H:%M:%S'),
        end_datetime      = snap_end.strftime('%Y-%m-%dT%H:%M:%S'),
    )

def _download_currents(snap_lon, snap_lat, snap_start, n_days, cache_path):
    import copernicusmarine
    logger.info(f'Download correnti CMEMS — {snap_start.date()} +{n_days}d → {os.path.basename(cache_path)}')
    bbox     = _build_bbox(snap_lon, snap_lat, snap_start, n_days)
    last_err = None
    for ds in CMEMS_CURRENT_DATASETS:
        try:
            copernicusmarine.subset(
                dataset_id       = ds['dataset_id'],
                variables        = ds['variables'],
                output_filename  = os.path.basename(cache_path),
                output_directory = CACHE_DIR,
                overwrite        = True,
                **bbox,
            )
            logger.info(f"Dataset correnti scaricato: {ds['dataset_id']}")
            return
        except Exception as e:
            logger.warning(f"Dataset correnti fallito: {ds['dataset_id']} — {e}")
            last_err = e
    logger.error(f'Tutti i dataset correnti hanno fallito. Ultimo errore: {last_err}')
    raise ProcessorExecuteError(f'CMEMS currents download failed: {last_err}')


def _download_wind(snap_lon, snap_lat, snap_start, n_days, cache_path):
    import copernicusmarine
    logger.info(f'Download vento CMEMS — {snap_start.date()} +{n_days}d → {os.path.basename(cache_path)}')
    bbox = _build_bbox(snap_lon, snap_lat, snap_start, n_days)
    bbox.pop('minimum_depth', None)
    bbox.pop('maximum_depth', None)

    WIND_DATASETS = [
        {'dataset_id': 'cmems_obs-wind_med_phy_nrt_l4_0.125deg_PT1H',
         'variables': ['eastward_wind', 'northward_wind']},
        {'dataset_id': 'cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H',
         'variables': ['eastward_wind', 'northward_wind']},
    ]
    for ds in WIND_DATASETS:
        try:
            copernicusmarine.subset(
                dataset_id       = ds['dataset_id'],
                variables        = ds['variables'],
                output_filename  = os.path.basename(cache_path),
                output_directory = CACHE_DIR,
                overwrite        = True,
                **bbox,
            )
            logger.info(f"Dataset vento scaricato: {ds['dataset_id']}")
            return
        except Exception as e:
            logger.warning(f"Dataset vento fallito: {ds['dataset_id']} — {e}")
    raise RuntimeError('Wind dataset not available')


# ── Trajectory reader ────────────────────────────────────────────────────────

def _read_trajectories(path):
    import netCDF4 as nc4

    ds       = nc4.Dataset(path)
    lons     = ds.variables['lon'][:]
    lats     = ds.variables['lat'][:]
    time_var = ds.variables['time']
    raw_times = nc4.num2date(
        time_var[:],
        units    = time_var.units,
        calendar = getattr(time_var, 'calendar', 'standard'),
    )
    statuses = ds.variables['status'][:] if 'status' in ds.variables else None
    ds.close()

    time_strings = [
        f'{t.year:04d}-{t.month:02d}-{t.day:02d}T'
        f'{t.hour:02d}:{t.minute:02d}:{t.second:02d}'
        for t in raw_times
    ]

    n_particles, n_time = lons.shape
    lon_masked = np.ma.getmaskarray(lons)

    # Per ogni particella: trova il momento e la posizione in cui si spiaggia/esce dal dominio
    strand_t   = [-1]    * n_particles  # -1 = mai spiaggiata
    strand_lon = [None]  * n_particles
    strand_lat = [None]  * n_particles

    for p in range(n_particles):
        for t in range(n_time):
            if lon_masked[p, t]:
                # La posizione è diventata masked: cerca l'ultima valida
                for t2 in range(t - 1, -1, -1):
                    if not lon_masked[p, t2]:
                        strand_t[p]   = t
                        strand_lon[p] = round(float(lons[p, t2]), 6)
                        strand_lat[p] = round(float(lats[p, t2]), 6)
                        break
                break
            elif statuses is not None:
                s = statuses[p, t]
                if not np.ma.is_masked(s) and int(s) != 0:
                    # Status non-zero: spiaggiata su questa posizione
                    strand_t[p]   = t
                    strand_lon[p] = round(float(lons[p, t]), 6)
                    strand_lat[p] = round(float(lats[p, t]), 6)
                    break

    steps = []
    for t in range(n_time):
        positions = []
        for p in range(n_particles):
            if not lon_masked[p, t]:
                pos = [round(float(lons[p, t]), 6), round(float(lats[p, t]), 6)]
                # Segna come spiaggiata se il flag è scattato a questo step o prima
                if strand_t[p] != -1 and t >= strand_t[p]:
                    pos.append(True)
                positions.append(pos)
            else:
                # Posizione masked: tieni la particella visibile alla posizione di spiaggiamento
                if strand_lon[p] is not None:
                    positions.append([strand_lon[p], strand_lat[p], True])
                else:
                    positions.append(None)
        steps.append(positions)

    return {'times': time_strings, 'steps': steps}