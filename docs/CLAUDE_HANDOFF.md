# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `1.52.0`. Sie wird
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

- Paketversion: `1.40.0`
- Aktueller Slice: 1.40 Die letzte ungepruefte Zahl — `tests/status-module-counts-contract.test.ts`
- Die Fortschrittstabelle nennt jetzt nur noch Zahlen, die aus den Testdateien zaehlbar sind
- Compute Contracts behauptete 116 Faelle; rekonstruierbar waren 73
- Vorheriger Slice: 1.39 Zahlen pruefen sich — `tests/status-numbers-contract.test.ts`
- Jede Zertifizierungszahl in `STATUS.md` muss dem Maximum der gruenen Manifeste ihres Stacks entsprechen
- `STATUS.md` nennt **keine** Zahl mehr, die kein Manifest belegen kann; die lokalen Vitest-Zahlen stehen in `docs/QA.md`
- Neuer Stack? Dann die Zuordnung in `CLAIMS` ergaenzen, sonst schlaegt der Vertrag laut fehl
- Vorheriger Slice: 1.38 Was noch waechst — `lib/server/compute/webhook-retention-runtime.ts`
- Zugestellte und tote Zustellungen haben getrennte Fenster; **wartende bleiben unberuehrt**
- `usage_events` bekommt bewusst **keinen** Aufraeumer: Trigger und fehlendes DELETE-Recht sind Absicht, die Antwort auf Wachstum ist Export
- Regel fuer Mutationsproben: nie die Parameterzahl oder einen untypisierten Bezug aendern — PostgreSQL wirft dann, und die Probe misst das Werkzeug statt der Zusage
- Vorheriger Slice: 1.37 Aufraeumen laeuft — `lib/server/realtime/retention-runtime.ts`
- Beide `prune`-Pfade hatten bis 1.36 **keinen Aufrufer**; Event-Log und Change-Feed wuchsen unbegrenzt
- Scope-Liste ausdruecklich in `QKERN_REALTIME_RETENTION_SCOPES_JSON` — RLS gibt keine organisationsuebergreifende Suche her
- Aufbewahrt wird nach **Alter**, nicht nach Position: Ein laenger ausgefallener Poller verliert Aenderungen
- Vorheriger Slice: 1.36 Clusterweite Grenze — `lib/server/compute/function-concurrency.ts`, Migration 0035
- Ein Platz ist eine Zeile mit Ablauf; die prozesslokale Zaehlung bleibt als Host-Schutz daneben
- Der Halter steht in der Zeile, aber nicht in der Zaehlbedingung — sonst uebersaehe eine Instanz die fremden Plaetze
- Vorheriger Slice: 1.35 Echte Registry — `registry:2` im Functions-Stack, kein ersetzter Wert mehr in der Kette
- Migration 0034 laesst `host:port` im Image-Bezug zu; der Digest bleibt die bindende Stelle
- `allowLocalImageId` ist **entfernt**: Das Schlupfloch existierte nur, weil das Test-Image lokal gebaut war
- Vorheriger Slice: 1.34 Aenderungen zaehlen mit — `deliverChanges` meldet einmal je zugestellter Aenderung
- Der Soak-Lauf laeuft jetzt **mit** eingeschaltetem Emitter und kleinem Flush-Schwellwert; die Latenzschranken gelten fuer den gemessenen Pfad
- Vorheriger Slice: 1.33 Realtime buendelt — `lib/server/usage/buffered-emitter.ts`
- Alle sechs Metriken melden; `UNENFORCEABLE_USAGE_METRICS` sammelt die drei, fuer die `enforce` nicht setzbar ist
- Der Puffer wird beim Herunterfahren geschrieben (`workers/realtime-runtime.mts`); ein Absturz verliert ihn absichtlich
- Vorheriger Slice: 1.32 Zaehlung an der HTTP-Grenze — `lib/server/usage/api-requests.ts`
- `admitApiRequest` steht am Ende der Kontext-Resolver von Queues, Storage und Generated Data API
- Nicht in `usage/http.ts`: dort steht die HTTP-Flaeche der Usage-Projektion selbst
- Fuenf von sechs Metriken melden; offen bleibt `realtime_messages` (braucht einen buendelnden Emitter)
- Vorheriger Slice: 1.31 Nachtraegliche Metriken — Generated Data API und Storage melden
- `POST_HOC_USAGE_METRICS` in `lib/server/usage/model.ts`: fuer diese Metriken ist `enforce` nicht setzbar
- Vier der sechs Metriken sind live; `api_requests` gehoert an die HTTP-Grenze (71 Routen, kein Chokepoint), `realtime_messages` braucht einen buendelnden Emitter
- Vorheriger Slice: 1.30 Transaktionale Messung — `consume`, `record` und `admit` nehmen eine laufende Transaktion
- `ProjectQueueRepository.enqueue` erhaelt einen `ProjectQueueMeter`, der **in** der Enqueue-Transaktion laeuft
- Eine abgelehnte Messung rollt die bereits geschriebene Nachricht zurueck; Functions bleiben nicht-transaktional, weil sie nichts schreiben
- Vorheriger Slice: 1.29 Usage-Emitter — `lib/server/usage/emitter.ts`
- Ein Port mit **einer** Methode: `admit`. Der Emitter besitzt den `meter`-Principal und baut den Idempotenzschluessel
- Verdrahtet in `ProjectQueueService.enqueue` und `FunctionInvocationService.invoke`; Voreinstellung ist der `DisabledUsageEmitter`
- Messung faellt im Betrieb offen aus (`QKERN_USAGE_EMITTER_ON_FAILURE`), bei Fehlkonfiguration aber beim Start zu
- Vorheriger Slice: 1.28 Echter Empfaenger — `tests/receiver.integration.test.ts`, `tests/support/receiver/`
- Sechster Zertifizierungslauf: `npm run test:receiver:docker` (Node-24-HTTPS-Empfaenger plus PostgreSQL 17)
- Der Stack legt ein Netz mit **oeffentlichem** Subnetz an, damit die Adresspolicy unveraendert gilt
- Vorheriger Slice: 1.27 Egress-Haertung — `lib/server/net/address-policy.ts`, `guarded-fetch.ts`
- Jede Ausgangsverbindung: Namen aufloesen, jede Adresse pruefen, zur geprueften verbinden
- Die gepinnte `lookup` muss `options.all` beachten; sonst scheitert jede echte Verbindung
- Vorheriger Slice: 1.26 Vermittelter Egress — `lib/server/compute/function-egress.ts`
- Der Container behaelt `--network none`; Ausgangsverbindungen laufen zeilenweise ueber stdio
- Vorheriger Slice: 1.25 Signaturschluessel aus dem Vault — `lib/server/compute/webhook-secret-vault.ts`
- Fuenfter Zertifizierungslauf: `npm run test:vault:docker` (HashiCorp Vault 1.18 im Dev-Modus)
- Vorheriger Slice: 1.24 Functions Ende zu Ende — Kette in einem Lauf, `maxConcurrency` durchgesetzt
- Kettenlauf: `tests/function-chain.integration.test.ts` plus `docker-compose.functions-certification.yml`
- Vorheriger Slice: 1.23 Functions aufrufbar — Migration 0033, Verwaltung und `compute/invoke/{name}`
- Aufrufweg: `lib/server/compute/function-invocation.ts`, opt-in ueber `QKERN_FUNCTIONS_ENABLED`
- Vorheriger Slice: 1.22 Functions-Sandbox — `lib/server/compute/function-sandbox-docker.ts`
- Vierter Zertifizierungslauf: `npm run test:functions:docker` (braucht Docker; startet sein eigenes PostgreSQL auf 127.0.0.1:55433)
- Test-Image der Sandbox: `tests/support/function-sandbox/`
- Vorheriger Slice: 1.21 Definitionsflaeche — REST und Console fuer Cron und Webhooks
- Definitionsdienst: `lib/server/compute/definitions.ts` und `definitions-postgres-repository.ts`
- Routen: `app/api/v1/projects/[projectId]/environments/[environment]/compute/`
- Berechtigung: `project_compute_admin` (nur owner und administrator)
- Console: Ansicht `Functions & Jobs` in `components/console/console-app.tsx`
- Vorheriger Slice: 1.20 Zustellprozess — Cron und Webhooks laufen in `workers/compute-runtime.mts`
- Compute-Betrieb: `lib/server/compute/runtime-composition.ts`, `webhook-delivery-runtime.ts`
- Signatur und Transport: `lib/server/compute/webhook-signer.ts`, `webhook-transport.ts`
- Start: `QKERN_COMPUTE_RUNTIME_ENABLED=true npm run worker:compute`
- Poller-Betrieb: `change-poller-runtime.ts`, `change-poller-registry.ts`, `project-connection.ts`
- `changes:` ist opt-in ueber `QKERN_REALTIME_CHANGES_ENABLED`
- Projekt-DB-Migration: `db/project/0003_qkern_change_feed.sql` (gegen echtes PostgreSQL zertifiziert)
- Sechs Zertifizierungslaeufe: `test:postgres:docker`, `test:storage:docker`, `test:auth:docker`, `test:functions:docker`, `test:vault:docker`, `test:receiver:docker`
- Letzte Control-Plane-Migration: `db/migrations/0035_project_function_slots.sql`
- Webhook-Outbox: `lib/server/compute/webhook-outbox.ts` und `webhook-postgres-repository.ts`
- Cron: `lib/server/compute/cron-scheduler.ts` und `cron-postgres-repository.ts`
- Realtime-Domäne: `lib/server/realtime/` mit `postgres-repository.ts`, `event-bus.ts` und `change-source.ts`
- Evidenz: `docs/evidence/2026-08-04/` bis `2026-08-06/` mit Rohlogs und generierten Manifesten
- Manifestgenerator: `scripts/certification-manifest.mjs`
- SMTP-Delivery: `lib/server/project-auth/smtp-delivery.ts`
- Usage-Domäne: `lib/server/usage/`
- Usage-REST: `app/api/v1/projects/[projectId]/environments/[environment]/usage/route.ts`
- Usage-Vertrag: `docs/USAGE_METERING.md` und `lib/openapi.ts`
- Queue-Domäne: `lib/server/project-queues/`
- PostgreSQL-Adapter: `lib/server/project-queues/postgres-repository.ts`
- REST-Routen: `app/api/v1/projects/[projectId]/environments/[environment]/queues/`
- Vertrag: `docs/PROJECT_QUEUES.md` und `lib/openapi.ts`
- Worker: `lib/server/project-queues/worker.ts` und `worker-runtime.ts`;
  gestartet von `workers/project-queue-runtime.mts` (`npm run worker:queues`).
  Kein neues Modul in `lib/server` ohne Prozesseinstieg — der
  Erreichbarkeitsvertrag faellt sonst um, und das ist Absicht.
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

`1.21.0`: Flaechen fuer Definitionen. Cron und Webhooks laufen seit 1.20 in
einem startbaren Prozess, aber eine Definition entsteht weiterhin nur ueber
direkten Datenbankzugriff. Es fehlen REST-Endpunkte und eine Console-Flaeche
fuer beide Definitionsarten sowie ein Vault-gestuetzter Provider fuer
Signaturschluessel -- der einzige heutige Provider liest sie aus der Umgebung
und ist in Produktion abgewiesen.

Ebenfalls offen und kleiner: die automatische Entdeckung der zu bedienenden
Scopes (heute `QKERN_COMPUTE_SCOPES_JSON`; eine Suche ueber alle Organisationen
braucht eine Rolle, die RLS nicht einschraenkt), ein Scheduler fuer die beiden
Realtime-`prune`-Pfade und ein gemeinsamer Katalog, damit Generated Data API und
Realtime-Changes nicht je einen eigenen Pool zu denselben Projektdatenbanken
oeffnen.

Danach schliesst nur noch die **Functions-Sandbox** die Stufe 1.6. Sie ist der
groesste verbleibende Brocken, weil sie echte Prozessisolation, Ressourcenlimits
und Egress-Kontrolle verlangt -- und genau diese drei nennt das
Austrittskriterium ausdruecklich. Offene Adapter stehen in
`docs/COMPUTE_CONTRACTS.md`.

## Zwei Muster, die mehrfach aufgetreten sind

**Gebaut, zertifiziert -- und trotzdem wirkungslos, weil niemand es aufruft.**
Release 1.14 fand den Poller, den kein Prozess rief. 1.15 fand, dass die
Realtime-Runtime weiterhin den Memory-Log verwendete, obwohl der dauerhafte
Adapter seit 1.11 zertifiziert war. Beim Anfassen eines Moduls lohnt die Frage:
Ruft der Betrieb das ueberhaupt auf?

**Der Gegenprobe trauen, nicht dem gruenen Haken.** Release 1.20 hat zwei neue
Garantien zertifiziert, die im ersten Lauf sofort gruen waren. Statt das zu
glauben, wurden beide im Adapter einzeln abgeschaltet und der Stack erneut
ausgefuehrt: Genau die zwei zugehoerigen Faelle fielen um, kein anderer. Wer
eine neue Garantie zertifiziert, sollte einmal zeigen, dass ihr Test auch rot
werden kann -- der Lauf dauert Minuten und beantwortet die Frage endgueltig.

**Ausgefuehrt und zufaellig gruen.** Release 1.16 fand drei Wettlaeufe im
gemeinsamen Testaufbau, die seit 1.13 latent waren: Rolle, Schema und Feed
werden von parallel laufenden Integrationstests angelegt, und jedes
`IF NOT EXISTS` davor ist ein Check-dann-Erzeuge ohne Atomaritaet. Die Laeufe zu
1.13 bis 1.15 waren gruen, ohne dass der Aufbau deterministisch war. Ein gruener
Lauf beweist nicht, dass der Aufbau deterministisch ist.

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
- `usage_events` bleibt append-only. Der Export aus `1.41.0` ersetzt keine
  Aufbewahrung: Ein gelöschtes Ereignis heisst, dass derselbe Schlüssel später
  erneut zählt. Cursor niemals über einen Typ führen, der den Wert der
  Datenbank abschneidet.
- Usage-Zähler nicht als Rechnung darstellen, solange Tarife/Reconciliation fehlen.
- Service Role ist kein PostgreSQL-/RLS-Privilegien-Bypass.
- Historische `docs/RELEASE_*.md` niemals nachträglich ändern.
- Niemals dauerhaft `GRANT qkern_ledger_owner TO …` in einem Test: Die Rolle
  ist clusterweit, und der Migrationszaun verlangt sie ohne jede
  Mitgliedschaft. Ein Grant macht jede Migration im ganzen Lauf unmöglich.
- Worker-Einstiege heissen `.mts`. Ohne `"type": "module"` uebersetzt tsx
  jede `.ts` als CommonJS, und Top-Level-await bricht den Start ab, bevor eine
  eigene Zeile laeuft. Bis `1.44.0` konnte deshalb kein einziger der sieben
  Prozesse starten.

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
