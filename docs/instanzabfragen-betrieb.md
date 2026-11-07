# Betrieb der robusten Instanzabfragen

## Rollout (noch nicht ausgeführt)

1. Cloudron-Backup und normales Deployment nach ausdrücklicher Freigabe.
2. `python manage.py migrate --noinput` ausführen (Cloudron `deploy/start.sh`
   erledigt Migrationen bereits vor dem App-Start). Migration
   `0002_fetch_scheduling_state` ergänzt ausschließlich Betriebsmodelle.
3. Ein begrenzter Testlauf verwendet `--limit` **nach** der Alterspriorisierung.
   Er kann absichtlich an der unveränderten 15-%-Prüfung scheitern: begrenzte
   Aktualisierung ist kein Auftrag zur Veröffentlichung unvollständiger Daten.
4. Danach regulärer Lauf; Fortschritt und Rate-Limits mit `fetch_status` prüfen.
   Keine parallelen Voll-Läufe; der bestehende ETL-Prozesslock bleibt aktiv.

## Grenzen und Einstellungen

`config/sources.yaml` → `collection.instances`:

| Host | Request-Abstand | Laufzeitbudget | Request-Budget |
| --- | ---: | ---: | ---: |
| gruene.social | 5 s | 60 min | 720 |
| social.bund.de | 3 s | 45 min | 900 |
| sonstige Hosts (Default) | 2 s | 30 min | 900 |

Ein Request gleichzeitig je Host; globale Anzahl über
`FEDIPOL_GLOBAL_CONCURRENCY` (Default 6). Die früheren Account-Parameter
`FEDIPOL_PER_INSTANCE_CONCURRENCY` und `FEDIPOL_PER_INSTANCE_MIN_INTERVAL`
steuern den neuen Dispatcher nicht mehr. Das übergreifende Sammelbudget beträgt
mit `FEDIPOL_COLLECTION_RUN_BUDGET_SECONDS` standardmäßig zwei Stunden.
Ein bereits laufender HTTP-Aufruf kann sein Budget noch um seine begrenzte
Connect-/Read-Timeout-Zeit überschreiten. Keine neuen Requests nach Deadline.

Die Abstände gelten für **alle** HTTP-Aufrufe der Instanzen, einschließlich
Verzeichnissen und Post-Seiten. Bei 429 wird die komplette Instanz pausiert;
`Retry-After` und Mastodon-Reset-Header werden respektiert. Fehlerhafte/fehlende
Header führen zu wachsender Wartezeit statt sofortiger Wiederholung.
Nach drei 429 im selben Lauf werden weitere Accounts dieses Hosts zurückgestellt.
Andere Instanzen können weiterarbeiten. Verwaltete API-Redirects werden nicht
automatisch verfolgt; Pagination muss auf demselben Host/API-Pfad bleiben.

## Priorität und Fehler

Unter fälligen Accounts einer Instanz: nie erfolgreich aktualisierte zuerst,
sonst ältestes `last_success_at` zuerst. Ein Fehler setzt diesen Zeitpunkt
**nicht** auf heute. Temporäre Fehler erhalten eine Wiederholungspause; 404/410
und 401/403 mindestens einen Tag. Wiederholte Lookup-404/410 über mindestens
sieben Tage markieren einen Fall zur Prüfung, löschen aber niemals Accounts.
Insbesondere bei instanzweiten 404 ist erst die Instanz zu prüfen; solche
Markierungen sind keine bestätigten Account-Löschungen.

Aktive Overrides und Ausschlüsse greifen vor Planung. Ein früher bekannter
Account bleibt bei unvollständiger Verzeichnisabfrage als Kandidat erhalten.
Die operative Aktiv-Markierung berücksichtigt Ausschlüsse auch für die
Altersdiagnose; historische Beobachtungen werden dabei nicht gelöscht.

## Persistenz und Neustart

- `/app/data/fetch-journal/events.jsonl`: append-only Ereignisse mit Prüfsumme,
  Schema-/Importer-Version, erfolgreichen Beobachtungen und Fehler-Metadaten.
  Schreiben mit `fsync` vor Bestätigung als Erfolg.
- SQLite: `AccountFetchState`, `InstanceFetchState`, `AccountFetchAttempt` und
  `AppliedFetchEvent` sind Betriebsindizes; keine fachlichen Beobachtungs-Payloads.
- HTTP-Worker schreiben nur ins geschützte Journal. Der zentrale Dispatcher
  aktualisiert SQLite. Beim Wiederanlauf werden fehlende Index-Einträge
  idempotent rekonstruiert; eine unvollständige letzte Journalzeile wird entfernt.
- Das Journal liegt außerhalb der bereinigten Raw-/Checkpoint-/Generationsordner.
  Noch kein automatisches Pruning: **nicht manuell löschen**, da neueste gültige
  Beobachtungen auch aus nicht veröffentlichten Läufen stammen können. Sichere
  Komprimierung samt Aufbewahrungsregeln ist ein separater Schritt.
- Alle aktiven Beobachtungen behalten ihren echten Abfragezeitpunkt. Bootstrap
  nutzt Zeiten aus der Vorgängergeneration, niemals den Migrationszeitpunkt.

Erfolge eines nicht veröffentlichten Laufs fließen als Last-known-good in den
nächsten Export ein. Sie werden dabei **nicht** als im neuen Lauf frisch
abgefragt umetikettiert. Das vorherige Dashboard bleibt bei Prüfungsfehlern aktiv.
Die 15-%-Grenze und alle übrigen Veröffentlichungskriterien sind unverändert.
Bei kleinen Laufbudgets kann diese Grenze weiterhin einen Publish verhindern;
eine Umstellung auf Datenalter benötigt eine eigene fachliche Freigabe.

## Diagnose ohne externe API-Anfragen

```sh
python manage.py fetch_status
python manage.py fetch_status --instance gruene.social
python manage.py fetch_status --instance social.bund.de --limit 100
python manage.py fetch_status --run-id 20261107T135829Z
```

Das Kommando zeigt Laufstatus, Ergebnisse, Anfragen, Wiederholungen, Cooldowns,
älteste Accounts und strukturierte Fehler mit HTTP-Status und Phase.
`requests` zählt Account-HTTP-Aufrufe; `instance_requests` berücksichtigt zusätzlich
Verzeichnisabfragen des ausgewählten Laufs. Fehler-Ereignisse können mehr sein
als letztlich fehlgeschlagene Accounts, wenn eine Wiederholung erfolgreich war.

`/health/data` ergänzt `collection` (auch bei fehlender Generation) und die
diagnostische `observation_age`-Verteilung des Exports. `/healthz` bleibt
unveränderte Liveness. `manifest.json` enthält zusätzlich echte Abfragezeiten
pro exportiertem Account in `observed_at`; `fedipol_data.json` bleibt kompatibel.
48-Stunden-/7-Tage-Altersbänder dienen zunächst nur der Beobachtung, nicht als
neue Veröffentlichungsschwellen. Keine Secrets oder Antwortkörper in Fehlerdaten.

## Prüfung

`make check` sowie `python manage.py makemigrations --check --dry-run`.
Tests verwenden Fake-Uhren und Fake-HTTP; keine Live-Lasttests. Abgedeckt sind
Alterspriorität, global faire Freigabe, gemeinsame Request-Budgets, 429/Cooldowns
nach Neustart, abgeschnittene Journale, SQLite-Recovery, unvollständige Antworten,
unveröffentlichte Erfolge und unveränderte Veröffentlichungssperren.
