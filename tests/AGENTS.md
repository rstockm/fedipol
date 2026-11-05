# Tests

| Datei | Zweck |
| --- | --- |
| `test_deploy.py` | Prüft Ausführungsrechte beider direkt aufgerufener Cloudron-Einstiegsskripte; verhindert Containerstart mit `permission denied`. |
| `test_http.py` | Prüft Timeouts, Retries, Retry-After und groß-/kleinschreibungsunabhängige Antwortheader; verhindert Pagination-Abbruch nach 40 Posts bei kleingeschriebenem `link`. |
| `test_mastodon_enricher.py` | Prüft Lookup, Pagination, Bot-Flag und Fehler; zeitabhängige Aktivitätsprüfungen verwenden festen Bezugszeitpunkt. |
| `test_normalize.py` | Prüft URL-, Handle-, IDNA- und Parteinormalisierung; schützt gegen Verlust von Benutzernamen und Kollisionen gleicher Instanzen. |
| `test_pipeline_offline.py` | Prüft Offline-ETL, Veröffentlichung, Overrides und Locks; Regression: Wikidata-Handles einschließlich Stella Merendino erreichen Export als getrennte Profil-URLs. |
