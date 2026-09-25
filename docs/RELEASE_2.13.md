# Release 2.13.0 – Eine Schrift

Denzil zur Badge "282 archivierte Pruefläufe": die Schriftart ist
schrecklich, ueberall aendern.

## Neu

Alle Labels, Kicker, Zaehler und Kleintexte auf der Seite und in der
Console laufen in Manrope 600, der Schrift des Fliesstexts. JetBrains Mono
bleibt nur dort, wo Code steht: Schnittstellen-Zeilen, Editor,
Zeilennummern, `pre`-Bloecke, Diff.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/font-local-run1.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/font-local-run2.manifest.json` |

`next build` gruen. Stacks unveraendert, kein Server-Code beruehrt.

## Ehrlich offen

- **Buchstabenabstaende sind die alten.** Bis 0,16 em aus der Mono-Zeit;
  in der Sans koennten sie enger sein.
