"""End-to-End-Pipeline-Tests im Offline-Modus (Fixtures statt Netzwerk)."""
import json

from fedipol.etl.paths import DataPaths
from fedipol.etl.pipeline import Pipeline, PipelineConfig

FIXTURE_ACCOUNTS = [
    "https://gruene.social/@erika_musterfrau",
    "https://mastodon.social/@maxbeispiel",
    "https://spd.social/@petrapartei",
    "https://social.bund.de/@beispielministerium",
    "https://social.bund.de/@beispielbehoerde",
    "https://mastodon.social/@beispielbehoerde2",
]


def seed_checkpoint(paths: DataPaths, run_id: str) -> None:
    checkpoint = paths.run_checkpoint(run_id)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for i, url in enumerate(FIXTURE_ACCOUNTS):
        lines.append(
            json.dumps(
                {
                    "url": url,
                    "posts_count": 100 + i,
                    "recent_posts_count": i,
                    "created_at": "2022-01-01T00:00:00.000Z",
                    "is_bot": False,
                    "capped": False,
                    "fetched_at": "2026-09-03T02:00:00+00:00",
                }
            )
        )
    checkpoint.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_pipeline(paths, recorder=None, run_id=None) -> Pipeline:
    return Pipeline(
        paths=paths,
        recorder=recorder,
        config=PipelineConfig(offline=True, run_id=run_id, trigger="test"),
    )


def test_pipeline_offline_publishes_compatible_export(data_paths, recorder, permissive_limits):
    seed_checkpoint(data_paths, "RUN-1")
    result = make_pipeline(data_paths, recorder, "RUN-1").run()

    assert result.published, result.error
    assert result.account_count == len(FIXTURE_ACCOUNTS)
    assert recorder.active_generation == "RUN-1"
    assert recorder.runs["RUN-1"]["status"] == "succeeded"

    export_path = data_paths.export_dir("RUN-1") / "fedipol_data.json"
    payload = json.loads(export_path.read_text(encoding="utf-8"))
    data = payload["data"]

    # Datenvertrag: Schluessel == account.url, alle Pflichtfelder vorhanden
    for url, entry in data.items():
        assert entry["account"]["url"] == url
        assert set(entry) == {"account", "posts_count", "recent_posts_count", "created_at", "is_bot"}
        assert set(entry["account"]) == {"name", "url", "category"}

    # Kategorien im bisherigen Format
    assert data["https://gruene.social/@erika_musterfrau"]["account"]["category"] == "Kreisverband (Grüne)"
    assert (
        data["https://mastodon.social/@maxbeispiel"]["account"]["category"]
        == "Mitglied des Deutschen Bundestages (Linke)"
    )
    # Institutionen ohne Partei-Klammer
    assert (
        data["https://social.bund.de/@beispielministerium"]["account"]["category"] == "Ministerium"
    )
    # Person ohne bekannte Partei: Kategorie ohne Klammer (Legacy-Vertrag,
    # sonst entsteht im Dashboard eine namenlose graue Legenden-Gruppe)
    assert (
        data["https://mastodon.social/@beispielbehoerde2"]["account"]["category"] == "Behoerde"
    )
    assert "(" not in data["https://mastodon.social/@beispielbehoerde2"]["account"]["category"]


def test_pipeline_offline_is_idempotent(data_paths, recorder, permissive_limits):
    seed_checkpoint(data_paths, "RUN-1")
    seed_checkpoint(data_paths, "RUN-2")

    result1 = make_pipeline(data_paths, recorder, "RUN-1").run()
    data1 = json.loads((data_paths.export_dir("RUN-1") / "fedipol_data.json").read_text())["data"]
    result2 = make_pipeline(data_paths, recorder, "RUN-2").run()
    data2 = json.loads((data_paths.export_dir("RUN-2") / "fedipol_data.json").read_text())["data"]

    assert result1.published and result2.published
    assert data1 == data2
    # Keine Duplikate trotz wiederholtem Lauf
    assert len(data2) == len(FIXTURE_ACCOUNTS)
    assert recorder.active_generation == "RUN-2"


def test_failed_run_keeps_previous_generation(data_paths, recorder, strict_drop_limits, tmp_path):
    seed_checkpoint(data_paths, "RUN-1")
    result1 = make_pipeline(data_paths, recorder, "RUN-1").run()
    assert result1.published

    # Alle Accounts per Override ausschliessen -> Qualitaetspruefung muss greifen
    # (isolated_config stellt bereits eine temporaere Konfigurationskopie bereit)
    config_dir = tmp_path / "config"
    (config_dir / "account_overrides.yaml").write_text(
        "\n".join(
            [
                "accounts:",
                *[f"  - url: {url}\n    exclude: true\n    reason: Testausschluss" for url in FIXTURE_ACCOUNTS],
            ]
        ),
        encoding="utf-8",
    )
    from fedipol.etl.overrides import load_overrides
    from fedipol.etl.pipeline import Pipeline

    original = Pipeline._overrides
    Pipeline._overrides = lambda self: load_overrides(config_dir / "account_overrides.yaml")
    try:
        result2 = make_pipeline(data_paths, recorder, "RUN-2").run()
    finally:
        Pipeline._overrides = original

    assert not result2.published
    assert result2.error  # Qualitaetsfehler
    assert recorder.active_generation == "RUN-1"
    assert recorder.runs["RUN-2"]["status"] == "failed"
    # Veroeffentlichte Daten unveraendert lesbar
    data1 = json.loads((data_paths.export_dir("RUN-1") / "fedipol_data.json").read_text())["data"]
    assert len(data1) == len(FIXTURE_ACCOUNTS)


def test_lock_rejects_parallel_run(data_paths, recorder, permissive_limits):
    from fedipol.etl.locking import FileLock

    lock = FileLock(data_paths.locks_dir / "etl.lock")
    lock.acquire()
    try:
        result = make_pipeline(data_paths, recorder, "RUN-X").run()
        assert not result.published
        assert result.error == "lock_busy"
    finally:
        lock.release()
