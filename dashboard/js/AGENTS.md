# Dashboard-JavaScript

| Datei | Zweck |
| --- | --- |
| `de.js` | Synchron mit main; deutscher Quelltextkatalog, lokalisierter `hero.*` und explizite Deutschland-Scope-Texte. |
| `en.js` | Englische Dashboard-/Info-/OAuth-Texte, `hero.*` mit deutschem Scope, Theme-Labels und Sprachbutton-Zustand/Wechselziel sowie Platzhalter. |
| `i18n.js` | Synchron mit main; FediWings-Sprachpolitik via localStorage/Browsersprache/DE-Fallback; DE/EN-Outline-Button zeigt aktuellen Zustand und lokalisiertes Wechselziel; DOM-Adapter für Text/Attribute und nachgerenderte Meldungen; keine Übersetzung von Code, URLs oder Quelldaten. |
| `follow.js` | Synchron mit `main:js/follow.js`; OAuth/PKCE, State-/Handle-/Ziel-/Rückkehrbindung; Account-Suche erhält Handle statt Profil-URL, prüft exakte Zuordnung und unterscheidet HTTP-Fehler; Following-Liste liest bestehende Follows mit vorhandenen Scopes; Buttons `Folge ich`/`Angefragt`, tabweite Anfragezustände; Same-Origin-Pagination, 401 und `dashboardReady`-Rückkehrkoordination. |
| `theme.js` | Synchron mit main; `fedipol:theme-v1`, Auto/Hell/Dunkel; setzt `data-bs-theme` vor Body-Rendering; folgt Systemschema im Auto-Modus; synchronisiert Tabs und BFCache-Rückkehr, behält Session-Wahl bei gesperrtem Speicher; Namespace `FedipolTheme`. |
| `ui.js` | Synchron mit `main:js/ui.js`; Theme-RGB-Tokens für dunkle Parteifarben und Histogramm-Gitter via CSS; DE/EN-Datumswerte/Diagramme bei Sprachwechsel ohne Ansichtsverlust; chronologische Datumssortierung, Histogramm-Vormonatszuwachs; FediWings-/Folgen-Aktionen für Personen und Institutionen; Rückkehransicht über OAuth; `dashboardReady` nach Datenrendering; mobile Karten; `.posts-header` identifiziert Sortierspalte. |
