# index.html

Dashboard-Einstieg mit Account-, Institutionen- und Instanztabellen.
Accountliste enthält Spalte Startdatum zwischen Partei und Posts; Institutionen
zeigen Startdatum vor Posts. Personen haben rechts eine Aktionsspalte; `account-table`
wechselt mobil in Karten mit Aktionsleiste. `js/ui.js` rendert Tabellenköpfe und Daten
dynamisch; `.posts-header` bleibt unabhängig von der Aktionsspalte sortierbar.
Institutionen haben ebenfalls Folgen-Aktionen; `followAuthModal` fragt eigenen
Handle ab, `followStatus` meldet Ergebnisse; `js/follow.js` lädt vor `js/ui.js`.
