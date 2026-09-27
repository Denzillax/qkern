# Release 2.56.0 – Was die Datenbank über sich sagt

Drei Platzhalter unter Observability und Einstellungen sind weg. Alle drei
Seiten lesen nur, und alle drei sagen, was sie bewusst nicht zeigen.

## Was neu ist

- Ansicht Observability, Abfrage-Leistung: was eine Abfrage kostet, aus `pg_stat_statements`, ohne die Abfrage zu zeigen.
- Ansicht Observability, Abfrage-Einblicke: der Plan einer lesenden Abfrage, ohne sie auszuführen.
- Ansicht Einstellungen, Infrastruktur: worauf diese Umgebung läuft, gelesen vom Server selbst und aus der Control Plane.
- PostgreSQL-Zertifizierung von 201 auf 204 Fälle, lokale Suite von 2088 auf 2130.

## Drei Grenzen, die man wissen sollte

- **Der Abfragetext bleibt in der Datenbank.** `pg_stat_statements` normalisiert nur Abfragen. Ein Utility-Befehl steht mit seinem Literal in der Sicht, also auch das Passwort aus einem `CREATE ROLE`. Auch eine normalisierte Abfrage trägt noch Bezeichner. Wer einen einzelnen Plan sehen will, bekommt ihn über die Abfrage-Einblicke.
- **Der Plan läuft nicht.** `EXPLAIN` ohne `ANALYZE`. Mit `ANALYZE` würde ein Knopf in der Console die Abfrage wirklich ausführen, und das ist eine andere Zusage. Die Prüfung auf eine lesende Abfrage steht vor dem Präfix, sonst wäre ein `EXPLAIN ANALYZE DELETE` möglich. Die Bedingungstexte der Knoten verlassen die Datenbank nicht, weil sie die Literale der Abfrage tragen.
- **Lese-Replikate gibt es nicht.** Die Infrastruktur-Seite zeigt Version, Kodierung, Sortierung, Startzeit, Grösse und die Umgebungen des Projekts. Was QKERN nicht hat, steht als Zeile mit Grund da und nicht als leere Kachel.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 204/204, exit 0 | `docs/evidence/2026-09-27/welle8-run1.manifest.json` |
| PostgreSQL 17, 204/204, exit 0 | `docs/evidence/2026-09-27/welle8-run2.manifest.json` |
| Mutation Sortierung der teuersten Abfragen, exit 1 | `docs/evidence/2026-09-27/welle8-mutation-perf.manifest.json` |
| Mutation Plan führt die Abfrage aus, exit 1 | `docs/evidence/2026-09-27/welle8-mutation-insights.manifest.json` |
| Mutation Grösse als Konstante, exit 1 | `docs/evidence/2026-09-27/welle8-mutation-infra.manifest.json` |
| Vitest lokal 2130/2130, exit 0 | `docs/evidence/2026-09-27/welle8-local-run1.manifest.json` |
| Vitest lokal 2130/2130, exit 0 | `docs/evidence/2026-09-27/welle8-local-run2.manifest.json` |

## Nachtrag zum Verfahren

Drei Agenten haben nebeneinander in eigenen Arbeitsbäumen gebaut, und dabei
sind zwei Dinge aufgefallen, die nichts mit dem Produkt zu tun haben.

Alle drei haben dieselbe freie Fallnummer gegriffen. Das ist beim
Zusammenführen aufgelöst worden, aber eine Nummer, die drei Leute gleichzeitig
für frei halten, ist ein Verfahrensfehler und keine Panne.

Und der Stash gehört dem Repository, nicht dem Arbeitsbaum. Ein `git stash pop`
in einem Arbeitsbaum hat die Arbeit eines anderen erwischt. Sie ist sofort
zurückgelegt worden und nichts ist verloren, aber in parallelen Arbeitsbäumen
wird kein Stash mehr benutzt.

## Ehrlich offen

- **Die Abfrage-Leistung zeigt keinen Text, auch keinen normalisierten.** Wer wissen will, welche Abfrage hinter einer Kennung steckt, muss sie selbst zuordnen.
- **Die Planungszeit ist die einzige gemessene Zahl** in den Abfrage-Einblicken. Alles andere ist die Schätzung des Planers, nicht die Wirklichkeit.
- **Die Infrastruktur-Seite kennt keine Instanzgrösse und keine Platte.** Die Provisionierung meldet sie nicht, und die Seite erfindet sie nicht.
- **Im Browser nicht gesehen.** Die drei neuen Ansichten sind angemeldet nie betrachtet worden.
