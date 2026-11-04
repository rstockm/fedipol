"""Packaging checks for directly invoked Cloudron entry points."""

from pathlib import Path

import pytest


@pytest.mark.parametrize("name", ["start.sh", "etl-job.sh"])
def test_cloudron_entry_points_are_executable(name):
    script = Path(__file__).resolve().parents[1] / "deploy" / name
    assert script.stat().st_mode & 0o111 == 0o111
