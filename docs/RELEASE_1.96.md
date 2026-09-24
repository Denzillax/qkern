# Release 1.96.0 — Bewegung beim Scrollen

Nutzerwunsch: Scroll-Effekte auf der Frontpage wie in der Referenz, und bei
den Preisen „CHF" statt des komischen Zeichens, aufgebaut genau wie dort.

## Scroll-Effekte

`components/reveal.tsx` bringt zwei Bausteine. `Reveal` beobachtet einen
Abschnitt mit `IntersectionObserver` und setzt beim ersten Sichtkontakt
`data-in`; Kinder eines gestaffelten Containers folgen im Abstand von 70 ms.
`CountUp` zählt die vier Kennzahlen ab halber Sichtbarkeit in 1,4 s hoch.

Ohne JavaScript bleibt alles sichtbar — die Ausblendung greift nur unter
`html[data-reveal="on"]`, und das setzt erst der Effekt.
`prefers-reduced-motion` schaltet beides ab.

## Preise wie die Referenz

Drei gleiche Karten: Name, „CHF 0" mit „/pro Monat", Beschreibung, voller
Button, gepunktete Linie, Häkchenliste in Grün. Free, Pro und Business mit
je fünf Punkten; die Entwurfsnotiz bleibt.

## Ehrlich

Beim ersten Browsertest blieben die Zähler bei 3, 0 und 0 stehen — der
Browser-Tab lag im Hintergrund, wo `requestAnimationFrame` pausiert. Der
Endwert wird jetzt zusätzlich per Timeout gesetzt; eine Kennzahl darf nie
unter ihrem Beleg stehen bleiben. Im Vordergrund gemessen: 7 → 145 → 160.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/scroll-reveal-local-run1.manifest.json` |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/scroll-reveal-local-run2.manifest.json` |

`next build` exit 0. Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Wort-für-Wort-Animation im Hero** wie in der Referenz gibt es nicht;
  QKERN behält dort die Ladeanimation aus 1.92.
- **Die Preise bleiben Entwürfe**, wie die Notiz unter den Karten sagt.
