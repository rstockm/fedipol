"""Wikidata SPARQL-Import mit versionierten Query-Dateien."""

from __future__ import annotations

import logging
from pathlib import Path

from fedipol.etl.http import FetchResult, fetch

logger = logging.getLogger(__name__)


def load_query(config_dir: Path, name: str) -> str:
    """Liest eine versionierte Query-Datei; Name darf mit oder ohne .sparql kommen."""
    if not name.endswith(".sparql"):
        name = f"{name}.sparql"
    path = Path(config_dir) / "queries" / name
    return path.read_text(encoding="utf-8")


def run_sparql_query(
    endpoint: str,
    query: str,
    *,
    language: str = "de",
    connect_timeout: float = 10.0,
    read_timeout: float = 180.0,
    max_retries: int = 3,
    session=None,  # noqa: ANN001
    sleep=None,  # noqa: ANN001
) -> FetchResult:
    """Fuehrt eine SPARQL-Abfrage als POST aus (gzip-komprimierte Antwort)."""
    return fetch(
        endpoint.rstrip("/"),
        session=session,
        accept="application/sparql-results+json",
        connect_timeout=connect_timeout,
        read_timeout=read_timeout,
        max_retries=max_retries,
        sleep=sleep,
        method="POST",
        data={"query": query, "format": "json"},
    )


def parse_bindings(result: FetchResult) -> list[dict]:
    """Normalisiert SPARQL-Bindings zu flachen Dictionaries."""
    data = result.json()
    rows: list[dict] = []
    for binding in data.get("results", {}).get("bindings", []):
        row = {}
        for key, value in binding.items():
            row[key] = value.get("value") if isinstance(value, dict) else value
        rows.append(row)
    return rows
