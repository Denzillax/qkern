# Release 2.36.0 – Die Kette in Zeitreihenfolge

Die Audit-Kette hatte eine Lücke, die niemand ausnutzen musste, damit sie
weh tut: zwei gleichzeitige Schreiber konnten sie in eine Reihenfolge
bringen, die dem Zeitstempel widerspricht, und jede Nachrechnung hätte
Manipulation gemeldet. Seit den Anmelde-Ereignissen von 2.35 war das nur
eine Frage der Zeit.

## Was neu ist

- Migration 0047: der Kettentrigger hebt den Zeitstempel nach dem Lock auf
  mindestens Vorgänger plus eine Mikrosekunde, bevor er den Hash rechnet.
  Kettenreihenfolge gleich `(created_at, id)`, je Organisation.
- Ein PostgreSQL-Fall, der das Rennen nachstellt: 175 von 175.
- `docs/SECURITY.md` nennt die Garantie.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 175/175, exit 0 | `docs/evidence/2026-09-26/audit-order-run1.manifest.json` |
| PostgreSQL 17 175/175, exit 0 | `docs/evidence/2026-09-26/audit-order-run2.manifest.json` |
| Mutation 174/175, exit 1 | `docs/evidence/2026-09-26/audit-order-mutation.manifest.json` |
| Vitest lokal 1290/1290, exit 0 | `docs/evidence/2026-09-26/audit-order-local-run1.manifest.json` |
| Vitest lokal 1290/1290, exit 0 | `docs/evidence/2026-09-26/audit-order-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Alte Zeilen bleiben, wie sie sind.** Die Migration ändert nur neue.
- **Ein explizit gesetzter Zeitstempel wird überschrieben.** Kein Codepfad
  setzt einen; eine logische Wiederherstellung mit aktiven Triggern würde
  Hashes brechen.
- **REPEATABLE READ wäre weiterhin ein Problem.** Kein Code setzt diese
  Stufe.
