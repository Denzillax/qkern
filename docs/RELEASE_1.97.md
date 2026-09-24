# Release 1.97.0 — Grosse Zahlen, kleines Menü

Drei Nutzerbefunde mit Screenshot: winzige Kennzahlen mit dem Plus in einer
eigenen Zeile, kein Hamburger-Menü auf dem Telefon, und ein Sidebar-Pfeil
in der Console, der auf dem Telefon nichts bedeutet.

## Die winzige Zahl

Ein Selektor: `.stat span`, gedacht fürs Label, traf seit `1.96` auch den
Zähler-Span in `strong` — 13,5 px und `display: block`. Jetzt gilt
`.stat > span` fürs Label, der Zähler erbt die Schrift, die Zahl ist 44 bis
64 px. Gemessen: 62 → 106 → 136 → 160 in 1,4 s.

## Das Menü

`components/site-menu.tsx` erscheint unter 1000 px, wo die
Desktop-Navigation verschwindet: ein Blatt unter der Kapsel mit allen
Ankern, Anmelden und Projekt erstellen. Escape, Klick auf einen Eintrag,
Klick daneben und Wechsel auf Desktop-Breite schliessen es. Bei 375 px
geprüft: Knopf 44 × 44 px, Menü öffnet, „Produkt" schliesst und springt. Nach dem
ersten Screenshot des Nutzers nachgezogen: Blatt und Abdunkelung per Portal
ausserhalb der Kopfzeile, die Kapsel bleibt scharf und ungedimmt, Button-Text in Weiss, Einträge 19 px halbfett.

## Die Schublade

Auf dem Telefon ist die Console-Sidebar eine Schublade. Statt des Pfeils
steht dort ein Schliessen-Kreuz, und ein auf Desktop gemerkter
eingeklappter Zustand wird unter 760 px neutralisiert.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/mobile-menu-local-run1.manifest.json` |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/mobile-menu-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Das Schliessen-Kreuz der Console ist nicht im Browser geprüft** — ohne
  Konto bleibt die Console zu (siehe `1.95`).
