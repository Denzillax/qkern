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
| GitHub Actions, drei Betriebssysteme gruen | `docs/evidence/2026-09-25/github-dx-run-36163798505.json` |
| PostgreSQL 17 161/161, exit 0 | `docs/evidence/2026-09-25/postgres-pool-listener-run1.manifest.json` |
| PostgreSQL 17 161/161, exit 0 | `docs/evidence/2026-09-25/postgres-pool-listener-run2.manifest.json` |
| Mutation 1/1 faellt, exit 1 | `docs/evidence/2026-09-25/pool-listener-mutation.manifest.json` |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/pool-listener-local-run1.manifest.json` |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/pool-listener-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Der GitHub-Lauf auf diesem Stand steht noch aus.**
- **Lizenz und `private` sind Denzils Entscheidung.** Ohne sie laedt der
  Workflow nichts hoch.
- **Der Teardown beendet weiterhin fremde Verbindungen mit FORCE.** Der
  Prozess-Pool wird nicht sauber geschlossen, nur ueberlebt.
