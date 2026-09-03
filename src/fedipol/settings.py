"""
Django-Settings fuer fedipol.

Alle produktionsrelevanten Werte werden ueber Umgebungsvariablen gesteuert.
Persistente Daten liegen ausschliesslich unter FEDIPOL_DATA_DIR (Cloudron:
/app/data), das Image-Dateisystem wird als schreibgeschuetzt behandelt.
"""

import os
import pathlib
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# ---------------------------------------------------------------- Persistenz


def _env_data_dir() -> Path:
    raw = os.environ.get("FEDIPOL_DATA_DIR")
    if raw:
        return Path(raw)
    if pathlib.Path("/app/data").is_dir():
        return Path("/app/data")
    return BASE_DIR / "var"


DATA_DIR = _env_data_dir()
DASHBOARD_DIR = Path(
    os.environ.get("FEDIPOL_DASHBOARD_DIR", BASE_DIR / "dashboard")
)
PROJECT_CONFIG_DIR = Path(
    os.environ.get("FEDIPOL_CONFIG_DIR", BASE_DIR / "config")
)

# ------------------------------------------------------------------ Security

DEBUG = os.environ.get("DJANGO_DEBUG", "").lower() in {"1", "true", "yes"}


def _secret_key() -> str:
    env = os.environ.get("DJANGO_SECRET_KEY")
    if env:
        return env
    key_file = DATA_DIR / ".secret_key"
    try:
        if key_file.exists():
            value = key_file.read_text(encoding="utf-8").strip()
            if value:
                return value
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        key_file.write_text(secrets.token_urlsafe(64), encoding="utf-8")
        return key_file.read_text(encoding="utf-8").strip()
    except OSError:
        # Fallback ohne Persistenz (z. B. read-only Dateisystem in Tests)
        return "insecure-fallback-only-for-local-dev"


SECRET_KEY = _secret_key()

_allowed_hosts = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts.split(",") if h.strip()]

_csrf_origins = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf_origins.split(",") if o.strip()]

if not DEBUG:
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_SSL_REDIRECT = False  # Cloudron-Proxy terminiert TLS; interne Healthchecks sind HTTP
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"

# ------------------------------------------------------------------- Django

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "fedipol.ops",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "fedipol.urls"
WSGI_APPLICATION = "fedipol.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        "OPTIONS": {"timeout": 20},
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

USE_TZ = True
TIME_ZONE = os.environ.get("FEDIPOL_TIME_ZONE", "UTC")

LANGUAGE_CODE = "de-de"

STATIC_URL = "static/"
STATIC_ROOT = DATA_DIR / "staticfiles"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "stderr": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
        },
    },
    "root": {"handlers": ["stderr"], "level": os.environ.get("FEDIPOL_LOG_LEVEL", "INFO")},
}

# ------------------------------------------------------------- ETL-Parameter

ETL = {
    # Netzwerk
    "connect_timeout": float(os.environ.get("FEDIPOL_CONNECT_TIMEOUT", "10")),
    "read_timeout": float(os.environ.get("FEDIPOL_READ_TIMEOUT", "60")),
    "max_retries": int(os.environ.get("FEDIPOL_MAX_RETRIES", "3")),
    "backoff_base": float(os.environ.get("FEDIPOL_BACKOFF_BASE", "1.5")),
    # Instanzverhalten
    "global_concurrency": int(os.environ.get("FEDIPOL_GLOBAL_CONCURRENCY", "6")),
    "per_instance_concurrency": int(os.environ.get("FEDIPOL_PER_INSTANCE_CONCURRENCY", "2")),
    "per_instance_min_interval": float(os.environ.get("FEDIPOL_PER_INSTANCE_MIN_INTERVAL", "1.0")),
    "status_pages_max": int(os.environ.get("FEDIPOL_STATUS_PAGES_MAX", "3")),
    # Qualitaetsgrenzen vor Veroeffentlichung
    "max_stale_share": float(os.environ.get("FEDIPOL_MAX_STALE_SHARE", "0.15")),
    "max_account_drop_share": float(os.environ.get("FEDIPOL_MAX_ACCOUNT_DROP_SHARE", "0.10")),
    # Aufbewahrung
    "generations_keep": int(os.environ.get("FEDIPOL_GENERATIONS_KEEP", "3")),
    "raw_keep_runs": int(os.environ.get("FEDIPOL_RAW_KEEP_RUNS", "7")),
}
