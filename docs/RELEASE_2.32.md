# Release 2.32.0 – Was die Data API kann

Der Platzhalter "Data API" unter Einstellungen ist eine echte Ansicht:
Status, freigegebene Tabellen, Regeln und Grenzen. Nur lesend, und jede
Zahl kommt aus derselben Quelle wie der Server.

## Was neu ist

- Statuskarte aus der generierten OpenAPI mit vier ehrlichen Zuständen.
- Tabellenkarte aus der Schema-Route: RLS an oder aus, freigegeben ja,
  nein oder unbekannt; Views getrennt.
- Regelkarte aus `lib/data-api-limits.ts`; Server und Ansicht teilen die
  Konstanten, ein Vertrag hält sie zusammen.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1270/1270, exit 0 | `docs/evidence/2026-09-26/data-api-view-local-run1.manifest.json` |
| Vitest lokal 1270/1270, exit 0 | `docs/evidence/2026-09-26/data-api-view-local-run2.manifest.json` |
| Mutation 1/1270 fällt, exit 1 | `docs/evidence/2026-09-26/data-api-view-mutation.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Im Browser nur der Ladezustand gesehen**; die Sitzung im Speichermodus
  war abgelaufen. Die Zustände sind durch Tests belegt.
- **`public` ist Standard, nicht einziges Schema.** Die Ansicht sagt das.
- **Weitere Schemata und eine eigene Zeilengrenze** sind nicht verbunden.
- **Provenance beim Publish** ist noch nicht belegt; der Trockenlauf
  übersprang das Veröffentlichen, weil die Version schon auf npm liegt.
