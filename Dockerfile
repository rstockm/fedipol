# Fedipol - Cloudron Custom App (Service App)
# Multi-Stage: uv-Builder + schlanke Runtime.
# Basis-Images per Digest gepinnt (Framework-Pflicht); Digest bei Release erneuern.

FROM python:3.13-slim@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285 AS builder

ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app/code

RUN python -m pip install --no-cache-dir "uv==0.8.22"

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY config ./config
COPY dashboard ./dashboard
COPY deploy ./deploy
COPY manage.py ./
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------- Runtime

FROM python:3.13-slim@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285

# sqlite3: Cloudron sichert deklarierte SQLite-Pfade ueber das sqlite3-Kommando.
# util-linux: setpriv fuer den unprivilegierten App-Prozess im Startskript.
RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 1000 --user-group --shell /usr/sbin/nologin fedipol

COPY --from=builder /app/code /app/code
COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=fedipol.settings \
    FEDIPOL_DATA_DIR=/app/data

EXPOSE 8000

CMD ["/app/code/deploy/start.sh"]