#!/bin/sh
# Startskript der Cloudron-App (drei Phasen, siehe Framework CLOUDRON-GUIDE):
# 1. Als Root: Persistenzverzeichnis vorbereiten.
# 2. Als App-Benutzer: idempotente Initialisierung (Secret-Key, Migrationen).
# 3. exec: langlebiger Gunicorn-Prozess (Signalweiterleitung via exec).
#
# Wichtig: Die Plattform-Umgebung (CLOUDRON_*, Nutzer-Env wie
# DJANGO_ALLOWED_HOSTS) bleibt erhalten; nur HOME und PATH werden gezielt
# gesetzt. Kein `setpriv --reset-env` - es wuerde die Env-Variablen
# vernichten, die der Cloudron-Healthcheck und die Settings brauchen.

set -eu

APP_USER=fedipol
DATA_DIR="${FEDIPOL_DATA_DIR:-/app/data}"
CODE_DIR=/app/code

# --- Phase 1: Verzeichnisse und Rechte (als Root) -------------------------
mkdir -p "${DATA_DIR}" \
    "${DATA_DIR}/raw" "${DATA_DIR}/checkpoints" \
    "${DATA_DIR}/analytics/generations" "${DATA_DIR}/exports/generations" \
    "${DATA_DIR}/locks"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"

# --- Phase 2: Initialisierung als App-Benutzer ----------------------------
run_as_app() {
    setpriv --reuid="${APP_USER}" --regid="${APP_USER}" --clear-groups --inh-caps=-all \
        env HOME="/app/code" PATH="/app/.venv/bin:/usr/bin:/bin" \
        FEDIPOL_DATA_DIR="${DATA_DIR}" DJANGO_SETTINGS_MODULE=fedipol.settings \
        "$@"
}

run_as_app /bin/sh -c '
    set -eu
    if [ ! -f /app/data/.secret_key ]; then
        /app/.venv/bin/python -c "import secrets; open(\"/app/data/.secret_key\", \"w\").write(secrets.token_urlsafe(64))"
        chmod 600 /app/data/.secret_key
    fi
    cd /app/code
    /app/.venv/bin/python manage.py migrate --noinput
'

# --- Phase 3: Anwendungsprozess (unprivilegiert, via exec) ----------------
exec setpriv --reuid="${APP_USER}" --regid="${APP_USER}" --clear-groups --inh-caps=-all \
    env HOME="/app/code" PATH="/app/.venv/bin:/usr/bin:/bin" \
        FEDIPOL_DATA_DIR="${DATA_DIR}" DJANGO_SETTINGS_MODULE=fedipol.settings \
    /app/.venv/bin/gunicorn fedipol.wsgi:application \
        --bind 0.0.0.0:8000 \
        --workers "${GUNICORN_WORKERS:-2}" \
        --threads "${GUNICORN_THREADS:-4}" \
        --timeout 120 \
        --access-logfile - \
        --error-logfile - \
        --chdir "${CODE_DIR}"