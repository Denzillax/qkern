# Release 2.19.0 – Drei aus dem Katalog

Indizes, Policies und Enum-Typen, gelesen aus dem Katalog, nach dem Muster
der Trigger und Funktionen. Drei Routen, drei Ansichten, vier Sprachen.

## Was es tut

`/schema/indexes`: Name, Tabelle, Zugriffsmethode, eindeutig, Primaer,
gueltig, Spalten, Definition, Praedikat. `/schema/policies`: Name, Tabelle,
Befehl, erlaubend oder einschraenkend, Rollen, USING, WITH CHECK.
`/schema/enum-types`: Name und Werte in Typreihenfolge. Alles nur lesend.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 165/165, exit 0 | `docs/evidence/2026-09-25/catalog-run1.manifest.json` |
| PostgreSQL 17 165/165, exit 0 | `docs/evidence/2026-09-25/catalog-run2.manifest.json` |
| Mutation Indizes 164/165, exit 1 | `docs/evidence/2026-09-25/catalog-mutation-indexes.manifest.json` |
| Mutation Policies 164/165, exit 1 | `docs/evidence/2026-09-25/catalog-mutation-policies.manifest.json` |
| Mutation Enums 164/165, exit 1 | `docs/evidence/2026-09-25/catalog-mutation-enums.manifest.json` |
| Vitest lokal 1136/1136, exit 0 | `docs/evidence/2026-09-25/catalog-local-run1.manifest.json` |
| Vitest lokal 1136/1136, exit 0 | `docs/evidence/2026-09-25/catalog-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Nur Schema `public`** in der Console.
- **Im Browser nicht gesehen.** Das Console-Konto fehlt seit dem Neustart
  des Dev-Servers.
- **RLS an oder aus** steht in `/schema`, nicht in der Policy-Liste.
