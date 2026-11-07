# info.html

Informationsseite mit DE/EN-Sprachwahl und zentralen Katalogen aus `js/`.
Sprachwahl als Outline-Button mit aktuellem DE/EN-Kürzel und lokalisiertem Wechselziel;
Header bricht mobil um, Buttons mindestens 44 px hoch.
Prominenter Scope-Hinweis: bisher ausschließlich deutsche Politik/Institutionen,
einschließlich deutscher Vertreter:innen auf EU-Ebene; Englisch erweitert keine
Datenabdeckung. Eigennamen und Quellenkategorien bleiben originalsprachlich.
SPARQL-/API-Code wird nicht übersetzt; Copy-Buttons und Rückmeldungen schon.
Bot-Keywords matchen ganze Wörter; Dashboard-Kopie synchron halten.
Farbschema-Button vor der Sprachwahl zyklisiert Auto/Hell/Dunkel; `js/theme.js`
lädt im `<head>`, setzt `data-bs-theme` sofort und folgt `prefers-color-scheme`.
