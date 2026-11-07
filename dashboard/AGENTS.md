# Dashboard

Statische Dashboard-Kopie für Cloudron; mit Frontend auf Branch `main` synchron halten.
Titel und Kopfzeile `Fedipol` mit dekorativem Parlaments-/Statistik-SVG.
DE/EN mit zentralen Katalogen und gespeicherter Sprachwahl; `Germany` nur Englisch
ab 1200 px. Info-Seite betont ausschließlich deutschen Scope; Code und Quelldaten
bleiben unverändert. `de.js`, `en.js`, `i18n.js` laden vor OAuth und UI.
Folgen-Aktionen auch bei Institutionen; Handle-Modal und Statuszeile,
`js/follow.js` lädt vor `js/ui.js`.
Frontend-Stand `main:da44c22`: Auto/Hell/Dunkel mit `js/theme.js` im Head,
DE/EN-Outline-Button mit lokalisiertem Wechselziel, mobiler Header-Umbruch.
Hero ohne zweite Überschriftzeile; nur `Fediverse.` trägt Blau-Violett-Verlauf.
Header-Wortmarke Inter Tight 750, optisch auf gemeinsame 44-px-Controls justiert.
Dashboard und Info laden SVG-/PNG-Favicons, Apple-Touch-Icon und App-Manifest.

| Datei | Zweck |
| --- | --- |
| `index.html` | Dashboard-Einstieg mit frühem Theme-Skript und DE/EN-Outline-Button; einziges H1 im kompakten, lokalisierten Hero unter Fedipol-Marke, lokale Inter Tight via `css/hero.css`; Tabellen mit Startdatum zwischen Partei und Posts beziehungsweise bei Institutionen vor Posts; `account-table` hat trailing Aktionsspalte und mobile Karten, `.posts-header` identifiziert sortierbare Posts-Spalte. |
| `info.html` | Informationsseite mit Theme- und DE/EN-Outline-Button; Code-Flächen und Footer nutzen Theme-Tokens. |
| `site.webmanifest` | Relative App-ID/Start/Scope für Root und Unterpfade, standalone; Android-PNGs 192/512 und maskierbare Variante; identisch mit main. |
