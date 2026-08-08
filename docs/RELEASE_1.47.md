# Release 1.47.0 — Die Probe wird Pflicht

## Korrektur zu 1.46

**Die Aussage in Release 1.46 war falsch.**

Dort steht, `createLoopbackRuntimeProbeFromEnv` rufe „kein einziger Prozess" auf.
Richtig ist: **Vier von sieben taten es seit der Baseline `1.8.0`** —
Migrationen, Apply-Publisher, Incident-Publisher und Provisioner. Ohne Probe
waren nur Compute, Realtime und der Queue-Wirt.

Der Fehler war meiner und banal. Ich hatte mit drei Mustern gesucht:
`new RuntimeProbeState`, `createRuntimeProbeServer` und `runtimeProbe`. Das erste
kommt nur in der Fabrik selbst vor, das zweite gibt es nicht, und das dritte traf
`createLoopbackRuntimeProbeFromEnv` wegen der Gross-/Kleinschreibung nicht. Kein
Treffer — und daraus eine Aussage über sieben Prozesse.

`docs/RELEASE_1.46.md` bleibt unverändert; historische Release Notes werden nicht
nachträglich geglättet. Die Korrektur steht hier, in `docs/QA.md` und in
`STATUS.md`.

Was inhaltlich stimmt: Der Compute-Prozess startete die Probe wirklich nicht, das
Ordnungsproblem mit dem Erfolgssignal war echt, und die Zertifizierung von 1.46
belegt, was sie belegt. Falsch war allein die Reichweite.

## Der Vertrag dagegen

Dieselbe Lehre wie in 1.39 und 1.40, diesmal an einer Aussage statt an einer
Zahl: `tests/worker-probe-contract.test.ts` zählt aus, welche Prozesse die Probe
starten.

Realtime steht mit Begründung auf der Ausnahmeliste. Es ist ein Server ohne
Runde, und `ready` verlangt eine gelungene Runde — ohne Postgres Changes tickt
dort gar nichts. Ein Herzschlag-Timer wäre ein Signal, das nur behauptet, dass
der Prozess lebt; das sagt `live` bereits.

## Der Queue-Wirt meldet sich

`ProjectQueueWorkerRuntime` nimmt seit Alpha 1 einen `probe` entgegen —
durchgereicht hat ihn niemand. Seit diesem Release tut der Wirt das, und der
Prozess startet den Listener:

```bash
QKERN_RUNTIME_PROBE_ENABLED=true npm run worker:queues
```

Der Functions-Lauf fragt `/ready`, **solange der Prozess läuft** — nach dem
Beenden antwortet niemand mehr, und der Fall wäre grün aus dem falschen Grund.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Der Wirt reicht den Beobachter nicht mehr durch | 25 von 26 — genau der Prozess-Fall; `/ready` bliebe 503, während Nachrichten verarbeitet werden |
| Dem Wirt wird der Probe-Aufruf genommen | Der Vertrag nennt die Datei namentlich |

## Belege

| Lauf | Manifest |
| --- | --- |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-08/queue-probe-run1.manifest.json` |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-08/queue-probe-run2.manifest.json` |
| Mutation Beobachter 25/26 | `docs/evidence/2026-08-08/queue-probe-mutation.manifest.json` |
| PostgreSQL 120/120, exit 0 | `docs/evidence/2026-08-08/queue-probe-postgres.manifest.json` |

Lokal: 1012 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Vertrag prüft, dass ein Prozess die Fabrik aufruft** — nicht, dass die
  Probe danach etwas Wahres meldet. Zertifiziert ist das für Compute und den
  Queue-Wirt; die vier Migrations-Prozesse melden seit `1.8.0` und haben dafür
  keinen archivierten Lauf.
- **Realtime bleibt ohne Readiness.** Die Ausnahme ist begründet, nicht gelöst.
  Was dort eine gelungene Runde wäre, ist eine offene Produktfrage.
- **Ein Zähler über alle Bindungen.** Scheitert der Claim einer Queue, meldet der
  Wirt für alle `not ready`. Konservativ und grob, wie schon beim Compute-Prozess.
- **Die falsche Aussage aus 1.46 stand einen Tag.** Gefunden habe ich sie selbst,
  beim Weiterarbeiten — nicht durch eine Prüfung. Der Vertrag verhindert die
  Wiederholung, nicht das Entstehen.
