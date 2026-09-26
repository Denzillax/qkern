# Release 2.41.0 – Das Schema als Bild

Tabellen, Spalten und Fremdschlüssel eines Schemas als Diagramm. Nur lesend,
aus dem Katalog, ohne neue Abhängigkeit.

## Was neu ist

- Ansicht Datenbank, Schema-Visualizer statt Platzhalter.
- Data-Plane-Methode `inspectForeignKeys`: Spalten in Schlüsselreihenfolge, Aktionen als Wörter, fremdes Schema benannt.
- Route `GET .../schema/foreign-keys?schema=`.
- Geometrie als reine Funktion, gegen Überschneidung geprüft von 1 bis 40 Tabellen.
- Dieselbe Liste in Worten neben dem Bild, `role="img"` mit Beschriftung.
- PostgreSQL-Zertifizierung von 177 auf 178 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 178/178, exit 0 | `docs/evidence/2026-09-26/schema-visualizer-run1.manifest.json` |
| PostgreSQL 17, 178/178, exit 0 | `docs/evidence/2026-09-26/schema-visualizer-run2.manifest.json` |
| Mutation im Stack, 177/178, exit 1 | `docs/evidence/2026-09-26/schema-visualizer-mutation.manifest.json` |
| Vitest lokal 1375/1375, exit 0 | `docs/evidence/2026-09-26/schema-visualizer-local-run1.manifest.json` |
| Vitest lokal 1375/1375, exit 0 | `docs/evidence/2026-09-26/schema-visualizer-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Das Bild bleibt etwa bis fünfzehn Tabellen lesbar.** Kanten weichen keinem Kasten aus.
- **Primärschlüssel fehlen im Bild**, weil die Schema-Route sie nicht liefert.
- **Kein Schema-Wähler**, die Ansicht zeigt `public`.
- **Die neue Route nennt Namen aus fremden Schemas**, die die Schema-Route nicht zeigt. Nur Namen, keine Daten, kein zusätzliches Recht.
- **Die Mutation fällt nur im Stack**, weil die Reihenfolge nur am echten Katalog beweisbar ist.
- **Im Browser nicht gesehen.**
