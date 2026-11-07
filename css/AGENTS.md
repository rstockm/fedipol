# Dashboard-Styles

`fedipol-brand` hält Namen und blaues Parlaments-/Statistik-Icon auch mobil zusammen.
Wortmarke Inter Tight 750; `1em`-Icon an Buchstabenkörper-Mitte ohne `p`-Unterlänge;
separate Icon-/Glyphen-Lift-Tokens, 44-px-Controls und kontrollierter mobiler Umbruch.
DE/EN: Header mit Sprachauswahl; `Germany` nur Englisch ab 1200 px;
mobile Datumspräfixe und Ladeanzeige folgen `html[lang]`; Header passt ab 320 px.

Farbschema: eigene `--app-*`-Variablen in `:root`/`[data-bs-theme="light"]`, Dunkelwerte
unter `[data-bs-theme="dark"]`; Bootstrap 5.3 setzt das Attribut über `js/theme.js`.
Parteifarben bleiben Alpha-Overlays (`--party-opacity` dunkel leicht erhöht);
Histogramm-Gitter und Bot-Aufhellung folgen ebenfalls Variablen.
Diagramme nutzen RGB-Tokens für dunkle Parteifarben; Dunkelmodus hellt sie auf,
ohne Neurendering oder Verlust der Alpha-Abstufung. Header-/Footer-Akzente folgen
`--app-primary`; Sprachbutton nutzt Outline-Design; Header erlaubt mobilen Umbruch.

| Datei | Zweck |
| --- | --- |
| `hero.css` | Kompakter DE/EN-Hero, lokale Inter Tight, responsive Hell-/Dunkel-Tokens, Verlauf auf Fediverse, Raster/Ringe; Reduced Motion und Forced Colors. |
| `styles.css` | Parteifarben, Diagramme und responsive Tabellen mit Farbschema-Variablen für Hell/Dunkel; Aktionen mit Fokus-/Folgen-Wartezustand, grüne Follow- und gelbe Anfragebestätigung; viewportfeste Statusmeldung und markierte OAuth-Rückkehrzeile; unter 897 px Account-Karten mit Metadaten und 44-px-Aktionen; Institutionen behalten Tabellenlayout mit Analyse-/Folgen-Spalte. |
