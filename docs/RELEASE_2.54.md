# Release 2.54.0 – Was hinausgeht

Log-Drains mit einer harten Grenze, Vorlagen für den SQL-Editor und die
Frage, was ein angemeldeter Nutzer wirklich darf.

## Was neu ist

- Ansicht Einstellungen, Log-Drains: weitergeleitet wird nur, was die Console zeigt.
- Ansicht SQL-Editor mit zehn Vorlagen, alle nur lesend, keine führt sich selbst aus.
- Ansicht Auth, Policies: was ein angemeldeter Nutzer lesen und schreiben darf, und warum.
- PostgreSQL-Zertifizierung von 195 auf 198 Fälle.

## Zwei Befunde, die man wissen sollte

- **Ein angemeldeter Nutzer wird keine eigene Datenbankrolle.** Es gibt nirgends einen Rollenwechsel; die Identität steckt in transaktionslokalen Ansprüchen.
- **Eine Tabelle ohne Zeilensicherheit ist nicht offen, sondern unerreichbar.** Die Data API weist sie ab.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 198/198, exit 0 | `docs/evidence/2026-09-27/welle6-run1.manifest.json` |
| PostgreSQL 17, 198/198, exit 0 | `docs/evidence/2026-09-27/welle6-run2.manifest.json` |
| Mutation Anmelderechte, exit 1 | `docs/evidence/2026-09-27/welle6-mutation-access.manifest.json` |
| Mutation Vorlagen, exit 1 | `docs/evidence/2026-09-27/welle6-mutation-templates.manifest.json` |
| Mutation Log-Drains, exit 1 | `docs/evidence/2026-09-27/welle6-mutation-drain.manifest.json` |
| Vitest lokal 2013/2013, exit 0 | `docs/evidence/2026-09-27/welle6-local-run1.manifest.json` |
| Vitest lokal 2013/2013, exit 0 | `docs/evidence/2026-09-27/welle6-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Der Sammler der Drains hat noch keinen dauerhaften Aufrufer.**
- **Ein Objektname kann persönliche Angaben enthalten** und geht trotzdem hinaus, weil die Console ihn zeigt.
- **Das Urteil kann eine Bedingung nicht auswerten**, die eine Einstellung oder Funktion liest.
- **Im Browser nicht gesehen.**
