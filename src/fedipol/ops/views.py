"""HTTP-Endpunkte: Health, Datenaktualitaet, Dashboard und Export."""

import mimetypes
import pathlib

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET

from fedipol.etl.paths import resolve_data_dir
from fedipol.ops.models import ActiveGeneration

DASHBOARD_ALLOWED_SUFFIXES = {".html", ".css", ".js", ".png", ".svg", ".ico"}


def _active_export_dir() -> pathlib.Path | None:
    """Verzeichnis des aktiven Exports oder None, wenn nicht verfuegbar."""
    generation = ActiveGeneration.get_solo()
    if not generation:
        return None
    export_dir = resolve_data_dir() / "exports" / "generations" / generation.generation_id
    if (export_dir / "fedipol_data.json").is_file():
        return export_dir
    return None


def _dashboard_file(relpath: str) -> pathlib.Path:
    """Aufgeloesten Dashboard-Pfad gegen Directory Traversal und Whitelist pruefen."""
    base = pathlib.Path(settings.DASHBOARD_DIR).resolve()
    candidate = (base / relpath).resolve()
    if base != candidate and base not in candidate.parents:
        raise Http404
    if candidate.suffix.lower() not in DASHBOARD_ALLOWED_SUFFIXES:
        raise Http404
    if not candidate.is_file():
        raise Http404
    return candidate


@require_GET
def dashboard(request, relpath: str = "index.html") -> FileResponse:
    """Liefert die unveraenderten statischen Dashboard-Assets aus."""
    if relpath in {"", "/"}:
        relpath = "index.html"
    path = _dashboard_file(relpath)
    content_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path.open("rb"), content_type=content_type or "application/octet-stream")


@require_GET
def export_data(request) -> FileResponse | JsonResponse:
    """Stellt fedipol_data.json aus der aktiven Exportgeneration bereit."""
    export_dir = _active_export_dir()
    if export_dir is None:
        return JsonResponse(
            {"error": "Keine aktive Daten-Generation verfuegbar."},
            status=503,
        )
    path = export_dir / "fedipol_data.json"
    response = FileResponse(path.open("rb"), content_type="application/json")
    response["Cache-Control"] = "no-cache"
    return response


@require_GET
def export_manifest(request) -> JsonResponse:
    """Manifest der aktiven Generation: Lauf-ID, Aktualitaet, Qualitaet."""
    export_dir = _active_export_dir()
    if export_dir is None:
        return JsonResponse({"error": "Keine aktive Daten-Generation verfuegbar."}, status=503)
    import json

    manifest = json.loads((export_dir / "manifest.json").read_text(encoding="utf-8"))
    return JsonResponse(manifest)


@require_GET
def healthz(request) -> JsonResponse:
    """Liveness: Prozess und SQLite; Datenstatus separat über /health/data.

    Eine App ohne publizierte Generation (frische Installation) ist
    betriebsbereit; Cloudron-Healthchecks dürfen sie daher nicht als
    unhealthy einstufen.
    """
    checks = {"process": True, "sqlite": False}
    try:
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["sqlite"] = True
    except Exception:
        return JsonResponse({"status": "unhealthy", "checks": checks}, status=503)

    export_dir = _active_export_dir()
    checks["active_generation"] = export_dir is not None
    if export_dir is not None:
        try:
            import json

            payload = (export_dir / "fedipol_data.json").read_text(encoding="utf-8")
            json.loads(payload)  # vollstaendig parsebar
            checks["active_generation"] = True
        except Exception:
            checks["active_generation"] = False

    status = "healthy" if checks["active_generation"] else "degraded_no_generation"
    return JsonResponse({"status": status, "checks": checks})


@require_GET
def health_data(request) -> JsonResponse:
    """Datenaktualitaet getrennt von Liveness melden (Framework-Pflicht)."""
    export_dir = _active_export_dir()
    if export_dir is None:
        return JsonResponse({"status": "unhealthy_missing_generation"}, status=503)
    import json

    manifest = json.loads((export_dir / "manifest.json").read_text(encoding="utf-8"))
    stale = manifest.get("stale_accounts", 0)
    total = manifest.get("account_count", 0)
    max_stale_share = settings.ETL["max_stale_share"]
    if total and stale / total > max_stale_share:
        status = "degraded_partial_data"
    elif manifest.get("generated_at"):
        status = "healthy"
    else:
        status = "unhealthy_missing_generation"
    return JsonResponse(
        {
            "status": status,
            "generation": manifest.get("run_id"),
            "generated_at": manifest.get("generated_at"),
            "account_count": total,
            "stale_accounts": stale,
        }
    )


def error_page(request, exception=None) -> HttpResponse:  # pragma: no cover
    return HttpResponse("Interner Fehler", status=500)