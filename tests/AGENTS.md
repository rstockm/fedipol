# Tests

| Datei | Zweck |
| --- | --- |
| `test_deploy.py` | Prüft Ausführungsrechte beider direkt aufgerufener Cloudron-Einstiegsskripte; verhindert Containerstart mit `permission denied`. |
| `test_fetch_scheduling.py` | Fake-Uhr: Alterspriorität, gemeinsamer HTTP-Limiter für Verzeichnis/Lookup/Seiten, Budgets, Cooldowns/Neustart, Journal-Prüfsummen/-Recovery, SQLite-Idempotenz und unvollständige Beobachtungen. |
| `test_http.py` | Prüft Timeouts, Retries, Header, verwaltete 429-Pausen und blockiertes Redirect-Following; verhindert Pagination-Abbruch bei kleingeschriebenem `link`. |
| `test_mastodon_enricher.py` | Prüft Lookup, Pagination, Bot-Flag und Fehler; ungültige Statusantworten sind kein Erfolg; Fremdhost-Pagination wird vor Abruf verworfen; fester Bezugszeitpunkt. |
| `test_normalize.py` | Prüft URL-, Handle-, IDNA- und Parteinormalisierung; schützt gegen Verlust von Benutzernamen und Kollisionen gleicher Instanzen. |
| `test_pipeline_offline.py` | Prüft Offline-ETL, Veröffentlichung, Overrides/Locks und Wikidata-Handles; gemockter Online-Lauf erhält Erfolge trotz gesperrter Publikation und priorisiert danach andere Accounts. |
| `test_views.py` | Export/Health und neue Collection-Diagnose auch nach gescheiterter Erstveröffentlichung; Dashboard lädt Theme-Skript und Outline-Sprachbutton, UI-/Theme-/I18n-/EN-Skripte liefern JavaScript; keine Live-API-Aufrufe. |
