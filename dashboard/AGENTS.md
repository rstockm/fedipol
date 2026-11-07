# Dashboard

Statische Dashboard-Kopie für Cloudron; mit Frontend auf Branch `main` synchron halten.
Titel und Kopfzeile `Fedipol` mit dekorativem Parlaments-/Statistik-SVG.
DE/EN mit zentralen Katalogen und gespeicherter Sprachwahl; `Germany` nur Englisch
ab 1200 px. Info-Seite betont ausschließlich deutschen Scope; Code und Quelldaten
bleiben unverändert. `de.js`, `en.js`, `i18n.js` laden vor OAuth und UI.
Folgen-Aktionen auch bei Institutionen; Handle-Modal und Statuszeile,
`js/follow.js` lädt vor `js/ui.js`.

| Datei | Zweck |
| --- | --- |
| `index.html` | Dashboard-Einstieg und Tabellen; Startdatum steht zwischen Partei und Posts beziehungsweise bei Institutionen vor Posts; `account-table` hat trailing Aktionsspalte und mobile Karten, `.posts-header` identifiziert sortierbare Posts-Spalte. |
