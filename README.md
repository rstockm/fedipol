# Fedipol - Fediverse Activity Tracker

Interaktives Dashboard zur Analyse der Fediverse-Aktivitaeten deutscher
Politiker:innen und politischer Institutionen:

https://rstockm.github.io/fedipol/

Die Seiten sind rein statisch; die Daten werden live aus der Service-App
geladen (taeglicher ETL, aktive Generation):

- Daten: https://fedipol.wolkenbar.de/fedipol_data.json (CORS-Freigabe
  fuer diese Pages-Origin)
- Status: https://fedipol.wolkenbar.de/healthz und /health/data

Der App- und Pipeline-Code (ETL, Django-App, Dokumentation inkl. ADRs)
liegt auf dem Branch [`service-app`](https://github.com/rstockm/fedipol/tree/service-app).
Hosting-Entscheidung: docs/adr/ADR-0002-dashboard-hosting.md (Variante B1).

Lizenz: MIT; Datenbasis Wikidata (CC BY-SA 4.0).
