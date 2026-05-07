"""
Pre-calcola le traiettorie per gli scenari fissi definiti in SCENARIOS.
Esegui una volta (o quando aggiungi nuovi scenari):

    cd /path/to/demo_5
    python processes/precompute_scenarios.py [scenario_id]

Se scenario_id è omesso, pre-calcola tutti gli scenari mancanti.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta

import geopandas as gpd
from shapely.geometry import Polygon

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

from processes.PMARProcess import SCENARIOS, SCENARIOS_DIR, SCENARIOS_SHP_DIR, PRESSURE_MODELS
from processes.OpenDriftProcess import _get_forcing_file, _get_wind_file, _build_model, OUT_DIR
from processes.logging_utils import setup_logger

logger = setup_logger('precompute', 'pmar', 'precompute.log')

# ── Shapefile predefiniti ─────────────────────────────────────────────────────

ADRIATICO_COORDS = [
    (12.4, 37.9),
    (18.5, 39.7),
    (19.5, 41.0),
    (18.8, 42.2),
    (17.0, 43.5),
    (17.8, 44.5),
    (18.5, 45.2),
    (14.3, 45.8),
    (13.5, 45.7),
    (13.1, 45.6),
    (12.4, 45.1),
    (12.2, 44.5),
    (12.0, 43.5),
    (12.2, 42.0),
    (12.0, 40.5),
    (12.4, 37.9),
]

SHAPEFILE_POLYGONS = {
    'adriatico.shp': ADRIATICO_COORDS,
}


def _ensure_shapefiles():
    for filename, coords in SHAPEFILE_POLYGONS.items():
        shp_path = os.path.join(SCENARIOS_SHP_DIR, filename)
        if not os.path.exists(shp_path):
            logger.info(f'Creo shapefile: {filename}')
            gdf = gpd.GeoDataFrame(
                geometry=[Polygon(coords)],
                crs='EPSG:4326',
            )
            gdf.to_file(shp_path)
            logger.info(f'Shapefile creato: {shp_path}')
        else:
            logger.info(f'Shapefile già presente: {filename}')


def _run_scenario(scenario_id):
    sc = SCENARIOS[scenario_id]
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

    gdf    = gpd.read_file(sc['shapefile']).to_crs('EPSG:4326')
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
        o.seed_from_shapefile(shapefile=sc['shapefile'], number=pnum, time=start_time)
        ts = timedelta(hours=time_step_hours)
        logger.info(
            f'[{scenario_id}] Run: model={pm_cfg["class"]}, pnum={pnum}, '
            f'duration={duration_days}d, time_step={time_step_hours}h'
        )
        import time as _time
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


def main():
    _ensure_shapefiles()

    ids_to_run = sys.argv[1:] if len(sys.argv) > 1 else list(SCENARIOS.keys())

    for sid in ids_to_run:
        if sid not in SCENARIOS:
            print(f'Scenario sconosciuto: {sid!r}. Disponibili: {list(SCENARIOS.keys())}')
            continue
        try:
            _run_scenario(sid)
        except Exception as e:
            print(f'ERRORE [{sid}]: {e}')

    print('Fatto.')


if __name__ == '__main__':
    main()
