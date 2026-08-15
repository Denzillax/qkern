# Release 1.63.0 — Ein Muster, das sich selbst findet

Release 1.62 endete mit dem Satz, drei Treffer desselben Rechtemusters in zwei
Releases seien kein Zufall. Dieses Release macht daraus einen Vertrag — und der
Vertrag hat sofort einen vierten gefunden, den schwersten von allen.

## Der Fund

**Seit Migration 0019 konnte die Control Plane keinen Apply-Auftrag mehr
einreihen.**

`enqueueApproved()` schreibt das Auftragsereignis mit
`INSERT … ON CONFLICT (organization_id, migration_job_id, event_type)
DO NOTHING`. Ein **benannter** Arbiter verlangt Leserecht auf genau diesen
Spalten. Migration 0019 hat `SELECT ON migration_outbox` von `qkern_runtime`
entzogen — mit gutem Grund, denn die Laufzeit soll weder Lease noch
Broker-Zustand einsehen — und damit zugleich das Einreihen abgeschaltet.

Auftrag und Ereignis stehen in einer Transaktion. Es entstand also nicht ein
Auftrag ohne Ereignis, sondern **gar nichts**: Jede Freigabe mit automatischer
Einreihung scheiterte.

Alles dahinter war zertifiziert — Worker, Ledger, Publisher, der Prozess, der
in einer echten Projektdatenbank anwendet. Nur konnte nie jemand einen Auftrag
davorstellen. Die Testaufbauten haben ihre Zeilen als Eigentümer geschrieben,
und die Eigentümerrolle darf alles.

## Der Vertrag

`tests/sql-privilege-clause-contract.integration.test.ts` liest zweierlei und
pflegt nichts:

- die Anweisungen aus dem Adapter — inklusive der Spaltenlisten, die als
  Konstante interpoliert werden;
- die Rechte aus dem **laufenden Cluster**, Rolle für Rolle, Spalte für Spalte.

Regel: Wer eine Anweisung mit benanntem `ON CONFLICT`-Arbiter oder mit
`RETURNING` ausführen darf, muss die betroffenen Spalten auch lesen dürfen.
Geprüft wird nur gegen Rollen, die diese Art Schreibzugriff überhaupt haben —
einer Rolle ohne `INSERT` ein Leserecht abzuverlangen wäre das Gegenteil von
eng.

95 Anweisungen fallen darunter. Was der Vertrag nicht auflösen konnte — 9
Spaltenlisten, 471 Platzhalter —, meldet er, statt es zu verschweigen.

## Was `ON CONFLICT` wirklich verlangt

Gemessen, nicht angenommen:

| Anweisung | Ergebnis ohne Leserecht |
| --- | --- |
| `INSERT` schlicht | läuft bis zur Zeilenpolitik |
| `INSERT … ON CONFLICT DO NOTHING` | läuft bis zur Zeilenpolitik |
| `INSERT … ON CONFLICT (spalten) DO NOTHING` | **permission denied** |

Der **benannte** Arbiter ist es. Er steht absichtlich da: Er benennt, welche
Gleichheit gemeint ist, statt jede beliebige Verletzung schweigend zu
schlucken.

## Migration 0038

```sql
GRANT SELECT (organization_id, migration_job_id, event_type)
  ON migration_outbox TO qkern_runtime;
```

Genau die drei Arbiter-Spalten. `status`, `lease_owner`, `lease_token`,
`lease_expires_at`, `failure_count` und `available_at` bleiben unlesbar — ein
eigener Fall belegt das, damit aus einer Reparatur keine Rechteerweiterung
wird.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Leserecht auf `created_at` statt auf die Arbiter-Spalten | **130 von 134** |

Es fallen die beiden Einreihungsfälle und der Vertrag selbst — genau die drei,
die davon abhängen.

Ein **vierter** Fall ist mitgefallen, der nichts damit zu tun hat: `claims every
message exactly once across six competing instances`. Er liegt auf dem
Queue-Weg, den die Mutation nicht berührt, und beide grünen Läufe haben ihn
bestanden. Er steht in den Belegen und in der Liste unten.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 134/134, exit 0 | `docs/evidence/2026-08-15/privilege-clause-run1.manifest.json` |
| PostgreSQL 134/134, exit 0 | `docs/evidence/2026-08-15/privilege-clause-run2.manifest.json` |
| Mutation 130/134 | `docs/evidence/2026-08-15/privilege-clause-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. 38 Migrationen.

## Ehrlich offen

- **Ein Lastfall ist einmal in drei Läufen gescheitert**, mit einem
  `PersistenceError` beim Einreihen unter sechs konkurrierenden Instanzen. Nicht
  erklärt, nicht reproduziert, nicht weggelassen.
- **Der Vertrag liest SQL mit Ausdrücken, nicht mit einem Parser.** Er löst
  interpolierte Spaltenkonstanten auf und meldet, was er nicht lesen konnte —
  aber eine Anweisung, die er falsch abgrenzt, prüft er auch falsch.
- **Er prüft zwei Klauseln.** `ON CONFLICT` mit benanntem Arbiter und
  `RETURNING`. Andere Klauseln mit eigenen Rechtebedingungen sind nicht erfasst,
  weil keine bisher aufgefallen ist — das ist eine Beobachtung, kein Beweis.
- **Er läuft nur im PostgreSQL-Stack.** Ohne Cluster gibt es keine Rechte zu
  lesen; lokal ist er übersprungen, nie bestanden.
