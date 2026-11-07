# Dashboard-JavaScript

| Datei | Zweck |
| --- | --- |
| `de.js` | Synchron mit main; deutscher Quelltextkatalog und explizite Deutschland-Scope-Texte. |
| `en.js` | Synchron mit main; englische Dashboard-/Info-/OAuth-Texte und Platzhalter. |
| `i18n.js` | Synchron mit main; FediWings-Sprachpolitik via localStorage/Browsersprache/DE-Fallback, DOM-Adapter für Text/Attribute und nachgerenderte Meldungen; keine Übersetzung von Code, URLs oder Quelldaten. |
| `follow.js` | Synchron mit `main:js/follow.js`; OAuth/PKCE, State-/Handle-/Ziel-/Rückkehrbindung; Account-Suche erhält Handle statt Profil-URL, prüft exakte Zuordnung und unterscheidet HTTP-Fehler; Following-Liste liest bestehende Follows mit vorhandenen Scopes; Buttons `Folge ich`/`Angefragt`, tabweite Anfragezustände; Same-Origin-Pagination, 401 und `dashboardReady`-Rückkehrkoordination. |
| `ui.js` | Synchron mit `main:js/ui.js`; DE/EN-Datumswerte/Diagramme bei Sprachwechsel ohne Ansichtsverlust; chronologische Datumssortierung, Histogramm-Vormonatszuwachs; FediWings-/Folgen-Aktionen für Personen und Institutionen; Rückkehransicht über OAuth; `dashboardReady` nach Datenrendering; mobile Karten; `.posts-header` identifiziert Sortierspalte. |
