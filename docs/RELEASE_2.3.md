# Release 2.3.0 — Die Console in vier Sprachen

Zwei Nutzerbefunde: Der Sprachknopf der Website stapelte Globus und
Kürzel, und in der Console sollte die Sprache ebenfalls wählbar sein.

## Der Knopf

Er erbte das Raster des Icon-Buttons, das seine zwei Kinder übereinander
setzt. Jetzt ist er eine Pille mit Globus und Kürzel nebeneinander.

## Die Console

Jeder Text in `console-app.tsx` steht als `t("deutscher Text")`. Der
deutsche Text ist der Schlüssel, er kann nie fehlen. `lib/i18n/console.ts`
hält 454 Übersetzungen je Sprache. Die aktive Sprache liegt in einer
Modulvariablen, die die Wurzel zu Beginn jedes Renderns setzt: kein
Context, weil rund dreissig kleine Komponenten `t` direkt aufrufen und
React synchron von oben nach unten rendert. Navigation, Platzhalter und
Suche übersetzen am Render. Die Sprachwahl sitzt in der Kopfleiste neben
der Umgebung und teilt das Cookie mit der Website.

## Wie die Umstellung lief

Per Skript mit einem anführungszeichenbewussten Scanner. Ein erster
Regex-Versuch hatte Anführungszeichen verschoben und die Datei beschädigt;
zurück zur Sicherung. Ein Patch am Skript schrieb `` als
Backspace-Zeichen in die Ausschluss-Regex, weshalb umhüllte Texte ein
zweites Mal umhüllt wurden; der Typecheck fand es.

## Der Vertrag

`tests/console-i18n-contract.test.ts` liest alle `t("…")`-Aufrufe und alle
Navigationstexte aus dem Code und verlangt für jeden alle drei Sprachen,
ohne verwaiste Einträge, mit gleichen Auslassungspunkten und Randleerzeichen.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1108/1108, exit 0 | `docs/evidence/2026-09-25/console-languages-local-run1.manifest.json` |
| Vitest lokal 1108/1108, exit 0 | `docs/evidence/2026-09-25/console-languages-local-run2.manifest.json` |

Im Browser in der angemeldeten Session geprüft. Stacks unverändert.

## Ehrlich offen

- **Werte aus der API** (`active`, `delivered`) bleiben Daten, keine Texte.
- **Datumsformate der Console** bleiben `de-CH`.
- **Niemand hat die Übersetzungen gegengelesen.**
