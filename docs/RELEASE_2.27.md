# Release 2.27.0 – Regeln und Grenzen je Bucket

Storage-Policies und Storage-Einstellungen sind eigene Ansichten ueber die
vorhandene Bucket-Route.

## Was es tut

Policies: Lese- und Schreibregel je Bucket als Auswahl, mit Klartext, was
die Regel bedeutet. Einstellungen: Objektgroesse, Speicherplatz,
Aufbewahrung und MIME-Typen je Bucket als Formular. Der Dienst prueft die
Grenzen, die Ansicht zeigt seine Antwort.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 170/170, exit 0 | `docs/evidence/2026-09-25/storage-views-run1.manifest.json` |
| PostgreSQL 17 170/170, exit 0 | `docs/evidence/2026-09-25/storage-views-run2.manifest.json` |
| Vitest lokal 1160/1160, exit 0 | `docs/evidence/2026-09-25/storage-views-local-run1.manifest.json` |
| Vitest lokal 1160/1160, exit 0 | `docs/evidence/2026-09-25/storage-views-local-run2.manifest.json` |

`next build` gruen.

## Nebenbei behoben

Storage, Usage und Billing antworteten abgeschaltet mit 500 ohne Koerper,
weil der Dienst schon beim Anlegen warf. Jetzt 503 mit Begruendung, wie
die Queues seit 2.24.

## Ehrlich offen

- **Mit einem echten Bucket nicht gesehen.** Der Dev-Server hat Storage
  nicht aktiv; gesehen ist der Zustand ohne.
- **Regeln je Pfad gibt es nicht.**
- **Keine Mutationsprobe** fuer die Laufzeit-Zugriffe; der Vertrag prueft
  das Verhalten direkt.
