# Release 2.20.0 – Der Rest des Katalogs

Erweiterungen, Rollen, Publikationen und Spaltenrechte. Damit sind alle
Katalog-Ansichten aus Supabase Studio, die nur lesen, in der Console.

## Was es tut

`/schema/extensions`, `/schema/roles`, `/schema/publications` sind
datenbankweit und nehmen keinen Parameter an. `/schema/column-privileges`
gilt je Schema und zeigt die je Spalte gesetzten Rechte, gruppiert je
Spalte und Rolle, PUBLIC eingeschlossen. Alles nur lesend.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/catalog-wide-run1.manifest.json` |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/catalog-wide-run2.manifest.json` |
| Mutation Erweiterungen 168/169, exit 1 | `docs/evidence/2026-09-25/catalog-wide-mutation-extensions.manifest.json` |
| Mutation Rollen 168/169, exit 1 | `docs/evidence/2026-09-25/catalog-wide-mutation-roles.manifest.json` |
| Mutation Publikationen 168/169, exit 1 | `docs/evidence/2026-09-25/catalog-wide-mutation-publications.manifest.json` |
| Mutation Spaltenrechte 168/169, exit 1 | `docs/evidence/2026-09-25/catalog-wide-mutation-privileges.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/catalog-wide-local-run1.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/catalog-wide-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Tabellenrechte stehen nirgends.** Nur die je Spalte gesetzten.
- **Im Browser nicht gesehen.** Das Console-Konto fehlt seit dem Neustart
  des Dev-Servers.
- **Schema-Visualizer, Tabellen-Verwaltung und Replikation** bleiben
  Platzhalter; sie brauchen Schreibpfade, nicht nur Lesen.
