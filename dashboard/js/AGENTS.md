# Dashboard-JavaScript

| Datei | Zweck |
| --- | --- |
| `follow.js` | Synchron mit `main:js/follow.js`; OAuth/PKCE, State-/Handle-/Ziel-/Rückkehrbindung; Account-Suche erhält Handle statt Profil-URL, prüft exakte Zuordnung und unterscheidet HTTP-Fehler; Following-Liste liest bestehende Follows mit vorhandenen Scopes; Buttons `Folge ich`/`Angefragt`, tabweite Anfragezustände; Same-Origin-Pagination, 401 und `dashboardReady`-Rückkehrkoordination. |
| `ui.js` | Synchron mit `main:js/ui.js`; chronologische Datumssortierung, Histogramm-Vormonatszuwachs; FediWings-/Folgen-Aktionen für Personen und Institutionen; `captureFollowView`/`restoreFollowView` erhalten Suche, Partei, Sortierung und Zeilenposition über OAuth; `dashboardReady` nach Datenrendering; mobile Karten; `.posts-header` identifiziert Sortierspalte. |
