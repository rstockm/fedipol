"""Vertragspruefung: Neuer Export muss den bisherigen JSON-Vertrag einhalten.

Die eingefrorene Baseline (fedipol_data.json vom Stand 1b5c8b19) definiert
den Vertrag: Struktur, Felder, Typen. Werte duerfen sich unterscheiden.
"""
import json
from pathlib import Path

from fedipol.etl.export import REQUIRED_ACCOUNT_FIELDS, REQUIRED_TOP_FIELDS

BASELINE = Path(__file__).resolve().parent / "fixtures" / "baseline_fedipol_data.json"


def _baseline_entries():
    payload = json.loads(BASELINE.read_text(encoding="utf-8"))
    return payload.get("data", payload)


def test_baseline_structure_wrapped_in_data():
    payload = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert set(payload) == {"data"}


def test_baseline_entries_match_expected_contract():
    """Sichert den Vertrag selbst gegen unentdeckte Abweichungen in der Baseline."""
    for url, entry in list(_baseline_entries().items())[:200]:
        assert url == entry["account"]["url"]
        assert REQUIRED_TOP_FIELDS <= set(entry)
        assert REQUIRED_ACCOUNT_FIELDS <= set(entry["account"])
        assert isinstance(entry["posts_count"], int)
        assert isinstance(entry["recent_posts_count"], int)
        assert isinstance(entry["is_bot"], bool)
        if entry["created_at"] is not None:
            assert entry["created_at"].endswith("Z")


def test_keys_and_urls_never_diverge_in_baseline():
    for url, entry in _baseline_entries().items():
        assert entry["account"]["url"] == url
