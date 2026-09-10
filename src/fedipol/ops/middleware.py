"""CORS-Freigabe fuer das unter GitHub Pages gehostete Dashboard.

Die App ist oeffentlich und nur lesend. Das Dashboard unter
https://rstockm.github.io/fedipol/ laedt den Export direkt aus dieser App;
dafuer spiegelt die Middleware freigegebene Origins (Umgebungsvariable
FEDIPOL_CORS_ORIGINS) in den CORS-Antwortheadern.
"""

from django.conf import settings
from django.http import HttpRequest, HttpResponse


class PublicCorsMiddleware:
    """Spiegelt erlaubte Origins fuer Lese-Anfragen in CORS-Headern."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        allowed = settings.FEDIPOL_CORS_ORIGINS
        origin = request.headers.get("Origin", "")
        trusted = origin in allowed

        if request.method == "OPTIONS" and trusted:
            response = HttpResponse(status=204)
            response["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Origin, Accept"
            response["Access-Control-Max-Age"] = "86400"
        else:
            response = self.get_response(request)

        if trusted:
            response["Access-Control-Allow-Origin"] = origin
            response["Vary"] = "Origin"
        return response
