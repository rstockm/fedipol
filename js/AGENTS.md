# Frontend-JavaScript

| Datei | Zweck |
| --- | --- |
| `follow.js` | OAuth/PKCE nach FediWings; Scopes `read:accounts write:follows`; Session im `sessionStorage`; State, Handle, Ziel, Rückkehransicht und 15-Minuten-Frist binden Rücksprung; `accounts/search?resolve=true` löst Remote-Accounts auf; eigene Following-Liste mit Same-Origin-Pagination erkennt vorhandene Follows; Buttons zeigen `Folge ich`/`Angefragt`, Anfragen bleiben tabweit gespeichert; `dashboardReady` koordiniert Rückkehr nach Datenrendering; 401 löscht Session; Requests ohne Redirect mit Timeout. Namespace `window.FediPolFollow`. |
| `ui.js` | Lädt Export, rendert Tabellen/Filter/Diagramme; UTC-Startdatum und chronologische Sortierung; Histogramm-Hover mit Vormonatszuwachs; kodierte FediWings-Links und Folgen-Aktionen für Personen und Institutionen; `captureFollowView`/`restoreFollowView` sichern Suche, Partei, Sortierung und relative Zeilenposition über OAuth, fokussieren und markieren Rückkehrziel; `dashboardReady` nach Rendering; mobile Karten und Zählerlabels; Sortierung adressiert `.posts-header`. |
