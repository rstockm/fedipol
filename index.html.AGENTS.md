# index.html

Dashboard-Einstieg mit Account-, Institutionen- und Instanztabellen.
Titel und Kopfzeile heißen `Fedipol`; dekoratives Inline-SVG kombiniert
Parlamentsdach und ansteigende Statistik-Säulen, auch mobil sichtbar.
Fette Wortmarke und Icon an Buchstabenkörper-Mitte ausgerichtet; `header-row`
hält 44-px-Controls auf gemeinsamer Achse. Einziges H1 im kompakten DE/EN-Hero,
Verlauf nur auf `Fediverse.`; lokale Inter Tight über `css/hero.css`.
SVG-/PNG-Favicons, Apple-Touch-Icon und `site.webmanifest` laden gemeinsame App-Icons.
DE/EN-Sprachauswahl; `de.js`, `en.js`, `i18n.js` laden vor UI/OAuth.
Sprachwahl als Outline-Button mit aktuellem DE/EN-Kürzel und lokalisiertem Wechselziel;
Header bricht auf kleinen Viewports um, mobile Buttons mindestens 44 px hoch.
Englischer Titelzusatz `Germany` erscheint ab 1200 px; deutsch bleibt `Fedipol`.
Fehlercontainer `#error` zeigt Export-Ladefehler unabhängig von OAuth an.
Accountliste enthält Spalte Startdatum zwischen Partei und Posts; Institutionen
zeigen Startdatum vor Posts. Personen haben rechts eine Aktionsspalte; `account-table`
wechselt mobil in Karten mit Aktionsleiste. `js/ui.js` rendert Tabellenköpfe und Daten
dynamisch; `.posts-header` bleibt unabhängig von der Aktionsspalte sortierbar.
Institutionen haben ebenfalls Folgen-Aktionen; `followAuthModal` fragt eigenen
Handle ab, `followStatus` meldet Ergebnisse; `js/follow.js` lädt vor `js/ui.js`.
Farbschema-Button vor der Sprachwahl zyklisiert Auto/Hell/Dunkel; `js/theme.js`
lädt im `<head>`, setzt `data-bs-theme` sofort und folgt `prefers-color-scheme`.
