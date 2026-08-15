# Release 1.61.0 — Der Herzschlag, den niemand schreiben konnte

## Der Fund

Der Provisioner konnte seit Migration 0021 **keinen einzigen Heartbeat
schreiben** — und damit nie arbeiten.

`heartbeat()` schreibt mit `INSERT … ON CONFLICT (organization_id,
provisioner_id) DO UPDATE`. PostgreSQL verlangt für den Konfliktpfad
SELECT-Recht auf den Spalten des Arbiter-Index. Migration 0021 hat mit
`REVOKE ALL` alles genommen und danach nur `INSERT` und `UPDATE (last_seen_at)`
erteilt. Der Aufruf endet mit `permission denied for table`, schon beim ersten
Einfügen: Das Recht wird beim Planen geprüft, nicht erst beim Konflikt.

Er steht als **erster** Aufruf in demselben `try`, das auch `quarantineExpired`
umfasst — und dessen `catch` verschluckt die Ursache. Jede Runde endete deshalb
in `claim_failed`, bevor sie einen Auftrag auch nur gesucht hat.

Das ist die achte Ausprägung derselben Sache: gebaut, dokumentiert, in einer
Zertifizierung als Bibliothek grün — und im Betrieb wirkungslos, weil der Weg
dorthin an einer Stelle klemmt, die niemand entlanggelaufen ist.

## Der Weg dorthin

Release 1.59 vermutete den Fehler im Zweig `quarantineExpired` → `claimNext`.
Release 1.60 hat beide gegen echtes PostgreSQL belegt und die Vermutung damit
widerlegt. Übrig blieb genau ein Aufruf im selben Block — und der war es.

Eine widerlegte Vermutung ist hier kein verlorener Zyklus gewesen: Sie hat den
Suchraum auf eine Zeile reduziert.

## Migration 0036

```sql
GRANT SELECT (organization_id, provisioner_id)
  ON project_database_provisioner_heartbeats TO qkern_provisioner;
```

Genau die beiden Arbiter-Spalten und keine weitere. Die Zeilenpolitik aus 0021
bleibt die Grenze: Sie bindet jeden Zugriff an `qkern.actor_ref`.

## Was belegt ist

- Der Heartbeat wird geschrieben und danach aufgefrischt — Einfüge- und
  Konfliktpfad.
- Ein Provisioner sieht den Heartbeat eines anderen **nicht**.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Leserecht auf `started_at, last_seen_at` statt auf die Arbiter-Spalten | **127 von 129** — genau die zwei neuen Fälle |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 129/129, exit 0 | `docs/evidence/2026-08-15/provisioner-heartbeat-run1.manifest.json` |
| PostgreSQL 129/129, exit 0 | `docs/evidence/2026-08-15/provisioner-heartbeat-run2.manifest.json` |
| Mutation 127/129 | `docs/evidence/2026-08-15/provisioner-heartbeat-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. 36 Migrationen.

## Ehrlich offen

- **Der Prozessnachweis fehlt weiterhin.** Was ihm im Weg stand, ist weg; was
  noch fehlt, ist ein Broker, den der Provisioner rufen kann. Der
  Zertifizierungsstack hat noch keinen.
- **Der `catch` verschluckt die Ursache immer noch.** `claim_failed` nennt
  keinen Code, und genau das hat diesen Fehler so lange getragen. Ein fester,
  redigierter Fehlercode an dieser Stelle steht aus.
- **Andere `ON CONFLICT`-Pfade sind nicht durchgesehen.** Wenn dieses
  Rechtemuster einmal falsch war, kann es das an weiteren Stellen sein.
