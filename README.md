# Fedipol - Fediverse Activity Tracker

Ein interaktives Dashboard zur Analyse der Fediverse-Aktivitäten deutscher Politiker:innen und politischer Institutionen.

## Ziel des Projektes

Der Fediverse Activity Tracker bietet einen Überblick über die Präsenz und Aktivität deutscher Politiker:innen und politischer Institutionen im Fediverse. Das Tool ermöglicht es, Trends und Entwicklungen in der politischen Kommunikation auf dezentralen sozialen Plattformen zu beobachten und zu analysieren.

![image](https://github.com/user-attachments/assets/204d71c9-82ff-4039-b9fe-52623d893aae)


## Datengrundlage

- Basiert auf den Daten des [fedipolitik](https://codeberg.org/open/fedipolitik) Projekts
- Lizenziert unter [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de)
- Erfasst werden Accounts von:
  - Politiker:innen aller Parteien
  - Politischen Institutionen
  - Parteiorganisationen
  - Parlamentsfraktionen
- Unterstützte Plattformen:
  - Mastodon
  - Pleroma
  - Pixelfed
  - PeerTube
  - Lemmy
  - Misskey

## Funktionen

### Navigation und Filter

- Schnellzugriff-Buttons für verschiedene Bereiche:
  - Parteien
  - Institutionen
  - Instanzen
- Suchfunktion für Accounts mit Echtzeit-Filterung
- Parteienfilter über die interaktive Verteilungsgrafik

### Parteien-Übersicht

- Visualisierung der Verteilung nach Parteien
- Farbkodierung für verschiedene Parteien
- Unterscheidung zwischen regulären Accounts und Bots
- Interaktive Zeitleiste des Datums der Account-Erstellungen

### Account-Listen

- Sortierbare Tabellen für:
  - Partei-Accounts
  - Institutionen
- Anzeige von:
  - Account-Name und Kategorie
  - Parteizugehörigkeit
  - Plattform-Icon
  - Bot-Kennzeichnung

### Aktivitäts-Tracking

- Analyse der Posting-Frequenz
- Unterscheidung zwischen:
  - Gesamtzahl der Posts seit Beitritt
  - Aktivität in den letzten 60 Tagen
- Visuelle Darstellung durch Fortschrittsbalken:
  - Grün: Aktuelle Aktivität (60 Tage)
  - Blau: Gesamtaktivität

### Export-Funktionen

- Export der aktuellen Daten im JSON-Format
- Offline-Verfügbarkeit durch lokalen Cache
- Manuelle Aktualisierung der Daten möglich


## Technische Grundlage

### Frontend-Technologien

- HTML5
- CSS3 mit Media Queries für Responsive Design
- JavaScript (ES6+)
- Bootstrap 5.3.3 für das UI-Framework
- Font Awesome 6.5.1 für Icons
- SortableJS für Tabellensortierung

### Daten-Management

- Lokale Datenspeicherung via localStorage
- JSON-basierte Datenhaltung
- Caching-Mechanismus für optimale Performance
- Asynchrone API-Abfragen

### API-Integration

- Mastodon API v1 Integration
- Batch-Processing für API-Anfragen
- Rate-Limiting-Berücksichtigung
- Fehlertolerante Datenabfrage

### Performance-Optimierungen

- Lazy Loading für Daten
- Optimierte API-Batch-Verarbeitung
- Effizientes DOM-Management
- Debouncing für Suchanfragen

### Deployment

- Statisches Hosting möglich
- Keine Server-Komponente erforderlich
- Minimale Abhängigkeiten
- Einfache Installation und Wartung
- Kann grundsätzlich auch für andere Account-Sammlungen angepasst werden
