"""DuckDB-Staging: Rohdaten in die Baustein-Generation laden."""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb

from fedipol.etl.normalize import (
    PARTY_ABBREVIATION_MAP,
    canonical_url,
    instance_of,
    instance_priority,
    normalize_name,
    position_priority,
)

logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"


def _read_sql(name: str) -> str:
    return (SQL_DIR / name).read_text(encoding="utf-8")


def open_building_database(path: Path) -> duckdb.DuckDBPyConnection:
    """Oeffnet die Baustein-DuckDB und legt das Staging-Schema an."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(path))
    conn.execute(_read_sql("staging.sql"))
    return conn


def insert_party_aliases(conn: duckdb.DuckDBPyConnection) -> None:
    conn.executemany(
        "INSERT OR REPLACE INTO ref.party_aliases VALUES (?, ?)",
        list(PARTY_ABBREVIATION_MAP.items()),
    )


def insert_wikidata_rows(
    conn: duckdb.DuckDBPyConnection,
    rows: list[dict],
    *,
    source_query: str,
) -> int:
    """SPARQL-Bindings (flache Dictionaries) in staging.candidates laden."""
    kind = "institution" if source_query == "institutions" else "person"
    inserted = 0
    for row in rows:
        account_raw = row.get("account") or ""
        if not account_raw:
            continue
        try:
            canon = canonical_url(account_raw)
        except ValueError:
            logger.warning("Ungueltige Wikidata-Account-URL uebersprungen: %r", account_raw)
            continue
        position = row.get("positionLabel") or None
        party = row.get("partyLabel") or None
        conn.execute(
            """
            INSERT INTO staging.candidates
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                canon,
                account_raw,
                row.get("itemLabel") or "Unbekannt",
                kind,
                position,
                party,
                row.get("qid"),
                instance_of(canon),
                f"wikidata:{source_query}",
                instance_priority(canon),
                position_priority(position),
            ],
        )
        inserted += 1
    return inserted


def insert_directory_rows(conn: duckdb.DuckDBPyConnection, rows: list) -> int:
    """Verzeichnis-Accounts (DirectoryAccount) in staging.candidates laden."""
    inserted = 0
    for row in rows:
        try:
            canon = canonical_url(row.account_url)
        except ValueError:
            logger.warning("Ungueltige Verzeichnis-URL uebersprungen: %r", row.account_url)
            continue
        if row.kind == "institution":
            position = "Institution (Instanz)"
            party = None
        else:
            position = row.party  # Partei als Position (wie im bisherigen Ablauf)
            party = row.party
        conn.execute(
            """
            INSERT INTO staging.candidates
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                canon,
                row.account_url,
                row.name,
                row.kind,
                position,
                party,
                None,
                row.instance,
                f"directory:{row.instance}",
                instance_priority(canon),
                position_priority(position),
            ],
        )
        inserted += 1
    return inserted


def insert_observations(conn: duckdb.DuckDBPyConnection, results: list) -> int:
    """EnrichmentResult-Ergebnisse in staging.observations laden."""
    rows = [
        (
            r.url,
            r.posts_count,
            r.recent_posts_count,
            r.created_at,
            r.is_bot,
            bool(r.capped),
            r.fetched_at,
            "ok" if r.ok else "error",
        )
        for r in results
    ]
    if rows:
        conn.executemany(
            "INSERT INTO staging.observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows
        )
    return len(rows)


def insert_lkg_observations(conn: duckdb.DuckDBPyConnection, rows: list[dict]) -> int:
    """Letzte bekannte Beobachtungen der Vorgaengergeneration laden."""
    if rows:
        conn.executemany(
            "INSERT INTO staging.lkg_observations VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    row["url"],
                    row["posts_count"],
                    row["recent_posts_count"],
                    row["created_at"],
                    row["is_bot"],
                    row.get("fetched_at"),
                )
                for row in rows
            ],
        )
    return len(rows)


def canonical_name_key(name: str) -> str:
    return normalize_name(name)


def build_marts(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute(_read_sql("marts.sql"))
