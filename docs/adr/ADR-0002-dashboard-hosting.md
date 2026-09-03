# ADR-0002: Dashboard-Hosting (Cloudron-integriert oder GitHub Pages)

- Status: Proposed
- Datum: 2026-09-03
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

Noch nicht abschliessend entschieden. Beide Varianten sind im Code
unterstuetzt, weil beide denselben Export-Vertrag bedienen:

- **Variante A - Cloudron-integriert (Zugpferd der Framework-Konformitaet):**
  Die App liefert Dashboard und Daten aus einer Domain. Kein CORS, atomarer
  Generationwechsel am selben Ort, keine GitHub-Abhaenigkeit im Betrieb.
  Nachteil: oeffentliche URL aendert sich (Weiterleitung moeglich),
  Verfuegbarkeit an die App gebunden.

- **Variante B - GitHub Pages beibehalten:**
  - B1: Pages liest den Export direkt vom Cloudron-Endpunkt (CORS noetig,
    Abhaengigkeit von der App-Verfuegbarkeit).
  - B2: Nach erfolgreichem ETL stoesst Cloudron einen GitHub-Workflow
    (`repository_dispatch`) an, der einen versionierten Export abruft,
    validiert und als Pages-Artefakt deployt (kein taeglicher Git-Commit).

## Alternativen

- Taegliche automatische Git-Commits auf main: abgelehnt - verschleisst
  Historie und koppelt zwei Bereitstellungspfade ohne Not.
- Django/HTMX-Neubau der UI: abgelehnt, siehe ADR-0001.

## Konsequenzen

- Die Entscheidung kann bis nach dem Shadow-Betrieb (mehrere reale
  Naechtlaeufe, Vergleich mit der Baseline) aufgeschoben werden.
- Bei Variante B wird ein GitHub-Token (Scope: Actions ausloesen) als
  Cloudron-Umgebungsvariable benoetigt und ein zusaetzliches
  Deployment-Monitoring (ETL-Erfolg ≠ Pages-Deploy).
- Bei Variante A ist eine 301-Weiterleitung der alten Pages-URL bzw. ein
  Hinweis auf der Pages-Seite zu organisieren.

## Verifikation

- Shadow-Betrieb: mehrere Nachtlaeufe vergleichen Export vs. Baseline
  (Accountzahl, Kategorien, Bot-Status, Aktivitaet).
- Variante A: Playwright-Smoke-Test gegen die App-Domain.
- Variante B: End-to-End-Test des Dispatch-Workflows inkl. Rollback auf
  den letzten validierten Export.

## Ablösung

Entscheidung nach erfolgreichem Shadow-Betrieb; dieses ADR wird dann auf
Accepted gesetzt (mit gewaehlter Variante) oder durch ein Nachfolger-ADR
ersetzt.
