# Dashboard-JavaScript

| Datei | Zweck |
| --- | --- |
| `follow.js` | Synchron mit `main:js/follow.js`; OAuth/PKCE nach FediWings, `read:accounts write:follows`, State-/Handle-/Zielbindung und Timeout; tabweite Session; Remote-Auflösung per `accounts/search?resolve=true`, Follow mit Anfragebestätigung und 401-Behandlung. |
| `ui.js` | Synchron mit `main:js/ui.js`; Datumssortierung chronologisch, unbekannte zuletzt; Histogramm-Hover zeigt Vormonatszuwachs je Partei/gesamt; kodierte FediWings-Autostart-Links mit festem Ziel; trailing `.account-actions-cell` statt Button im Profiltext, getrennte Desktop-/Mobilbeschriftung und mobile Zählerlabels; Sortierung adressiert `.posts-header`. |
