# Release 2.11.0 – Der Q-Orbit

Denzils Referenz: der Hero auf nexalead.framer.ai, ein Partikelring, der
mit der Maus interagiert. Bei QKERN steht das Q in der Mitte.

## Was es tut

Rund 1400 Partikel laufen auf drei gleich geneigten Bahnen um das Q, alle
in einer Richtung, innen schneller als aussen. Hinten sind sie kleiner und
blasser. Die Maus kippt den Ring sanft, Partikel in Zeigernaehe weichen aus
und kehren zurueck. Das Q steht still.

Ab 961 px steht der Text links und der Orbit gross rechts, der Pruefbericht
darunter. Auf dem Handy bleibt es zentriert, der Orbit liegt hinter der
Ueberschrift. Das Q-Feld aus 2.10 ist entfernt.

## Was zweimal falsch war

"Es bewegt sich komisch", zweimal. Erst drehten die Bahnen in drei
Richtungen, wackelten und das Q drehte mit. Dann blieb eine Eigendrehung
der Blickachse, die den geneigten Ring taumeln liess wie einen Kreisel.
Jetzt steht die Bahn fest, nur die Partikel laufen, nur die Maus kippt.

## Wo es stillhaelt

`prefers-reduced-motion` zeichnet ein einziges Bild. Ausserhalb des
Sichtfelds pausiert die Schleife. Ohne Hover-Zeiger laufen nur die
Partikel. Rein dekorativ, keine Klicks.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/hero-orbit-local-run1.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/hero-orbit-local-run2.manifest.json` |

`next build` gruen. Stacks unveraendert, kein Server-Code beruehrt.

## Ehrlich offen

- **Kein Test fuer die Bewegung selbst.** Vitest hat kein Canvas; gemessen
  ist nur Layout und dass der Canvas bemalt ist.
- **Der Ring wartet auf Denzils Auge.** Zweimal war es falsch; ob es jetzt
  stimmt, entscheidet er.
