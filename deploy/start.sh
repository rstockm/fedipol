#!/bin/sh
# Startskript der Cloudron-App (drei Phasen, siehe Framework CLOUDRON-GUIDE):
# 1. Als Root: Persistenzverzeichnis vorbereiten.
# 2. Als App-Benutzer: idempotente Initialisierung (Secret-Key, Migrationen).
# 3. exec: langlebiger Gunicorn-Prozess (Signalweiterleitung via exec).

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
    setpriv --reuid="${APP_USER}" --regid="${APP_USER}" --clear-groups \
        --reset-env --inh-caps=-all \
        env PATH="/app/.venv/bin:/usr/bin:/bin" \
            HOME="/app/code" \
            DJANGO_SETTINGS_MODULE=fedipol.settings \
            FEDIPOL_DATA_DIR="${DATA_DIR}" \
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
    /app/.venv/bin/python manage.py check --deploy 2>/dev/null || true
'

# --- Phase 3: Anwendungsprozess (unprivilegiert, via exec) ----------------
exec setpriv --reuid="${APP_USER}" --regid="${APP_USER}" --clear-groups \
    --reset-env --inh-caps=-all \
    env PATH="/app/.venv/bin:/usr/bin:/bin" \
        HOME="/app/code" \
        DJANGO_SETTINGS_MODULE=fedipol.settings \
        FEDIPOL_DATA_DIR="${DATA_DIR}" \
    /app/.venv/bin/gunicorn fedipol.wsgi:application \
        --bind 0.0.0.0:8000 \
        --workers "${GUNICORN_WORKERS:-2}" \
        --threads "${GUNICORN_THREADS:-4}" \
        --timeout 120 \
        --access-logfile - \
        --error-logfile - \
        --chdir "${CODE_DIR}"