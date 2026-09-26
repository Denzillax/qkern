# Release 2.42.0 – Was der Zeitplan ausgelöst hat

Das Cron-Log in der Konsole. Es gibt kein Laufprotokoll, also wird es aus den
erwarteten Vorkommen und den Nachrichten der Queue zusammengesetzt.

## Was neu ist

- Ansicht Logs, Cron statt Platzhalter.
- Der Dedupe-Schlüssel ist eine benannte Funktion, die der Dispatcher selbst benutzt.
- Vier Zustände: gefunden, fehlt, noch nicht fällig, erwartet.
- Fenster von 24 Stunden, höchstens 50 Vorkommen, in der Antwort genannt.
- Kein Payload, kein Schlüssel, kein Verifikator in der Antwort.
- PostgreSQL-Zertifizierung von 178 auf 179 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 179/179, exit 0 | `docs/evidence/2026-09-26/cron-log-run1.manifest.json` |
| PostgreSQL 17, 179/179, exit 0 | `docs/evidence/2026-09-26/cron-log-run2.manifest.json` |
| Mutation im Stack, 178/179, exit 1 | `docs/evidence/2026-09-26/cron-log-mutation.manifest.json` |
| Mutation lokal, 9/11, exit 1 | `docs/evidence/2026-09-26/cron-log-local-mutation.manifest.json` |
| Vitest lokal 1395/1395, exit 0 | `docs/evidence/2026-09-26/cron-log-local-run1.manifest.json` |
| Vitest lokal 1395/1395, exit 0 | `docs/evidence/2026-09-26/cron-log-local-run2.manifest.json` |

`next build` grün.

## Nachtrag zum Verfahren

Der Zertifizierungsfall scheiterte dreimal am Aufräumen, und jedes Mal an
einer gewollten Zusage: Audit-Zeilen sind unveränderlich, eine
Queue-Nachricht mit Dedupe-Schlüssel ist vor der Aufbewahrungsfrist
geschützt, und eine Organisation mit Audit-Zeilen lässt sich nicht löschen.
Der Fall hat jetzt eine eigene Organisation und räumt nur ab, was er darf.

## Ehrlich offen

- **Was der Container ausgegeben hat, steht nicht hier.**
- **Ein Dedupe-Fenster kürzer als der Cron-Takt** macht ältere Vorkommen unbeweisbar; die Voreinstellung sind fünf Minuten.
- **Die Nachsicht misst gegen die Uhr der API**, nicht die des Schedulers.
- **Ein geänderter Ausdruck ist nicht rekonstruierbar**, weil eine Änderung eine neue Definition ist.
- **Offen und nicht repariert:** eine Queue mit Dedupe-Fenster 0 lässt zusammen mit einem Dedupe-Schlüssel jeden Cron-Lauf scheitern.
- **Im Browser nicht gesehen.**
