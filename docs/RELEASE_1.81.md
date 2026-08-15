# Release 1.81.0 — Der Kreis ohne Lücken

Der letzte rein datenbankseitige Billing-Punkt aus `1.68`: Die Rechnung hatte
weder kaufmännische Nummer noch Fälligkeit. Migration 0044 gibt ihr beides —
und die Rechnungen bleiben dabei append-only.

## Die Nummer

Lückenlos je Organisation, monoton, vergeben im selben Statement wie die
Rechnung: Eine datenmodifizierende CTE upsertet den Zähler
(`billing_invoice_counters`), der äussere INSERT trägt die Nummer. Kein
UPDATE trägt je eine Nummer nach.

Die Feinheit, die den SAVEPOINT verlangt: Die CTE läuft **auch dann**, wenn
der äussere INSERT im `ON CONFLICT` der Idempotenz verliert. Deshalb steht
jede Vergabe in einem SAVEPOINT, und der Verlierer rollt seinen Zählerstand
zurück — **eine vergebene Nummer ohne Rechnung ist nicht ausdrückbar.**

## Die Fälligkeit

Fest 30 Tage nach Ausstellung, als DEFAULT auf derselben Transaktionszeit wie
`issued_at` — die Gleichheit `due_at = issued_at + 30 Tage` ist exakt.
Schreibbar ist die Spalte für niemanden: kein Spalten-Grant, keine Policy.

Eine generierte Spalte scheiterte ehrlich: `timestamptz + interval` ist in
PostgreSQL nicht immutable — der erste Stack-Lauf wies die Migration ab,
bevor ein einziger Test lief.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 155 Fälle, 44 Migrationen): Vier Rechnungen
über vier Perioden tragen exakt die Nummern 1 bis 4 — quer über Projekte, mit
einem verlorenen Wiederholungslauf dazwischen, der **keine** Lücke
hinterlässt. `due_at` stimmt für jede Rechnung exakt; der Leser liefert
`invoiceNumber` und `dueAt` an der REST-Fläche mit.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der SAVEPOINT-Rollback des Wettlauf-Verlierers wird entfernt | **154 von 155** — genau der Nummernkreis-Fall: der verlorene zweite Lauf lässt seinen Zählerstand stehen und reisst eine Lücke |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 155/155, exit 0 | `docs/evidence/2026-08-16/invoice-numbers-run1.manifest.json` |
| PostgreSQL 155/155, exit 0 | `docs/evidence/2026-08-16/invoice-numbers-run2.manifest.json` |
| Mutation 154/155 | `docs/evidence/2026-08-16/invoice-numbers-mutation.manifest.json` |

44 Migrationen. Lokal: 1065 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die 30 Tage sind fest** — es gibt keine Zahlungsbedingung je Organisation.
- **Der Zähler serialisiert Rechnungsläufe je Organisation** — bei sehr vielen
  gleichzeitigen Läufen eine bewusste Bremse, keine gemessene.
- **Weiterhin keine Console-Fläche für Rechnungen und keine Zahlungsanbindung.**
