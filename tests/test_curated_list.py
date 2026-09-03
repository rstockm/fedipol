"""Tests fuer die kuratierte Liste (Port des Legacy-Markdown-Parsers)."""
from pathlib import Path

from fedipol.etl.sources.curated_list import load_curated_list, parse_curated_markdown

SAMPLE = """# Politiker und Institutionen im Fediverse

## Mitglied des Landtages (Grüne)

| Wer | Link |
| :-- | :-- |
| Erika Musterfrau | https://gruene.social/@erika |
| Max Beispiel | https://mastodon.social/@maxb |

## Kreisverband (Die PARTEI)

| Wer | Link |
| :-- | :-- |
| Die PARTEI Sys | https://die-partei.social/@sys |
"""


def test_parse_sections_parties_and_rows():
    accounts = parse_curated_markdown(SAMPLE)
    assert len(accounts) == 3
    erika = accounts[0]
    assert erika.name == "Erika Musterfrau"
    assert erika.position == "Mitglied des Landtages"
    assert erika.party == "Grüne"  # Instanz-Präferenz überschreibt Abschnittspartei
    maxb = accounts[1]
    assert maxb.party == "Grüne"  # Abschnittspartei
    assert accounts[2].party == "Die PARTEI"


def test_load_missing_file_returns_empty(tmp_path):
    assert load_curated_list(tmp_path / "fehlt.md") == []


def test_load_real_curated_list():
    path = Path(__file__).resolve().parents[1] / "config" / "curated_accounts.md"
    accounts = load_curated_list(path)
    assert len(accounts) > 250
    assert all(a.url.startswith("http") for a in accounts)
    assert any(a.party == "Grüne" for a in accounts)
