# Release 2.43.0 – Ein Fenster von null

Keine neue Ansicht. Die Behebung eines Fehlers, den die Arbeit am Cron-Log
zutage brachte.

## Was der Fehler war

Eine Queue mit Dedupe-Fenster null liess jedes Einreihen mit
Dedupe-Schlüssel scheitern, weil der Verifikator ohne Frist geschrieben
wurde und die Bedingung beides oder keines verlangt. Der Aufrufer bekam
einen Konflikt gemeldet, den es nicht gab. Jeder Cron-Job auf so einer Queue
scheiterte bei jedem Vorkommen.

## Was jetzt gilt

Fenster null heisst keine Entdopplung: weder Verifikator noch Frist werden
geschrieben. Null bleibt eine gültige Einstellung, weil Schema, OpenAPI und
Route sie zusagen und Queue-Definitionen unveränderlich sind. Keine
Migration, weil solche Zeilen nie einfügbar waren.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 180/180, exit 0 | `docs/evidence/2026-09-26/dedupe-window-run1.manifest.json` |
| PostgreSQL 17, 180/180, exit 0 | `docs/evidence/2026-09-26/dedupe-window-run2.manifest.json` |
| Mutation im Stack, 179/180, exit 1 | `docs/evidence/2026-09-26/dedupe-window-mutation.manifest.json` |
| Mutation lokal, 16/17, exit 1 | `docs/evidence/2026-09-26/dedupe-window-local-mutation.manifest.json` |
| Vitest lokal 1398/1398, exit 0 | `docs/evidence/2026-09-26/dedupe-window-local-run1.manifest.json` |
| Vitest lokal 1398/1398, exit 0 | `docs/evidence/2026-09-26/dedupe-window-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Auf einer Queue ohne Fenster läuft ein Cron-Job mindestens einmal**, nicht genau einmal.
- **Wer Entdopplung braucht, muss ein Fenster grösser als null wählen.** Das steht jetzt im Handbuch.
- **Ein Aufrufer, der den Konflikt als "schon eingereiht" gelesen hat**, sieht jetzt mehrere Nachrichten.
- **Genau auf der Fensterkante** entdoppelt der Speicherport einschliessend, PostgreSQL nicht. Unverändert gelassen und benannt.
