# Frontend-JavaScript

| Datei | Zweck |
| --- | --- |
| `follow.js` | OAuth/PKCE nach FediWings; Scopes `read:accounts write:follows`; Session im `sessionStorage`; State, Handle, Ziel und 15-Minuten-Frist binden Rücksprung; `accounts/search?resolve=true` löst Remote-Accounts auf, `accounts/:id/follow` folgt; 401 löscht Session, Folgeanfragen separat bestätigt; Requests ohne Redirect mit Timeout. Namespace `window.FediPolFollow`. |
| `ui.js` | Lädt Export, rendert Tabellen/Filter/Diagramme; `formatAccountStartDate` zeigt UTC-Datum; Datumssortierung chronologisch, unbekannte zuletzt; Histogramm-Hover zeigt Vormonatszuwachs je Partei/gesamt; `getFediWingsUrl` erzeugt kodierte Autostart-Links mit festem Ziel; trailing `.account-actions-cell` mit `Folgen`-Button (alle Accounts) und FediWings-Analyse (Parteien); delegierter Klick-Handler startet `FediPolFollow.follow`; `isFollowableAccount` prüft Profil-URLs; getrennte Desktop-/Mobilbeschriftung und mobile Zählerlabels; Sortierung adressiert `.posts-header`. |
