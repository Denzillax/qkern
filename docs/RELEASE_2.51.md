# Release 2.51.0 – Die Brücke läuft

Was 2.50 als "gebaut, zertifiziert und untätig" hinterlassen hat, läuft
jetzt als Prozess. Dazu Rücksprungziele je Projekt und zwei Protokolle, die
sagen, was sie nicht haben.

## Was neu ist

- Die Webhook-Brücke läuft im Compute-Worker, mit dauerhafter Position.
- Rücksprungziele je Umgebung, durchgesetzt an der einzigen Engstelle.
- Mailweg und Vorlagen nur lesend, der Text aus derselben Funktion, die ihn versendet.
- Function-Aufrufe im Protokoll; die Data API sagt ehrlich, dass es keines gibt.
- PostgreSQL-Zertifizierung von 188 auf 191 Fälle.

## Der Fall beweist einen Prozess, keine Funktion

Er startet den Worker, macht eine Änderung, beendet ihn, prüft die Stille
während der Pause, startet neu und zählt genau drei Zustellungen in
Reihenfolge.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 191/191, exit 0 | `docs/evidence/2026-09-26/welle3-run1.manifest.json` |
| PostgreSQL 17, 191/191, exit 0 | `docs/evidence/2026-09-26/welle3-run2.manifest.json` |
| Mutation Prozess, exit 1 | `docs/evidence/2026-09-26/welle3-mutation-worker.manifest.json` |
| Mutation Rücksprungziele, exit 1 | `docs/evidence/2026-09-26/welle3-mutation-auth.manifest.json` |
| Mutation Protokollfilter, exit 1 | `docs/evidence/2026-09-26/welle3-mutation-logs.manifest.json` |
| Vitest lokal 1719/1719, exit 0 | `docs/evidence/2026-09-26/welle3-local-run1.manifest.json` |
| Vitest lokal 1719/1719, exit 0 | `docs/evidence/2026-09-26/welle3-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Kopplungen löschen statt ausschalten** hält die Position an; eine spätere Kopplung sieht, was der Strom noch hält.
- **Ein Absturz zwischen Einreihen und Schreiben** wiederholt höchstens eine Stapelmenge.
- **Migration `0051` ist nicht optional.** Fehlt sie, scheitert jede Anmeldung laut.
- **Mailtexte gibt es nur in einer Sprache und nur fest.**
- **Im Browser nicht gesehen.**
