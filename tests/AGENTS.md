# Frontend-Tests

| Datei | Zweck |
| --- | --- |
| `cumulative-hover.test.cjs` | Prüft Histogramm-Hover mit Vormonatsänderung je Partei und gesamt, ersten Monat, Monate ohne Zuwachs und Parteifilter. |
| `fediwings.test.cjs` | Prüft feste FediWings-Ziel-URL, Handle-Kodierung, ungültige Profil-URLs und sicheren Button nur für Personen-/Parteizeilen; beide Frontend-Kopien. |
| `start-date.test.cjs` | Node-Regressionstests für Datum, Spaltenposition, chronologische Sortierung und unbekannte Werte; prüft zusätzlich Service-Dashboard, sofern Worktree vorhanden. Aufruf: `node --test tests/*.test.cjs`. |
