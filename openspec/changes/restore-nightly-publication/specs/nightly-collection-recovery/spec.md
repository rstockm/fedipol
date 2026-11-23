## ADDED Requirements

### Requirement: Begrenzte Instanzabfrage
Der ETL SHALL `gruene.social` standardmäßig bis zu 2.500 Requests und vier Stunden erlauben und den Mindestabstand von fünf Sekunden sowie Server-Cooldowns beibehalten. Das globale Standardbudget SHALL 4,5 Stunden betragen.

#### Scenario: Eine große Instanz benötigt mehr als eine Stunde
- **WHEN** `gruene.social` weitere fällige Accounts hat und bisher nur das frühere Budget ausgeschöpft hätte
- **THEN** der Lauf darf weitere Requests senden, sofern die neuen Grenzen und Cooldowns es zulassen.

### Requirement: Bewusst ausgeschlossene Instanzen
Der ETL SHALL konfiguriert stillgelegte Hosts weder zur Accountabfrage einplanen noch als aktiv, fehlend oder veraltet exportieren. Historische Beobachtungen SHALL erhalten bleiben.

#### Scenario: Stillgelegter Account wurde schon veröffentlicht
- **WHEN** `respublicae.eu` als stillgelegt konfiguriert ist und die Vorgängergeneration einen Account dieser Instanz enthält
- **THEN** wird er weder abgefragt noch exportiert und nicht zur Zahl der fehlenden Accounts gerechnet.

### Requirement: Beschädigte SPARQL-Antworten
Der ETL SHALL ungültige SPARQL-Resultate innerhalb des bestehenden Retry-Budgets mit Backoff erneut abrufen und SHALL nur validierte Antworten ablegen.

#### Scenario: Abgeschnittenes JSON mit HTTP 200
- **WHEN** ein Abruf abgeschnittenes JSON liefert und der nächste ein gültiges Resultat
- **THEN** benutzt und speichert der ETL nur das gültige Resultat.

#### Scenario: Retry-Budget erschöpft
- **WHEN** kein gültiges Resultat innerhalb des Retry-Budgets ankommt
- **THEN** bricht der Lauf ohne neue Publikation ab.
