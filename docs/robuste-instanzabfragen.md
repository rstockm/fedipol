# Konzept: robuste und faire Instanzabfragen

Status: Kernverfahren implementiert und offline getestet; noch nicht deployt.
Betrifft die aktive Middleware in `service-app/`, nicht den historischen
Snapshot `middleware/`. Betriebshinweise: `instanzabfragen-betrieb.md`.

Implementiert: Alterspriorität, fairer Dispatcher, Request-Limiter inklusive
Verzeichnissen/Pagination, persistente Cooldowns, Beobachtungsjournal mit
Recovery, SQLite-Fehlerindex, Diagnosekommando und zusätzliche Health-Metadaten.
Nicht automatisch aktiviert: neue altersbasierte Veröffentlichungsschwellen,
redaktioneller Sonder-Publish, automatische Löschung von 404-Accounts und
Journal-Komprimierung/Pruning. Die folgenden Zielvorgaben kennzeichnen diese
optionalen Weiterentwicklungen; sie sind keine Behauptung eines Live-Rollouts.

## 1. Ziel und Befund

Insbesondere `gruene.social` und `social.bund.de` sollen schonend abgefragt
werden. Innerhalb jeder Instanz kommen die am längsten nicht erfolgreich
aktualisierten Accounts zuerst. Erfolge müssen auch dann erhalten bleiben,
wenn ein Lauf abbricht oder sein Dashboard-Export nicht veröffentlicht wird.

Derzeit begrenzt `pipeline.py::_enrich_accounts` die Parallelität pro Instanz
auf zwei Accounts und reserviert einen zeitlichen Slot vor `enricher.enrich`.
Das ist kein Request-Limit: Ein Account verursacht Lookup, mehrere Statusseiten
und gegebenenfalls Wiederholungen. Diese HTTP-Aufrufe teilen keinen zentralen
Request-Pacer. Alle Accounts werden sofort in einen gemeinsamen Executor
eingereiht; auf Instanz-Semaphoren wartende Aufgaben können globale Worker
belegen. Bei HTTP 429 wartet nur die einzelne Anfrage, nicht die ganze Instanz.

Checkpoints speichern bisher nur Erfolge je Lauf. Fehler gehen nicht dauerhaft
in einen Account-Verlauf ein. Last-known-good-Daten kommen aus der letzten
veröffentlichten Generation. Damit kann ein nicht veröffentlichter Lauf beim
nächsten Lauf unnötige Wiederholungen und dieselben Benachteiligungen verursachen.

## 2. Architektur

```text
Quellen / Overrides
        ↓
Fällige Accounts → eigene Prioritätsqueue je Instanz
        ↓
Fairer Dispatcher zwischen bereiten Instanzen
        ↓
Gemeinsamer HTTP-Limiter je Zielhost
  ├─ Lookup
  ├─ sämtliche Statusseiten
  ├─ Wiederholungen
  └─ API-Aufrufe der Instanzverzeichnisse
        ↓
Validierte Beobachtungen + dauerhafte Versuchsergebnisse
        ↓
Staging → Marts → Prüfungen → atomare Veröffentlichung
```

Kein zusätzlicher Dienst, kein Redis/Celery erforderlich. Ein Management Command
bleibt über den bestehenden Interprozess-Lock alleiniger ETL-Schreiber.
HTTP-Worker liefern Ergebnisse an einen zentralen Persistenz-/Scheduling-Thread.
SQLite speichert Betriebszustand; fachliche Beobachtungen bleiben in
Dateiartefakten und DuckDB. Dashboard-Generationen bleiben unveränderlich.

## 3. Dauerhafter Zustand

### AccountFetchState (SQLite, Django-Migration)

Pro kanonischer Account-URL:

- `instance`, `first_seen_at`;
- `last_attempt_at`, `last_success_at`;
- `next_attempt_at`, `consecutive_failures`, `last_error_category`;
- `last_observation_ref` als Verweis auf eine dauerhaft gespeicherte Beobachtung;
- operativer Zustand: aktiv, vorübergehend zurückgestellt, Prüfung erforderlich.

`last_success_at` bezeichnet die letzte **vollständige und validierte
Account-Anreicherung**, nicht einen erfolgreichen Lookup, einen Versuch oder
den Veröffentlichungszeitpunkt. Ein fehlgeschlagener Versuch verändert diesen
Zeitpunkt niemals. Profil- und Post-Abfragen müssen getrennt diagnostizierbar
sein; ein Profil-Erfolg mit fehlgeschlagener Post-Seite zählt nicht als voller
Erfolg. Die absichtliche, dokumentierte Begrenzung der Seitenzahl ist dagegen
ein gültiges, mit `capped` markiertes Ergebnis.

### InstanceFetchState (SQLite)

Pro normalisiertem Zielhost: `next_request_at`, `cooldown_until`, aktueller
Request-Abstand, letzte brauchbare Rate-Limit-Header und Zähler aufeinanderfolgender
429/5xx/Netzwerkfehler. Instanzweite Sperrzeiten überleben Neustarts.

### AccountFetchAttempt (SQLite)

Je Account-Versuch: Lauf-ID, Start/Ende, Ergebnis, Phase (`lookup`/`statuses`),
HTTP-Status, Fehlerklasse, Request-/Retry-Anzahl und Beobachtungsverweis.
Keine Tokens, Cookies, vollständigen HTTP-Header oder Profiltexte im Fehlerlog.
Strukturierte Logs ergänzen die Tabelle, ersetzen sie aber nicht.

## 4. Reihenfolge: älteste erfolgreiche Aktualisierung zuerst

Vor jedem Lauf werden Overrides und Ausschlüsse angewendet. Eine Queue enthält
nur Accounts, deren `next_attempt_at` erreicht ist. Instanz-Cooldowns sind eine
zusätzliche Voraussetzung für die Freigabe.

Sortierung innerhalb einer Instanz:

1. Noch nie erfolgreich abgefragte Accounts zuerst; untereinander `first_seen_at`
   aufsteigend, damit ständig neue Accounts ältere unbekannte nicht verdrängen.
2. Sonst `last_success_at` aufsteigend: älteste Aktualisierung zuerst.
3. Bei Gleichstand `last_attempt_at` (nie versucht zuerst), dann kanonische URL.

Ein endlos fehlschlagender Account bleibt zwar fachlich alt, wird durch
`next_attempt_at` aber zeitweise aus der fälligen Queue genommen. So blockieren
404-Profile nicht täglich dieselben vorderen Plätze. Ein frisch erfolgreicher
Account rückt hinter die weiterhin alten Accounts. Nie ein alphabetischer oder
zufälliger Neustart der Abfragereihenfolge.

Der Dispatcher nimmt nur Arbeit für freigegebene Instanzen an, statt den
Executor mit sämtlichen Accounts zu füllen. Er bedient bereite Instanzen reihum;
innerhalb jeder Instanz bleibt die obige Alterspriorität bestehen. Wartende
Instanzen belegen keine globalen Worker. Beim Wiederanlauf werden noch offene
Leases freigegeben und Queues aus dem dauerhaften Zustand neu aufgebaut.

## 5. Drosselung auf HTTP-Ebene

Jeder tatsächliche Request muss vor dem Senden denselben hostbezogenen Limiter
passieren. Das gilt auch für Pagination, Retries und Verzeichnisabfragen.
Redirects dürfen den Limiter des Zielhosts nicht umgehen; Pagination wird nur
für erlaubte API-Ziele akzeptiert. SSRF-/URL-Prüfungen bleiben erforderlich.

Konservative **Startwerte**, nach Messung anzupassen, keine behaupteten Serverlimits:

| Instanz | Gleichzeitige HTTP-Requests | Mindestabstand | Instanz-Zeitbudget pro Lauf |
| --- | ---: | ---: | ---: |
| gruene.social | 1 | 5 Sekunden | zunächst 60 Minuten |
| social.bund.de | 1 | 3 Sekunden | zunächst 45 Minuten |
| Andere | 1 | 2 Sekunden | zunächst 30 Minuten |

Keine Bursts: höchstens ein sofort freier Slot pro Instanz. Global zunächst sechs
gleichzeitige Requests; die strengere hostbezogene Grenze gilt zusätzlich.
Ein Account kann mehrere Request-Slots brauchen. Budgets zählen HTTP-Requests
einschließlich Wiederholungen, nicht bloß Accounts. Deadline, Request-Budget und
Job-Gesamtbudget begrenzen die Laufzeit; unbediente Accounts werden zurückgestellt,
nicht als technisch fehlgeschlagen behandelt. Kein unbegrenzter nächtlicher Lauf.

Beispiel: 1.000 Requests benötigen bei fünf Sekunden Abstand bereits ungefähr
83 Minuten, bei drei Sekunden ungefähr 50 Minuten, jeweils ohne Zusatzwartezeit.
Eine vollständige Aktualisierung aller Accounts pro Nacht ist deshalb kein
realistisches Versprechen. Mit gemessenen Request-Mengen wird das erreichbare
Aktualisierungsintervall bestimmt. Bleibt die Queue dauerhaft überaltert,
braucht es mehr Laufzeit/weitere zeitlich getrennte Läufe oder weniger Requests,
nicht ein höheres Abfragetempo gegen das Instanzlimit.

## 6. Reaktion auf Limits und Fehler

### HTTP 429

- Sofort **alle neuen Requests an diese Instanz** aussetzen, nicht nur diesen
  Worker. Bereits laufende Requests dürfen enden.
- `Retry-After` sowohl als Sekundenwert als auch HTTP-Datum verstehen.
  Unterstützte Mastodon-Rate-Limit-Header für Restbudget/Reset berücksichtigen;
  konservativ den spätesten verlässlichen Freigabezeitpunkt verwenden.
- Ohne brauchbare Serverangabe: erster Cooldown 60 Sekunden, danach exponentiell
  länger, bis 30 Minuten für selbst berechnete Wartezeiten. Eine längere
  Servervorgabe wird niemals auf diese 30 Minuten gekürzt. Positiver Jitter.
- Request-Abstand erhöhen, z. B. verdoppeln. Erst nach längerer störungsfreier
  Phase langsam reduzieren, niemals unter den konfigurierten Mindestabstand.
- Account mit unverändertem Alter zurückstellen. Nach mehreren 429 im Lauf
  Instanz für den Rest des Laufbudgets öffnen lassen (Circuit Breaker), andere
  Instanzen weiter bedienen. Kein sofortiger Retry-Sturm.

### Weitere Fehler

| Fehler | Behandlung |
| --- | --- |
| Timeout, Verbindung, 502/503/504 | Begrenzte Wiederholungen mit Backoff; bei mehreren betroffenen Accounts instanzweite Pause |
| Ungültiges JSON / unerwartetes Schema | Kein Erfolg; Fehler mit Phase speichern, kontrolliert zurückstellen |
| Lookup 404/410 | Nicht sofort löschen: später bestätigen; nach z. B. drei Lookup-Fehlern über mindestens sieben Tage in redaktionelle Prüfung geben |
| Status-Seite 404 | Nicht als verschwundener Account interpretieren; Pagination-/Account-ID-Problem separat prüfen |
| 401/403 | Berechtigungs-/Instanzproblem; keine engen Wiederholungsschleifen |

Wenn auch die Instanz-API nicht erreichbar ist oder viele Profile gleichzeitig
404 liefern, zuerst Instanzstörung vermuten und Einzelkonten nicht massenhaft
als gelöscht klassifizieren. Ein späterer Erfolg setzt Fehlerzähler zurück.
Zurückgestellte Accounts behalten ihre letzten gültigen Daten mit echtem Alter.

## 7. Fortschritt unabhängig von der Veröffentlichung sichern

Validierte Anreicherungen werden während des Laufs append-only mit URL,
Beobachtungszeit, Daten, Schema-/Importer-Version und Prüfsumme gespeichert.
Der zentrale Schreiber bestätigt erst nach dauerhaftem Schreiben einen Erfolg
und aktualisiert dann `last_success_at` und den Beobachtungsverweis in SQLite.
Ein Neustart verwirft eine unvollständige letzte Zeile und rekonstruiert fehlende
SQLite-Einträge idempotent aus gültigen Datensätzen; kein Verweis darf auf ein
noch nicht dauerhaft gespeichertes Ergebnis zeigen.

Beim nächsten Lauf und beim Export gilt pro Account die neueste kompatible,
vollständige Beobachtung – auch aus einem Lauf, dessen Gesamtveröffentlichung
gescheitert ist. Ein kaputtes Export-Artefakt wird dadurch nicht übernommen.
Importer-/Schema-Inkompatibilitäten erfordern Neuabfrage statt stiller Mischung.
Aufbewahrung referenzierter Beobachtungen ist unabhängig von der Löschung alter
Run-Logs; Live-Verweise dürfen nicht ins Leere bereinigt werden.

## 8. Datenalter und Veröffentlichung transparent machen

Bei einem budgetierten Verfahren ist „nicht in diesem Lauf abgefragt“ kein
geeignetes Qualitätskriterium mehr. Deshalb drei getrennte Kennzahlen:

- technisch fehlgeschlagene Versuche / tatsächlich versuchte Accounts;
- absichtlich zurückgestellte Accounts und Grund (Budget, Cooldown, noch nicht fällig);
- wirklich alte Beobachtungen / exportierte Accounts, anhand `observed_at`.

Vorschlag zur fachlichen Entscheidung: bis 48 Stunden aktuell, zwei bis sieben
Tage verzögert, darüber überaltert. Diese Werte sind **noch festzulegen** und
werden nicht mit diesem Konzept produktiv aktiviert. Bei Postzahlen für ein
rollierendes 60-Tage-Fenster ist das Beobachtungsdatum zwingend sichtbar; ein
alter Zähler darf nicht als heute neu berechnet ausgegeben werden.

Die bestehende 15-%-Regel wird weder stillschweigend erhöht noch entfernt.
Eine Umstellung auf altersbasierte Grenzwerte braucht eine ausdrückliche
Entscheidung, Tests und eine Übergangsmessung. Zusätzlich Instanz-Abdeckung,
ältesten Account und Altersverteilung berichten, damit eine einzelne große
Instanz nicht im Gesamtmittel verschwindet. Harte Struktur-/Konsistenzprüfungen
und atomare Veröffentlichung bleiben bestehen.

Optionaler separater Veröffentlichungsweg für rein redaktionelle Korrekturen:
auf Basis der letzten gültigen Beobachtungen eine neue Generation mit aktuellen
Overrides erzeugen und regulär validieren. So kann ein Ausschluss veröffentlicht
werden, ohne alle APIs neu abzufragen. Beobachtungsalter bleibt unverändert;
`published_at` darf niemals zu `observed_at` umgedeutet werden. Dieser Weg umgeht
keine Datenprüfung und braucht ebenfalls eine explizite Implementierung/Freigabe.

## 9. Diagnose und Betriebsanzeige

Pro Lauf/Instanz ausgeben: fällige/versuchte/erfolgreiche/zurückgestellte Accounts,
Requests, 429, 404, Timeouts, Retry-Anzahl, Cooldown, Zeitbudget, älteste
Beobachtung sowie Altersverteilung. Für jeden fehlgeschlagenen Account muss die
Ursache samt Phase und Zeit abrufbar sein. Betriebsdaten z. B. 30 Tage halten;
referenzierte erfolgreiche Beobachtungen davon unabhängig aufbewahren.

`/healthz` bleibt Prozess-/Datenbank-Liveness. Datenalter, erschöpfte Budgets,
Instanzsperren und fehlgeschlagene Veröffentlichungen gehören in `/health/data`
und Betriebsanzeige, nicht in pauschale Container-Neustarts. Uhrzeiten mit
expliziter Zeitzone dokumentieren; persistiert UTC, laufende Abstände mit
monotoner Uhr berechnen. Beim Start Deadline/Cooldown gegen UTC rekonstruieren.

## 10. Umsetzung und Abnahme

1. **Messbarkeit und Zustand:** Django-Modelle/Migrationen, dauerhafte Fehler,
   Beobachtungsablage, Wiederanlauf. Initialisierung von `last_success_at` aus
   vorhandenen Beobachtungszeitpunkten, nicht aus dem Migrationszeitpunkt.
2. **HTTP-Limiter:** alle Request-Pfade einschließlich Pagination/Retry anbinden;
   hostweite Cooldowns und zurückhaltende Startparameter.
3. **Prioritätsdispatcher:** fällige Accounts nach letztem Erfolg; Budgets und
   faire Freigabe zwischen Instanzen; kein belegter Worker für gesperrte Hosts.
4. **Export und Altersmessung:** neueste gültige Beobachtungen laufübergreifend
   nutzen; bisherige und vorgeschlagene Qualitätsmetriken zunächst parallel
   messen. Keine Änderung der Veröffentlichungsgrenzen ohne Freigabe.
5. **Kontrollierter Cloudron-Pilot:** kleine begrenzte Teilmenge, danach regulärer
   Lauf für gruene.social/social.bund.de. Anhand 429-Quote, Durchsatz und maximalem
   Datenalter nachjustieren; keine belastenden Live-Lasttests.

Pflichttests mit Fake-Uhr und gemocktem HTTP:

- Alte/neue/nie erfolgreiche Accounts: deterministische Reihenfolge je Instanz;
  Fehler ändern `last_success_at` nicht; erneuter Lauf beginnt beim Rückstand.
- 429 auf Lookup oder Post-Seite sperrt alle Request-Arten desselben Hosts;
  Sekunden-/Datums-Header, Reset, kaputte Header und Neustart-Cooldown abdecken.
- Pagination und Wiederholungen zählen gegen dasselbe Request-/Zeitbudget;
  unterbrochene Post-Abfrage überschreibt keine vollständige Beobachtung.
- Gesperrtes gruene.social blockiert weder social.bund.de noch andere Instanzen.
- Erfolgreiche Accounts eines nicht veröffentlichten Laufs bleiben nutzbar und
  werden nicht erneut vor den älteren Accounts bevorzugt.
- Crash zwischen Dateischreiben und SQLite-Commit wird korrekt rekonstruiert;
  unvollständige Datensätze, doppelte Ergebnisse und fehlende Referenzen testen.
- 404-Einzelprofil, instanzweite 404-Störung und späterer Erfolg unterscheiden.
- Overrides greifen vor Planung; Export erhält tatsächliche Beobachtungszeiten;
  Veröffentlichung bleibt atomar und Qualitätsgrenzen werden nicht umgangen.

Abnahmeziel: keine dauerhafte Benachteiligung derselben Accounts durch die
Reihenfolge; nachvollziehbarer Fortschritt über mehrere Läufe; jeder endgültige
Fehler dauerhaft erklärbar. Keine Erfolgsgarantie gegen dauerhaft unerreichbare
Instanzen – stattdessen sichtbarer, kontrollierter Rückstand.
