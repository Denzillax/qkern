# Release 2.15.0 – Was der Runner fand

Der zweite GitHub-Lauf. Developer Experience gruen auf Ubuntu, Windows und
macOS: die erste Evidenz fuer Windows und macOS ausserhalb dieser Maschine.
PostgreSQL: 161 von 161 gruen und trotzdem exit 1.

## Der Fehler

Das Teardown eines Tests raeumt seine Datenbank mit `DROP DATABASE ... WITH
(FORCE)` ab. Das beendet auch die unbenutzte Verbindung eines Pools, den
der Migrationsprozess geoeffnet hatte. node-postgres meldet das als
`error`-Ereignis des Pools, und ohne Zuhoerer ist das ein unbehandelter
Fehler des ganzen Prozesses. Hier hat das Timing nie getroffen, der
schnellere Runner schon.

Ein Dienst darf davon nicht sterben. Der Pool aus `createPostgresPool` hat
jetzt einen Zuhoerer, der den Verlust protokolliert. Vertrag und Mutation
liegen bei.

## Veroeffentlichen

`.github/workflows/publish.yml`, nur von Hand. Der Probelauf ist die
Voreinstellung und laedt nichts hoch. Der echte Lauf verweigert Pakete mit
`private: true` oder `UNLICENSED`; beides steht heute noch drin. Der
`bin`-Pfad der CLI verliert sein `./`, weil npm 11 ihn sonst verwirft.

## Belege

| Lauf | Manifest |
| --- | --- |
| GitHub Actions, drei Betriebssysteme gruen (Stand 2.14.0) | `docs/evidence/2026-09-25/github-dx-run-36163798505.json` |
| GitHub Actions, drei Betriebssysteme gruen (Stand 2.15.0) | `docs/evidence/2026-09-25/github-dx-run-36164575183.json` |
| GitHub Actions, Zertifizierung 161/161, 8/8, 7/7 (Stand 2.15.0) | `docs/evidence/2026-09-25/github-certification-run-36164575195.json` |
| PostgreSQL 17 161/161, exit 0 | `docs/evidence/2026-09-25/postgres-pool-listener-run1.manifest.json` |
| PostgreSQL 17 161/161, exit 0 | `docs/evidence/2026-09-25/postgres-pool-listener-run2.manifest.json` |
| Mutation 1/1 faellt, exit 1 | `docs/evidence/2026-09-25/pool-listener-mutation.manifest.json` |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/pool-listener-local-run1.manifest.json` |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/pool-listener-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Nachtrag:** Der GitHub-Lauf auf diesem Stand ist gruen, alle sechs Jobs
  (`docs/evidence/2026-09-25/github-certification-run-36164575195.json`,
  `github-dx-run-36164575183.json`). Sprosse 7 ist damit fuer die
  Zertifizierung und die drei Betriebssysteme belegt.
- **Lizenz und `private` sind Denzils Entscheidung.** Ohne sie laedt der
  Workflow nichts hoch.
- **Der Teardown beendet weiterhin fremde Verbindungen mit FORCE.** Der
  Prozess-Pool wird nicht sauber geschlossen, nur ueberlebt.
