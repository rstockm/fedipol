"""Tests fuer URL-Normalisierung, Party-Mapping und Kategorien."""
import pytest

from fedipol.etl.normalize import (
    canonical_url,
    dashboard_category,
    instance_of,
    instance_priority,
    is_bot_note,
    party_abbreviation,
    position_priority,
)


def test_canonical_url_lowercase_and_trailing_slash():
    assert canonical_url("HTTPS://Gruene.Social/@Erika/") == "https://gruene.social/@Erika"


def test_canonical_url_adds_scheme():
    assert canonical_url("mastodon.social/@user") == "https://mastodon.social/@user"


def test_canonical_url_idna_normalization():
    latin = canonical_url("https://bawü.social/@user")
    puny = canonical_url("https://xn--baw-joa.social/@user")
    assert latin == puny == "https://xn--baw-joa.social/@user"


def test_instance_of():
    assert instance_of("https://social.bund.de/@amt") == "social.bund.de"


def test_canonical_url_rejects_empty():
    with pytest.raises(ValueError):
        canonical_url("")
    with pytest.raises(ValueError):
        canonical_url("https://")


def test_party_abbreviations():
    assert party_abbreviation("Bündnis 90/Die Grünen") == "Grüne"
    assert party_abbreviation("Sozialdemokratische Partei Deutschlands") == "SPD"
    assert party_abbreviation("Volt Deutschland") == "Volt"


def test_dashboard_category_format_matches_legacy_contract():
    # js/ui.js erwartet 'Position (Kuerzel)' - leere Position ergibt ' (Kuerzel)'
    assert dashboard_category("Kreisverband", "Bündnis 90/Die Grünen") == "Kreisverband (Grüne)"
    assert dashboard_category("", "Die Linke") == " (Linke)"


def test_dashboard_category_without_party_has_no_bracket():
    # Regression: leere Klammer erzeugt im Dashboard eine namenlose graue
    # Legenden-Gruppe. Legacy: Klammer entfaellt ohne Partei.
    assert dashboard_category("Behörde", "") == "Behörde"
    assert dashboard_category("Behörde", None) == "Behörde"
    assert dashboard_category("politische Partei in Deutschland", "") == "politische Partei in Deutschland"
    assert dashboard_category("", "") == ""


def test_bot_note_heuristics():
    keywords = ["bot", "automatisiert", "mirror"]
    assert is_bot_note("<p>Ich bin ein Mirror</p>", keywords)
    assert is_bot_note("Vollautomatisiert gepostet", keywords)
    assert not is_bot_note("Persönlicher Account", keywords)


def test_instance_priority():
    assert instance_priority("https://social.bund.de/@x") == 30
    assert instance_priority("https://gruene.social/@x") == 20
    assert instance_priority("https://mastodon.social/@x") == 10


def test_position_priority():
    assert position_priority("Mitglied des Deutschen Bundestages") == 100
    assert position_priority("Kreisverband") == 10
