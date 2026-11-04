# ETL

| Datei | Zweck |
| --- | --- |
| `normalize.py` | Normalisiert URLs und Fediverse-Handles via `canonical_url`; erhält Benutzernamen, normalisiert Host und IDNA; Partei- und Kategoriezuordnung. Regression: Wikidata-P4033-Handles dürfen nicht zu Instanz-URLs kollabieren. |
