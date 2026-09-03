# Fedipol: Automatisierung und Zielarchitektur

Stand der Analyse: 3. September 2026  
Analysierter Upstream-Stand: [`1b5c8b19`](https://github.com/rstockm/fedipol/commit/1b5c8b19ea0e8a548275ae9cca627e1f158a79ac)  
Repository: <https://github.com/rstockm/fedipol>  
Dashboard: <https://rstockm.github.io/fedipol/>

## Umsetzungsstand (Appendix, 3. September 2026)

Die Roadmap ist bis Phase 5 umgesetzt und live validiert:

- **Phase 0-4 abgeschlossen.** Serverseitige Pipeline (Django Service App,
  DuckDB-Generationsmodell, Cloudron-Paketierung) mit 61 automatisierten
  Tests und Contract-Baseline; Umsetzung in ADR-0001 dokumentiert.
- **Live-Nachtlaeufe**: drei vollstaendige Laeufe gegen die echten Quellen
  (1.200-1.540 Kandidaten, ~59 Instanzen). Rate Limits (429) werden per
  `Retry-After` respektiert, Instanz-Drosselung mittels InstancePacer
  (mindestens 1 s zwischen Request-Starts je Instanz).
- **Shadow-Vergleich gegen die eingefrorene Baseline (Mai 2026)**:
  Ueberschneidungsmenge 850 Accounts; `is_bot` zu 100 % konsistent
  (3 natuerliche Profil-Aenderungen), `created_at` zu 100 % identisch.
  Abweichungen bei Postzahlernaeren erwartbar (vier Monate Aktivitaet).
- **Quellergaenzung**: 304 der zunachst fehlenden Alt-Accounts stammen aus
  der kuratierten Liste (fedipolitik/manuelle Pflege); `config/curated_accounts.md`
  ist als dritte Quelle angebunden (Port des Legacy-Markdown-Parsers).
- **Kontinuitaet**: fehlgeschlagene Einzelanreicherungen werden pro Lauf
  per Checkpoint wiederaufgenommen; Accounts ohne aktuellen Wert bleiben
  per Last-known-good (als veraltet markiert) im Export, statt zu
  verschwinden (968 -> 1.136 Accounts zwischen Lauf 1 und 2).
- **Offen**: Dashboard-Hosting-Entscheidung (ADR-0002, Proposed),
  CI-Workflow-Datei benoetigt einmalig `workflow`-Scope, Cloudron-Install
  auf echter Instanz sowie Alarmierung fuer fehlgeschlagene Naechtlaeufe.

Entwicklung weiter unten im Originaltext: Ist-Analyse, Zielarchitektur und
alle Details zu Phasen und Alternativen.

## Kurzfassung

Der vorgeschlagene Umbau ist sinnvoll und weitgehend automatisierbar. Der heutige Prozess ist keine klassische serverseitige ETL-Pipeline, sondern eine Abfolge browserbasierter Werkzeuge, Downloads und manueller Datei-Updates. Die fachliche Ermittlung und Anreicherung der Accounts findet in JavaScript im Browser statt. Das eigentliche Dashboard liest anschließend nur die erzeugte Datei `fedipol_data.json`.

Genau diese lose Kopplung ermöglicht eine risikoarme Migration:

- Das bestehende Dashboard kann mit seinen Visualisierungen zunächst unverändert bleiben.
- Die browserbasierte Datenaufbereitung wird durch einen täglichen, serverseitigen Batch-Prozess ersetzt.
- DuckDB übernimmt Staging, Transformationen, Historisierung und die Erzeugung stabiler Data Marts.
- SQLite speichert ausschließlich operativen Zustand wie Läufe, Fehler und die aktive DuckDB-Generation.
- Ein kompatibler Export erzeugt weiterhin `fedipol_data.json` im heute erwarteten Format.
- Der Nachtlauf wird durch den Cloudron Scheduler gestartet und veröffentlicht Daten nur nach erfolgreichen Qualitätsprüfungen.
- Fehlgeschlagene Läufe lassen den letzten erfolgreichen Datenstand unangetastet.

DuckDB ist bei derzeit rund 1.170 Accounts nicht aus Performancegründen notwendig. Der Nutzen liegt in reproduzierbaren SQL-Transformationen, sauberer Provenienz, Historisierung, Datenqualitätsprüfungen und einer kontrollierten Veröffentlichung. Eine einzelne, gleichzeitig vom Webprozess und ETL beschriebene DuckDB-Datei wäre dagegen die falsche Architektur.

Nicht vollständig automatisierbar ist die fachliche Kuratierung. Accountumzüge, fehlerhafte Quellklassifikationen, falsche Bot-Erkennung und bewusste Ein- oder Ausschlüsse werden weiterhin vorkommen. Diese Entscheidungen sollten künftig als kleine, versionierte Override-Datei gepflegt werden und nicht mehr als spontane Nachbearbeitung eines Downloads.

## Untersuchungsgrundlage

Das lokale Verzeichnis enthielt zum Zeitpunkt der Analyse nur eine leere `.git`-Struktur ohne Arbeitsbaum, Remote oder Commits. Da in der Umgebung außerdem kein `git`-Programm verfügbar war, wurde der öffentliche Repository-Stand über die GitHub-API und die Raw-Dateien des oben genannten Commits untersucht.

Berücksichtigt wurden insbesondere:

- `README.md`
- `index.html`
- `wikidata.html`
- `enhancement.html`
- `info.html`
- `js/wikidataQuery.js`
- `js/enhancement.js`
- `js/mastodonApi.js`
- `js/ui.js`
- `politiker-und-institutionen-im-fediverse.md`
- `fedipol_data.json`
- `exclude.json`
- Repository-Struktur, Issues und die letzten 30 Commits
- die Vorgaben aus `/home/rstockm/KI/Framework`

Das Repository enthält keine GitHub-Actions-Workflows, kein serverseitiges Programm, kein Paketmanifest, keine automatisierten Tests und keinen expliziten Build-Prozess. GitHub Pages liefert den Inhalt direkt als statische Website aus.

## Ist-Zustand

### Tatsächlicher Datenfluss

Der heutige Prozess besteht aus mindestens zwei voneinander getrennten Browserläufen:

```text
wikidata.html
  -> drei parallele SPARQL-Abfragen
  -> Verzeichnisabfragen ausgewählter Mastodon-Instanzen
  -> optionale Deduplizierung
  -> optionaler Aktivitätsfilter
  -> manueller Markdown-Download
  -> manuelles Ersetzen von politiker-und-institutionen-im-fediverse.md

enhancement.html
  -> Markdown im Browser parsen
  -> für jeden Account Mastodon-Lookup aufrufen
  -> bis zu drei Seiten mit Statusmeldungen abrufen
  -> Aktivität und Bot-Status berechnen
  -> bei Fehlern erneut oder teilweise weiterlaufen lassen
  -> manueller JSON-Download
  -> manuelles Ersetzen von fedipol_data.json
  -> manueller Commit nach GitHub

index.html
  -> fedipol_data.json laden
  -> Tabellen, Filter, Statistiken und Timeline im Browser rendern
```

### Datenquellen

Die Implementierung verwendet aktuell folgende Quellen:

- Wikidata SPARQL Endpoint für Politiker:innen, Parteizugehörigkeiten, politische Positionen und Institutionen
- öffentliche Verzeichnisse ausgewählter Parteiinstanzen
- öffentliche Verzeichnisse ausgewählter institutioneller Instanzen
- Mastodon-kompatible Account- und Status-Endpunkte auf den gefundenen Instanzen
- `exclude.json` für einzelne Ausschlüsse

Die Dokumentation ist dabei nicht durchgängig konsistent. Die README und Teile von `info.html` verweisen auf das Projekt fedipolitik als Datengrundlage, während die operative Implementierung überwiegend Wikidata und Instanzverzeichnisse verwendet. Auch beschriebene Deduplizierungsregeln stimmen nicht vollständig mit der Implementierung überein.

### Umfang des aktuellen Datenbestands

Die untersuchte `fedipol_data.json` enthält:

| Kennzahl | Wert |
| --- | ---: |
| Account-Objekte | 1.170 |
| Nach URL-Kleinschreibung mutmaßlich eindeutige Accounts | 1.168 |
| Unterschiedliche Host-Schreibweisen | 60 |
| Nach IDNA-Normalisierung unterschiedliche Instanzen | 59 |
| Als Bot markierte Accounts | 107 |
| Accounts mit Aktivität größer null | 497 |
| Accounts mit Aktivität null | 673 |
| Unterschiedliche Kategoriezeichenketten | 127 |
| Kategorien mit führendem Leerzeichen | 644 |
| Accounts mit `recent_posts_count = 120` | 52 |
| Größe der JSON-Datei | rund 398 KB |

Die Root-Ebene enthält ausschließlich `data`. Ein Erzeugungszeitpunkt, eine Lauf-ID oder Angaben über fehlgeschlagene Einzelabfragen fehlen. Das Feld `created_at` bezeichnet die Erstellung des jeweiligen Accounts und nicht die Aktualität des Datenexports.

Die Häufung von exakt 120 aktuellen Posts ist kein fachliches Maximum, sondern folgt direkt aus der Implementierung: Es werden höchstens drei Seiten mit jeweils 40 Statusmeldungen gelesen. Das Dashboard behandelt 120 teilweise als `>120`, während die gespeicherten Daten keine eigene Kennzeichnung für eine abgeschnittene Zählung enthalten.

### Dashboard-Vertrag

Das öffentliche Dashboard ist technisch einfach gekoppelt:

- `js/ui.js` lädt relativ zum Dokument `fedipol_data.json`.
- Verarbeitet wird entweder ein Objekt unter `data` oder direkt das Root-Objekt.
- Der Schlüssel jedes Eintrags ist die Account-URL.
- Erwartet werden `account.name`, `account.url`, `account.category`, `posts_count`, `recent_posts_count`, `created_at` und `is_bot`.
- Instanzen, Parteien und Tabellen werden vollständig im Browser aus diesen Feldern abgeleitet.

Damit ist keine Neuimplementierung der Visualisierung erforderlich. Eine neue Pipeline muss zunächst nur exakt denselben Exportvertrag bedienen.

## Probleme des bestehenden Verfahrens

### Manuelle Prozessgrenzen

Die Zwischenergebnisse werden als Browser-Downloads erzeugt. Dateiaustausch, Wiederanlauf und Veröffentlichung hängen davon ab, dass eine Person:

- die richtigen Seiten in der richtigen Reihenfolge aufruft,
- die richtigen Filterzustände auswählt,
- lange Browserläufe beaufsichtigt,
- fehlgeschlagene Abfragen erkennt und wiederholt,
- Dateien unter den richtigen Namen verschiebt,
- Änderungen plausibilisiert und committed.

Diese Schritte sind weder reproduzierbar protokolliert noch idempotent ausführbar.

### Netzwerk- und Instanzverhalten

Die Account-Anreicherung verteilt viele Requests auf Dutzende unabhängig betriebene Instanzen. Diese unterscheiden sich bei Verfügbarkeit, Rate Limits, Mastodon-Versionen und CORS-Konfiguration. Der produktive Scan in `js/enhancement.js` besitzt keine belastbaren Request-Timeouts und keine systematische Retry-Strategie. Zehn Requests werden parallel gestartet, danach wartet der Browser eine Sekunde.

`js/mastodonApi.js` enthält zwar eine zweite Implementierung mit Batches, Rate-Limit-Behandlung und Retries, sie ist aber nicht die zentrale serverseitige Pipeline und beseitigt die Browserabhängigkeit nicht.

### Teilfehler und Datenverlust

Schlägt die Anreicherung eines neuen Accounts fehl, kann dieser beim Export fehlen, weil nur erfolgreich gescannte Einträge mit `created_at` exportiert werden. Es gibt kein explizites Last-known-good-Modell pro Account und keine Qualitätsgrenze für eine zulässige Teilveröffentlichung.

### Fachliche Heuristiken

Die Bot-Erkennung kombiniert das Mastodon-Bot-Flag mit einer Textsuche nach Begriffen wie `bot`, `automatisch`, `automatisiert`, `mirror` oder `unofficial`. Das erzeugt nachweislich False Positives, wie Issue 3 und der weiterhin als Bot markierte Account von GRÜNE Leipzig zeigen.

Weitere fachliche Entscheidungen sind direkt in JavaScript eingebaut:

- Listen besonderer Partei- und Institutionsinstanzen
- Partei-Namensmapping
- Instanz- und Positionsprioritäten
- Deduplizierung nach Namen
- Ersetzen fehlender Rollen durch Parteinamen
- Ausschluss von Bluesky-Bridges

Diese Regeln sind schwer isoliert testbar und nicht als eigener fachlicher Vertrag dokumentiert.

### Datenqualität

Der aktuelle Export ist formal vollständig, enthält aber erkennbare semantische Probleme:

- 127 unterschiedliche Kategorievarianten
- viele Kategorien ohne eigentliche Rollenbezeichnung
- zwei nur durch Groß-/Kleinschreibung der URL verschiedene Dubletten
- Unicode- und Punycode-Schreibweisen derselben Domain
- keine Information darüber, wann einzelne Werte zuletzt erfolgreich ermittelt wurden
- keine Unterscheidung zwischen echter Nullaktivität, abgeschnittenem Wert und fehlgeschlagener Abfrage

### Kein regulärer Betrieb

Die Commit-Historie zeigt Aktualisierungscluster statt eines festen Rhythmus. Auf viele Korrektur-Commits im Februar 2025 folgten längere Pausen. Issue 4 weist ausdrücklich auf einen sieben Monate alten Datenstand hin. Zwischen späteren Aktualisierungsphasen lagen erneut mehrere Monate.

## Ziele und Nicht-Ziele

### Ziele

- Vollautomatischer täglicher Lauf ohne Browser und manuelle Downloads
- Reproduzierbare, testbare und nachvollziehbare Transformationen
- Kontrollierte Behandlung von Timeouts, Rate Limits und Teilfehlern
- Wiederaufnahme eines unterbrochenen Laufs ohne Neustart aller erfolgreichen Schritte
- Historie der Quellen und Account-Beobachtungen
- Atomare Veröffentlichung eines geprüften Datenstands
- Letzter erfolgreicher Stand bleibt bei Fehlern verfügbar
- Bestehender Dashboard-Datenvertrag bleibt zunächst stabil
- Sichtbarer Aktualitäts- und Qualitätsstatus
- Framework-konformer Betrieb als Cloudron Service App

### Nicht-Ziele der ersten Migration

- Keine visuelle Neugestaltung des Dashboards
- Keine Migration auf ein neues Frontend-Framework
- Keine generische öffentliche REST-API
- Keine grundlegende Neudefinition der dargestellten Kennzahlen
- Keine vollständig automatische fachliche Entscheidung über problematische Accounts
- Keine Echtzeitaktualisierung; ein Nachtlauf pro Tag genügt

## Einordnung in das Framework

Die geplante Anwendung ist nach den Framework-Vorgaben eine **Service App**, weil sie serverseitige, gemeinsame und datenintensive Verarbeitung ausführt. Der Referenzstack sieht dafür vor:

- Python mit `uv`
- Django als Web- und Betriebsrahmen
- SQLite für operativen Zustand
- DuckDB für ETL und Analytics
- pytest und pytest-django
- Playwright für Browser-Smoke-Tests
- Cloudron als Zielplattform

Relevant sind insbesondere:

- `/home/rstockm/KI/Framework/GUIDELINES.md`
- `/home/rstockm/KI/Framework/DATA-GUIDELINES.md`
- `/home/rstockm/KI/Framework/OPERATIONS-GUIDELINES.md`
- `/home/rstockm/KI/Framework/CLOUDRON-GUIDE.md`

Der Wechsel von einer statischen Anwendung zu einer Service App sowie die endgültige Dashboard-Hostingentscheidung sollten in einem Architecture Decision Record dokumentiert werden.

## Vorgeschlagene gemeinsame Zielarchitektur

```text
Cloudron Custom App
|
|-- Django-Webprozess
|   |-- Health- und Freshness-Endpunkte
|   |-- optionale Betriebsansicht für letzte ETL-Läufe
|   |-- Auslieferung des bestehenden Dashboards oder der Exportdateien
|   `-- ausschließlich lesender Zugriff auf die aktive Generation
|
|-- Cloudron Scheduler
|   `-- tägliches Django Management Command
|
`-- /app/data
    |-- db.sqlite3
    |-- raw/<source>/<run_id>/...
    |-- analytics/generations/<run_id>.duckdb
    |-- exports/generations/<run_id>/fedipol_data.json
    `-- locks/etl.lock
```

Der Webprozess und die ETL teilen sich keine gleichzeitig beschreibbare DuckDB-Datei. Der Nachtlauf erzeugt eine neue, unveränderliche Generation. Erst nach erfolgreicher Validierung wird diese Generation in einer kurzen SQLite-Transaktion als aktiv markiert.

## Automatisierte ETL-Pipeline

### 1. Lauf anlegen und sperren

Der Scheduler startet beispielsweise:

```text
python manage.py run_fedipol_etl
```

Das Management Command:

- erzeugt eine eindeutige `run_id`,
- legt einen Laufdatensatz in SQLite an,
- erwirbt einen anwendungsweiten Interprozess-Lock,
- verhindert die Überlappung mit manuellen oder geplanten Läufen,
- registriert eine saubere `SIGTERM`-Behandlung.

Kann der Lock nicht erworben werden, wird kein zweiter Lauf gestartet. Das Ereignis wird sichtbar protokolliert, aber die aktive Generation bleibt unverändert.

### 2. Raw Extract

Alle externen Antworten werden vor der Interpretation unverändert gespeichert:

- SPARQL-Ergebnisse je Query
- Instanzverzeichnis-Antworten je Host und Seite
- Mastodon-Account-Antworten
- für die Aktivitätsberechnung benötigte Statusseiten

Zu jedem Artefakt werden mindestens Quelle, URL, Abrufzeit, HTTP-Status, Content-Hash, Größe, Versuch und Lauf-ID erfasst. Unveränderte Originalantworten ermöglichen eine spätere Reproduktion, ohne externe Systeme erneut aufzurufen.

### 3. Staging

Formatspezifische Extractoren normalisieren die Quellen in verlustarme Tabellen, zum Beispiel:

- `staging.wikidata_people`
- `staging.wikidata_institutions`
- `staging.instance_directory_accounts`
- `staging.account_profiles`
- `staging.account_statuses`

URLs und Domains werden kanonisiert. Originalwerte bleiben zusätzlich erhalten. Die Normalisierung umfasst mindestens:

- Scheme und Host-Kleinschreibung
- Entfernen nachgestellter Slashes
- IDNA-Normalisierung internationalisierter Domains
- robuste Extraktion von Username und Host
- Kennzeichnung ungültiger oder nicht unterstützter URLs

### 4. Fachliche Transformationen

Fachliche Regeln werden bevorzugt als versioniertes DuckDB-SQL umgesetzt:

- Zusammenführen der Quellen
- Deduplizierung nach kanonischer URL
- Ermittlung und Normalisierung von Parteien
- Trennung von Personen, Organisationen und Instanzaccounts
- Auswahl eines kanonischen Accounts bei Mehrfachtreffern
- Berechnung der Aktivitätskennzahlen
- Zusammenführung mit Last-known-good-Beobachtungen
- Erzeugung der Dashboard-Kategorie

Python orchestriert die Schritte und übernimmt Netzwerkzugriffe oder Transformationen, die in SQL nicht sinnvoll formulierbar sind.

### 5. Versionierte Overrides

Redaktionelle Entscheidungen werden in einer kleinen, versionierten Datei gepflegt, beispielsweise `config/account_overrides.yaml`. Ein Eintrag kann enthalten:

```yaml
accounts:
  - url: https://gruene.social/@gruene_leipzig
    force_bot: false
    reason: Manuell bestaetigter menschlich gepflegter Account
    source: https://github.com/rstockm/fedipol/issues/3

  - url: https://example.social/@alter_account
    replaced_by: https://example.social/@neuer_account
    reason: Accountumzug

  - url: https://example.social/@nicht_relevant
    exclude: true
    reason: Kein politischer Account
```

Sinnvolle Override-Felder sind:

- `include` oder `exclude`
- `replaced_by`
- `force_bot`
- `party`
- `category`
- `display_name`
- `canonical_url`
- `reason`
- `source`
- optional ein Ablaufdatum für nur vorübergehende Korrekturen

Overrides werden schemavalidiert und dürfen nicht stillschweigend auf nicht mehr vorhandene Accounts zeigen.

### 6. Account-Anreicherung

Die Mastodon-Abfragen werden instanzbewusst geplant:

- kleine globale Parallelität
- maximal ein oder zwei parallele Requests je Instanz
- explizite Connect- und Read-Timeouts
- Respektieren von `Retry-After`
- begrenzte Retries bei Netzwerkfehlern, `429` und geeigneten `5xx`
- exponentieller Backoff mit Jitter
- keine Retries für dauerhaft ungültige Antworten wie die meisten `4xx`
- persistenter Fortschritt pro Account und Schritt

Ein erneuter Lauf verarbeitet nicht blind alle bereits erfolgreichen Zwischenschritte. Der Idempotenzschlüssel sollte mindestens Quelle, Quellversion oder Hash und Pipelineversion berücksichtigen.

### 7. Aktivitätsmetrik

Die aktuelle Implementierung speichert höchstens 120 Posts für die letzten 60 Tage. Für die erste Migration gibt es zwei sinnvolle Modi:

**Kompatibilitätsmodus:**

- höchstens drei Seiten abrufen,
- `recent_posts_count` weiterhin bei 120 deckeln,
- intern zusätzlich `recent_posts_capped = true` speichern,
- den bestehenden Dashboardwert unverändert exportieren.

**Exakter Modus:**

- paginieren, bis der 60-Tage-Stichtag erreicht ist,
- Status-IDs und Zeitpunkte inkrementell speichern,
- tägliche Läufe ergänzen nur neue Statusmeldungen und entfernen Beobachtungen außerhalb des Fensters,
- exakte Zählung aus der lokalen Historie erzeugen.

Für eine risikoarme Migration sollte zunächst der Kompatibilitätsmodus gelten. Der exakte Modus verändert die fachliche Bedeutung und die Skalierung der Balken und sollte deshalb separat entschieden und getestet werden.

### 8. Teilfehler

Nicht jeder unerreichbare Account muss den gesamten Lauf verhindern. Die Pipeline unterscheidet mindestens:

- zentrale Quellenfehler, die den Lauf abbrechen,
- einzelne nicht erreichbare Instanzen,
- einzelne gelöschte oder umgezogene Accounts,
- temporäre Rate Limits,
- fachlich ungültige Datensätze.

Für einzelne temporäre Fehler wird die letzte erfolgreiche Beobachtung übernommen und als veraltet markiert. Das interne Modell speichert:

- `last_success_at`
- `last_attempt_at`
- `freshness_status`
- `error_category`
- `consecutive_failures`

Vor der Veröffentlichung gelten konfigurierbare Qualitätsgrenzen, etwa maximaler Anteil veralteter Accounts oder maximaler Rückgang gegenüber der letzten Generation. Überschreitet ein Lauf diese Grenzen, bleibt die letzte erfolgreiche Generation aktiv.

### 9. Marts und Export

Das zentrale Mart ist eine stabile Tabelle wie `mart.dashboard_accounts`. Daraus erzeugt ein Exportadapter weiterhin genau den vorhandenen Vertrag:

```json
{
  "data": {
    "https://example.social/@account": {
      "account": {
        "name": "Name",
        "url": "https://example.social/@account",
        "category": "Rolle (Partei)"
      },
      "posts_count": 123,
      "recent_posts_count": 12,
      "created_at": "2022-11-01T00:00:00.000Z",
      "is_bot": false
    }
  }
}
```

Zusätzlich sollte ein separates Manifest erzeugt werden:

```json
{
  "run_id": "2026-09-03T02:00:00Z",
  "generated_at": "2026-09-03T02:41:17Z",
  "pipeline_version": "...",
  "account_count": 1170,
  "fresh_accounts": 1148,
  "stale_accounts": 22,
  "status": "complete"
}
```

Das Manifest erweitert den Vertrag, ohne die Visualisierungsdaten zu verändern.

## DuckDB-Publikationsmodell

Jeder erfolgreiche Lauf erzeugt eine neue Generation:

1. SQLite-Lauf als `running` markieren.
2. Interprozess-Lock erwerben.
3. Neue DuckDB-Datei unter einem temporären Namen im Generationsverzeichnis erstellen.
4. Raw-, Staging-, Transformations- und Mart-Schritte ausführen.
5. Datenqualitäts- und Exportvertragsprüfungen ausführen.
6. DuckDB-Verbindung schließen.
7. Datei und Exportverzeichnis atomar in eine unveränderliche Generation umbenennen.
8. In einer kurzen SQLite-Transaktion die aktive Generation umstellen.
9. Lauf als `succeeded` markieren.

Bei einem Fehler wird der Lauf als `failed` markiert. Die aktive Generation wird nicht verändert.

Mindestens die aktive und ihre direkte Vorgängergeneration bleiben erhalten. Ältere Generationen werden nur außerhalb von ETL- und Backupfenstern bereinigt. Nach einem Restore prüft die Anwendung, ob die in SQLite referenzierte Generation vorhanden und lesbar ist. Fehlt sie, erfolgt ein kontrollierter Fallback auf die neueste validierte Generation.

## Operatives Datenmodell

SQLite sollte klein bleiben und nur betriebliche Informationen verwalten:

### `etl_runs`

- `run_id`
- `started_at`
- `finished_at`
- `status`
- `trigger`
- `pipeline_version`
- `active_generation_before`
- `published_generation`
- `source_count`
- `account_count`
- `fresh_count`
- `stale_count`
- `error_summary`

### `etl_steps`

- `run_id`
- `step_name`
- `started_at`
- `finished_at`
- `status`
- `attempt`
- `input_count`
- `output_count`
- `error_category`

### `active_generation`

- genau eine aktive Generations-ID
- Aktivierungszeitpunkt
- vorherige Generations-ID

Analytische Accounttabellen werden nicht parallel im Django ORM nachgebaut. Sie gehören in DuckDB.

## Datenqualitätsprüfungen

Vor jeder Veröffentlichung sollten mindestens folgende Prüfungen laufen:

- JSON-Schema und DuckDB-Schema sind gültig.
- Jeder Exportdatensatz besitzt alle bisher erwarteten Felder.
- Account-URL und Objektschlüssel sind identisch.
- Kanonische URLs sind eindeutig.
- Zähler sind nicht negativ.
- `recent_posts_count` ist nicht größer als `posts_count`, soweit beide semantisch vergleichbar sind.
- Datumswerte sind parsebar und plausibel.
- Parteien und Kategorien entsprechen kontrollierten oder ausdrücklich zugelassenen Werten.
- Die Gesamtzahl fällt nicht ohne dokumentierten Grund stark ab.
- Der Anteil veralteter oder fehlgeschlagener Anreicherungen bleibt unter dem Grenzwert.
- Der Export ist bei identischen Inputs deterministisch.
- Ein wiederholter Import erzeugt keine zusätzlichen Duplikate.
- Das Dashboard kann den Export in einem Browser-Smoke-Test laden.

Erwartete Änderungen, etwa ein größerer Rückgang durch eine geänderte Wikidata-Abfrage, müssen als bewusst freigegebene Regeländerung behandelt werden und dürfen nicht unbemerkt produktiv gehen.

## Erhalt des Dashboards

Die vorhandenen Visualisierungen sind ein schützenswerter Bestandteil. Die erste Ausbaustufe übernimmt daher unverändert:

- Seitenaufbau und Navigation
- Partei-Verteilungsbalken
- Partei-Farbmapping
- Timeline
- Account- und Institutionstabellen
- Sortierung nach Gesamt- oder 60-Tage-Aktivität
- Suche und Parteienfilter
- Aktivitätsbalken und Botdarstellung
- Responsive Verhalten

Notwendige technische Änderungen sollten auf folgende Punkte begrenzt bleiben:

- konfigurierbarer oder weiterhin relativer Pfad zu `fedipol_data.json`
- robuste Fehlermeldung, falls kein Export geladen werden kann
- Anzeige des letzten erfolgreichen Aktualisierungszeitpunkts
- optionaler Hinweis auf teilweise veraltete Einzelwerte

Vor dem Umbau wird der aktuelle Stand mit repräsentativen Daten als visuelle und funktionale Regression-Baseline gesichert.

## Dashboard-Hosting: Variante A - in Cloudron

Das bestehende HTML, CSS und JavaScript wird als statischer Bestandteil in die Cloudron-App aufgenommen. Django liefert die Seiten oder bindet die unveränderten Dateien ein. Der Pfad `fedipol_data.json` wird aus der aktiven Exportgeneration bedient.

### Vorteile

- Ein Deployment und eine Domain
- Kein zusätzlicher GitHub-Publikationspfad
- Kein CORS zwischen Dashboard und Daten
- Atomarer Wechsel von Dashboarddaten und Manifest
- Health- und Freshness-Status liegen am selben Ort
- Spätere Authentifizierung wäre einfach ergänzbar
- Kein GitHub-Token für tägliche Datenupdates notwendig

### Nachteile

- Die öffentliche URL ändert sich, sofern keine Weiterleitung eingerichtet wird.
- Verfügbarkeit des Dashboards hängt direkt von der Cloudron-App ab.
- Statische Auslieferung und Cache-Header müssen in der App sauber konfiguriert werden.
- Ein Cloudron-Release umfasst künftig Web- und Datenbetrieb.

### Technische Ausgestaltung

Die bestehende UI sollte nicht in Django Templates umgeschrieben werden. Sie kann als unveränderlicher statischer Build im Image liegen. Nur die Datenroute ist laufzeitabhängig. Eine kleine Django-View oder eine kontrollierte statische Dateiauslieferung liest die Exportdatei der aktiven Generation.

Der Webprozess öffnet DuckDB nur lesend, falls zusätzliche Betriebsansichten erforderlich sind. Für das bestehende Dashboard reicht der generierte JSON-Export; eine allgemeine REST-API ist nicht nötig.

## Dashboard-Hosting: Variante B - GitHub Pages

Das Dashboard bleibt unter der bekannten GitHub-Pages-URL. Die ETL läuft trotzdem vollständig in Cloudron. Für die Datenbereitstellung gibt es zwei Untervarianten.

### B1: GitHub Pages liest den Cloudron-Export

`js/ui.js` lädt `fedipol_data.json` von einem öffentlichen Cloudron-Endpunkt.

Vorteile:

- Kein täglicher GitHub-Commit
- Keine zeitliche Verzögerung durch ein zweites Deployment
- Dashboarddateien bleiben nahezu unverändert
- Cloudron ist die einzige Datenquelle der Wahrheit

Nachteile:

- CORS und Content Security Policy müssen korrekt konfiguriert werden.
- Das Dashboard funktioniert bei Ausfall der Cloudron-App nicht vollständig.
- Pages und Datendienst sind zwei getrennte Deployments.
- Der öffentliche Cloudron-Endpunkt wird zu einer dauerhaften externen Schnittstelle.

### B2: Cloudron stößt eine GitHub-Pages-Publikation an

Nach erfolgreichem ETL wird ein GitHub-Workflow per `repository_dispatch` oder vergleichbarem Mechanismus ausgelöst. Der Workflow lädt einen eindeutig versionierten Export von Cloudron, validiert ihn und deployt ein Pages-Artefakt.

Vorteile:

- Dashboard und Daten werden weiterhin vollständig statisch ausgeliefert.
- Cloudron-Ausfälle nach erfolgreicher Publikation beeinträchtigen das Dashboard nicht.
- Der vorhandene relative JSON-Pfad kann bestehen bleiben.
- Das Pages-Artefakt kann eindeutig einer `run_id` zugeordnet werden.

Nachteile:

- Zusätzlicher Publikations- und Fehlerpfad
- GitHub-Token oder signierter Abrufmechanismus erforderlich
- Monitoring muss zwischen ETL-Erfolg und Pages-Deployment unterscheiden.
- Daten können in Cloudron erfolgreich, auf Pages aber noch veraltet sein.
- Automatische Git-Commits sollten vermieden werden, da sie täglich Repository-Historie erzeugen würden.

## Vergleich der Hosting-Varianten

| Kriterium | Cloudron integriert | Pages mit Cloudron-Export | Pages mit Publikationsworkflow |
| --- | --- | --- | --- |
| Erhalt der Visualisierung | sehr gut | sehr gut | sehr gut |
| Bekannte öffentliche URL | Weiterleitung nötig | unverändert | unverändert |
| Anzahl Deployments | eins | zwei | zwei |
| CORS erforderlich | nein | ja | nein |
| Dashboard bei Cloudron-Ausfall | nein | Daten ggf. nicht verfügbar | letzter Stand verfügbar |
| GitHub-Zugang aus Cloudron | nein | nein | ja, zumindest für Dispatch |
| Atomare Datenpublikation | einfach | einfach am Endpunkt | über zwei Systeme koordiniert |
| Betriebsaufwand | niedrig | mittel | höher |
| Vollständig statische Auslieferung | nein | Frontend ja | ja |

Beide Hauptvarianten sind tragfähig. Die Entscheidung hängt weniger von der Visualisierung als vom gewünschten Betriebsmodell ab:

- **Cloudron integriert** ist einfacher und Framework-näher.
- **GitHub Pages** bewahrt URL und statische Ausfallsicherheit, benötigt aber eine zusätzliche klare Publikationsgrenze.

Die Entscheidung kann bis nach einem erfolgreichen Parallelbetrieb der ETL offenbleiben, weil beide Varianten denselben JSON-Export verwenden.

## Cloudron-Betrieb

### Persistenz

Alles Persistente liegt unter `/app/data`:

- SQLite-Datenbank
- Raw-Artefakte
- DuckDB-Generationen
- Exportgenerationen
- notwendige Laufmetadaten

Temporäre, jederzeit verwerfbare Scratch-Dateien liegen unter `/tmp`. Der Publikationskandidat für eine atomare Umbenennung bleibt dagegen auf demselben Dateisystem wie die endgültige Generation unter `/app/data`.

### Scheduler

Der tägliche Lauf wird zu einer festen Uhrzeit außerhalb des Cloudron-Backupfensters geplant. Festzulegen sind:

- Zeitzone und Verhalten bei Sommerzeitwechsel
- maximale Gesamtlaufzeit
- Verhalten bei verpasster Ausführung
- manueller Wiederanlauf
- Alarmierung nach Fehlschlag
- Abstand zum nächsten geplanten Lauf

Cloudrons Grace Period für überlappende Scheduler-Jobs darf nicht als reguläres Laufzeitbudget verwendet werden.

### Health und Freshness

Der Health-Endpunkt prüft:

- Django-Prozess antwortet.
- SQLite ist lesbar.
- Die referenzierte aktive Generation existiert.
- Der aktuelle JSON-Export ist lesbar.
- Optional lässt sich die aktive DuckDB-Datei read-only öffnen.

Die Datenaktualität sollte separat gemeldet werden. Ein alter Datenstand ist nicht automatisch ein Grund, den Container neu zu starten. Sinnvolle Statuswerte sind:

- `healthy`
- `healthy_but_stale`
- `degraded_partial_data`
- `unhealthy_missing_generation`

### Logging und Benachrichtigung

Logs gehen ausschließlich nach stdout und stderr und enthalten pro Lauf die `run_id`. Pro Schritt werden Start, Ende, Dauer, Versuch, Mengen und Fehlerkategorie protokolliert. Secrets und vollständige sensible Antworten werden nicht geloggt.

Für einen unbeaufsichtigten Nachtlauf ist eine Benachrichtigung bei folgenden Ereignissen sinnvoll:

- Lauf fehlgeschlagen
- seit mehr als zwei Tagen keine erfolgreiche Generation
- ungewöhnlicher Rückgang der Accountzahl
- hoher Anteil veralteter Accountdaten
- wiederholte Rate Limits oder Instanzausfälle
- fehlgeschlagenes Backup oder Restore-Test

### Backup und Restore

Cloudron-Backups umfassen gemeinsam:

- `db.sqlite3`
- aktive und vorherige DuckDB-Generation
- dazugehörige Exporte
- Raw-Daten gemäß Aufbewahrungsregel

ETL-Publikation und Generationsbereinigung dürfen nicht parallel zum Backup laufen. Restore-Tests prüfen nicht nur, ob Dateien vorhanden sind, sondern ob Dashboard, aktive Generation und SQLite-Zeiger konsistent zusammenarbeiten.

## Sicherheit

Alle externen Antworten gelten als nicht vertrauenswürdig. Dies betrifft insbesondere HTML in Accountnamen oder Profiltexten, ungewöhnlich große Antworten, manipulierte Pagination-Links und fehlerhafte JSON-Strukturen.

Notwendige Maßnahmen:

- Antwortgrößen und Laufzeiten begrenzen
- Content-Type und JSON-Struktur prüfen
- nur `https` und erwartete Hosts/URLs zulassen
- Weiterleitungen begrenzen
- keine externen Werte in Shell-Kommandos interpolieren
- DuckDB-Abfragen parametrisieren
- Ausgabewerte für HTML-Kontexte escapen
- Secrets weder in Git noch in Logs oder Browserdaten ausliefern
- Cloudron-Prozess unprivilegiert ausführen
- direkte Abhängigkeiten und Containerimage regelmäßig prüfen

Da die aktuellen Daten bereits öffentlich auf GitHub Pages liegen, ist eine öffentliche Exportdatei grundsätzlich plausibel. Trotzdem sollte ausdrücklich dokumentiert werden, dass Raw-Antworten möglicherweise mehr Daten enthalten als der kuratierte öffentliche Export und nicht automatisch öffentlich ausgeliefert werden.

## Tests und Abnahmekriterien

Ein einheitlicher Einstieg wie `make check` sollte lokal und in GitHub Actions dieselben Prüfungen ausführen.

### Unit-Tests

- URL- und Domainnormalisierung
- Partei- und Kategorienmapping
- Deduplizierungsprioritäten
- Override-Anwendung
- Bot-Heuristik und manuelle Korrektur
- Berechnung der Aktivitätsgrenze
- Fehlerklassifikation

### Integrationstests

- Wikidata-Fixtures einlesen
- Instanzverzeichnis paginieren
- Account-Lookup und Statuspagination
- `429` mit `Retry-After`
- Netzwerk-Timeout und begrenzte Retries
- Teilfehler mit Last-known-good-Daten
- idempotente Wiederholung desselben Inputs
- atomarer Generationswechsel
- Abbruch vor der Publikationsgrenze
- Recovery eines als `running` zurückgelassenen Laufs
- Fallback bei fehlender aktiver Generation

### Datenvertrags-Tests

- Alle bisherigen Pflichtfelder bleiben vorhanden.
- Datentypen bleiben unverändert.
- Objektschlüssel und Account-URL stimmen überein.
- Ein eingefrorener Referenzexport wird semantisch reproduziert.
- Änderungen an Kategorien, Parteien oder Kennzahlen werden als explizite Differenzen ausgewiesen.

### Browser-Tests

Playwright prüft mindestens:

- Dashboard lädt ohne JavaScript-Fehler.
- Partei-Verteilungsbalken und Timeline werden gerendert.
- Partei- und Suchfilter funktionieren.
- Tabellen lassen sich nach beiden Aktivitätswerten sortieren.
- Links und mobile Navigation funktionieren.
- Aktualitätsstatus wird angezeigt.
- Letzter erfolgreicher Datenstand bleibt nach simuliertem ETL-Fehler sichtbar.

### Container-Tests

- Image lässt sich reproduzierbar bauen.
- App startet mit leerem `/app/data`.
- Health-Endpunkt funktioniert.
- Scheduler-Command kann mit Fixtures laufen.
- Prozess verarbeitet `SIGTERM` sauber.
- Django `check --deploy` ist erfolgreich.

## Stufenweise Roadmap

### Phase 0: Vertrag und Baseline sichern

- Upstream-Repository lokal vollständig verfügbar machen.
- Aktuellen Dashboardstand und Beispieldaten fixieren.
- Datenvertrag von `fedipol_data.json` als JSON Schema beschreiben.
- Browser-Smoke-Test für die vorhandene Visualisierung erstellen.
- Aktuelle Kennzahlen und sichtbare Screenshots als Regression-Baseline sichern.
- Profilwechsel und Hostingoptionen in einem ersten ADR dokumentieren.

Ergebnis: Das bestehende Verhalten ist messbar geschützt, bevor ETL-Code ersetzt wird.

### Phase 1: Serverseitige Extractoren

- Python-Projekt mit `uv` und Django-Grundstruktur anlegen.
- Wikidata-Abfragen aus JavaScript in versionierte Query-Dateien überführen.
- Instanzlisten in validierte Konfiguration verschieben.
- Raw-Speicherung und Provenienz implementieren.
- Timeouts, Retries und instanzbezogene Parallelität ergänzen.
- Kleine repräsentative HTTP-Fixtures aufbauen.

Ergebnis: Quellen können ohne Browser reproduzierbar abgerufen werden.

### Phase 2: DuckDB und fachliche Transformationen

- DuckDB-Schema für Staging, Beobachtungen und Marts erstellen.
- URL-Normalisierung, Zusammenführung und Deduplizierung implementieren.
- Override-Datei samt Schema und Tests einführen.
- Aktuelle Bot- und Parteiregeln zunächst kompatibel nachbilden.
- Kompatiblen `fedipol_data.json`-Export erzeugen.
- Alten und neuen Export automatisiert vergleichen.

Ergebnis: Die neue Pipeline erzeugt bei denselben Eingaben einen dashboardkompatiblen Datenstand.

### Phase 3: Robuster Lauf und Veröffentlichung

- SQLite-Laufmodell implementieren.
- Interprozess-Lock und SIGTERM-Behandlung ergänzen.
- Checkpoints und Last-known-good-Logik einführen.
- Qualitätsgrenzen definieren.
- Immutable DuckDB- und Exportgenerationen publizieren.
- Startup- und Restore-Recovery implementieren.

Ergebnis: Fehlerhafte oder abgebrochene Läufe gefährden den veröffentlichten Datenstand nicht.

### Phase 4: Cloudron-Paketierung

- `CloudronManifest.json`, Dockerfile und Startskript erstellen.
- `localstorage` und SQLite-Pfade korrekt deklarieren.
- Prozess unprivilegiert starten.
- Health- und Freshness-Endpunkte bereitstellen.
- Scheduler-Command im Cloudron-Manifest konfigurieren.
- Speicher-, CPU-, Laufzeit- und Plattenbudgets dokumentieren.
- Backup und Restore in einer isolierten Instanz testen.

Ergebnis: Die ETL läuft täglich unbeaufsichtigt auf Cloudron.

### Phase 5: Shadow-Betrieb

- Alte manuelle Pipeline vorübergehend weiter verfügbar halten.
- Neue Pipeline mehrere Nachtläufe lang parallel betreiben.
- Accountmengen, Parteien, Kategorien, Aktivität und Botstatus vergleichen.
- Unterschiede klassifizieren: Bug, bewusste Verbesserung oder Quelländerung.
- Schwellenwerte anhand realer Ausfälle nachjustieren.

Ergebnis: Die neue Pipeline ist mit realem Instanzverhalten validiert.

### Phase 6: Dashboard-Hosting entscheiden

- Cloudron-integrierte Variante prototypisch ausliefern.
- GitHub-Pages-Variante mit öffentlichem Export oder Publikationsworkflow testen.
- Verfügbarkeit, Cacheverhalten, CORS, Secrets und Rollback bewerten.
- Entscheidung in einem ADR festhalten.
- Gewählte Variante mit einem End-to-End-Smoke-Test absichern.

Ergebnis: Das Dashboard bleibt visuell erhalten und bezieht ausschließlich automatisiert veröffentlichte Daten.

### Phase 7: Manuelle Pipeline abschalten

- `wikidata.html` und `enhancement.html` als historische Werkzeuge kennzeichnen oder entfernen.
- Browserdownloads aus der Betriebsdokumentation streichen.
- Overrides und fachliche Änderungsprozesse dokumentieren.
- Alarmierung und Verantwortlichkeiten für fehlgeschlagene Nachtläufe festlegen.
- Nach erfolgreicher Betriebsphase alte Datenpfade bereinigen.

Ergebnis: Der Regelbetrieb benötigt keine manuellen Durchläufe mehr.

## Offene Entscheidungen

Vor oder während der Umsetzung sind folgende Punkte festzulegen:

1. Zu welcher Uhrzeit und in welcher Zeitzone läuft der Job?
2. Wann findet das Cloudron-Backup statt?
3. Wie lange darf ein vollständiger Lauf maximal dauern?
4. Bleibt die 120-Post-Grenze zunächst bewusst kompatibel?
5. Wie hoch darf der Anteil veralteter Accountwerte bei einer Veröffentlichung sein?
6. Nach wie vielen aufeinanderfolgenden Fehlern gilt ein Account als vermutlich gelöscht?
7. Wie lange werden Raw-Antworten und tägliche Generationen aufbewahrt?
8. Welcher Benachrichtigungsweg wird für fehlgeschlagene Läufe verwendet?
9. Soll das Dashboard später in Cloudron liegen oder dauerhaft auf GitHub Pages bleiben?
10. Falls GitHub Pages bleibt: direkter Cloudron-Abruf oder separater Publikationsworkflow?
11. Welche Quelle ist fachlich führend: Wikidata, fedipolitik, Instanzverzeichnisse oder eine definierte Kombination?
12. Wer darf Overrides ändern und wie werden diese fachlich geprüft?

## Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
| --- | --- |
| Instanzen sind nachts nicht erreichbar | begrenzte Retries, Checkpoints, Last-known-good |
| Wikidata-Query läuft in ein Timeout | Queries aufteilen, Raw-Cache, Retry mit Backoff |
| Neue Regeln verändern viele Kategorien | Contract-Diff und Freigabeschwelle |
| Bot-Heuristik erzeugt False Positives | offizielles Flag priorisieren, versionierte Overrides |
| DuckDB wird parallel beschrieben | genau ein Writer, immutable Generationen |
| ETL überschreibt den letzten guten Stand | Publikation erst nach vollständiger Validierung |
| Cloudron-Backup trifft laufende Publikation | getrennte Zeitfenster und gemeinsamer Lock |
| GitHub Pages bleibt nach ETL-Erfolg veraltet | getrenntes Deployment-Monitoring und Freshness-Manifest |
| Dashboardmigration verändert Visualisierung | bestehende Assets übernehmen, Playwright-Regression |
| Raw-Daten wachsen unbegrenzt | dokumentierte Retention und Größenwarnungen |
| Upstream-Daten enthalten fachliche Fehler | nachvollziehbare Overrides mit Quelle und Begründung |

## Empfehlung für den Einstieg

Die technische Kernentscheidung muss nicht mit der Dashboard-Hostingentscheidung gekoppelt werden. Der kleinste risikoarme Weg ist:

1. Bestehenden JSON-Vertrag einfrieren.
2. Serverseitige ETL als Shadow-Pipeline aufbauen.
3. DuckDB intern verwenden und weiterhin dieselbe JSON-Datei exportieren.
4. Mehrere reale Nachtläufe vergleichen.
5. Erst danach zwischen Cloudron-Auslieferung und GitHub Pages entscheiden.

Damit wird zuerst der schmerzhafte und fehleranfällige Teil beseitigt, ohne gleichzeitig die bereits ausgefeilte Visualisierung umzubauen. Beide Dashboard-Varianten bleiben bis zu einer späteren ADR-Entscheidung offen und verwenden dieselbe geprüfte Exportgrenze.

## Fazit

Fedipol eignet sich sehr gut für eine serverseitige Automatisierung. Die Datenmenge ist klein, die Quellen und fachlichen Regeln sind überschaubar, und das Dashboard ist bereits über eine einzige JSON-Datei von der Aufbereitung getrennt. Die eigentliche Herausforderung liegt nicht in DuckDB oder Cloudron, sondern im zuverlässigen Umgang mit vielen unabhängigen Fediverse-Instanzen und in der nachvollziehbaren fachlichen Kuratierung.

Eine Cloudron Service App mit täglichem Management Command, SQLite für Laufzustand, generationenbasierter DuckDB-Verarbeitung und kompatiblem JSON-Export löst diese Probleme, ohne die Visualisierung neu zu bauen. GitHub Pages kann dabei erhalten bleiben oder später durch eine integrierte Auslieferung ersetzt werden. Diese Entscheidung ist reversibel, solange `fedipol_data.json` als stabile Veröffentlichungsgrenze bestehen bleibt.
