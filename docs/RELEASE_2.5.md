# Release 2.5.0 — Das Flyout

Im eingeklappten Zustand waren die Untermenüs der Sidebar unsichtbar. Im
Brainstorming standen drei Varianten im Browser; gewählt wurde das Flyout
am Icon, wie es Supabase Studio macht.

## Verhalten

Hover auf ein Gruppen-Icon öffnet nach 150 ms, Klick sofort. Das Flyout
liegt rechts neben dem Icon, 220 px breit, zeigt den Gruppennamen und alle
Unterpunkte mit dem grünen oder grauen Punkt. Es schliesst bei Wahl eines
Unterpunkts, bei Escape, bei Klick ausserhalb und 250 ms nachdem die Maus
Icon und Flyout verlassen hat. Lange Gruppen scrollen innen; ragt das
Flyout unten hinaus, rutscht es nach oben. Gruppen ohne Unterpunkte
wechseln direkt. Auf dem Telefon bleibt das Untermenü inline.

## Gemessen

Bei 1280 × 720: zwölf Flyout-Gruppen, keine Inline-Untermenüs; Hover öffnet
nach der Verzögerung und schliesst nach der Gnadenfrist; Klick, Escape und
Wahl verhalten sich wie beschrieben; Auth zeigt 16 Einträge mit
Unterkante 708; das Flyout von Einstellungen rutscht von 559 auf 237. Bei
375 px kein Flyout.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/sidebar-flyout-local-run1.manifest.json` |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/sidebar-flyout-local-run2.manifest.json` |

Vertrag `tests/console-flyout-contract.test.ts`. Entwurf in
`docs/superpowers/specs/2026-09-25-collapsed-sidebar-flyout-design.md`.
Stacks unverändert.

## Ehrlich offen

- **Bei sehr kleiner Fensterhöhe** scrollt das Flyout, statt sich zu teilen.
