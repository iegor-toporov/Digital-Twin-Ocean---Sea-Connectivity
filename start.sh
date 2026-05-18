#!/bin/bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# Load environment variables from .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

export PYGEOAPI_CONFIG=pygeoapi-config.yml
export PYGEOAPI_OPENAPI=pygeoapi-openapi.yml
export PYTHONPATH=$SCRIPT_DIR
rm -f out/pmar_*.nc out/pmar_*.nc_tmp out/opendrift_*.nc out/opendrift_*.nc_tmp
pygeoapi openapi generate $PYGEOAPI_CONFIG --output-file $PYGEOAPI_OPENAPI
pygeoapi serve