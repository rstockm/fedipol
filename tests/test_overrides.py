"""Tests fuer versionierte Overrides."""
from datetime import date
from pathlib import Path

import pytest

from fedipol.etl.overrides import (
    AccountOverride,
    OverridesError,
    OverrideSet,
    load_overrides,
    validate_against,
)


def _write(tmp_path, content: str) -> Path:
    path = tmp_path / "account_overrides.yaml"
    path.write_text(content, encoding="utf-8")
    return path


def test_load_empty(tmp_path):
    assert load_overrides(tmp_path / "gibts-nicht.yaml").entries == []


def test_load_and_canonicalize(tmp_path):
    path = _write(
        tmp_path,
        """
accounts:
  - url: https://Gruene.Social/@gruene_leipzig/
    force_bot: false
    reason: Menschlich gepflegt
    source: https://github.com/rstockm/fedipol/issues/3
""",
    )
    entries = load_overrides(path).entries
    assert len(entries) == 1
    assert entries[0].url == "https://gruene.social/@gruene_leipzig"
    assert entries[0].force_bot is False
    assert entries[0].exclude is False


def test_reason_required(tmp_path):
    path = _write(tmp_path, "accounts:\n  - url: https://x.social/@a\n")
    with pytest.raises(OverridesError):
        load_overrides(path)


def test_unknown_field_rejected(tmp_path):
    path = _write(
        tmp_path,
        "accounts:\n  - url: https://x.social/@a\n    reason: ok\n    nonsense: 1\n",
    )
    with pytest.raises(OverridesError):
        load_overrides(path)


def test_invalid_expires_rejected(tmp_path):
    path = _write(
        tmp_path,
        'accounts:\n  - url: https://x.social/@a\n    reason: ok\n    expires: "2026-13-99"\n',
    )
    with pytest.raises(OverridesError):
        load_overrides(path)


def test_expired_override_not_active():
    entry = AccountOverride(url="https://x.social/@a", reason="tmp", expires=date(2020, 1, 1))
    assert not entry.is_active()
    entry = AccountOverride(url="https://x.social/@a", reason="tmp", expires=date(2100, 1, 1))
    assert entry.is_active()


def test_validate_against_warns_for_unknown_urls():
    overrides = OverrideSet(
        entries=[
            AccountOverride(url="https://unknown.social/@ghost", reason="test"),
            AccountOverride(url="https://known.social/@real", reason="test"),
        ]
    )
    warnings = validate_against(overrides, {"https://known.social/@real"})
    assert len(warnings) == 1
    assert "unknown.social" in warnings[0]
