# ETL

| Datei | Zweck |
| --- | --- |
| `export.py` | Exportvertrag bleibt unverändert; Manifest ergänzt echte `observed_at`-Zeiten und diagnostische Altersbänder ohne Änderung der Qualitätsschwellen. |
| `fetch_state.py` | Prüfsummen-Journal mit fsync; dauerhafte Erfolge/Fehler und Instanzpausen, last_success-Priorität, Aktiv-Plan und Recovery; SQLite-Persistenz nur im zentralen Thread. |
| `generations.py` | Atomare Generationen; Vorgänger-Beobachtungen und Kandidaten als Fallback für unvollständige Verzeichnisse. |
| `http.py` | HTTP-Client mit Timeouts/Backoff; verwaltete API-Requests teilen Host-Limiter, 429/5xx werden zurückgestellt, Redirects nicht verfolgt; strukturierte Fehler und case-insensitive Header. |
| `normalize.py` | Normalisiert URLs und Fediverse-Handles via `canonical_url`; erhält Benutzernamen, normalisiert Host und IDNA; Partei- und Kategoriezuordnung; `is_bot_note` matcht Bot-Keywords nur als ganze Wörter (Wortgrenzen), um False Positives durch Teilstrings in Hashtags/Handles zu vermeiden (#AfDVerbot, @depressiveRobot). Regression: Wikidata-P4033-Handles dürfen nicht zu Instanz-URLs kollabieren. |
| `pipeline.py` | Lädt Fetch-Zustand und Limits vor Verzeichnissen; filtert Overrides vor Altersplanung, nutzt laufübergreifendes LKG und erhält Qualitätsschwellen; InstancePacer nur noch Legacy-Testhelfer. |
| `rate_limit.py` | Ein Request pro Host, Mindestabstände/Cooldowns und Budgets; Retry-After Sekunden/Datum und Mastodon-Reset; adaptive Drosselung mit persistentem Zustand. |
| `scheduling.py` | Fällige Accounts pro Host nach ältestem Erfolg; nur bereite Hosts belegen Worker; begrenzte Wiederholungen und SIGTERM-Recovery. |
