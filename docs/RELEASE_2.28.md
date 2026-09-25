# Release 2.28.0 – Was das zweite Review fand

Ein zweites Review der Releases 2.24 bis 2.26. Sechs Befunde, alle
behoben, keiner ein Loch in der Mandantengrenze.

## Die Befunde

- Eine nicht registrierte Unterklasse einer Fehlerklasse haette die Namen
  ihres Vorfahren als eigene genommen. Jetzt je Klasse registriert.
- Ein RPC-Pflichtargument namens `valueOf` galt als geliefert, weil
  `"valueOf" in {}` wahr ist. Jetzt nur eigene Schluessel.
- Der Data-Plane-Dienst wurde erst nach dem `await` gemerkt; gleichzeitige
  erste Anfragen bauten mehrere. Jetzt sofort gemerkt, Abgelehntes
  vergessen, Abgeschaltetes am Literal erkannt.
- Die OpenAPI nannte noch die alte Namensgrammatik.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 171/171, exit 0 | `docs/evidence/2026-09-25/review2-run1.manifest.json` |
| PostgreSQL 17 171/171, exit 0 | `docs/evidence/2026-09-25/review2-run2.manifest.json` |
| Mutation 170/171, exit 1 | `docs/evidence/2026-09-25/review2-mutation.manifest.json` |
| Vitest lokal 1161/1161, exit 0 | `docs/evidence/2026-09-25/review2-local-run1.manifest.json` |
| Vitest lokal 1161/1161, exit 0 | `docs/evidence/2026-09-25/review2-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Gleichzeitige erste Anfragen sind nicht nachgestellt**, nur die
  Reihenfolge von Merken und `await`.
- **Die Namenslisten in den Basisklassen sind Altlast.** Sie stoeren
  nicht.
