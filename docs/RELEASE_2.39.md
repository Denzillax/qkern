# Release 2.39.0 – Was offen steht

Der Sicherheitsberater in der Konsole: Befunde nach Schwere, aus Daten, die
QKERN schon liest. Dazu eine Karte, die zu jeder Regel sagt, ob sie lief.
Nur lesend, ohne Reparatur.

## Was neu ist

- Ansicht Advisors, Sicherheit statt Platzhalter.
- Reines Regelmodul, stabil sortiert, sieben Regeln pruefen, eine kann es nicht.
- Route `GET .../advisors/security`, gleiche Tuer wie die Policies.
- Ein abgeschalteter Dienst heisst "nicht geprueft", nicht 500.
- PostgreSQL-Zertifizierung von 175 auf 176 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 176/176, exit 0 | `docs/evidence/2026-09-26/advisor-run1.manifest.json` |
| PostgreSQL 17, 176/176, exit 0 | `docs/evidence/2026-09-26/advisor-run2.manifest.json` |
| Mutation im Stack, 175/176, exit 1 | `docs/evidence/2026-09-26/advisor-mutation.manifest.json` |
| Mutation lokal, 16/18, exit 1 | `docs/evidence/2026-09-26/advisor-local-mutation.manifest.json` |
| Vitest lokal 1341/1341, exit 0 | `docs/evidence/2026-09-26/advisor-local-run1.manifest.json` |
| Vitest lokal 1341/1341, exit 0 | `docs/evidence/2026-09-26/advisor-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Der Berater repariert nichts.**
- **Eine absichtlich öffentliche Tabelle** erscheint als Befund hoher Schwere.
- **Ein Service-Key in Produktion** erscheint als Befund, auch wenn er gewollt ist.
- **Nicht im Blick:** SECURITY DEFINER, Views ohne security_invoker, Spaltenrechte, jedes Schema ausser public.
- **Im Browser nicht gesehen.**
