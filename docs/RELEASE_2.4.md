# Release 2.4.0 — Knöpfe, die stillhalten

Zwei Nutzerbefunde: Das Schliessen-Kreuz der Sidebar stand auf dem Desktop
neben dem Pfeil, und Buttons sollen ihre Grösse nie ändern, wenn ihre
Beschriftung wechselt. Das Zweite ist jetzt eine feste Regel im
Gedächtnis.

## Das Kreuz

Die Regel von `1.94` schlug die von `1.97` in der Spezifität. Jetzt gilt
`.console-brand .sidebar-close`: auf dem Desktop weg, auf dem Telefon da.
Im eingeklappten Zustand lag eine dritte Regel darüber; jetzt
`.console-sidebar .console-brand button.sidebar-close`. Bei 1280 px
gemessen: kein Kreuz, ausgeklappt und eingeklappt; bei 375 px Kreuz statt
Pfeil. Sprachknopf und Umgebungsmenü behalten beim Wechsel auf Französisch
ihre Breite.

## Die Breite

`components/stable-label.tsx` legt alle Varianten einer Beschriftung in
dieselbe Grid-Zelle. Nur die aktive ist sichtbar, die anderen nehmen
unsichtbar Platz, also ist die Breite immer die der längsten Variante,
über Zustände und Sprachen hinweg. Angewandt auf den Sprachknopf, auf
Anmelden und Projekt erstellen, auf das Umgebungsmenü und auf jeden
Zustandswechsel in der Console.

Dabei fanden sich fünf Zustandswechsel mit deutschen Literalen, die der
Scanner von `2.3` übersprungen hatte. Jetzt übersetzt, zehn neue Schlüssel.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1108/1108, exit 0 | `docs/evidence/2026-09-25/stable-buttons-local-run1.manifest.json` |
| Vitest lokal 1108/1108, exit 0 | `docs/evidence/2026-09-25/stable-buttons-local-run2.manifest.json` |

Stacks unverändert.

## Ehrlich offen

- **Statuswerte in Tabellen** sind Daten und nicht reserviert.
