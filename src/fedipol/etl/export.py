"""Dashboard-Export: kompatibler fedipol_data.json-Vertrag plus Manifest."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC
from pathlib import Path

from fedipol.etl.normalize import dashboard_category

CONTRACT_VERSION = "1"

# Vertrag des bestehenden Dashboards (js/ui.js): Pflichtfelder je Account.
REQUIRED_TOP_FIELDS = {"account", "posts_count", "recent_posts_count", "created_at", "is_bot"}
REQUIRED_ACCOUNT_FIELDS = {"name", "url", "category"}


@dataclass
class DashboardRow:
    url: str
    name: str
    category: str
    posts_count: int
    recent_posts_count: int
    created_at: str | None
    is_bot: bool
    freshness: str  # fresh | stale (intern, nicht exportiert)

    def to_export_entry(self) -> dict:
        return {
            "account": {
                "name": self.name,
                "url": self.url,
                "category": self.category,
            },
            "posts_count": self.posts_count,
            "recent_posts_count": self.recent_posts_count,
            "created_at": self.created_at,
            "is_bot": self.is_bot,
        }


@dataclass
class ExportResult:
    data: dict[str, dict]
    manifest: dict

    @property
    def account_count(self) -> int:
        return len(self.data)

    @property
    def stale_count(self) -> int:
        return sum(1 for row in self._rows if row.freshness == "stale")

    @property
    def fresh_count(self) -> int:
        return sum(1 for row in self._rows if row.freshness == "fresh")

    _rows: list[DashboardRow] = None  # type: ignore[assignment]


def build_dashboard_rows(
    conn,  # duckdb.DuckDBPyConnection
    overrides,  # OverrideSet
    bot_keywords: list[str],
    excluded_urls: set[str] | None = None,
) -> list[DashboardRow]:
    """mart.canonical_accounts x mart.account_facts -> Dashboard-Zeilen.

    Overrides werden zuletzt angewendet: Ausschluss, Bot-Korrektur,
    Name und Kategorie. replazierte Accounts (replaced_by) entfernen den
    alten Eintrag, sofern das Ziel selbst exportiert wird.
    """
    candidates = conn.execute(
        """
        SELECT canonical_url, name, kind, position_label, party_label
        FROM mart.canonical_accounts
        ORDER BY canonical_url
        """
    ).fetchall()

    facts = {
        row[0]: row
        for row in conn.execute(
            """
            SELECT url, posts_count, recent_posts_count, created_at, is_bot, freshness
            FROM mart.account_facts
            """
        ).fetchall()
    }

    override_map = overrides.by_url() if overrides is not None else {}
    excluded_urls = excluded_urls or set()

    rows: list[DashboardRow] = []
    for canon, name, kind, position, party in candidates:
        if canon in excluded_urls:
            continue
        override = override_map.get(canon)
        if override is not None and override.is_active():
            if override.exclude:
                continue
            name = override.display_name or name
            category = override.category  # None heisst: Standardlogik verwenden
        else:
            override = None
            category = None

        fact = facts.get(canon)
        if fact is None:
            # Ohne Beobachtung kein Export (wie bisher nur gescannte Accounts).
            continue
        _url, posts_count, recent_count, created_at, is_bot, freshness = fact

        if category is None:
            if kind == "institution":
                # Institutionen erhalten keine Partei-Klammer
                category = (position or "Institution").strip()
            else:
                category = dashboard_category(position, party or "")

        rows.append(
            DashboardRow(
                url=canon,
                name=name,
                category=category,
                posts_count=int(posts_count or 0),
                recent_posts_count=int(recent_count or 0),
                created_at=created_at,
                is_bot=bool(is_bot),
                freshness=freshness,
            )
        )

    # replaced_by: Quelle nur weglassen, wenn das Ziel selbst exportiert wird
    replaced_targets = {
        entry.replaced_by
        for entry in override_map.values()
        if entry.is_active() and entry.replaced_by
    }
    rows = [row for row in rows if row.url not in replaced_targets]

    return rows


def build_export(
    rows: list[DashboardRow],
    *,
    run_id: str,
    pipeline_version: str,
    missing_count: int = 0,
    warning_count: int = 0,
) -> ExportResult:
    """Erzeugt den kompatiblen Datenvertrag und das Zusatz-Manifest."""
    data: dict[str, dict] = {}
    for row in sorted(rows, key=lambda r: r.url):
        data[row.url] = row.to_export_entry()

    manifest = {
        "run_id": run_id,
        "generated_at": _utcnow(),
        "pipeline_version": pipeline_version,
        "contract_version": CONTRACT_VERSION,
        "account_count": len(data),
        "fresh_accounts": sum(1 for r in rows if r.freshness == "fresh"),
        "stale_accounts": sum(1 for r in rows if r.freshness == "stale"),
        "missing_accounts": missing_count,
        "warning_count": warning_count,
        "status": "complete" if missing_count == 0 else "partial",
    }
    return ExportResult(data=data, manifest=manifest, _rows=rows)


def write_export(export_result: ExportResult, target_dir: Path) -> None:
    """Schreibt fedipol_data.json und manifest.json (Byte-identisch bei gleichen Inputs)."""
    target_dir.mkdir(parents=True, exist_ok=True)
    payload = {"data": export_result.data}
    (target_dir / "fedipol_data.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (target_dir / "manifest.json").write_text(
        json.dumps(export_result.manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _utcnow() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat(timespec="seconds")
