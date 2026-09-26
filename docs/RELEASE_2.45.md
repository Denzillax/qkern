# Release 2.45.0 – Der Verlauf

Drei Platzhalter auf einmal: API, Storage und Functions unter Berichte zeigen
den Verlauf ihrer Nutzung. Ohne neue Tabelle, weil die Ereignisse ihren
Zeitstempel schon tragen.

## Was neu ist

- Drei echte Ansichten über eine geteilte Komponente und eine Route.
- Aggregation in der Datenbank, nie in JavaScript.
- Fenster folgt der Eimergrösse: 48 Stunden oder 90 Tage.
- Diagramm als reine Geometrie, daneben dieselben Zahlen als Tabelle.
- Die drei Notizen, die Antwortzeiten, Belegung und Fehler versprachen, sind weg.
- PostgreSQL-Zertifizierung von 181 auf 182 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 182/182, exit 0 | `docs/evidence/2026-09-26/usage-series-run1.manifest.json` |
| PostgreSQL 17, 182/182, exit 0 | `docs/evidence/2026-09-26/usage-series-run2.manifest.json` |
| Mutation im Stack, 181/182, exit 1 | `docs/evidence/2026-09-26/usage-series-mutation.manifest.json` |
| Vitest lokal 1444/1444, exit 0 | `docs/evidence/2026-09-26/usage-series-local-run1.manifest.json` |
| Vitest lokal 1444/1444, exit 0 | `docs/evidence/2026-09-26/usage-series-local-run2.manifest.json` |

`next build` grün.

## Nachtrag zum Verfahren

Der Zertifizierungsfall trug zwei falsche Erwartungen, beide durch
Abschreiben entstanden: eine zählte ein Ereignis vor dem Fenster mit, die
andere übernahm die Zahlen der Stunde für das Tagesfenster. Beide rechnen
jetzt je Fenster, mit der Rechnung im Kommentar.

## Ehrlich offen

- **Keine Antwortzeiten, keine Belegung, keine Containerfehler.** Die Ereignisse tragen das nicht.
- **"Abgelehnt" heisst Kontingent**, nie HTTP-Fehler.
- **Der letzte Eimer ist immer angebrochen.**
- **Bei echtem Volumen** braucht es eine Rollup-Tabelle oder einen BRIN-Index auf `observed_at`.
- **Auf dem Speicherport** meldet die Route "Metering nicht aktiv", obwohl es "kann nicht aggregieren" heisst.
- **Im Browser nicht gesehen.**
