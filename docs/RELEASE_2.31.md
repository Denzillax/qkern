# Release 2.31.0 – Vier Sprachen

Die Einstiegsdoku auf Deutsch, Englisch, Französisch und Italienisch.
Deutsch bleibt das Original; die Website zeigt die Sprache, die der Besucher
gewählt hat, und fällt auf Deutsch zurück, wenn eine Sprache fehlt.

## Was neu ist

- `docs/guide/en/`, `docs/guide/fr/`, `docs/guide/it/`: je fünf Seiten, mit
  denselben Codeblöcken wie das Original und einem Glossar mit 99 Einträgen
  in der Reihenfolge der jeweiligen Sprache.
- Verfügbare Sprachen werden von der Platte erkannt; Seitentitel je Sprache;
  die Vertragstests laufen je Sprache und vergleichen jede Übersetzung mit
  dem Deutschen.
- Repository öffentlich: `LICENSE` an der Wurzel, `git clone` im
  Schnellstart, Herkunftsnachweis im Publish-Workflow standardmässig an.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1264/1264, exit 0 | `docs/evidence/2026-09-26/i18n-docs-local-run1.manifest.json` |
| Vitest lokal 1264/1264, exit 0 | `docs/evidence/2026-09-26/i18n-docs-local-run2.manifest.json` |
| Mutation 1/1264 fällt, exit 1 | `docs/evidence/2026-09-26/i18n-docs-mutation.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Kein Mensch hat die Übersetzungen gegengelesen.** Die Verträge prüfen
  Form und Struktur, nicht den Sinn.
- **Zwei Namen für die Freigabezentrale im Französischen**, Glossar und
  Konsole; im Text erklärt, aber nicht schön.
- **Programmausgaben bleiben deutsch**, etwa die Meldungen des
  Bindungsskripts; die Übersetzungen erklären sie in Klammern.
