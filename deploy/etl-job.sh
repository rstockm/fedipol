#!/bin/sh
# Scheduler-Job des taeglichen ETL-Laufs (Cloudron Scheduler, 03:00 UTC).
# Laufueberlappung verhindert der Interprozess-Lock in der Pipeline selbst.

set -eu

CODE_DIR=/app/code
export FEDIPOL_DATA_DIR="${FEDIPOL_DATA_DIR:-/app/data}"
export PATH="/app/.venv/bin:/usr/bin:/bin"
export DJANGO_SETTINGS_MODULE=fedipol.settings

cd "${CODE_DIR}"
exec /app/.venv/bin/python manage.py run_fedipol_etl --trigger scheduler