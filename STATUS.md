# QKERN Status

> Stand: 4. August 2026 · Release: `1.12.0` · Statusdatei ist Teil der Definition of Done.

QKERN ist ein belastbarer Product-MVP und eine modulare Architekturgrundlage,
aber noch keine vollständige Supabase-Alternative.

## Fortschrittsmessung

Ein einzelner Prozentwert wurde entfernt. Er maß Fläche statt Tiefe und besaß
keine Messvorschrift; er zählte geschriebenen Code, nicht verifiziertes
Verhalten. Release 1.9 hat gezeigt, wie irreführend das ist: Zwei als fertig
oder implementiert dokumentierte Pfade waren gegen eine reale Datenbank
überhaupt nicht funktionsfähig.

Gemessen wird jetzt zweiachsig je Modul:

- **implementiert** — ausführbare vertikale Funktion vorhanden, lokal getestet
- **zertifiziert** — gegen echte Dienste ausgeführt, Lauf archiviert

| Modul | implementiert | zertifiziert |
| --- | --- | --- |
| Control Plane, Approval/Audit, Migration Runtime | ja | ja — 9 Real-DB-Fälle |
| Generated Data API | ja | ja — 2 Real-DB-Fälle, RLS und Injection |
| Project Auth | ja | ja — Lifecycle, Replay, echtes SMTP und echtes OIDC |
| Object Storage | ja | ja — 6 Real-DB-Fälle plus MinIO/ClamAV |
| Project Queues | ja | teilweise — 5 Real-DB-Fälle; Multi-Instance und Last nein |
| Usage Metering | teilweise | teilweise — 4 Real-DB-Fälle; keine Emitter |
| Realtime | teilweise | teilweise — Log und Fan-out ja, CDC-Erfassung gebaut aber nicht verdrahtet |
| Compute Contracts | nur Ports | nein |
| SDK und CLI | ja | teilweise — nur Linux belegt |
| Managed Operations | nein | nein |

## Releasezustand

| Prüfschritt | Ergebnis |
| --- | --- |
| Strict TypeScript | grün |
| Vitest (Windows) | 692 bestanden, 47 übersprungen, 0 fehlgeschlagen |
| Next.js Production Build | grün |
| Production Dependency Audit | 0 bekannte Schwachstellen |
| SDK-/CLI-Paketbuild | ESM/DTS, CLI-JS und Tarball-Manifeste grün |
| Fresh-Project-Smoke | Linux x64/Node 24 grün; Windows/macOS über CI vorbereitet, nicht ausgeführt |
| **PostgreSQL-17-Zertifizierung** | **28 von 28 bestanden, exit 0, zweimal reproduziert** |
| **MinIO-/ClamAV-Zertifizierung** | **2 von 2 bestanden, exit 0, zweimal reproduziert** |
| **Project-Auth-Provider-Zertifizierung** | **5 von 5 bestanden, exit 0, zweimal reproduziert** |
| **Realtime gegen echtes PostgreSQL** | **5 Faelle mit zwei Instanzen, Teil der 33 PostgreSQL-Faelle** |
| Rohlogs und Manifeste | `docs/evidence/2026-08-04/` |
| Realtime Real-Service/Load | noch nicht vorhanden; Runtime verweigert Production |
| Project Queues Multi-Instance/Load | noch nicht zertifiziert; kein Production-Go-live |
| Managed Production Go-live | noch nicht freigegeben |

Die 47 übersprungenen Fälle sind 30 Real-Service-Tests, die in den beiden
Docker-Stacks laufen, und 17 POSIX-Fälle, die auf Windows nicht ausdrückbar
sind. Sie gelten als übersprungen, nie als bestanden.

## Ausführbar implementiert

- Account, Session, persönlicher Workspace und serverseitige Rollenmatrix
- tenantisolierte PostgreSQL-Control-Plane mit RLS und getrennten Laufzeitrollen
- Change Sets, verschlüsselte Statements, Approval-Artefakte und Audit-Hash-Kette
- je Projektumgebung `manual`, `guarded` oder `autonomous`, Risikogrenze,
  Auto-Queue und Not-Aus; autonome Entscheidungen bleiben auditiert
- echte opt-in PostgreSQL-Data-Plane für Schema-Introspection und begrenzte
  Read-only-Abfragen über REST und MCP
- opt-in Generated Data API mit live-schema-gebundenem CRUD, RLS, Projekt-Keys,
  parametrierten Filtern, Cursor-Pagination, OpenAPI und Console Table Editor
- getrennte Project-Auth-App-User mit Email/Passwort, Magic Link, Reset,
  TOTP-/Recovery-MFA, OIDC/PKCE, Ed25519-JWT/JWKS und Refresh-Replay-Sperre
- opt-in Object Storage mit privaten Buckets, festen Policies, Quota, signed S3-
  Grants, Provider-HEAD, Quarantäne, ClamAV-Port, Lifecycle und Race-Härtung
- asynchrone Migration Queue, Worker, Target-Ledger/Fence, Reconciliation,
  Incidents, getrennte Publisher sowie Provisioning-/Release-Sicherheitsverträge
- lokaler Realtime-WebSocket-Transport mit exakter Origin-/Pfad-/Subprotocol-
  Prüfung, First-Frame-Auth, Channel-Policy, Broadcast, Presence, Ordering,
  signiertem Replay und Backpressure
- neue opt-in Project-Queues-Foundation mit Scope-/Policy-Isolation, verzögertem
  JSON-Enqueue, SHA-256-verifier-only Dedupe und Queue-Capacity
- atomare Claims, einmalige workergebundene Lease-Tokens, Renewal, monotones
  Reclaim-Fencing, serverberechnetes exponentielles Retry und Dead Letters
- dauerhafter PostgreSQL-17-Adapter mit Migration 0026, Tenant-RLS, engen
  Spaltengrants, `FOR UPDATE SKIP LOCKED`, persistentem Fencing und Cleanup
- injizierbarer Queue-Worker mit Lease-Heartbeat, Timeout/Abort, fester
  Fehlerklassifikation, sicherem Shutdown und redigierten Ereignissen/Zählern
- Admin-only Dead-Letter-Liste und concurrent-idempotentes Replay über eine
  unveränderliche same-tenant Quellbindung aus Migration 0027
- Function-, Cron- und Webhook-Vertragsports mit digest-gepinnten Images,
  Ressourcen-/Egress-/Secret-Ref-Grenzen, Cron-Dedupe und signiertem Exact-Ack
- frameworkfreies generisches TypeScript-SDK mit Typed Table CRUD sowie Clients
  für Schema, Project Auth, Storage und Queues über einen gehärteten Fetch-Port
- secretfreie CLI für init/status/schema pull/migration plan/seed check mit
  Type-Generator, Projektpfadgrenze und niemals impliziter Ausführung
- eigenständig kompilierbare private SDK-/CLI-Pakete mit ESM, Typdeklarationen,
  Manifest-/Tarball-Gate und einem ausführbaren secretfreien Fresh-Project-Smoke;
  Schema Pull akzeptiert jetzt scope-gebundene Project Keys wie SDK und CLI
- REST/OpenAPI sowie MCP für Queue-Liste, Status und Enqueue; Worker-Lease-
  Operationen bleiben bewusst aus MCP ausgeschlossen
- opt-in Usage-Metering mit sechs festen Monatsmetriken, verifier-only
  Idempotenz, atomaren `observe`-/`enforce`-Quotas und stabilen Retry-Entscheidungen
- dauerhafter Usage-Adapter mit Migration 0028, Tenant-RLS, append-only Events,
  monotonen Countern und optimistisch versionierten Quota-Policies
- read-only Usage-/Quota-Projektion in REST, OpenAPI und Console; Dezimalstrings
  vermeiden Präzisionsverlust, Event Keys und Einzelereignisse bleiben intern
- lesende und schreibende, eng annotierte MCP-Werkzeuge über dieselben Policy-
  und Tenantgrenzen wie REST

## Product Preview oder offen

| Modul | Stand | Nächster belastbarer Slice |
| --- | --- | --- |
| Project Auth | **abgeschlossen und zertifiziert** | weitere Provider, SMS und SAML als eigener Slice |
| Storage | **abgeschlossen und zertifiziert** | Multipart/Resumable und Transform-Service als eigener Slice |
| Realtime | Log und Fan-out zertifiziert; CDC-Erfassung gebaut | Verdrahtung des changes-Kanals und Trigger gegen echte Projekt-DB |
| Project Queues / Jobs | Alpha 3 | startbarer konkreter Handler-Host, Metrics-Export und Real-Service-Zertifizierung |
| Functions/Cron/Webhooks | Alpha-4-Vertragsports | Persistenz, Sandbox/DNS-Pinning, Scheduler/Webhook-Outbox und E2E |
| SDK/CLI | Alpha-3-Checkpoint | Registry-Publishing, Upgrade-E2E und archivierte Windows/macOS/Linux-CI-Evidenz |
| Billing/Usage | Alpha 1 Metering-/Quota-Grundlage | transaktionale Produkt-Emitter, Reconciliation, Tarife und Rechnungsintegration |
| Managed Swiss Operations | Nachweisverträge | Provider-Onboarding, HA, PITR, Restore, Datenflussnachweis |

## Aktueller Fokus

**Release 1.9 hat beide Zertifizierungsstacks erstmals ausgeführt.** Dabei traten
fünf Produktfehler zutage, die ausschließlich unter einer realen Datenbank
auftreten — darunter zwei, die einen als fertig beziehungsweise implementiert
dokumentierten Pfad vollständig funktionsunfähig machten: Der dauerhafte
Queue-Adapter konnte nie eine Nachricht schreiben, und die Generated Data API lud
keine einzige reale Tabelle. Beide sind behoben und belegt. Details in
[Release 1.9](docs/RELEASE_1.9.md).

**Release 1.10 schließt Stufe 1.3.** Ein dritter Wegwerfstack mit Mailpit als
echtem SMTP-Server und Dex als echtem OIDC-Provider erbringt die vom
Austrittskriterium verlangte Provider-E2E-Matrix. Der Dienst läuft dabei ohne
Debug-Token: Der einzige Weg an ein Verifikations-, Magic-Link- oder
Reset-Token führt über eine tatsächlich zugestellte Nachricht. Details in
[Release 1.10](docs/RELEASE_1.10.md).

Damit sind die Stufen 1.1 bis 1.4 abgeschlossen. Als nächstes steht Stufe 1.5
Realtime an; dort fehlt der persistente PostgreSQL-Event-Log mit CDC.

## Wichtige Grenzen

- Project Queues ist disabled-by-default. `QKERN_RUNTIME_MODE=postgres` wählt den
  dauerhaften RLS-Adapter; der `ephemeral` Memory-Adapter bleibt Production-verboten.
- Der PostgreSQL-Queuepfad ist jetzt gegen einen realen Server zertifiziert
  (5 Fälle: Dedupe, disjunkte Claims, Lease-Fencing, Replay-Bindung, Cross-Tenant-
  RLS). Mehrere Prozesse, Crash-Races und Last sind weiterhin nicht zertifiziert;
  der Pfad ist deshalb nicht Go-live-frei.
- Project Auth kann Mails zustellen, sobald ein SMTP-Host konfiguriert ist. Ohne
  Konfiguration bleibt der Port fail-closed und verweigert Action-Tokens, statt
  sie stillschweigend zu verwerfen. Eine Provider-E2E gegen einen echten Mail-
  und OIDC-Server fehlt weiterhin.
- Der Worker ist ein injizierbarer Execution-Port, noch kein allgemeiner Sandbox-
  Host. Zähler liegen pro Prozess vor und sind noch nicht extern scrapebar.
- Compute Contracts besitzen noch keine persistente Management-API, Scheduler-
  Lease, Webhook-Outbox, DNS-Pinning oder Production-Sandbox.
- Queue-Claims und Settlement verlangen eine Service Role sowie exakten Worker,
  Token und Ablauf. Roh-Dedupe-/Lease-Secrets werden nicht persistiert.
- Realtime bindet nur Loopback, verweigert Production und hält History/Presence
  weiterhin im Prozessspeicher.
- Usage Metering ist disabled-by-default. Browser und MCP dürfen keine Quota-
  Policies mutieren; `meter`/`operator` bleiben interne Autoritäten.
- Alpha 1 erfasst noch nicht automatisch jede Produktoperation. Ohne angebundenen
  vertrauenswürdigen Emitter sind Nullwerte erwartbar und nicht als Billingbeleg
  zu verwenden. Es existieren weder Preise noch Rechnungen.
- Der PostgreSQL-Usagepfad ist lokal nur statisch und in Memory getestet; die vier
  Real-DB-Fälle sowie Multi-Instance-, Crash-, Reconciliation- und Lastläufe fehlen.
- `autonomous` ist eine explizite stehende Autorisierung, kein stiller Bypass.
- Generated Data API, Project Auth und Storage bleiben opt-in und verlangen ihre
  dokumentierten unprivilegierten Rollen, Provider und Scanner.
- Production Apply benötigt weiterhin eine externe maschinelle Release-Signatur.
- Schweizer Hosting, Datenresidenz, HA, RPO/RTO und Compliance sind vor einem
  Marktversprechen technisch und rechtlich nachzuweisen.
- Die vorhandene GitHub-Matrix ist noch keine Evidenz: Windows und macOS gelten
  erst nach tatsächlich grünen archivierten Runnerläufen als bestätigt.

## Dokumentation

- [Dokumentationsindex](docs/INDEX.md)
- [Handbuch](docs/HANDBUCH.md)
- [Project Queues](docs/PROJECT_QUEUES.md)
- [Usage Metering und Quotas](docs/USAGE_METERING.md)
- [Compute Contracts](docs/COMPUTE_CONTRACTS.md)
- [TypeScript SDK](docs/SDK_TYPESCRIPT.md)
- [CLI](docs/CLI.md)
- [Developer Experience](docs/DEVELOPER_EXPERIENCE.md)
- [Release 1.8 Alpha 1](docs/RELEASE_1.8_ALPHA1.md)
- [Realtime-Protokoll](docs/REALTIME_PROTOCOL.md)
- [Stufenplan](docs/STUFENPLAN.md)
- [Modularchitektur](docs/MODULES.md)
- [BaaS-Roadmap](docs/BAAS_ROADMAP.md)
- [Dokumentationspflege](docs/DOCS_MAINTENANCE.md)
- [Claude-/Agentenübergabe](docs/CLAUDE_HANDOFF.md)
