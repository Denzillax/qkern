# Release 2.49.0 – Was der Scanner sah

Die Objekte des Speichers mit ihrem Urteil, und die Realtime-Nachrichten als
Verlauf. Beides nur lesend.

## Was neu ist

- Ansicht Logs, Storage statt Platzhalter, mit Filter nach Bucket und Urteil.
- Ansicht Berichte, Realtime an der geteilten Reihe aus 2.45.
- PostgreSQL-Zertifizierung von 185 auf 186 Fälle.

## Ein Fehler, der sonst unentdeckt geblieben wäre

Ein als befallen erkanntes Objekt bekommt im selben Schritt seinen
Löschzeitpunkt, und die bestehende Auflistung filtert entfernte Zeilen weg.
Ein infiziertes Objekt wäre also in keiner Liste je aufgetaucht. Die neue
Abfrage behält solche Zeilen, und die Mutationsprobe belegt es.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 186/186, exit 0 | `docs/evidence/2026-09-26/storage-log-run1.manifest.json` |
| PostgreSQL 17, 186/186, exit 0 | `docs/evidence/2026-09-26/storage-log-run2.manifest.json` |
| Mutation im Stack, 185/186, exit 1 | `docs/evidence/2026-09-26/storage-log-mutation.manifest.json` |
| Vitest lokal 1581/1581, exit 0 | `docs/evidence/2026-09-26/storage-log-local-run1.manifest.json` |
| Vitest lokal 1581/1581, exit 0 | `docs/evidence/2026-09-26/storage-log-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Kein Zugriffsprotokoll**, keine Historie der Urteile. Der Platzhalter versprach mehr, als der Code hält.
- **Die Zähler je Urteil** folgen dem gewählten Bucket, nicht dem gewählten Urteil.
- **Die Realtime-Reihe zählt zugestellte Nachrichten**, nicht Verbindungen.
- **Im Browser nicht gesehen.**
