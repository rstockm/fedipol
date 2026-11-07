# Frontend-Tests

Sprachbutton-Regression prüft DE/EN, Persistenz und lokalisierte Zustands-/Wechsellabels.
Theme-Regression prüft zusätzlich Tab-/BFCache-Synchronisation, fehlendes/Legacy-
`matchMedia`, Kontrast-Tokens und CSS-Umbruch; Mirror-Prüfung umfasst CSS und Theme-Abhängigkeiten.
Sprach- und Follow-Tests funktionieren auch ohne optionalen Service-Worktree.

| Datei | Zweck |
| --- | --- |
| `branding.test.cjs` | Prüft beide Dashboard-Kopien: Titel und H1 `Fedipol`, dekoratives Icon vor Name, kein alter Produktname. |
| `cumulative-hover.test.cjs` | Prüft Histogramm-Hover mit Vormonatsänderung je Partei und gesamt, ersten Monat, Monate ohne Zuwachs und Parteifilter. |
| `fediwings.test.cjs` | Prüft feste Ziel-URL, Handle-Kodierung, Autostart, HTML-Escaping, ungültige URLs, trailing Aktionsgruppe außerhalb Profiltext, Desktop-/Mobilbeschriftung und Posts-Sortierung unabhängig von Aktionen; beide Frontend-Kopien. |
| `i18n.test.cjs` | Prüft FediWings-Sprachpolitik, Speicherfehler, DE/EN-Katalogparität und Platzhalter, Meldungen, englische UTC-Datumswerte, Deutschland-Scope, gemeinsame Sprachwahl und synchrone Dashboard-Kopien. |
| `theme.test.cjs` | Prüft Farbschema-Politik (gespeicherte Wahl, Systemschema, Auto-Fallback, blitzfreie Sofortanwendung im `<head>`), Auto-Ereignislistener, Button-Zyklus mit Persistenz, DE/EN-Labels, Variablen statt hartgecodeter Hellfarben in HTML/JS/CSS und beide Frontend-Kopien (Service-Kopie, sofern Worktree vorhanden). |
| `follow.test.cjs` | Prüft beide Frontends: Folgen-/Analyse-Buttons auch für Institutionen, PKCE und State-Schutz, Session-Wiederverwendung, Following-Pagination ohne Fremd-Origin-Token, vorhandene Follows ohne Schreibzugriff, persistierte Anfragebeschriftung, Rückkehransicht erst nach Datenrendering; Such-Mock lehnt Profil-URL als Query ab; lokale/remote Handles, exakte Zuordnung, HTTP-Fehler, 401 und ungültige Antworten. |
| `start-date.test.cjs` | Node-Regressionstests für Datum, Spaltenposition über `.account-party`, chronologische Sortierung und unbekannte Werte; prüft zusätzlich Service-Dashboard, sofern Worktree vorhanden. Aufruf: `node --test tests/*.test.cjs`. |
