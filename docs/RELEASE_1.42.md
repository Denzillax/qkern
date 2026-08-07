# Release 1.42.0 — Wer ruft das eigentlich?

## Das Muster

Dieser Sprint hat sechsmal dasselbe gefunden:

| Release | Gebaut, zertifiziert — und wirkungslos |
| --- | --- |
| 1.14 | Realtime-Poller |
| 1.15 | Event-Log |
| 1.19 | Webhook-Outbox |
| 1.22 | Functions-Sandbox |
| 1.29 | Usage-Emitter |
| 1.37 | Prune-Pfade |

Jedes Mal war es Handarbeit, und jedes Mal später, als es hätte sein müssen.

## Die stehende Prüfung

`tests/entrypoint-reachability-contract.test.ts` läuft den Importgraphen von
jedem Prozesseinstieg aus — App-Routen, `workers/`, `scripts/`, Middleware — und
meldet, was in `lib/server` liegt, ohne dabei berührt zu werden.

Der Vertrag beweist **Erreichbarkeit, nicht Wirkung**. Ein Modul kann importiert
und nie ausgeführt werden. Das ist die schwächere Aussage und die einzige, die
ein Importgraph tragen kann — sie hätte aber alle sieben Fälle gefunden, denn in
allen sieben fehlte schon der Import.

## Der siebte Fall

Der erste Lauf fand fünf Module.

Drei waren tote Barrel-Dateien — `control-plane/index.ts`, `db/index.ts`,
`migrations/index.ts` —, die niemand importierte. Gelöscht.

Die anderen beiden waren der Fund: `ProjectQueueWorker` und
`ProjectQueueWorkerRuntime` gab es seit Alpha 1, gebaut und getestet, und **kein
Prozess startete sie je**. Nachrichten liessen sich einreihen, und niemand nahm
sie heraus.

## Der Wirt

```bash
npm run worker:queues
```

Jede Bindung in `QKERN_QUEUE_WORKER_BINDINGS_JSON` gibt genau eine Queue an genau
eine hinterlegte Function:

```json
[{"organizationId":"…","projectId":"…","environment":"development","queue":"orders","functionName":"settle-order"}]
```

Die Liste ist ausdrücklich, nicht entdeckt — wie `QKERN_COMPUTE_SCOPES_JSON` und
aus demselben Grund: RLS gibt keine organisationsübergreifende Suche her.

Kapazität, eine fehlende Function und ein überschrittenes Kontingent gelten als
`DEPENDENCY_UNAVAILABLE` und damit als wiederholbar: Alle drei sind Zustände der
Umgebung, die sich ohne Zutun der Nachricht ändern können. Eine fehlkonfigurierte
Bindung landet dadurch irgendwann im Dead Letter — sichtbar, redigiert und ohne
die Nachricht zu verlieren.

Ein `cause` wird nie weitergereicht. Er könnte eine Datenbankmeldung tragen, und
die gehört nicht in ein Queue-Log.

## Was der Fund nebenbei aufgedeckt hat

`docs/PROJECT_QUEUES.md` führte unter „Bewusste Alpha-Grenzen" noch „keine
Functions, Cron-Scheduler, Webhook-Zustellung oder Vault-Secret-Injektion". Alle
vier gibt es seit 1.20 bis 1.26. Korrigiert.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Prozesseinstieg `workers/project-queue-runtime.ts` entfernt | Der Vertrag nennt die ganze Kette — Dispatch, Komposition, Wirt, Runtime, Worker |
| Wirt hört auf `functionName` statt auf `queue` | 114 von 117 — alle drei Real-DB-Fälle tragen die Verdrahtung |
| Handler verschluckt den Fehlschlag | 116 von 117 — genau der Retry-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 117/117, exit 0 | `docs/evidence/2026-08-06/queue-host-run1.manifest.json` |
| PostgreSQL 117/117, exit 0 | `docs/evidence/2026-08-06/queue-host-run2.manifest.json` |
| Mutation Queue-Bindung 114/117 | `docs/evidence/2026-08-06/queue-host-mutation.manifest.json` |
| Mutation Fehlerklassifikation 116/117 | `docs/evidence/2026-08-06/queue-host-mutation2.manifest.json` |

Lokal: 1001 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Vertrag misst Erreichbarkeit, nicht Ausführung.** Ein importiertes Modul
  hinter einem Flag, das nie `true` wird, fällt nicht auf.
- **Er deckt nur `lib/server`.** `app/`, `lib/client` und `components/` sind
  ungeprüft; dort wäre die Aussage auch schwächer, weil Next.js Dateien über
  Konventionen lädt und nicht über Importe.
- **Die `ALLOWED`-Liste ist leer und soll es bleiben.** Sie ist die Stelle, an
  der diese Prüfung stumpf werden kann. Wer dort etwas einträgt, ohne den Grund
  zu meinen, hat sie abgeschaltet und nicht bestanden.
- **Der Wirt kann genau eines.** Eine Nachricht an eine hinterlegte Function.
  Ein allgemeiner Handler-Host, ein Consumer-SDK und eine Console-Fläche für die
  Bindungen fehlen.
- **Kein Lauf mit echtem Container.** Die drei Real-DB-Fälle prüfen den Weg von
  der Queue zur Function; die Sandbox dahinter ist eigens zertifiziert, aber die
  Kette Queue → Container in einem Lauf ist es nicht.
- **Die sechs früheren Fälle bleiben Geschichte, keine Garantie.** Der Vertrag
  hätte sie gefunden — dass er es getan hätte, ist eine Behauptung über die
  Vergangenheit und nicht durch einen Lauf belegt.
