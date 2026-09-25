# Release 2.18.0 – Funktionen aus dem Katalog

Zweiter Schritt von Punkt 2: die Funktionen und Prozeduren eines Schemas,
gelesen aus `pg_proc`, nach dem Muster der Trigger aus 2.9.

## Was es tut

`GET /schema/functions?schema=public` liefert Name, Art (Funktion oder
Prozedur), Sprache, Signatur, Identitaets-Signatur, Rueckgabetyp, ob eine
Menge zurueckkommt, Volatilitaet und SECURITY DEFINER. Aggregate,
Fensterfunktionen und der Quelltext bleiben draussen. Die Console zeigt
die Liste unter Datenbank, Funktionen, in vier Sprachen.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 162/162, exit 0 | `docs/evidence/2026-09-25/functions-run1.manifest.json` |
| PostgreSQL 17 162/162, exit 0 | `docs/evidence/2026-09-25/functions-run2.manifest.json` |
| Mutation 161/162, exit 1 | `docs/evidence/2026-09-25/functions-mutation.manifest.json` |
| Vitest lokal 1127/1127, exit 0 | `docs/evidence/2026-09-25/functions-local-run1.manifest.json` |
| Vitest lokal 1127/1127, exit 0 | `docs/evidence/2026-09-25/functions-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Kein Quelltext.** Er kann Geheimnisse tragen; eine eigene Ansicht mit
  bewusstem Oeffnen folgt.
- **Nur Schema `public`** in der Console, wie bei den Triggern.
- **Im Browser nicht gesehen.** Denzils Console-Konto fehlt seit dem
  Neustart des Dev-Servers.
