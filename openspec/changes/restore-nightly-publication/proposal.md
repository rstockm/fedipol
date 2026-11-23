## Why

Seit dem 7. November bleibt der veröffentlichte Export stehen: Das Budget für `gruene.social` reicht nicht für die Aktualisierung; `respublicae.eu` bietet keine Mastodon-API mehr. Ein Lauf scheiterte zudem an abgeschnittenem Wikidata-JSON.

## What Changes

- Zeit- und Request-Budget für `gruene.social` erhöhen, ohne das Request-Tempo zu erhöhen.
- `respublicae.eu` bewusst von Planung und Export ausschließen; historische Daten behalten.
- Ungültige SPARQL-Antworten begrenzt wiederholen; nur gültige Antworten als Raw-Artefakte speichern.
- Cloudron mit Backup aktualisieren, einen manuellen Volllauf starten und die Publikation prüfen.

## Capabilities

### New Capabilities
- `nightly-collection-recovery`: Budget, stillgelegte Quelle und Wiederholung fehlerhafter SPARQL-Antworten.

### Modified Capabilities

## Impact

Längere Läufe und mehr Requests pro Lauf, aber keine erhöhte Rate. Der Export verliert absichtlich Accounts der stillgelegten Instanz. Keine Migration, kein Eingriff in historische Generationen und keine Änderung des Exportvertrags oder Qualitätstors.
