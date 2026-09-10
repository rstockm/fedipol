# ADR-0002: Dashboard-Hosting (Cloudron-integriert oder GitHub Pages)

- Status: Accepted (Variante B1)
- Datum: 2026-09-03 (Entscheidung: 2026-09-11)
- Verantwortlich: Ralf Stockmann
- Betroffene Guideline: GUIDELINES.md (App-Profile), OPERATIONS-GUIDELINES.md (GitHub Pages, Publikation)
- Ersetzt: keines
- Ersetzt durch: keines

## Kontext

Die ETL-Pipeline laeuft als Cloudron Service App (ADR-0001) und veroeffentlicht
atomare Generationen von `fedipol_data.json`. Das bestehende Dashboard ist
rein statisch und nur ueber diese eine Datei an die Daten gekoppelt. Die
Visualisierung bleibt unveraendert; nur das Hosting ist noch offen. Die
oeffentliche URL https://rstockm.github.io/fedipol/ ist etabliert und wird
zitiert; die Daten sind oeffentlich (Wikidata, CC BY-SA 4.0).

## Entscheidung

Entschieden am 2026-09-11 nach erfolgreichem Shadow-Betrieb: **Variante B1**.
Der Haupt-Traffic bleibt auf GitHub Pages unter der etablierten URL
https://rstockm.github.io/fedipol/ (Pages-Source: Branch `main`).

- Veroeffentlicht wird der unveränderte Stand von `dashboard/`
  (`index.html`, `info.html`, `css/`, `js/ui.js`). Die Legacy-Dateien der
  Browser-Pipeline (`wikidata.html`, `enhancement.html`, `fedipol_data.json`,
  `exclude.json`) sind auf `main` entfernt.
- `js/ui.js` waelt die Datenquelle nach Host: auf `*.github.io` laedt es den
  Export direkt aus der Cloudron-App (`https://fedipol.wolkenbar.de/fedipol_data.json`),
  sonst vom selben Origin (App-Betrieb, lokaler Server).
- Damit der Cross-Origin-Abruf klappt, spiegelt die App freigegebene Origins
  (Umgebungsvariable `FEDIPOL_CORS_ORIGINS`, gesetzt auf
  `https://rstockm.github.io`) in den CORS-Antwortheadern
  (`fedipol.ops.middleware.PublicCorsMiddleware`). Nur lesende Endpunkte,
  keine Cookies.

## Alternativen

- Taegliche automatische Git-Commits auf main: abgelehnt - verschleisst
  Historie und koppelt zwei Bereitstellungspfade ohne Not.
- Django/HTMX-Neubau der UI: abgelehnt, siehe ADR-0001.

## Konsequenzen

- Kein taeglicher Git-Commit und kein Workflow-Dispatch: Pages zeigt den
  Frontend-Stand von `main`, die Daten kommen live aus der aktiven
  Exportgeneration der App.
- Abhaengigkeit der Datenverfuegbarkeit von der App (bekannter Nachteil von
  B1); ein fehlgeschlagener ETL-Lauf laesst die letzte Generation aktiv, ein
  nicht erreichbarer Cloudron zeigt im Dashboard eine Fehlermeldung.
- Pages-Updates sind manuelle Frontend-Releases: `dashboard/` nach `main`
  uebernehmen (siehe README, Abschnitt Deployment).
- Die CORS-Freigabe ist an die App-Env gebunden; ohne
  `FEDIPOL_CORS_ORIGINS=https://rstockm.github.io` bleibt der Abruf leer.

## Verifikation

- Shadow-Betrieb: mehrere Nachtlaeufe vergleichen Export vs. Baseline
  (Accountzahl, Kategorien, Bot-Status, Aktivitaet) - durchgefuehrt.
- Endpunkt-Check: `curl -H "Origin: https://rstockm.github.io" -I
  https://fedipol.wolkenbar.de/fedipol_data.json` muss
  `Access-Control-Allow-Origin` spiegeln.
- Browser-Smoke-Test der Pages-URL: Histogramm, Parteifilter und Timeline
  fuellen sich mit den App-Daten.

## Abloesung

Keine; Entscheidungsgrundlage fuer kuenftige Hosting-Aenderungen (z. B. Umzug
auf Variante A oder B2) bleibt dieser ADR.
