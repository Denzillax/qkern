# Release 1.94.0 — Der Weg zurück

Nutzerbefund mit Screenshot: Wer die Sidebar einklappt, kommt nicht mehr
heraus; das Logo führt auf die Startseite statt in die Console; der
Umgebungs-Button oben ist schlecht gestaltet.

## Die Einbahnstrasse

`.is-collapsed .console-brand button { display: none }` versteckte genau
den Button, der die Sidebar wieder öffnet. Jetzt steht er in der
70-px-Leiste unter dem Symbol, 32 × 32 px, mit Tooltip. Im Browser
gemessen: 232 → 70 → 232 px.

## Die zwei anderen

- **Logo** verlinkt `/console`, nicht mehr `/`.
- **Umgebungswahl**: natives `select` in Sans (600, 13 px) mit farbigem
  Status-Punkt und Chevron in einer Pille; die Rahmenfarbe trägt weiter die
  Umgebung — grün, gelb, rot.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/sidebar-return-local-run1.manifest.json` |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/sidebar-return-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Der Sidebar-Zustand wird nicht gespeichert** — nach einem Reload ist
  sie wieder ausgeklappt.
