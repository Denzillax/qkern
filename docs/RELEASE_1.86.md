# Release 1.86.0 — Zählen unter der eigenen Grenze

Die Lücke „Aggregate" der Paritätsleiter (Data API) ist geschlossen:
count, sum, avg, min und max — mit optionaler Gruppierungsspalte, unter der
RLS des Aufrufers.

## Dieselben Grenzen wie das Listen

Nur wählbare, nicht-sensible Spalten; dieselben Filter; Views nur mit
`security_invoker`. sum/avg verlangen einen numerischen Typ, min/max einen
sortierbaren; `count(*)` braucht keine Spalte. Zähler und Summen kommen als
**Dezimalstrings** — bigint/numeric verlören in JSON sonst Präzision. Mehr
als 100 Gruppen werden beschnitten und als `truncated` genannt, nicht
verschwiegen.

Die Route `GET …/tables/<table>/aggregate?fn=count&fn=sum:amount&group=…`
importiert die Fehlergrenze der Zeilenliste, statt sie zu duplizieren — der
Routen-Grenzen-Vertrag zählt weiterhin genau die deklarierten Grenzen.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 156 Fälle): A zählt nur seine eigene Zeile —
auch gruppiert nach `owner_id` erscheint nur die eigene Gruppe, gefiltert auf
B ergibt 0. `min(api_token)` ist text und damit sortierbar: Zwischen `min()`
und dem Geheimnis steht **allein** die Sensibel-Prüfung. `sum(name)`
scheitert am Typ.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Sensibel-Prüfung fällt aus der Spaltenwahl der Aggregate | **155 von 156** — genau der Aggregat-Fall: `min(api_token)` läse ein Geheimnis |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 156/156, exit 0 | `docs/evidence/2026-09-24/aggregates-run1.manifest.json` |
| PostgreSQL 156/156, exit 0 | `docs/evidence/2026-09-24/aggregates-run2.manifest.json` |
| Mutation 155/156 | `docs/evidence/2026-09-24/aggregates-mutation.manifest.json` |
| Vitest lokal 1078/1078, exit 0 | `docs/evidence/2026-09-24/aggregates-local-run1.manifest.json` |

44 Migrationen.

## Ehrlich offen

- **Eine Gruppierungsspalte, kein HAVING** — bewusst der kleinste Schnitt.
- **Aggregate stehen weder im OpenAPI-Dokument noch im SDK.**
- **Eingebettete Joins** bleiben die letzte Data-API-Lücke der Leiter.
