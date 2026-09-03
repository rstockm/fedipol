"""Zentrale Pfadaufloesung fuer persistente Daten unter FEDIPOL_DATA_DIR."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def resolve_data_dir() -> Path:
    raw = os.environ.get("FEDIPOL_DATA_DIR")
    if raw:
        return Path(raw)
    if Path("/app/data").is_dir():
        return Path("/app/data")
    return PROJECT_ROOT / "var"


@dataclass(frozen=True)
class DataPaths:
    root: Path

    @property
    def sqlite_db(self) -> Path:
        return self.root / "db.sqlite3"

    @property
    def raw_dir(self) -> Path:
        return self.root / "raw"

    @property
    def checkpoints_dir(self) -> Path:
        return self.root / "checkpoints"

    @property
    def generations_dir(self) -> Path:
        return self.root / "analytics" / "generations"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports" / "generations"

    @property
    def locks_dir(self) -> Path:
        return self.root / "locks"

    def config_dir(self) -> Path:
        raw = os.environ.get("FEDIPOL_CONFIG_DIR")
        return Path(raw) if raw else PROJECT_ROOT / "config"

    def dashboard_dir(self) -> Path:
        raw = os.environ.get("FEDIPOL_DASHBOARD_DIR")
        return Path(raw) if raw else PROJECT_ROOT / "dashboard"

    def run_raw_dir(self, run_id: str) -> Path:
        return self.raw_dir / run_id

    def run_checkpoint(self, run_id: str) -> Path:
        return self.checkpoints_dir / f"{run_id}.jsonl"

    def building_generation(self, run_id: str) -> Path:
        return self.generations_dir / f".building-{run_id}.duckdb"

    def generation(self, run_id: str) -> Path:
        return self.generations_dir / f"{run_id}.duckdb"

    def building_export_dir(self, run_id: str) -> Path:
        return self.exports_dir / f".building-{run_id}"

    def export_dir(self, run_id: str) -> Path:
        return self.exports_dir / run_id

    def ensure_run_dirs(self, run_id: str) -> None:
        for path in (
            self.root,
            self.raw_dir,
            self.checkpoints_dir,
            self.generations_dir,
            self.exports_dir,
            self.locks_dir,
            self.run_raw_dir(run_id),
        ):
            path.mkdir(parents=True, exist_ok=True)


def load_paths() -> DataPaths:
    paths = DataPaths(root=resolve_data_dir())
    paths.root.mkdir(parents=True, exist_ok=True)
    return paths
