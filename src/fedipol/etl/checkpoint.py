"""Persistente Checkpoints: Wiederaufnahme eines Laufs ohne Neustart aller Schritte."""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class CheckpointStore:
    """JSONL-Datei mit fertiggestellten Account-Anreicherungen pro Lauf."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._entries: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.is_file():
            return
        try:
            for line in self.path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue  # unvollstaendige Zeile nach Abbruch ignorieren
                url = entry.get("url")
                if url and entry.get("error") is None:
                    self._entries[url] = entry
        except OSError as exc:
            logger.warning("Checkpoint nicht lesbar (%s): %s", self.path, exc)

    def completed(self, url: str) -> bool:
        return url in self._entries

    def get(self, url: str) -> dict | None:
        return self._entries.get(url)

    def record(self, result) -> None:
        if result.error is not None:
            return
        self._entries[result.url] = {
            "url": result.url,
            "posts_count": result.posts_count,
            "recent_posts_count": result.recent_posts_count,
            "created_at": result.created_at,
            "is_bot": result.is_bot,
            "capped": result.capped,
            "fetched_at": result.fetched_at,
        }
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(self._entries[result.url], ensure_ascii=False) + "\n")

    def all_entries(self) -> list[dict]:
        return list(self._entries.values())

    def count(self) -> int:
        return len(self._entries)
