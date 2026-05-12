import os
import uuid
import time as _time
import threading
from datetime import datetime, timedelta

import geopandas as gpd
from shapely.geometry import Polygon

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

from processes.PMARProcess import (
    SCENARIOS, SCENARIOS_DIR, SCENARIOS_SHP_DIR, PRESSURE_MODELS,
    get_t4msp_scenarios, ensure_t4msp_shapefile,
)
from processes.OpenDriftProcess import _get_forcing_file, _get_wind_file, _build_model, OUT_DIR
from processes.logging_utils import setup_logger

logger = setup_logger('precompute_process', 'pmar', 'precompute_process.log')

_precompute_lock = threading.Semaphore(1)

PROCESS_METADATA = {
    'version': '0.1.0',
    'id': 'precompute',
    'title': {'en': 'Pre-compute PMAR scenario'},
    'description': {
        'en': 'Pre-computes trajectories for a fixed PMAR scenario and saves the NC file.'
    },
    'jobControlOptions': ['async-execute'],
    'keywords': ['pmar', 'precompute', 'scenario', 'trajectories'],
    'inputs': {
        'scenario_id': {
            'title': 'Scenario ID',
            'description': 'ID of the scenario to pre-compute (must be one of the keys in SCENARIOS).',
            'schema': {'type': 'string'},
            'minOccurs': 1, 'maxOccurs': 1,
        },
    },
    'outputs': {
        'result': {
            'title': 'Pre-compute result',
            'schema': {'type': 'object', 'contentMediaType': 'application/json'},
        }
    },
}

SHAPEFILE_POLYGONS = {
    'adriatico.shp': [
        (12.4, 37.9), (18.5, 39.7), (19.5, 41.0), (18.8, 42.2),
        (17.0, 43.5), (17.8, 44.5), (18.5, 45.2), (14.3, 45.8),
        (13.5, 45.7), (13.1, 45.6), (12.4, 45.1), (12.2, 44.5),
        (12.0, 43.5), (12.2, 42.0), (12.0, 40.5), (12.4, 37.9),
    ],
}


def _ensure_shapefiles():
    for filename, coords in SHAPEFILE_POLYGONS.items():
        shp_path = os.path.join(SCENARIOS_SHP_DIR, filename)
        if not os.path.exists(shp_path):
            logger.info(f'Creo shapefile: {filename}')
            gdf = gpd.GeoDataFrame(geometry=[Polygon(coords)], crs='EPSG:4326')
            gdf.to_file(shp_path)
            logger.info(f'Shapefile creato: {shp_path}')
        else:
            logger.info(f'Shapefile già presente: {filename}')


def _run_scenario(scenario_id, sc, shp_path):
    nc_output = os.path.join(SCENARIOS_DIR, sc['nc_filename'])

    if os.path.exists(nc_output):
        logger.info(f'[{scenario_id}] NC già presente, salto.')
        return

    logger.info(f'[{scenario_id}] Avvio pre-calcolo: {sc["label_en"]}')

    start_time      = datetime.fromisoformat(sc['start_time'])
    end_time        = start_time + timedelta(days=sc['duration_days'])
    pressure        = sc['pressure']
    pnum            = sc['pnum']
    duration_days   = sc['duration_days']
    time_step_hours = sc['time_step_hours']

    gdf    = gpd.read_file(shp_path).to_crs('EPSG:4326')
    bounds = gdf.total_bounds
    lon_c  = float((bounds[0] + bounds[2]) / 2)
    lat_c  = float((bounds[1] + bounds[3]) / 2)

    logger.info(f'[{scenario_id}] bounds={bounds.tolist()}, center=({lon_c:.2f}, {lat_c:.2f})')

    pm_cfg = PRESSURE_MODELS[pressure]
    forcing_paths = [_get_forcing_file(lon_c, lat_c, start_time, end_time, time_step_hours)]
    if pm_cfg['needs_wind']:
        wind_path = _get_wind_file(lon_c, lat_c, start_time, end_time)
        if wind_path:
            forcing_paths.append(wind_path)
        else:
            logger.warning(f'[{scenario_id}] Vento non disponibile, solo correnti')

    logger.info(f'[{scenario_id}] Forcing files: {forcing_paths}')

    os.environ.pop('PROJ_LIB', None)
    os.environ.pop('PROJ_DATA', None)

    o = _build_model(pm_cfg['class'], pm_cfg)
    o.set_config('general:coastline_action', 'stranding')
    o.add_readers_from_list(forcing_paths)

    tmp_nc = os.path.join(OUT_DIR, f'precompute_{uuid.uuid4().hex}.nc')
    try:
        o.seed_from_shapefile(shapefile=shp_path, number=pnum, time=start_time)
        ts = timedelta(hours=time_step_hours)
        logger.info(
            f'[{scenario_id}] Run: model={pm_cfg["class"]}, pnum={pnum}, '
            f'duration={duration_days}d, time_step={time_step_hours}h'
        )
        t0 = _time.monotonic()
        o.run(
            duration=timedelta(days=duration_days),
            time_step=ts,
            time_step_output=ts,
            outfile=tmp_nc,
        )
        elapsed = (_time.monotonic() - t0) / 60
        logger.info(f'[{scenario_id}] Simulazione completata in {elapsed:.1f} minuti')

        os.rename(tmp_nc, nc_output)
        logger.info(f'[{scenario_id}] NC salvato: {nc_output}')

    except Exception as e:
        logger.error(f'[{scenario_id}] Fallito: {e}', exc_info=True)
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
        raise


class PrecomputeProcessor(BaseProcessor):

    def __init__(self, processor_def):
        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data):
        scenario_id = data.get('scenario_id')
        if not scenario_id:
            raise ProcessorExecuteError('scenario_id è obbligatorio.')

        # Risolvi config e shapefile in base al tipo di scenario
        if scenario_id in SCENARIOS:
            sc           = SCENARIOS[scenario_id]
            is_t4msp     = False
        elif scenario_id.startswith('t4msp_'):
            t4msp_sc = get_t4msp_scenarios()
            if scenario_id not in t4msp_sc:
                raise ProcessorExecuteError(f'Scenario T4MSP sconosciuto: {scenario_id!r}')
            sc       = t4msp_sc[scenario_id]
            is_t4msp = True
        else:
            raise ProcessorExecuteError(
                f'Scenario sconosciuto: {scenario_id!r}. '
                f'Disponibili: {list(SCENARIOS.keys())}'
            )

        logger.info(f'[PrecomputeProcess] Avvio pre-calcolo scenario: {scenario_id}')

        if not _precompute_lock.acquire(blocking=False):
            raise ProcessorExecuteError('Un pre-calcolo è già in corso. Riprova al termine.')

        try:
            if is_t4msp:
                shp_path = ensure_t4msp_shapefile(sc['t4msp_area_id'])
            else:
                _ensure_shapefiles()
                shp_path = sc['shapefile']
            _run_scenario(scenario_id, sc, shp_path)
        except Exception as e:
            logger.error(f'[PrecomputeProcess] Errore nel pre-calcolo di {scenario_id}: {e}', exc_info=True)
            raise ProcessorExecuteError(str(e))
        finally:
            _precompute_lock.release()

        nc_path = os.path.join(SCENARIOS_DIR, sc['nc_filename'])

        logger.info(f'[PrecomputeProcess] Pre-calcolo completato: {sc["nc_filename"]}')

        return 'application/json', {
            'scenario_id': scenario_id,
            'status': 'done',
            'nc_filename': sc['nc_filename'],
        }

    def __repr__(self):
        return '<PrecomputeProcessor>'
