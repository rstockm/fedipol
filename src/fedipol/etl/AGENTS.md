# ETL

| Datei | Zweck |
| --- | --- |
| `http.py` | HTTP-Client mit Timeouts, Retries und Backoff; `FetchResult.headers` erhält HTTP-konforme, groß-/kleinschreibungsunabhängige Headerzugriffe für Statuspagination. |
| `normalize.py` | Normalisiert URLs und Fediverse-Handles via `canonical_url`; erhält Benutzernamen, normalisiert Host und IDNA; Partei- und Kategoriezuordnung. Regression: Wikidata-P4033-Handles dürfen nicht zu Instanz-URLs kollabieren. |
