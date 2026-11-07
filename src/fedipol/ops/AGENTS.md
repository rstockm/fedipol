# Betriebszustand

| Datei | Zweck |
| --- | --- |
| `fetch_diagnostics.py` | Lesende Zusammenfassung von Abfrageversuchen, aktiven Accountaltern und Instanzpausen, unabhängig von erfolgreicher Veröffentlichung. |
| `fetch_index.py` | Rekonstruiert SQLite-Betriebsindex transaktional/idempotent aus Journalereignissen; keine Beobachtungs-Payloads in SQLite. |
| `models.py` | ETL-Läufe/Schritte/aktive Generation sowie Account-/Instanz-Abfragestatus, strukturierte Versuche und angewendete Journalereignisse. |
| `recorder.py` | Django-Fassade zur Pipeline; journalbasierter FetchState mit idempotenter Indexierung im Orchestrierungs-Thread. |
| `views.py` | Statische Assets, Export und Health; health/data ergänzt Collection-Diagnose und Altersbänder, healthz bleibt unverändert. |

Migration `migrations/0002_fetch_scheduling_state.py` ergänzt nur Betriebsmodelle.
`management/commands/fetch_status.py` liefert Diagnose ohne externe Requests.
