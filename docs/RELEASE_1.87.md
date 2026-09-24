# Release 1.87.0 — Die ganze Uhr

Die Cron-Lücke der Paritätsleiter ist geschlossen: Bis `1.86` kannte QKERN
nur `*/N * * * *` und `M H * * *`. Jetzt gilt die klassische
Fünf-Feld-Grammatik in UTC.

## Die Grammatik

Je Feld `*`, `*/N`, `a`, `a-b`, `a-b/N` und Listen daraus; Minute 0–59,
Stunde 0–23, Tag 1–31, Monat 1–12, Wochentag 0–7 (7 ist Sonntag wie 0). Die
klassische Regel für Tag und Wochentag: Sind **beide** eingeschränkt, genügt
einer von beiden; sonst zählt der eingeschränkte. Ein Ausdruck ohne
Vorkommen in fünf Jahren (der 31. Februar) ist ein Fehler, keine Planung.
`* * * * *` ist gültig — die frühere Abweisung war nie eine dokumentierte
Zusage.

Der Definitionsdienst und der Scheduler teilen weiterhin denselben Parser:
Was der eine annimmt, kann der andere ausführen.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 157 Fälle): `0,30 6-8 * * 1-5` läuft durch
Scheduler, Datenbankfortschritt und Queue — am Dienstag, 4. August 2026, mit
Fortschritt 06:00 und Uhr 06:31 wird genau das 06:30-Vorkommen versendet,
07:00 noch nicht. Lokal die Matrix: Listen, Bereiche, Schritte über
Bereiche, nur Wochentage, 7 als Sonntag, die ODER-Regel in beiden
Richtungen, Jahreswechsel, jede Minute — und sechs ungültige Formen.

## Fund der Mutationsprobe

Der Readiness-Fall des Cron-Stacks („stops reporting ready when every
definition fails") stützte sich darauf, dass `* * * * *` unlesbar ist. Seit
der Grammatik lief diese Definition **erfolgreich** — und der Fall bestand
in Lauf 1 nur, weil die Probe das anfängliche 503 vor der ersten Runde
erwischte. Unter der Mutation, mit anderem Timing, fiel er: „expected 200 to
be 503". Er nutzt jetzt Stunde 24 als echten Fehler und trägt sich wieder
selbst. Ohne die Probe wäre ein hohler Fall grün geblieben.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Bereichsform `a-b` fällt aus der Feldgrammatik | Stack **156 von 157** (der Zwilling `0,30 6-8 * * 1-5`), lokal **1 von 1079** (die Matrix) |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 157/157, exit 0 | `docs/evidence/2026-09-24/cron-grammar-run1.manifest.json` |
| PostgreSQL 157/157, exit 0 | `docs/evidence/2026-09-24/cron-grammar-run2.manifest.json` |
| Mutation 156/157 | `docs/evidence/2026-09-24/cron-grammar-mutation.manifest.json` |
| Vitest lokal 1079/1079, exit 0 | `docs/evidence/2026-09-24/cron-grammar-local-run1.manifest.json` |
| Mutation lokal 1078/1079 | `docs/evidence/2026-09-24/cron-grammar-local-mutation.manifest.json` |
| verworfen: Realtime-Soak p95 6200 ms | `docs/evidence/2026-09-24/cron-grammar-soak-red.manifest.json` |

Ein Lauf 2 auf dem Zwischenstand fiel am Realtime-Soak-Latenzfall kurz nach
einem Docker-Neustart — verworfen, archiviert, nicht abgeschwächt; die drei
Endstand-Läufe sind frisch. 44 Migrationen.

## Ehrlich offen

- **Keine Namen** (JAN, MON), kein `@daily`, kein `L`/`W`/`#` — jede davon
  wäre eine zweite Grammatik.
- **Alles in UTC** — keine Zeitzone je Definition.
- **Die Console** validiert Ausdrücke weiterhin nur über die Route, nicht
  beim Tippen.
