# Release 2.26.0 – Namen mit Grossbuchstaben

Tabellen wie `"Order"` und Spalten wie `"createdAt"`, wie Prisma, TypeORM
und Drizzle sie anlegen, erscheinen jetzt im Table Editor, in der
generierten REST-API, in den erzeugten Typen der CLI und im SDK.

## Was es tut

Eine Namensgrammatik fuer Tabellen, Spalten, Funktionen und Argumente:
Gross- und Kleinbuchstaben, Ziffern, Unterstrich, hoechstens 63 Zeichen.
Kein Leerzeichen, kein Anfuehrungszeichen. Jeder Name landet nur ueber
`"..."` in SQL; Injektionen bleiben abgewiesen. Schemanamen bleiben klein.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 170/170, exit 0 | `docs/evidence/2026-09-25/names-run1.manifest.json` |
| PostgreSQL 17 170/170, exit 0 | `docs/evidence/2026-09-25/names-run2.manifest.json` |
| Mutation 168/170, exit 1 | `docs/evidence/2026-09-25/names-mutation.manifest.json` |
| Vitest lokal 1158/1158, exit 0 | `docs/evidence/2026-09-25/names-local-run1.manifest.json` |
| Vitest lokal 1158/1158, exit 0 | `docs/evidence/2026-09-25/names-local-run2.manifest.json` |

`next build` gruen, Tarballs geprueft.

## Ehrlich offen

- **Schemanamen bleiben klein.** `public` ist die Regel.
- **Nachtrag:** `@qkern/sdk@1.7.0-alpha.5` und `@qkern/cli@1.7.0-alpha.5`
  sind auf npm (`docs/evidence/2026-09-25/github-publish-alpha5-36182682935.json`),
  frische Installation geprueft. GitHub-Laeufe auf 2.26.0 gruen
  (36182329349, 36182329347).
- **Im Browser nicht gesehen.** Der Dev-Server hat keine Projektdatenbank.
