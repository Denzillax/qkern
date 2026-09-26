# Release 2.48.0 – Drei Slices nebeneinander

Zwei Implementierer gleichzeitig, in eigenen Arbeitskopien, danach
zusammengeführt. Herausgekommen sind die Anmeldungen als Reihe und als
Protokoll und der Tabellen-Designer.

## Was neu ist

- Ansichten Berichte, Auth und Logs, Auth aus dem Auth-Audit.
- Ansicht Datenbank, Tabellen: der erste schreibende Slice, über Change Sets und Freigabe.
- Kein DROP, kein Typwechsel, kein Spaltenwechsel; nur `public`.
- PostgreSQL-Zertifizierung von 183 auf 185 Fälle.

## Was das Zusammenführen zeigte

Fünf mechanische Konflikte, danach zwei zu Recht rote Verträge: verwaiste
Übersetzungen und eine veraltete Fallzahl. Beides gehört zu parallelem
Arbeiten, und beides wurde gefangen.

## Die interessanteste Mutationsprobe des Tages

Eine aufgehobene Bezeichnerprüfung liess 20 von 66 lokalen Fällen fallen,
den Stack aber grün: das Zitieren prüft ein zweites Mal. Erst mit beiden
aufgehobenen Schichten fällt der Zertifizierungsfall. Die doppelte
Absicherung ist damit belegt statt behauptet.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 185/185, exit 0 | `docs/evidence/2026-09-26/parallel-run1.manifest.json` |
| PostgreSQL 17, 185/185, exit 0 | `docs/evidence/2026-09-26/parallel-run2.manifest.json` |
| Mutation Tabellen, 184/185, exit 1 | `docs/evidence/2026-09-26/parallel-mutation-tables.manifest.json` |
| Mutation Auth, 184/185, exit 1 | `docs/evidence/2026-09-26/parallel-mutation-auth.manifest.json` |
| Vitest lokal 1567/1567, exit 0 | `docs/evidence/2026-09-26/parallel-local-run1.manifest.json` |
| Vitest lokal 1567/1567, exit 0 | `docs/evidence/2026-09-26/parallel-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Der Designer legt keine Schlüssel an** und kennt nur `public`.
- **Beliebiges SQL an die Change-Set-Route** war schon vorher möglich; der Designer fügt keine Fläche hinzu.
- **Kein Auffrischen von Token in der Reihe**, weil der Dienst es nicht protokolliert.
- **Im Browser nicht gesehen.**
