# Release 2.46.0 – Zahlen statt Abfragetexte

Datenbank und Verbindungen in der Konsole, aus den Statistiksichten. Nur
lesend, gruppiert, und ohne einen einzigen Abfragetext.

## Was neu ist

- Ansichten Berichte, Datenbank und Berichte, Verbindungen statt Platzhalter.
- Data-Plane-Methode `inspectActivity`, gefiltert auf die eigene Datenbank.
- Kein `query`, kein `client_addr`, kein `pid`; kein `terminate`, kein `cancel`.
- `numbackends` neben den gezählten Gruppen, weil die Leserolle nicht alles sieht.
- PostgreSQL-Zertifizierung von 182 auf 183 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 183/183, exit 0 | `docs/evidence/2026-09-26/activity-run1.manifest.json` |
| PostgreSQL 17, 183/183, exit 0 | `docs/evidence/2026-09-26/activity-run2.manifest.json` |
| Mutation im Stack, 182/183, exit 1 | `docs/evidence/2026-09-26/activity-mutation.manifest.json` |
| Vitest lokal 1458/1458, exit 0 | `docs/evidence/2026-09-26/activity-local-run1.manifest.json` |
| Vitest lokal 1458/1458, exit 0 | `docs/evidence/2026-09-26/activity-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **`usename` ist der einzige freie Text**, der die Datenbank verlässt.
- **Die Leserolle sieht fremde Sitzungen nur teilweise.** Die gezählte Summe kann niedriger sein als die Zahl der Backends.
- **Eine hohe Trefferquote** über eine frisch zurückgesetzte Statistik sagt wenig; der Zeitpunkt steht daneben.
- **Rollbacks zählen auch gewollte Rücknahmen.**
- **Im Browser nicht gesehen.**
