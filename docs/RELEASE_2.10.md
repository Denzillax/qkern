# Release 2.10.0 – Das Q-Feld

Denzils Wunsch: eine Animation im Hintergrund mit dem Q, die mit der Maus
interagiert. Die Referenz hat im Hero keinen bewegten Hintergrund, nur den
Glanz; das Q-Feld ist eine eigene Antwort.

## Was es tut

Sieben blasse Q-Symbole treiben langsam im Hero, jedes in eigenem Tempo.
Bewegt sich die Maus, weichen sie ihr aus, die grossen stärker als die
kleinen, und ein weicher Lichtfleck folgt dem Zeiger und hellt die
Symbole auf. Der Inhalt liegt darüber, das Feld nimmt keine Klicks an.

## Wo es stillhält

`prefers-reduced-motion` schaltet Drift und Parallaxe ab. Ohne Zeiger mit
Hover, also auf dem Telefon, gibt es nur den Drift, mit vier Symbolen in
kleinerer Grösse. Ein einziger Animations-Loop dämpft die Bewegung und
hält an, sobald nichts mehr zu glätten ist.

## Gemessen

Bei 1280 px: sieben Symbole mit laufender Animation, Transformationen
ändern sich nach einer Mausbewegung, der Lichtfleck geht von Deckkraft 0
auf 0,89 und wandert mit, die Hülle liegt über dem Feld.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/hero-field-local-run1.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/hero-field-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Kein Bezug auf die Scrollposition.**
- **Die Positionen sind handgesetzt**, nicht nach Textbreite berechnet.
