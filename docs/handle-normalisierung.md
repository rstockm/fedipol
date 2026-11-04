# Korrektur der Wikidata-Handle-Normalisierung

## Anlass und Ziel

Stella Merendino (`Q131817189`, `socialist_stella@mastodon.social`) fehlt im
Dashboard, obwohl der Wikidata-Rohimport vom 4. November 2026 sie enthält.
`canonical_url` behandelt den Benutzernamen als URL-Userinfo und erzeugt nur
`https://mastodon.social`. Unterschiedliche Accounts kollidieren dadurch schon
bei der Kandidatenbildung; ohne Profilpfad scheitert anschließend die Anreicherung.

## Änderung und Abnahme

- Handles `user@host` und `@user@host` werden vor dem URL-Parsing in
  `https://host/@user` umgewandelt. Host-/IDNA-Normalisierung bleibt erhalten;
  Benutzernamen bleiben unverändert. Fehlerhafte Handles werden abgelehnt.
- Regressionstests prüfen beide Schreibweisen, getrennte Accounts derselben
  Instanz, Großschreibung, IDNA, Port und den Offline-Export mit Stella.
- Zwei bestehende Aktivitätstests erhalten einen festen Bezugszeitpunkt statt
  des Tagesdatums, damit September-Fixtures nicht aus dem 60-Tage-Fenster fallen.
- `make check`: 77 Tests bestanden, ein optionaler Browser-Test übersprungen;
  Ruff und `git diff --check` erfolgreich.
- `manage.py check --deploy`: bestehende Warnungen W003 (CSRF-Middleware) und
  W008 (HTTPS-Redirect); keine Änderung dieser unabhängigen Einstellungen.

## Rollout und Rückfall

Basis ist Branch `service-app`, Commit `daee609`. Die Korrektur wird zusammen mit
der sortierbaren Frontend-Spalte Startdatum und der Vormonatsänderung im
Histogramm-Hover auf GitHub veröffentlicht. Der bestehende Cloudron-Code wurde vor der Änderung mit
dem Branch verglichen: Anwendungscode, Konfiguration, Deploymentskripte und
Dashboard stimmen überein.

Rollout: reguläres `cloudron update --app fedipol.wolkenbar.de` mit automatischem
Backup, danach Healthcheck und vollständiger manueller ETL als App-Benutzer.
Keine Schemaänderung und keine direkte Bearbeitung bestehender Generationen.
Die Pipeline veröffentlicht nur nach bestehenden Qualitätsprüfungen atomar;
bei ETL-Fehlern bleibt die vorherige Generation aktiv. Bei Releasefehlern steht
das Cloudron-Backup für die Wiederherstellung des vorherigen Images bereit.

Erfolgsnachweis: aktive neue Generation und Stella als eigener Eintrag unter
`https://mastodon.social/@socialist_stella` im öffentlichen Export.

### Beim Rollout entdeckter Paketierungsfehler

Der erste Server-Build erstellt erfolgreich ein Backup, kann den Container aber
nicht starten: `deploy/start.sh` besitzt im Branch nur Modus `0644`.
`deploy/start.sh` und `deploy/etl-job.sh` erhalten deshalb Ausführungsrechte
(`0755`), damit Docker-CMD und Scheduler auch aus einem frischen Checkout laufen.
Diese Änderung betrifft nur Dateimodi; keine Änderung von Skriptinhalten oder Daten.
Zwei zusätzliche Paketierungstests sichern die Ausführungsrechte ab.

### Stand nach erneutem Deployment

Am 4. November 2026 meldet Cloudron nach erneutem Backup und Server-Build
`App is updated`. `/healthz` und `/health/data` liefern HTTP 200.
Die produktive `canonical_url`-Funktion liefert für Stellas Wikidata-Handle
nachweislich `https://mastodon.social/@socialist_stella`.
Ein vollständiger ETL wurde mit `--trigger manual` als Benutzer `fedipol`
gestartet. Die Export-Verifikation erfolgt nach erfolgreicher Publikation.

### Verifiziertes Ergebnis

Generation `20261104T112206Z` wurde am 4. November 2026 um 11:47:31 UTC
veröffentlicht (Laufzeit etwa 25 Minuten). Der öffentliche Export enthält
1.458 Accounts: 1.315 frisch und 143 mit älteren Beobachtungen; 109 Kandidaten
haben keine Beobachtung. DNS-Fehler einzelner Instanzen und HTTP 429 auf
`gruene.social` traten auf; die vorhandenen Qualitätsprüfungen bestanden.
`/health/data` meldet die neue Generation als gesund.

Stella Merendino ist im öffentlich ausgelieferten `fedipol_data.json` unter
`https://mastodon.social/@socialist_stella` mit Kategorie
`Mitglied des Deutschen Bundestages (Linke)`, fünf Beiträgen und `is_bot: false`
enthalten. Damit ist die Kette Wikidata → Normalisierung → Anreicherung →
öffentlicher Dashboard-Export für diesen Account erfolgreich geprüft.
