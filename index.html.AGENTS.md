# index.html

Dashboard-Einstieg mit Account-, Institutionen- und Instanztabellen.
Titel und Kopfzeile heißen `Fedipol`; dekoratives Inline-SVG kombiniert
Parlamentsdach und ansteigende Statistik-Säulen, auch mobil sichtbar.
DE/EN-Sprachauswahl; `de.js`, `en.js`, `i18n.js` laden vor UI/OAuth.
Englischer Titelzusatz `Germany` erscheint ab 1200 px; deutsch bleibt `Fedipol`.
Fehlercontainer `#error` zeigt Export-Ladefehler unabhängig von OAuth an.
Accountliste enthält Spalte Startdatum zwischen Partei und Posts; Institutionen
zeigen Startdatum vor Posts. Personen haben rechts eine Aktionsspalte; `account-table`
wechselt mobil in Karten mit Aktionsleiste. `js/ui.js` rendert Tabellenköpfe und Daten
dynamisch; `.posts-header` bleibt unabhängig von der Aktionsspalte sortierbar.
Institutionen haben ebenfalls Folgen-Aktionen; `followAuthModal` fragt eigenen
Handle ab, `followStatus` meldet Ergebnisse; `js/follow.js` lädt vor `js/ui.js`.
