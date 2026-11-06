# Frontend-Tests

| Datei | Zweck |
| --- | --- |
| `cumulative-hover.test.cjs` | Prüft Histogramm-Hover mit Vormonatsänderung je Partei und gesamt, ersten Monat, Monate ohne Zuwachs und Parteifilter. |
| `fediwings.test.cjs` | Prüft feste Ziel-URL, Handle-Kodierung, Autostart, HTML-Escaping, ungültige URLs, trailing Aktionsgruppe außerhalb Profiltext, Desktop-/Mobilbeschriftung und Posts-Sortierung unabhängig von Aktionen; beide Frontend-Kopien. |
| `follow.test.cjs` | Prüft beide Frontends: Folgen-/Analyse-Buttons auch für Institutionen, PKCE und State-Schutz, Session-Wiederverwendung, Following-Pagination ohne Fremd-Origin-Token, vorhandene Follows ohne Schreibzugriff, persistierte Anfragebeschriftung, Rückkehransicht erst nach Datenrendering; Such-Mock lehnt Profil-URL als Query ab; lokale/remote Handles, exakte Zuordnung, HTTP-Fehler, 401 und ungültige Antworten. |
| `start-date.test.cjs` | Node-Regressionstests für Datum, Spaltenposition über `.account-party`, chronologische Sortierung und unbekannte Werte; prüft zusätzlich Service-Dashboard, sofern Worktree vorhanden. Aufruf: `node --test tests/*.test.cjs`. |
