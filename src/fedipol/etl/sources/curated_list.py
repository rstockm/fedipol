"""Kuratierte Account-Liste als zusaetzliche Quelle.

Portiert aus parseMarkdownContent in js/enhancement.js: Abschnitte
'## Position (Partei)' mit Tabellenzeilen '| Name | Link |'. Die Liste
enthaelt die redaktionell gepflegten Accounts, die nicht in Wikidata oder
in den Instanzverzeichnissen stehen (u. a. aus dem fedipolitik-Projekt).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_SECTION = re.compile(r"^##\s+(.*?)(?:\s*\((.*?)\))?\s*$")
_HEADER_SKIP = ("| Wer", "|:--", "| :--")


@dataclass(frozen=True)
class CuratedAccount:
    name: str
    url: str
    position: str
    party: str | None


def parse_curated_markdown(content: str) -> list[CuratedAccount]:
    accounts: list[CuratedAccount] = []
    position = ""
    party: str | None = None
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("## "):
            match = _SECTION.match(line)
            if match:
                position = match.group(1).strip()
                party = ((match.group(2) or "").strip()) or None
            continue
        if any(line.startswith(prefix) for prefix in _HEADER_SKIP):
            continue
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        name, link = cells[0], cells[1]
        if not link.startswith("http"):
            continue
        # Instanz-Praeferenz wie im Legacy-Parser (gruene.social / linke.social)
        if "gruene.social" in link:
            party = "Grüne"
        elif "linke.social" in link:
            party = "Linke"
        accounts.append(CuratedAccount(name=name, url=link, position=position, party=party))
    if not accounts:
        logger.warning("Kuratierte Liste enthaelt keine Accounts")
    return accounts


def load_curated_list(path: Path) -> list[CuratedAccount]:
    path = Path(path)
    if not path.is_file():
        logger.warning("Kuratierte Liste fehlt: %s", path)
        return []
    return parse_curated_markdown(path.read_text(encoding="utf-8"))
