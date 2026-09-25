# Release 2.16.0 – Apache 2.0

`@qkern/sdk` und `@qkern/cli` stehen unter Apache License 2.0, Denzils
Entscheidung. Die Plattform selbst bleibt unlizenziert.

## Was drin ist

`LICENSE` in beiden Paketen und im Tarball, `license: "Apache-2.0"`,
`private` entfernt, ein Abschnitt im README. Der Vertrag prueft alle drei.
Die Namen sind auf npm frei, die Organisation `qkern` gehoert Denzil.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/apache-local-run1.manifest.json` |
| Vitest lokal 1119/1119, exit 0 | `docs/evidence/2026-09-25/apache-local-run2.manifest.json` |

`next build` gruen, Tarballs geprueft. Stacks unveraendert.

## Ehrlich offen

- **Noch nichts veroeffentlicht.** Der Probelauf des Workflows ist gruen
  (`docs/evidence/2026-09-25/github-publish-dryrun-36165337979.json`):
  `@qkern/sdk` 11,1 kB in 7 Dateien, `@qkern/cli` 11,7 kB in 12 Dateien,
  beide mit `LICENSE`, Ziel registry.npmjs.org, Tag `alpha`, oeffentlich.
  Die echte Veroeffentlichung wartet auf Denzils Okay.
