# Release 2.33.0 – Schemanamen mit Grossbuchstaben

Der Schritt, den 2.26 offen liess: Schemanamen der Data API folgen jetzt
derselben Grammatik wie Tabellennamen. `Shop` geht, `pg_*`,
`information_schema` und `qkern_internal` bleiben abgewiesen, und `Shop`
und `shop` sind zwei Schemata.

## Was neu ist

- `isDataSchemaName` als eine Quelle für elf Routen, den Katalogdienst,
  die generierte API und die OpenAPI.
- Ein PostgreSQL-Fall mit einem Schema in Grossschrift und seinem
  Zwilling in Kleinschrift: 172 von 172.
- Der Realtime-Soak-Test hat ein ausdrückliches Wartebudget und eine
  Meldung, die beim Fehlschlag die fehlende Zahl nennt.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 172/172, exit 0 | `docs/evidence/2026-09-26/schema-names-run1.manifest.json` |
| PostgreSQL 17 172/172, exit 0 | `docs/evidence/2026-09-26/schema-names-run2.manifest.json` |
| Mutation 171/172, exit 1 | `docs/evidence/2026-09-26/schema-names-mutation.manifest.json` |
| Vitest lokal 1275/1275, exit 0 | `docs/evidence/2026-09-26/schema-names-local-run1.manifest.json` |
| Vitest lokal 1275/1275, exit 0 | `docs/evidence/2026-09-26/schema-names-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Die OpenAPI für ein fremdes Schema nennt die Pfade ohne
  `schema`-Parameter.** Ein Client, der ihr wörtlich folgt, landet in
  `public`. Das war vor 2.33 schon so.
- **Die Konsole kennt nur `public`.** Ein Schemawechsel im Table Editor
  ist ein eigener Schritt.
- **`PG_x` ist als Nutzerschema erlaubt**, weil PostgreSQL nur das kleine
  `pg_` reserviert.
