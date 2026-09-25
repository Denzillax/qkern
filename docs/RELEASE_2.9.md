# Release 2.9.0 – Trigger aus dem Katalog

Der erste Schritt, die Funktionen von Supabase Studio zu übertragen. Nicht
deren Code, sondern das Verhalten: pg-meta ist ein Satz Katalogabfragen,
und QKERN hat mit `/schema` schon eine. Die erste neue Objektart sind die
Trigger.

## Was neu ist

`inspectTriggers` im Data-Plane-Port läuft durch denselben Weg wie die
Schemaabfrage: lesende Transaktion, geprüfte Rollen- und Datenbankgrenze,
Timeouts. Die Abfrage ist aus `triggers.sql` von supabase/postgres-meta
(Apache 2.0) abgeleitet und auf `pg_catalog` reduziert: die Bits in
`tgtype` entscheiden über Zeitpunkt, Ebene und Ereignisse, die
WHEN-Bedingung kommt aus `pg_get_triggerdef`, interne Trigger bleiben
draussen, die Liste endet bei 200 mit ehrlichem `truncated`.

Die Route `GET /schema/triggers` geht durch dieselbe Tür wie `/schema`. Die
Console zeigt die Trigger des Schemas `public` mit Filter; anlegen läuft
weiter über ein Change Set.

## Gegenprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Filter `NOT tgisinternal` fällt aus der Abfrage | **160 von 161** – genau der Trigger-Fall: der Fremdschlüssel-Trigger erscheint |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 161/161, exit 0 | `docs/evidence/2026-09-25/triggers-run1.manifest.json` |
| PostgreSQL 161/161, exit 0 | `docs/evidence/2026-09-25/triggers-run2.manifest.json` |
| Mutation 160/161 | `docs/evidence/2026-09-25/triggers-mutation.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/triggers-local-run1.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/triggers-local-run2.manifest.json` |

## Ehrlich offen

- **Nur Trigger.** Funktionen, Indizes, Enum-Typen, Erweiterungen, Rollen,
  Policies, Publikationen und Spaltenrechte folgen nach demselben Muster.
- **Nur das Schema `public`** in der Console; die Route nimmt jedes.
- **Sichtprüfung im Browser** steht aus, bis sich Denzil neu registriert.
