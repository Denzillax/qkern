# Release 1.75.0 — Der Editor hört auf zu schauspielern

Sprosse 9 der Paritätsleiter: **Der SQL-Editor der Console ist echt.**

## Der Fund

Der SQL-Editor zeigte auf „Validate query" **vorbereitete Beispielzeilen** —
`ord_01JZ · CHF 184.00 · paid`, hartkodiert — und rief die Query-Route nie.
Dabei existiert der echte Weg seit langem: `POST …/query`, dahinter
`queryReadOnly` mit Parser-Wächter, `BEGIN READ ONLY`, Zeitbudgets, Zeilen-
und Bytelimit und Redaktion.

Das ist die Signatur-Fehlerklasse dieser Sprint — gebaut und nie gerufen — in
ihrer neunten Ausprägung, diesmal als Fläche: Der Editor sah aus wie ein
Editor und war eine Attrappe. Und das Rückgrat darunter war **ausschliesslich
mit Mocks getestet**.

## Was sich ändert

- **Die Console führt Read-only-SQL wirklich aus**: echte Spalten, echte
  Zeilen, ehrliches `truncated`, Fehlercodes im Klartext. Schreibende
  Statements gehen weiter den bestehenden Weg: Sie werden ein geprüftes
  Change Set, nie eine Direktausführung.
- **Das Rückgrat ist zertifiziert** — zum ersten Mal gegen echtes PostgreSQL:
  - Echte `SELECT`-Zeilen mit `truncated`, wenn das Limit greift.
  - Eine Spalte, die wie ein Geheimnis heisst (`api_key`), verlässt QKERN
    **nie** im Klartext — auch nicht über den SQL-Editor.
  - Ein `UPDATE` als Abfrage getarnt wird abgewiesen, ein Multi-Statement
    ebenso — und die Daten bleiben nachweislich unverändert.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Parser-Wächter wird entfernt | **148 von 149** — genau der Abwehrfall. Bemerkenswert: Die Daten blieben auch unter Mutation unverändert, weil `BEGIN READ ONLY` als zweite Linie stand — aber der zugesagte Fehlercode fehlte, und genau daran fiel der Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 149/149, exit 0 | `docs/evidence/2026-08-16/sql-editor-run1.manifest.json` |
| PostgreSQL 149/149, exit 0 | `docs/evidence/2026-08-16/sql-editor-run2.manifest.json` |
| Mutation 148/149 | `docs/evidence/2026-08-16/sql-editor-mutation.manifest.json` |

42 Migrationen. Lokal: 1064 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die Console-Ansicht selbst ist nicht automatisiert getestet.** Zertifiziert
  ist das Rückgrat, das sie ruft; die Routen-Tests decken die HTTP-Grenze.
  Ein Browser-E2E existiert im Projekt nicht.
- **Die Ergebnisdarstellung ist Zeilen als Text**, keine Tabelle mit
  Spaltenköpfen — bewusst schlicht gehalten.
- **Das 5-Sekunden-Zeitbudget der Abfrage ist nicht als Fall belegt** — ein
  verlässlicher Langläufer im Wegwerfstack wäre selbst ein Flakiness-Risiko.
