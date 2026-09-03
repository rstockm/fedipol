# ADR-0001: Fedipol als Cloudron Service App mit DuckDB-Generationsmodell

- Status: Accepted
- Datum: 2026-09-03
- Verantwortlich: Ralf Stockmann
- Betroffene Guideline: GUIDELINES.md (App-Profile, Datenhaltung), DATA-GUIDELINES.md (ETL, Publikation), OPERATIONS-GUIDELINES.md (Scheduler, Persistenz)
- Ersetzt: keines
- Ersetzt durch: keines

## Kontext

Fedipol war eine rein statische GitHub-Pages-Anwendung. Die gesamte
Datenaufbereitung (Wikidata-SPARQL, Instanzverzeichnisse, Mastodon-API-Scan)
lief als JavaScript im Browser; Zwischenergebnisse wurden als Downloads
verwaltet und manuell committet. Folgen: fehlende Timeouts/Retries im
produktiven Scan, Datenverlust bei Teilfehlern, kein Zeitplan (aktuelle
Datenstaende von mehreren Monaten), Bot-False-Positives ohne
Korrekturmoeglichkeit, keine Provenienz und keine Qualitaetspruefungen.

Das Framework verlangt fuer serverseitige, datenintensive Verarbeitung das
Profil **Service App** (Python/uv, Django, SQLite fuer Betriebszustand,
DuckDB fuer Analytics, pytest, Cloudron). Der Wechsel vom Static- zum
Service-Profil ist eine Architekturänderung und damit ADR-pflichtig.

## Entscheidung

1. Fedipol wird als **Cloudron Custom App (Service App)** betrieben:
   Django-Webprozess (unprivilegiert), taeglicher ETL als Django Management
   Command `run_fedipol_etl` via Cloudron Scheduler (03:00 UTC).
2. **SQLite** speichert ausschliesslich Betriebszustand (ETL-Laeufe,
   Schritte, aktive Generationszeiger). Analytische Daten liegen nicht im ORM.
3. **DuckDB** dient als analytische Datenhaltung im
   Generationsmodell: jeder Lauf baut eine neue, unveraenderliche
   Generation (`.building-<run_id>.duckdb` -> atomarer Rename), publiziert
   nur nach bestandenen Qualitaets- und Vertragspruefungen und aktiviert
   sie per kurzer SQLite-Transaktion. Webzugriffe sind ausschliesslich
   lesend; es gibt genau einen schreibenden Prozess (ETL).
4. Der Exportadapter erzeugt weiterhin **exakt den bisherigen
   Dashboard-Vertrag** (`fedipol_data.json`), ergaenzt um ein
   Lauf-Manifest. Die Visualisierung (js/ui.js, index.html, CSS) bleibt
   unveraendert; die Browser-Pipeline (wikidata.html, enhancement.html)
   entfaellt.
5. Redaktionelle Korrekturen (Bot-False-Positives, Accountumzuege,
   Ausschluesse) werden als **versionierte Overrides**
   (`config/account_overrides.yaml`) gepflegt, nicht als manuelle
   Nachbearbeitung.
6. Persistente Daten liegen ausschliesslich unter `FEDIPOL_DATA_DIR`
   (`/app/data` auf Cloudron) und sind Teil der Cloudron-Backups.

## Alternativen

- **Status quo (statisch + Browser-Pipeline)**: abgelehnt - nicht
  automatisierbar, nicht reproduzierbar, dokumentiert instabil.
- **GitHub Actions als Scheduler**: waere moeglich, widerspricht aber dem
  Framework-Zielbild (Cloudron) und bindet den Betrieb an GitHub;
  Secrets-Handling und Backups waeren ausserhalb der App.
- **Ein gemeinsames, beschreibbares DuckDB-File** fuer Webprozess und ETL:
  abgelehnt - Verletzung der Framework-Regel (genau ein Writer);
  generationsbasierte Publikation ist erforderlich.
- **Dashboard in Django/HTMX neu bauen**: abgelehnt - die existierenden
  Visualisierungen sind ausdruecklich zu erhalten; Migration ist kein Ziel.

## Konsequenzen

- Positiv: taeglich aktuelle, gepruefte Daten ohne manuelle Schritte;
  Reproduzierbarkeit und Provenienz; letzter guter Stand bleibt bei
  Fehlern aktiv; Testbarkeit (55 Tests, Contract-Baseline).
- Negativ/Pflichten: Betrieb einer Cloudron-App (Backups, Healthchecks,
  Updates); Image-Build per Digest; Benachrichtigung bei
  fehlgeschlagenen Naechtlaeufen muss ergaenzt werden (aktuell nur
  stdout-Logs).
- Risiko: Abhaengigkeit von Verfuegbarkeit und Rate Limits von ~59
  Instanzen - abgefedert durch Retry-/LKG-Mechanik und
  Qualitaetsgrenzen.

## Verifikation

- `make check` (ruff + pytest) lokal und in GitHub Actions identisch.
- Contract-Tests gegen die eingefrorene Baseline (`tests/fixtures/baseline_fedipol_data.json`).
- Qualitaetspruefungen verhindern Publikation bei Accountschwund,
  Vertragsverletzungen oder zu hohem Veraltungsanteil.
- Health-Endpunkt meldet Generation, Freshness und Teilfehler.
- Live-Smoke-Run und anschliessend taegliche Scheduler-Laeufe.

## Ablösung

Wenn das Dashboard-Hosting (Cloudron-integriert vs. GitHub Pages) nach dem
Parallelbetrieb endgueltig entschieden wird, folgt ein gesondertes ADR.
Auch eine Aenderung des Aktiviaetsmodus (Aufhebung der 120-Post-Grenze)
bedarf eines neuen ADR, da sie die Bedeutung der Kennzahlen aendert.
