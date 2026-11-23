## Kontext

Am 22.11. wurden 546 Accounts von `gruene.social` aufgrund des Instanzbudgets zurückgestellt. Am 23.11. lieferte Wikidata HTTP 200 mit abgeschnittenem JSON.

## Entscheidungen

- 2.500 Requests und vier Stunden für `gruene.social`, global 4,5 Stunden ab Initialisierung des Limiters. Fünf Sekunden Mindestabstand ergeben knapp 3,5 Stunden für 2.500 Requests; die restliche Zeit ist Puffer. Cooldowns bleiben bindend.
- Explizite Hostliste statt automatischem Ausschluss bei 404: Beim Planen und Exportieren sind betroffene URLs ausgeschlossen, auch wenn frühere Generationen sie kennen. Sie zählen nicht als fehlend oder veraltet. Der unveränderte Account-Rückgangsschutz prüft weiterhin gegen den bisherigen Stand.
- SPARQL-Validierung nutzt denselben Retry-Zähler wie Netzwerk- und HTTP-Fehler. Ungültiges JSON bzw. fehlende Result-Struktur werden nicht gespeichert; nach Ausschöpfung bleibt die alte Generation aktiv.

## Rollout und Rückweg

Normaler Cloudron-Update mit Backup; Liveness und unveränderten Export bis zur erfolgreichen Publikation prüfen. Bei Regression auf das vorherige Image zurück; persistente Daten nicht ohne gesonderte Freigabe zurückspielen.
