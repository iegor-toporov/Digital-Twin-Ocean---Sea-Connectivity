import os

from pygeoapi.process.base import BaseProcessor

from processes.PMARProcess import SCENARIOS, SCENARIOS_DIR, get_t4msp_scenarios
from processes.logging_utils import setup_logger

logger = setup_logger('scenario_status_process', 'pmar', 'scenario_status.log')

PROCESS_METADATA = {
    'version': '0.1.0',
    'id': 'scenario_status',
    'title': {'en': 'PMAR Scenario Status'},
    'description': {
        'en': 'Returns the pre-computation status for each defined PMAR scenario.'
    },
    'jobControlOptions': ['sync-execute'],
    'keywords': ['pmar', 'scenario', 'status'],
    'inputs': {},
    'outputs': {
        'result': {
            'title': 'Scenario status map',
            'schema': {'type': 'object', 'contentMediaType': 'application/json'},
        }
    },
}


class ScenarioStatusProcessor(BaseProcessor):

    def __init__(self, processor_def):
        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data):
        result = {}

        def _build_entry(sc, source, extra=None):
            nc_path = os.path.join(SCENARIOS_DIR, sc['nc_filename'])
            if os.path.exists(nc_path):
                nc_size_mb = round(os.path.getsize(nc_path) / (1024 * 1024), 2)
                computed   = True
            else:
                nc_size_mb = None
                computed   = False
            entry = {
                'computed':        computed,
                'nc_size_mb':      nc_size_mb,
                'label_it':        sc['label_it'],
                'label_en':        sc['label_en'],
                'area_it':         sc['area_it'],
                'area_en':         sc['area_en'],
                'pressure':        sc['pressure'],
                'pnum':            sc['pnum'],
                'duration_days':   sc['duration_days'],
                'time_step_hours': sc['time_step_hours'],
                'start_time':      sc['start_time'][:10],
                'res':             sc['res'],
                'source':          source,
            }
            if extra:
                entry.update(extra)
            return entry

        for scenario_id, sc in SCENARIOS.items():
            result[scenario_id] = _build_entry(sc, 'static')

        for scenario_id, sc in get_t4msp_scenarios().items():
            result[scenario_id] = _build_entry(sc, 't4msp', {'t4msp_area_id': sc['t4msp_area_id']})

        logger.info(f'[ScenarioStatus] Totale scenari: {len(result)} '
                    f'(static={len(SCENARIOS)}, t4msp={len(result)-len(SCENARIOS)})')
        return 'application/json', result

    def __repr__(self):
        return '<ScenarioStatusProcessor>'
