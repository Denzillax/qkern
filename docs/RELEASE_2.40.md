# Release 2.40.0 – Wo es langsam wird

Der Leistungsberater in der Konsole: fehlende Indizes, unbenutzte Indizes,
Verdacht auf Bloat, nie analysierte Tabellen. Aus den Statistiken von
PostgreSQL, nur lesend, mit benannten Schwellen.

## Was neu ist

- Ansicht Advisors, Leistung statt Platzhalter.
- Data-Plane-Methode `inspectStatistics` mit Grenzen und `truncated`-Flagge.
- Schwellen an einer Stelle, in jedem Text benannt.
- `pg_stat_statements` bleibt ungelesen, mit Begründung in der Karte.
- PostgreSQL-Zertifizierung von 176 auf 177 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 177/177, exit 0 | `docs/evidence/2026-09-26/performance-run1.manifest.json` |
| PostgreSQL 17, 177/177, exit 0 | `docs/evidence/2026-09-26/performance-run2.manifest.json` |
| Mutation im Stack, 176/177, exit 1 | `docs/evidence/2026-09-26/performance-mutation.manifest.json` |
| Mutation lokal, 30/31, exit 1 | `docs/evidence/2026-09-26/performance-local-mutation.manifest.json` |
| Vitest lokal 1358/1358, exit 0 | `docs/evidence/2026-09-26/performance-local-run1.manifest.json` |
| Vitest lokal 1358/1358, exit 0 | `docs/evidence/2026-09-26/performance-local-run2.manifest.json` |

`next build` grün.

## Nachtrag zum Verfahren

Die Mutationsprobe blieb beim ersten Versuch im Stack grün. Der Fall prüfte
die zweite Hälfte der Regel nicht, weil keine Tabelle viele sequenzielle und
gleichzeitig genug Indexscans zeigte. Der Fall wurde erweitert (`14abe13`),
danach fällt die Mutation. Der erste Lauf des neuen Falls lief in die
Fünf-Sekunden-Grenze der Datei; er hat jetzt ein eigenes Budget von 120
Sekunden (`19d5d0c`), ohne dass eine Zusicherung gelockert wurde.

## Ehrlich offen

- **Der Berater repariert nichts** und sagt nicht, welche Spalte fehlt.
- **Ein Index für den Quartalsbericht** erscheint als unbenutzt.
- **Eine frische Datenbank hat keine Zähler**, also auch keine Befunde.
- **Bloat ist eine Schätzung** des Kollektors, keine Messung.
- **`pg_relation_size` kostet einen Dateizugriff je Index**; die Grenze von 400 Indizes und das Statement-Timeout begrenzen das.
- **Im Browser nicht gesehen.**
