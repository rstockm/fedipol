# Deployment

| Datei | Zweck |
| --- | --- |
| `etl-job.sh` | Startet geplanten ETL als Management Command; benötigt versioniertes Ausführungsrecht für Cloudron-Scheduler. |
| `start.sh` | Initialisiert Persistenz und startet Gunicorn als App-Benutzer; benötigt versioniertes Ausführungsrecht für Docker-CMD. |
