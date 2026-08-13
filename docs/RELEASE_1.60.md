# Release 1.60.0 — Die offene Frage wird kleiner

## Die Spur aus 1.59

> Der Fehler tritt im Zweig `quarantineExpired` → `claimNext` auf, läuft bei
> **jedem** Takt und verschluckt seine Ursache.

Die Spur ist abgearbeitet — und sie führt nicht dorthin.

## Was jetzt belegt ist

**Beide Operationen funktionieren gegen echtes PostgreSQL**, ausgeführt von
`qkern_provisioner_app` und nicht von einer Eigentümerrolle:

- Ein wartender Auftrag wird übernommen und bekommt eine Lease.
- Der Aufräumer lässt eine frische Lease in Ruhe.
- Ein fremder Auftrag bleibt unberührt.

Das ist die schwächere Aussage als ein Prozessnachweis — und sie ist belegt,
während der Prozessnachweis es nicht ist.

## Wie diagnostiziert wurde

Lokal, gegen eine einzeln gestartete Datenbank statt über den vollen Stack:
Sekunden statt Minuten je Versuch. Das ist die Lehre aus sieben Zyklen in 1.59 —
wer eine Frage verengen will, sollte den kleinsten Aufbau wählen, in dem sie noch
dieselbe ist.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Mandantenbedingung zu `(organization_id = $1 OR true)` aufgeweicht | **kein Fall fällt** — die Grenze trägt RLS, nicht das Prädikat |
| Übernommen werden nur noch `failed` statt `pending` | 126 von 127 — genau der Übernahmefall |

Dass die erste Probe nicht traf, ist selbst ein Befund: Vom Adapter aus lässt
sich die Mandantengrenze nicht brechen. Dasselbe stand schon in Release 1.37
über den Aufräumer des Change-Feeds.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 127/127, exit 0 | `docs/evidence/2026-08-08/provisioning-port-run1.manifest.json` |
| PostgreSQL 127/127, exit 0 | `docs/evidence/2026-08-08/provisioning-port-run2.manifest.json` |
| Mutation Übernahmestatus 126/127 | `docs/evidence/2026-08-08/provisioning-port-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Prozessnachweis fehlt weiterhin.** Neu ist, dass er **nicht** an den
  beiden Abfragen scheitert, die im selben Block stehen.
- **Der nächste Kandidat ist der Unterschied zwischen den Umgebungen**: hier eine
  einzeln gestartete Datenbank, dort ein Stack mit parallelen Testdateien.
- **Die Übernahme wird nicht exklusiv geprüft.** Dass zwei Provisioner denselben
  Auftrag nicht doppelt bekommen, trägt `FOR UPDATE SKIP LOCKED` — hier läuft nur
  einer.
