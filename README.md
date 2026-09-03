# Fedipol - Fediverse Activity Tracker

Ein interaktives Dashboard zur Analyse der Fediverse-Aktivitäten deutscher Politiker:innen und politischer Institutionen.

- Dashboard (Legacy, unverändert): https://rstockm.github.io/fedipol/
- Architektur-Entscheidung: [ARCHITEKTUR-AUTOMATISIERUNG.md](ARCHITEKTUR-AUTOMATISIERUNG.md)

## Was ist neu

Der bisherige Prozess lief vollständig im Browser: Wikidata- und Instanzabfragen in `wikidata.html`, der Account-Scan in `enhancement.html`, danach manuelle Downloads von Markdown und `fedipol_data.json` samt manueller Commits. Diese Pipeline ist jetzt serverseitig automatisiert:

```
Wikidata SPARQL (versionierte Queries)
  Instanzverzeichnisse (gruene.social, spd.social, social.bund.de, ...)
  Mastodon-API (Lookup + Statuspagination)
        |
        v
  Raw-Artefakte  ->  DuckDB Staging  ->  Marts  ->  Qualitätsprüfungen
        |
        v
  immutable Generation (DuckDB + fedipol_data.json + manifest.json)
        |
        v
  Django-App: Dashboard (unverändert), Export, Health, Freshness
```

- **Täglicher Nachtlauf** per Cloudron Scheduler (03:00 UTC) als Django Management Command.
- **DuckDB** für Staging, Transformationen und Marts als unveränderliche Generationen; SQLite nur für Betriebszustand (Läufe, aktive Generation).
- **Robustheit**: feste Timeouts, Retries mit Backoff, `Retry-After`, instanzbewusste Parallelität, Checkpoints (Wiederaufnahme), Last-known-good-Fallback auf die Vorgängergeneration, Interprozess-Lock, saubere SIGTERM-Behandlung.
- **Qualitätstor**: Veröffentlicht wird nur geprüft; ein fehlgeschlagener Lauf lässt den letzten erfolgreichen Stand aktiv.
- **Dashboard unverändert**: `index.html`, `info.html`, CSS und `js/ui.js` werden 1:1 ausgeliefert und nur mit dem neuen Export gespeist. Der Datenvertrag von `fedipol_data.json` ist identisch (eingefroren als Test-Baseline).
- **Redaktion statt Handarbeit**: Korrekturen (falsche Bot-Markierung, Accountumzug, Ausschluss) werden in [`config/account_overrides.yaml`](config/account_overrides.yaml) versioniert - nicht mehr im Browser nachbearbeitet.

## Projektstruktur

```
manage.py                     Django-Verwaltungsskript
src/fedipol/settings.py       Umgebungsgesteuerte Settings (Cloudron-tauglich)
src/fedipol/ops/              Betriebs-App: SQLite-Modelle, Health/Export/Dashboard-Views
src/fedipol/ops/management/commands/run_fedipol_etl.py   der Nachtlauf
src/fedipol/etl/              Pipeline: sources, staging, marts, quality, export,
                              generations, checkpoint, locking, pipeline
src/fedipol/etl/sql/          versioniertes DuckDB-SQL (staging.sql, marts.sql)
config/queries/*.sparql       Wikidata-Abfragen (aus dem bisherigen JS portiert)
config/sources.yaml           Instanzen, Bot-Keywords, Endpunkte
config/account_overrides.yaml redaktionelle Korrekturen (versioniert)
dashboard/                    unveraenderte Dashboard-Assets vom GitHub-Pages-Stand
tests/                        pytest/pytest-django, Fixtures, Contract-Tests
deploy/                       start.sh (Cloudron) und etl-job.sh (Scheduler)
Dockerfile, CloudronManifest.json, Makefile, uv.lock
```

## Entwicklung

```sh
make check      # Lint (ruff) + Tests (pytest) - 55 Tests
make migrate    # SQLite-Betriebsdatenbank anlegen
make etl-smoke  # ETL mit 25 Accounts (echte Quellen)
make etl        # vollständiger ETL-Lauf
make serve      # App unter http://127.0.0.1:8000 (Dashboard + Export + Health)
```

Endpunkte: `/healthz` (Liveness/Readiness), `/health/data` (Datenaktualität getrennt),
`/fedipol_data.json` (aktive Generation), `/manifest.json` (Lauf-Metadaten), `/` (Dashboard).

### Datenverzeichnis

Alle persistenten Daten liegen unter `FEDIPOL_DATA_DIR` (lokal `./var`, auf Cloudron
`/app/data`): `db.sqlite3`, `raw/`, `checkpoints/`, `analytics/generations/`,
`exports/generations/`, `locks/`.

## Deployment (Cloudron)

```sh
cloudron install --location fedipol.example.org
cloudron env set --app fedipol.example.org DJANGO_ALLOWED_HOSTS=fedipol.example.org
cloudron env set --app fedipol.example.org DJANGO_CSRF_TRUSTED_ORIGINS=https://fedipol.example.org
```

Das Manifest deklariert `localstorage` mit SQLite-Pfad und den Scheduler-Job
`nightly_etl` (03:00 UTC). Der ETL braucht keine Secrets; die Mastodon-APIs und
Wikidata sind öffentlich.

## Rollen der Legacy-Dateien

`wikidata.html`, `enhancement.html` und die zugehörigen Browser-Workflows sind
durch die serverseitige Pipeline ersetzt und nicht mehr Teil der App. Die
Visualisierung in `js/ui.js` bleibt unverändert in Benutzung.

## Lizenz

MIT - siehe [LICENSE](LICENSE). Die Daten basieren auf Wikidata und den
abgefragten Fediverse-Instanzen (CC BY-SA 4.0 für die Wiki-Daten).
