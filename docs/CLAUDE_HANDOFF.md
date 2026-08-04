# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `1.11.0`. Sie wird
bei jedem versionierten Stand zusammen mit Quellcode, Status, Handbuch und Release
Note aktualisiert.

## Wichtigster Kontext für den nächsten Agenten

Bis `1.8.0-alpha.1` war **kein einziger Real-Service-Test jemals ausgeführt
worden**. Release 1.9 hat beide Docker-Zertifizierungsstacks zum Laufen gebracht
und dabei fünf Produktfehler gefunden, die nur unter einer realen Datenbank
auftreten. Zwei davon machten einen als fertig dokumentierten Pfad vollständig
funktionsunfähig.

Die Lehre daraus gilt weiter: **Ein grüner `npm test` ist keine Zertifizierung.**
Die Memory-Adapter kennen weder Rechtemodell noch RLS noch Transaktionsgrenze.
Wer einen dauerhaften Adapter anfasst, muss `npm run test:postgres:docker`
ausführen, bevor er ihn als funktionsfähig beschreibt.

## Verbindliche Lesereihenfolge

1. `AGENTS.md`
2. `STATUS.md`
3. `docs/CLAUDE_HANDOFF.md`
4. `docs/STUFENPLAN.md`
5. `docs/HANDBUCH.md`
6. `docs/USAGE_METERING.md`
7. `docs/PROJECT_QUEUES.md`
8. `docs/MODULES.md`
9. `docs/SECURITY.md`
10. `docs/QA.md`
11. `docs/SDK_TYPESCRIPT.md`
12. `docs/CLI.md`
13. `docs/DEVELOPER_EXPERIENCE.md`
14. `docs/RELEASE_1.9.md` und `docs/RELEASE_1.10.md`

Für Realtime-Arbeit zusätzlich `docs/REALTIME_PROTOCOL.md` lesen. Historische
Release Notes bleiben unverändert.

## Aktueller technischer Stand

- Paketversion: `1.11.0`
- Aktueller Slice: 1.11 Realtime Durability and Fan-out — Stufe 1.5 deutlich vorangebracht, aber nicht geschlossen
- Drei Zertifizierungsstacks: `test:postgres:docker`, `test:storage:docker`, `test:auth:docker`
- Letzte Control-Plane-Migration: `db/migrations/0030_realtime_event_log.sql`
- Realtime-Domäne: `lib/server/realtime/` mit `postgres-repository.ts`, `event-bus.ts` und `change-source.ts`
- Evidenz: `docs/evidence/2026-08-04/` mit Rohlogs und generierten Manifesten
- Manifestgenerator: `scripts/certification-manifest.mjs`
- SMTP-Delivery: `lib/server/project-auth/smtp-delivery.ts`
- Usage-Domäne: `lib/server/usage/`
- Usage-REST: `app/api/v1/projects/[projectId]/environments/[environment]/usage/route.ts`
- Usage-Vertrag: `docs/USAGE_METERING.md` und `lib/openapi.ts`
- Queue-Domäne: `lib/server/project-queues/`
- PostgreSQL-Adapter: `lib/server/project-queues/postgres-repository.ts`
- REST-Routen: `app/api/v1/projects/[projectId]/environments/[environment]/queues/`
- Vertrag: `docs/PROJECT_QUEUES.md` und `lib/openapi.ts`
- Worker: `lib/server/project-queues/worker.ts` und `worker-runtime.ts`
- DLQ-Routen: `.../queues/[queue]/dead-letters/`
- Compute-Ports: `lib/server/compute/`
- SDK: `sdk/typescript/src/index.ts`
- CLI: `cli/src/core.ts`, `cli/src/security.ts`, `cli/src/main.ts`
- DX-Gates: `scripts/verify-developer-experience.ts`, `scripts/verify-package-tarballs.mjs`
- Releasevertrag: `.env.example`, `docs/RELEASE_1.10.md`, `STATUS.md`

`ProjectQueueService` besitzt Validierung und Policy. Der vollständige Scope kommt
aus Session beziehungsweise serverseitig aufgelöstem Project Key. Nur
Administratoren verwalten Queues; `service_role` claimt und settlet. MCP exponiert
weiterhin ausschließlich Liste, Status und Enqueue, keine Worker-Leases.

`MemoryProjectQueueRepository` bleibt deterministischer `ephemeral` Test-/Dev-Port.
Bei `QKERN_RUNTIME_MODE=postgres` verdrahtet die Runtime automatisch
`PostgresProjectQueueRepository` über den bestehenden RLS-geprüften Runtime-Pool.
Migration 0026 persistiert Definitionen und Nachrichten mit zusammengesetzten
Tenant-FKs, RLS, enger Spalten-Autorität, verifier-only Dedupe und Leases,
monotoner Claim-Generation, Trigger-gesicherten Übergängen und Retention.

Claims verwenden `FOR UPDATE SKIP LOCKED`. Jeder Claim schreibt Worker,
SHA-256-Lease-Verifier, Ablauf und Generation atomar. Ack, Fail und Renewal müssen
Scope, Queue, Nachricht, Worker, Verifier und aktive Ablaufzeit exakt treffen.
Restart-Persistenz und Multi-Worker-Verteilung sind als vier optionale PostgreSQL-
Integrationstests codiert, konnten hier ohne Docker/PostgreSQL jedoch nicht real
ausgeführt werden.

`ProjectQueueWorker` führt genau einen injizierten Handler pro Claim aus, erneuert
die Lease, erzwingt Timeout/Abort und settlet mit dem ursprünglichen Token.
`ProjectQueueWorkerRuntime` serialisiert Polls und reagiert auf Shutdown. Seine
Ereignisse/Zähler sind redigiert und enthalten keine Payloads, Tokens oder Worker-
IDs. Der Admin-only DLQ-Pfad listet Referenzen ohne Payload und erzeugt über
Migration 0027 genau ein same-tenant Replay pro Dead Letter. Das Replay ist
auditiert und führt im Request keine Arbeit aus.

Alpha 4 ergänzt interne Ports, keine öffentliche Serverless-API. Function-
Definitionen verlangen `nodejs24`, digest-gepinnte Images, bounded Ressourcen,
exakte öffentliche HTTPS-Egress-Origins und Secret-Referenzen. `FunctionInvoker`
begrenzt JSON und Header und erzwingt Timeout/Abort außerhalb der Sandbox.
`WebhookDeliverer` verlangt HTTPS/443 ohne Query/Redirect, Signer-Port, bounded
Payload und Exact-Ack. `CronDispatcher` akzeptiert einen kleinen UTC-Ausdruck und
enqueuet mit deterministischem Occurrence-Dedupe-Key. Details und offene Adapter:
`docs/COMPUTE_CONTRACTS.md`.

Stufe 1.7 Alpha 1 ergänzt `@qkern/sdk`: generischer Database-Typ für Table CRUD,
Schema-, Queue-, Auth- und Storage-Clients, exakte Origin, Header-Credentials,
Timeout/Response-Limit, Redirect-Deny und bounded Fehler. Das SDK wiederholt keine
Writes automatisch und persistiert keine Tokens.

Alpha 2 ergänzt `@qkern/cli`. `init` ist secretfrei und überschreibt nichts;
`schema pull` generiert sortierte Database-Typen ohne sensitive Spalten;
`migration plan` validiert ein Statement und gibt nur Risk/Hash aus; `seed check`
erlaubt bounded INSERTs. Konfiguration und Pfade sind strikt, Project Keys kommen
nur aus `QKERN_PROJECT_KEY`. Kein CLI-Befehl führt SQL aus.

Alpha 3 baut SDK reproduzierbar als ESM/DTS und CLI als eigenständig startbares
Node.js-ESM. Paketmanifeste begrenzen Tarball-Inhalte; `verify:dx:full` kombiniert
Build, Fresh-Project-Smoke und `npm pack --dry-run`. Die Schema-Route verwendet
jetzt dieselbe scope-gebundene Project-Key-Grenze wie Generated Data API, sodass
SDK/CLI Schema Pull ohne Browser-Session funktioniert. Die portable CLI-SQL-Policy
ist durch einen Paritätstest an die Serverpolicy gebunden. Die GitHub-Matrix deckt
Linux, Windows und macOS als ausführbaren Vertrag ab; lokal tatsächlich bestätigt
ist ausschließlich Linux x64/Node 24.

Stufe 1.8 Alpha 1 ergänzt `UsageService` mit sechs festen Metriken, erlaubten
Quelle/Metrik-Paaren, UTC-Monatsfenstern und decimal-string Projektionen. Interne
`meter` erfassen idempotente Events; rohe Schlüssel werden ausschließlich als
SHA-256-Verifier gespeichert. `observe` zählt über Limits weiter, `enforce` lehnt
atomar ab. Auch ein abgelehntes Event bleibt append-only, sodass Retries nach
einem Prozess-/Repository-Neustart dieselbe Entscheidung erhalten.

`MemoryUsageRepository` ist nur Test/Development und in Production verboten.
`PostgresUsageRepository` nutzt die vorhandene tenantgebundene Runtime-
Transaktion. Migration 0028 ergänzt Policy, Counter und Events mit RLS,
zusammengesetzten Projekt-FKs, engen Grants und Triggern für Append-only,
Counter-Monotonie und lückenlose Policy-Revisionen. Vier optionale PostgreSQL-
Tests prüfen Concurrent-Limit, Restart-Replay, Projektion und RLS, wurden hier
ohne Docker/PostgreSQL aber nicht ausgeführt.

Der einzige öffentliche Pfad ist `GET .../usage` über den Session-Kontext. Die
Console-Fläche `Usage & Quotas` zeigt dieselbe no-store Projektion. Event-Ingestion
und `setQuota` bleiben interne Ports; MCP und Browser erhalten keine Mutation.
Automatische Emitter aus Data/Auth/Storage/Realtime/Queues/Compute sind noch nicht
verdrahtet. Es existieren keine Preise, Tarife, Rechnungen oder Payments.

## Ehrlich offene Arbeit

- konkreter startbarer Handler-Host/Consumer-Vertrag und Sandbox;
- externer Queue-Metrics-Exporter, Tracing, Alerting und Capacity-Grenzen;
- archivierte Real-PostgreSQL-Multi-Instance-, Crash-, Cleanup-, Soak- und Lastläufe;
- Functions-Sandbox, Cron, Webhook Delivery, Vault-Secret-Injektion;
- Egress-/Ressourcenlimits und unabhängige Security-Zertifizierung.
- persistente Compute-Definitionen, Cron-Leases/Catch-up, Webhook-Outbox,
  DNS/IP-Pinning und konkrete Production-Sandbox;
- reale archivierte Windows-/macOS-DX-Läufe, Upgrade-E2E, Registry-Publishing,
  Paket-Signatur/Provenance und Browser-/Bundler-Matrix;
- transaktionale, idempotente Usage-Emitter in allen Produktmodulen und ein
  Reconciliation-/Retention-/Export-Vertrag;
- archivierte Usage-Multi-Instance-/Crash-/Soak-/Last-Races, Metrics und Alerts;
- Tarife, Preisversionen, Credits, Rechnungen, Steuern, Payments und Provider-
  Abgleich; Alpha 1 ist ausdrücklich kein Billing;

Auch die offenen Live-Gates aus 1.3 bis 1.5 bleiben bestehen. Docker, Podman,
`postgres` und `psql` waren in dieser Arbeitsumgebung nicht verfügbar.

## Nächster bounded Slice

`1.12.0`: Postgres Changes, um Stufe 1.5 zu schließen.

`lib/server/realtime/change-source.ts` hält die Architektur bereits fest und ist
bewusst nicht implementiert. Der entscheidende Punkt steht dort ausführlich:
Broadcast-Ereignisse sind beim Schreiben bereits autorisiert, Datenbankänderungen
entstehen dagegen außerhalb von QKERN. Für sie gilt die Autorisierung des
Absenders nicht, weshalb CDC **RLS pro Ereignis und pro Abonnent** braucht. Zwei
Abonnenten desselben Kanals dürfen unterschiedliche Teilmengen derselben
Änderung erhalten. CDC darf deshalb **nicht** über `RealtimeEventLog` laufen,
dessen Ereignisse kanalweit sichtbar sind.

Drei Entwurfsentscheidungen sind offen und im Port dokumentiert: logische
Replikation gegen Trigger als Quelle, Autorisierung pro Abonnent gegen
vorberechnete Sichtbarkeit, und das Verhalten bei Rückstau.

Danach: Drop-/Reconnect-/Soak-/Lasttests, Queue-Multi-Instance-Läufe,
transaktionale Usage-Emitter.

Hinweis aus 1.11: Der Realtime-Zertifizierungslauf war beim ersten Versuch grün,
weil die Fehlerklassen aus 1.9 vorbeugend angewandt wurden — `bigint` erreicht
den Treiber als Zeichenkette, jede Sperrklausel verlangt UPDATE-Recht und
UPDATE-Policy, jeder Zugriffspfad braucht seine eigene RLS-Policy. Das lohnt sich
zu wiederholen.

## Sichere Arbeitsregeln

- Keine Organisation, Actor-, User-, Projekt- oder Environment-Identität aus
  Request-Behauptungen übernehmen.
- Keine Keys, Dedupe-Schlüssel, Lease-Tokens, Worker-IDs oder Payloads loggen.
- Worker-Lease-Operationen nicht in MCP oder einen Admin-Bypass übernehmen.
- Retry, Attempt-Limit und Dead-Letter-Status bleiben Serverautorität.
- `ephemeral` niemals als `durable` deklarieren.
- Usage-Idempotency Keys niemals roh speichern oder loggen; Hard-Quota,
  Counter und Evententscheidung müssen atomar bleiben.
- Keine öffentliche Event-Ingestion oder Browser-/MCP-Quota-Mutation ergänzen.
- Usage-Zähler nicht als Rechnung darstellen, solange Tarife/Reconciliation fehlen.
- Service Role ist kein PostgreSQL-/RLS-Privilegien-Bypass.
- Historische `docs/RELEASE_*.md` niemals nachträglich ändern.

## Pflichtprüfung und Checkpoint

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run verify:dx:full
npm audit --omit=dev --audit-level=moderate
npm run test:postgres:docker
npm run test:storage:docker
```

Ohne Docker die letzten beiden Läufe ausdrücklich als nicht ausgeführt markieren.
Danach ein neues `QKERN_Source_v*.zip` ohne `node_modules`, `.next`, `.git`,
Coverage, Build-Cache und lokale `.env*` erzeugen und versioniert speichern.
