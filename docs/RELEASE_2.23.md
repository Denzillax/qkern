# Release 2.23.0 – Was das Review fand

Ein Review der Releases 2.14 bis 2.22 fand zwei echte Fehler. Beide sind
behoben.

## Rollen nur fuer diese Datenbank

`/schema/roles` las den ganzen Cluster, mitsamt Steuerungsrollen und
Superuser. Jetzt nur Rollen, die diese Datenbank betreffen, und nie
Superuser. Die Notiz zu 2.20 nannte die Route "datenbankweit"; das war
sie nicht.

## Namen, wie der Katalog sie liefert

Ein Policy-Name mit Leerzeichen oder ein Index mit Grossbuchstaben leerte
eine ganze Ansicht. Katalognamen werden jetzt auf Typ, Laenge und
Steuerzeichen geprueft, nicht auf Bezeichner-Grammatik.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/review-run1.manifest.json` |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/review-run2.manifest.json` |
| Mutation 168/169, exit 1 | `docs/evidence/2026-09-25/review-mutation.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/review-local-run1.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/review-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Der Table Editor prueft Namen noch nach der alten Grammatik.** Das ist
  ein Vertrag aus 1.x mit Folgen fuer die Data API, eigener Slice.
- **Erweiterungen sind serverweit**, nicht je Datenbank; die Ansicht sagt
  es nicht.
