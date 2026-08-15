# Qualitäts- und Testplan

## Aktuell automatisiert

- TypeScript Strict Typecheck
- Next.js Production Build
- SQL-Read-only- und Risiko-Klassifizierung
- Tenant-Isolation ohne Existenz-Leak
- Verschachtelte Secret-Redaction
- Change-Set-Preview erzeugt Approval, aber keinen Apply
- Approval ist genau einmal entscheidbar
- Approval-Hash, Ablauf und Mutationsschutz
- Argon2id-Hashing, Session-Widerruf und gehärtete Cookie-Attribute
- Origin/CSRF-Prüfung, Rollenmatrix und gefälschte Organisationskontexte
- Tenant-Transaktionen, PostgreSQL-Repositories und Migrationsinvarianten
- OpenAPI-Vertrag und SQL-AST-Grenzen
- Echte Data-Plane-Rollen-/Datenbankbindung, `READ ONLY`, RLS, Schema-Limits, Query-Zeilen-/Bytegrenzen, Secret-Redaction, Rollback und cause-freie Fehler
- Generated-API-Matrix für Live-Schema-/Spalten-Allowlist, RLS-/Owner-Deny,
  Primärschlüsselbindung, parametrisierte Filter, Sortierung, Cursor, CRUD,
  Payload-/Antwortlimits, sensitive Spalten und cause-freie Rollbacks
- Projekt-Key-Matrix für 256-Bit-Keyformat, SHA-256-Verifier, Einmal-Ausgabe,
  Projekt-/Environment-Scope, Ablauf, monotone Sperrung, Rollen-Capability und CSRF
- Authentifizierte Generated-API-Routen für Console-Session und exakten Public-/
  Service-Key-Scope sowie live erzeugten OpenAPI-3.1-Vertrag
- MCP-Toolvertrag für Generated List/Insert/Update/Delete einschließlich Read-only-/
  Destructive-/Idempotenz-Annotationen und projektgebundener Agent-Claims
- Project-Auth-Account-Lifecycle für Signup, Verifikation, Passwortlogin, Magic
  Link, Reset, Logout, Admin-Sperrung und enumeration-safe E-Mail-Anforderungen
- Ed25519-JWT/JWKS-Vertrag mit exaktem Issuer/Audience/Scope, Ablauf, Tamper-Deny,
  aktueller plus vorheriger Public-Key-Rotation und serverseitiger Session-Prüfung
- Opaque Refresh-Einmalrotation, Replay-Erkennung und atomarer Widerruf der ganzen
  Tokenfamilie sowie sofortige User-/Session-Revocation
- TOTP-/Recovery-Code-MFA, AES-GCM-/HMAC-Grenze, AAL2-Ausgabe und einmaliger
  Recovery-Code-Verbrauch
- OIDC Authorization Code mit PKCE, State/Nonce, EdDSA-ID-Token, exakter Claim-
  Prüfung, serverseitiger Endpoint-Autorität und No-Redirect-/Unsafe-URL-Deny
- Project-Auth-Routen für exakten Projekt-Key, explizite CORS-Allowlist, Admin-
  Capability und App-JWT-plus-Key-Mapping in serverseitige PostgreSQL-RLS-Claims
- Migration `0024_project_auth.sql` mit getrennten App-User-Tabellen, unveränderlichem
  Scope, verifier-only Tokens, Least-Privilege-Grants und Runtime-Tabellen-Deny
- Project-Storage-Service-Matrix für private Defaults, Policy-/Owner-Isolation,
  Quota-Reservierung/-Ablauf, Completion-Replay, Provider-HEAD-Mismatch, Quarantäne,
  clean/infected Scanner-Urteil, Download-TTL, Delete und Retention/Lifecycle
- S3-SigV4-Providervertrag für Key/MIME/SHA-256, begrenzte Multipart-Größe,
  no-redirect HEAD/Delete, HTTPS-Production-Origin, Credential-Deny, Expiry und
  cause-freie fehlerhafte Provider-Metadaten
- ClamAV-`INSTREAM`-Vertrag mit exaktem Frameformat, begrenzter Object-/Chunkgröße,
  Connect-/Scan-/Download-Timeouts, privatem TCP-Ziel und fail-closed Antwortparser
- Scanner-Download-Matrix für no-redirect, Content-Encoding-Deny sowie erneute
  Prüfung von Bytezahl, MIME und SHA-256 vor Übernahme von `clean` oder `infected`
- Portloser MinIO-/ClamAV-Zertifizierungsstack mit echten Signed-POST-/HEAD-/GET-
  Pfaden, Clean-Download, EICAR-Delete, opt-in Tests und garantiertem Volume-Cleanup
- Storage-Routen-/OpenAPI-/MCP-Vertrag für exakte CORS-Allowlist, Admin-CSRF,
  read-only Tool-Annotationen und öffentliche Projektionen ohne Provider-Key,
  Checksum oder persistierten Completion-Verifier
- Ausführbare Storage-Race-Matrix für parallele Completion-Replays, Expiry während
  eines blockierten Scans mit Orphan-Cleanup sowie Delete gegen Lifecycle ohne
  doppelte Usage-Freigabe
- Migration `0025_project_storage.sql` mit Tenant-RLS, unveränderlichen Bucket-/
  Upload-/Object-Identitäten, verifier-only Completion, partiellen Unique-Indizes,
  Quota-Invarianten und Least-Privilege-Spaltengrants
- Realtime-Service-Matrix für Channel-Policy, Organization-/Project-/Environment-
  Isolation, Live-Ordering, signierte scopegebundene Cursor, Replay und Stale-/
  Overflow-Deny ohne stille Event-Lücke
- Presence-Snapshot/Join/Leave mit privaten Schlüsseln, Disconnect-Cleanup,
  `anon`-/`service_role`-Deny sowie Payload-/Subscription-/JSON-Grenzen
- First-Frame-Gateway-Auth, credential-freie Fehler, Invalid-Frame-Strikes,
  Rate-Limit und verspätetes Auth-Ergebnis nach Socket-Close ohne Orphan-Connection
- echte lokale `ws`-Transporttests für Subprotocol, Origin-/Query-Deny,
  Authentifizierung, zwei Clients, Subscribe, Broadcast und Backpressure-Vertrag
- statischer Runtime-Vertrag für explizites Enablement, PostgreSQL-Key-Grenze,
  Loopback-Bindung und technischen Production-Deny
- Policy-Matrix für `manual`, `guarded`, `autonomous`, Risikogrenze, Production-Auto-Queue-Deny und Not-Aus
- Tenantgebundene Policy-Migration, system-attribuierte Approval Decision, Rollen-Capability und authentifizierter Console-Durchstich ohne Freigabe pro Änderung
- Durchstich über authentifizierte Console-, Change-Set- und Approval-Routen
- Rollen-Startprüfung für getrennte Auth-/Runtime-/Worker-/Provisioner-Logins
- Apply-Route, idempotente Queue-/Outbox-Repositories und Lease-Fencing
- Worker-Prüfung, Rollback-only-Retry und Crash-/Commit-Reconciliation
- PostgreSQL-Projekt-Executor, Rollen-/Datenbankbindung und Ledger-ACL-/Schema-Invarianten
- Projekt-Ledger-Provisionierungsvertrag und targetgebundene Approval-Hashes
- Dedizierte Worker-DB-Rolle, exakte Approval-Snapshot-Bindung und fail-closed Reclaim-Race-Tests
- Opt-in Runtime-Komposition, lokaler Zielkatalog und referenzbasierter Outbox-Publisher
- Claim-Generation, Lease-Heartbeat, persistenter Target-Fence-Vertrag und confirmed-fence Reclaim-Retries
- Projekt-Provisioning-API, Capability-/CSRF-/Idempotenz-Vertrag und redigierter No-store-Status
- Persistenter Provisioning-Zustandsautomat, SKIP-LOCKED-/Lease-Fencing, Abort-Nichtzählung, fünf Versuche und drei Recovery-Zyklen
- Signierter Provisioning-Broker mit reference-only Body, Bootstrap-Attestierung, HMAC-Rotation, exact-host HTTPS/443, No-Redirect und Antwortgrößenlimit
- Unveränderliches secret-freies Binding-Ledger und tenantgebundener persistierter Vault-Katalog mit Bootstrap-Pin und Singleflight
- Tenant-/Actor-gebundene Provisioner-Heartbeats, aggregate SLO-Projektion ohne direkte Tabellenrechte, disjunkte Fehlercounts, fail-closed Summenprüfung und redigierte No-store-Health-API
- Disabled-by-default OpenMetrics-Export mit serverseitig festem Tenant, rotierbarem Private-File-Bearer, No-follow/Mode-Prüfung, Inline-/Authority-Reuse-Deny, Cookie-/Tenant-Header-Negativtests und festen redigierten Labels
- Ed25519-signiertes Backup-/Restore-Evidenzgate mit Public-Key-Pin, striktem Exact-Field-Vertrag, No-follow-/Integritätsprüfung, festen Frische-/RPO-/RTO-Grenzen, Zeitfolgen-/Manifest-Invarianten, positiver Check-Allowlist, cause-freiem CLI-Exit und optionaler fail-closed OpenMetrics-Einbindung ohne Evidenz-IDs oder Digests
- Disabled-by-default Loopback-Probes für Provisioner, Migration Worker und beide Publisher mit getrenntem Liveness-/Readiness-Vertrag, erstem erfolgreichem Poll als Ready-Gate, sofortigem Fehler-Reset, Veraltung, Clock-Rollback, Shutdown, Method-/Pfadgrenzen und secretfreien Antworten
- Deterministischer Background-Runtime-Deployment-Generator samt no-follow CLI-Gate für vier tokenlose ServiceAccounts/Workloads, digest-gepinntes Image, Non-root/read-only/seccomp, entfernte Capabilities, deaktivierte Host-Namespaces, feste Ressourcen, private Einzel-Secret-Referenzen, Loopback-Exec-Probes und Negativdrift bis hin zu Zusatzservice und doppelten JSON-Schlüsseln
- Ed25519-signiertes Live-Deployment-Evidenzgate mit Public-Key-, Cluster-, NetworkPolicy- und Provenance-Pins, kanonischer Bundle-/Image-Bindung, exakter Vier-Komponenten-Reihenfolge, Replica-/Rollout-/Probe-/SIGTERM-/Restart-/Security-/Secret-Assertions, Supply-Chain-/Alert-Gates, 24-Stunden-Frische, no-follow Dateien, cause-freiem CLI und optionaler redigierter fail-closed OpenMetrics-Einbindung
- Ed25519-signiertes Provider-/Pager-E2E-Evidenzgate mit sieben paarweise verschiedenen Provider-/Vault-/Broker-/Pager-/Restore-/Runtime-Pins, 15 festen PostgreSQL-17-Szenarien, Laufzeit-/Frische-/Signaturlatenz-Policy, Duplicate-Key-/Extra-Field-/Tamper-/Pin-/Authority-Reuse-Negativtests, cause-freiem CLI und redigierter fail-closed OpenMetrics-Einbindung
- Ed25519-signiertes Security-Assessment-Evidenzgate mit acht paarweise verschiedenen Release-/SBOM-/Scan-/Pentest-Pins, 14 festen Kontrollen, null offenen Critical-/High-Findings, Zeit-/Frischepolicy, strikter Datei-/Authority-Grenze, cause-freiem CLI und redigierter fail-closed OpenMetrics-Einbindung
- Gemeinsamer Release-Evidence-Preflight mit vier Signaturverifiern, fünf exakten Dateidigest-Prüfungen gegen die Production-Apply-Pins, Pfadkollisionsschutz, Abbruchprüfung und einheitlichem cause-freiem Fehler
- Finaler Production-Readiness-Preflight mit erneuter Teilresultatprüfung, Production-/PostgreSQL-/TLS-/Tenant-/Origin-/Proxy-/Katalog-Invarianten, Inline-Authority-Deny, erzwungen deaktiviertem Apply und redigierter cause-freier CLI
- Disabled-by-default Production-Apply-Autorisierung mit exakter Tenant-/Projekt-/Change-Set-/Approval-/Ziel-/Statement-/Action-Bindung, Ed25519, Key- und fünf paarweise verschiedenen Evidenz-Pins, Vier-Stunden-Fenster, Duplicate-Key-/Inline-/Authority-Reuse-Deny sowie unabhängigen Service- und Worker-Negativtests ohne Enqueue oder Executor-Aufruf
- Gepinnte Next.js-Sicherheitsversion und explizite Overrides für gepatchte
  `fast-uri`-, Hono-, `ip-address`-, PostCSS- und `sharp`-Transitivgrenzen
- Vom Worker unabhängig konfigurierte Outbox-Publisher-Komposition
- Persistenter Reconciliation-only-Zustandsautomat, getrennte Attempt-Grenze, crash-sichere Review-Quarantäne und Nachweis, dass dieser Pfad niemals SQL ausführt
- Owner-/Administrator-Rollenmatrix, Review-API-Redaction, referenzbasierte Command-Repositories, Worker-Konsum, Cycle-Grenzen und Nachweis, dass Operator-Rechecks niemals SQL ausführen
- Worker-only-Incident-Eröffnung, genau-einmal-Eskalation, unveränderliche Evidenz, Support-read-only-/Owner-Acknowledge-Rollenmatrix, feste Codes, API-Redaction und Nachweis fehlender Job-/SQL-Mutation
- Atomare Incident-/Notification-Outbox-Erzeugung, Upgrade-Backfill, Web-Runtime-Deny, tenantgebundene SKIP-LOCKED-Claims, Lease-Fencing, exakte Sink-Acks, Retry/Abort/Concurrency und secretfreier fester Message-Vertrag
- Signierter Incident-Webhook mit deterministischer HMAC, Idempotency-Key, exakter Host-Allowlist, Production-HTTPS/443, No-Redirect, Timeout-/Lease-Reserve, Ack-Größenlimit, striktem Response-Vertrag und redigierten Fehlern
- Persistente Incident-Dead-Letter-Transition, feste Failure-Codes, Abort-/Lease-Nichtzählung, tenant-/actor-gebundene Recovery-Commands, Fehlercode-/Retry-Generations-Bindung einschließlich ABA-Negativfall, Rollenmatrix, Cycle-Grenzen und Nachweis fehlender Incident-/Job-/SQL-Mutation
- Tenant-isolierte Delivery-Detail-/Health-Projektionen ohne Tabellenrechte, bounded Incident-ID-Eingabe, disjunkte Count-Invarianten, API-Redaction, No-store und Auth-before-service
- Owner-/Administrator-only Resolution-Verifications mit festem Grund, Drei-Zyklen-Grenze, Command-first-Lock-Ordering, Worker-only-`resolved`-Guard, atomarem Job-/Change-Set-/Incident-Abschluss ausschließlich nach `already_applied` sowie Negativnachweis für Operator-Aussage und neue SQL-Ausführung
- Statisch validierter, portloser und tmpfs-basierter PostgreSQL-17-Zertifizierungs-Stack mit explizitem Create-/Drop-Gate, separaten Runtime-/Auth-/Worker-Logins und garantiertem Container-/Volume-Cleanup
- Sechs optionale echte PostgreSQL-Tests für Upgrade 0017→0018, Current-/Stale-Backfill, `CHECK`-NULL-Bypass, ABA-Replay, exakten Generation-Retry, Command-first-Interleaving und Worker-only-Resolution
- Zwei optionale echte PostgreSQL-Tests für Generated-API-CRUD, Claim-basierte
  Cross-Subject-RLS-Isolation, sensitive Spalten und Identifier-/Spalten-SQLi
- Zwei optionale echte PostgreSQL-Tests für Project-Auth-Persistenz, Runtime-Deny,
  unveränderlichen Scope und atomare Refresh-Replay-Familienrevocation
- Sechs optionale echte PostgreSQL-Tests für Storage-RLS, verifier-only Completion,
  serialisierte Quota ohne Overbooking, idempotente Completion, Expiry-/Scan-
  Orphan-Cleanup, Delete-/Lifecycle-Race und Runtime-Direktzugriff-Deny

> **Zahlenquelle.** Die Testzahlen in diesem Dokument waren an neun Stellen von
> Hand gepflegt und drifteten: Bis Release 1.9 wies dieser Abschnitt 609 Tests
> als „aktuell" aus, während `STATUS.md` bereits 678 nannte. Verbindlich sind ab
> sofort die generierten Manifeste unter `docs/evidence/`, erzeugt von
> `scripts/certification-manifest.mjs`. Die folgenden historischen
> Checkpoint-Angaben bleiben als Chronik stehen und werden nicht nachgeführt.

Automatisierter Stand zu Release 1.9: **692 erfolgreiche Tests, 47 übersprungene
und 0 fehlgeschlagene** in 130 Testdateien, grüner Strict Typecheck und
erfolgreicher Next.js-Production-Build. Die 47 übersprungenen Fälle sind 30
Real-Service-Tests, die in den beiden Docker-Stacks laufen, und 17 POSIX-Fälle,
die auf Windows nicht ausdrückbar sind.

Erstmals zertifiziert: **PostgreSQL 17 mit 28 von 28 bestandenen Fällen** und
**MinIO/ClamAV mit 2 von 2**, beide exit 0 und zweimal reproduziert. Rohlogs und
Manifeste liegen unter `docs/evidence/2026-08-04/`.

Historischer Stand vor Release 1.9 (nie gegen Real-Services ausgeführt): 609
erfolgreiche Tests in 105 Testdateien, 21 übersprungene optionale
Integrationstests in sechs weiteren Dateien. Die 19 neuen Realtime-Tests decken
Service, Policy, Cursor/Replay, Presence, Auth, Gateway-Races, Runtime-Vertrag und
echte lokale WebSocket-Verbindungen ab. Fünf ClamAV-Adaptertests prüfen Protokoll,
Clean/Infected, malformed Responses und Integritätsdrift; sechs statische
PostgreSQL-Harness-Tests binden die Storage-Race-Matrix, fünf weitere den Storage-
Service-Harness. Drei ausführbare Memory-Races prüfen Completion-Replay, Expiry-/
Scan-Orphan-Cleanup und Delete/Lifecycle-Accounting. Drei optionale Real-DB-Tests
prüfen Rollen und RLS; sechs weitere den v0.23-Upgrade-/Recovery-/Resolution-
Vertrag; je zwei Generated-API-CRUD und Project-Auth-Persistenz, sechs Project-
Storage-Persistenz/Concurrency und zwei den echten MinIO-/ClamAV-Pfad. Der normale
grüne Lauf prüft zusätzlich Data Plane, Autonomiepolicy, Project Auth, Project
Storage, Realtime, system-attribuierte Decisions und den lebenden
Dokumentationsvertrag, erzeugt aber ausdrücklich keine echte positive Release-
Autorisierung oder Live-Evidenz. Weder der PostgreSQL-17- noch der MinIO-/ClamAV-
Docker-Zertifizierungslauf konnte in der aktuellen Arbeitsumgebung ausgeführt
werden, weil dort kein Docker-Programm installiert ist. Der grüne Standardlauf
ist deshalb weiterhin kein Realtime-Multi-Instance-/Lasttest, realer S3-/Malware-
Scanner-/Backup-/Restore-Drill, kein echtes Prometheus-/OTel-Scraping oder Alarm-
Routing, kein unabhängiger Pentest und kein Live-Cluster-, Registry-Provenance-,
NetworkPolicy-, OIDC-/E-Mail-Provider-, PostgreSQL-, Vault-, Worker-, Provisioner-,
Runtime-Probe-, Container-Shutdown-, Target-Fence-, Reconciliation-/Incident-/
Resolution-/Outbox-/Webhook-/Broker-/Dead-Letter-Race- oder Projekt-Datenbank-
Nachweis.

`npm run test:postgres` verwendet ausschließlich explizit gesetzte Test-URLs. `npm run test:postgres:docker` startet dagegen einen eigenen portlosen PostgreSQL-17-Container auf tmpfs, installiert die gesperrten Node-Abhängigkeiten in einem isolierten Volume, führt alle 28 Real-DB-Tests aus und räumt den Stack auch nach einem fehlgeschlagenen Lauf auf. Das Recovery-Testfile verweigert Create/Drop ohne `QKERN_TEST_ALLOW_DATABASE_CREATE_DROP=true` und beschränkt Datenbanknamen auf einen intern erzeugten alphanumerischen Bezeichner.

`npm run test:storage:docker` startet entsprechend einen separaten portlosen
Wegwerfstack mit gepinntem MinIO, ClamAV und Node. Der Runner legt seinen eigenen
Provider-Bucket signiert an, führt Clean- und EICAR-Pfade aus und entfernt den Stack
einschließlich Volumes auch nach Fehlern. Ohne Docker bleibt dieser Nachweis offen.

Der Production-Dependency-Audit meldet mit Next.js 16.2.12, MCP SDK 1.30.0 und den fest gepinnten `fast-uri`-4.1.2-, Hono-4.12.34-, `ip-address`-10.4.0-, PostCSS-8.5.25- und `sharp`-0.35.3-Overrides 0 bekannte Schwachstellen.

## Project Queues Alpha 1

Automatisiert geprüft werden Queue-Definition-Races, vollständige Scope-/Policy-
Isolation, parallele verifier-only Dedupe, verzögertes Enqueue, geordnete atomare
Claims, exakte Worker-/Token-Bindung, Lease-Renewal, Expiry-Reclaim mit monotoner
Generation, begrenztes exponentielles Retry, Dead Letter, Retention, Capacity sowie
JSON-Größen-/Tiefe-/Prototype-Grenzen. Ergänzt sind Runtime-Tests für Disabled-
Default, exakte Origins, Payload-Konfiguration und den nicht umgehbaren Production-
Deny des `ephemeral`-Adapters.

Route- und Vertragsprüfungen decken CORS vor Auth/Servicezugriff, Session-CSRF,
cause-freie Fehler, Owner-/Administrator-Capability, OpenAPI-Sicherheitsmodelle,
write-only Lease-/Dedupe-Felder und MCP-Annotationen ab. Der MCP-Vertrag bestätigt
zusätzlich, dass kein Queue-Claim-Tool registriert ist.

Noch offen und nicht als ausgeführt auszugeben sind Real-Broker/PostgreSQL-
Persistenz, Prozess-Crash zwischen Claim und Settlement, Multi-Instance-Claim-
Interleavings, Cleanup/Retention unter Last, Dead-Letter-Replay, Queue-Metriken,
Soak-/Backpressure-/Capacity-Tests und unabhängige Abuse-/Security-Prüfung. Für
Alpha 1 existiert deshalb kein optionaler Real-Service-Queue-Test und keine
Production-Zertifizierung.

Checkpoint `1.6.0-alpha.1` am 4. August 2026: Strict TypeScript grün, **627**
Vitest-Tests bestanden, **21** optionale Real-Service-Tests übersprungen,
Next.js-Production-Build grün und Production-Dependency-Audit mit **0** bekannten
Schwachstellen. Docker, Podman, `postgres` und `psql` waren nicht installiert;
PostgreSQL-17- und MinIO-/ClamAV-Läufe wurden nicht ausgeführt.

## Project Queues Alpha 2

Migration 0026 und der PostgreSQL-Adapter werden lokal statisch auf Tenant-FKs,
RLS, least-privilege Grants, unveränderliche Payloads, verifier-only Secrets und
`FOR UPDATE SKIP LOCKED` geprüft. Vier optionale Real-DB-Szenarien prüfen durable
Dedupe, disjunkte Concurrent Claims, Restart-festes Lease-Fencing und
Cross-Tenant-RLS. Die Memory-Matrix prüft zusätzlich, dass Completed-Retention ein
längeres Dedupe-Fenster nicht vorzeitig löscht.

Checkpoint `1.6.0-alpha.2` am 4. August 2026: Strict TypeScript grün, **631**
lokale Vitest-Tests bestanden, **25** optionale Real-Service-Tests übersprungen,
Next.js-Production-Build grün und Production-Dependency-Audit mit **0** bekannten
Schwachstellen. Ohne Docker/PostgreSQL wurden die vier neuen Real-DB-Fälle nicht
ausgeführt; Multi-Instance-, Crash-, Cleanup-, Soak- und Last-Evidenz bleibt offen.

## Project Queues Alpha 3

Geprüft werden Handler-Erfolg, periodische Lease-Erneuerung, Timeout eines nicht
kooperativen Handlers, feste Invalid-Payload-Klassifikation, Abort vor Claim,
serialisierter Runtime-Loop, Backoff-Abbruch und Concurrent-Run-Sperre. Logtests
suchen explizit nach Payload, Worker-ID und Lease-Token. DLQ-Tests decken redigierte
Liste, Admin-Autorität, Same-Origin-Sperre und concurrent-idempotentes Replay ab.
Ein fünfter optionaler PostgreSQL-Fall prüft Unique-Replay-Bindung und Persistenz.

Checkpoint `1.6.0-alpha.3` am 4. August 2026: Strict TypeScript grün, **641**
lokale Vitest-Tests bestanden, **26** optionale Real-Service-Tests übersprungen und
Production-Dependency-Audit mit **0** bekannten Schwachstellen. Der abschließende
Next.js-Production-Build wird als Release-Gate ausgeführt. Ohne Docker/PostgreSQL
bleibt die reale Queue-/Worker-Zertifizierung offen.

## Compute Contracts Alpha 4

Neun Tests decken Image-Digest, Function-Egress, Secret-Referenzen, bounded
Sandbox-Response, Timeout und unsichere Header sowie Webhook-SSRF/Query/Redirect-
Vertrag, Signer-Port, Exact-Ack und Timeout ab. Cron-Tests prüfen UTC-Occurrence,
unzulässige Ausdrücke, Cross-Tenant-Sperre und den deterministischen Dedupe-Key.

Checkpoint `1.6.0-alpha.4` am 4. August 2026: **650** lokale Tests grün, **26**
optionale Real-Service-Tests übersprungen, TypeScript/Build grün, Audit 0. Reale
Sandbox-, DNS-Pinning-, Scheduler-/Webhook-Outbox- und Provider-E2E-Tests fehlen.

## TypeScript SDK Alpha 1

Sechs Tests prüfen generische Table-Typen, URL-/Filter-Encoding, Header-only Keys
und Tokens, exakte Mutation Bodies ohne Retry, Queue-Dedupe im Body, Origin-/Path-
Negativfälle, bounded Fehler ohne Servertext sowie Fetch-Timeout. Checkpoint
`1.7.0-alpha.1`: **656** lokale Tests grün, **26** optionale Real-Service-Tests
übersprungen, TypeScript/Build grün und Audit 0.

## CLI Alpha 2

Fünf Tests prüfen exklusive secretfreie Initialisierung, unbekannte Config-Felder,
Traversal/HTTP-Negativfälle, deterministische Typen ohne sensitive Spalten,
Migration Risk/Hash ohne Ausführung und bounded INSERT-only Seeds. Checkpoint
`1.7.0-alpha.2`: **661** lokale Tests grün, **26** optionale Real-Service-Tests
übersprungen, TypeScript/Build grün und Audit 0.

## Developer Packages Alpha 3

Drei neue Tests schließen die Project-Key-Lücke der Schema-Route, prüfen SDK-/CLI-
Distributionsmanifeste und halten die eigenständige CLI-SQL-Policy gegen die
Serverpolicy synchron. `verify:dx` erzeugt zusätzlich ein frisches temporäres
Projekt und startet die gebaute CLI; `verify:packages` prüft die tatsächlichen SDK-
und CLI-Tarball-Inhalte. Checkpoint `1.7.0-alpha.3`: **664** lokale Tests grün,
**26** optionale Real-Service-Tests übersprungen, Paket-/Next.js-Build und Audit 0.
Der DX-Smoke lief lokal auf Linux x64/Node 24. Windows/macOS sind nur als CI-Matrix
vorbereitet und gelten bis zu realen archivierten Läufen nicht als bestanden.

## Usage Metering und Quotas Alpha 1

Vierzehn lokale Tests prüfen verifier-only Idempotenz und Konflikte, stabile
Denied-Replays, harte parallele Limits, `observe`-Überschreitung, Quellen-/Tenant-
Grenzen, 24-Monatsfenster, optimistische Policy-Revisionen, Runtime-Disabled-
Default/Production-Deny, no-store HTTP-Projektion, strikte Query-Parameter und den
statischen Append-only-/RLS-Migrationsvertrag. OpenAPI hält alle sechs Metriken,
Dezimalstrings und den ausschließlichen Session-Lesezugriff fest.

Vier optionale PostgreSQL-Fälle prüfen Concurrent-Hard-Limit ohne Überbuchung,
Verifier-Persistenz ohne Rohschlüssel, identisches Denied-Replay nach Repository-
Neustart, dauerhafte Projektion und leere Cross-Tenant-RLS-Sicht. Checkpoint
`1.8.0-alpha.1`: **678** lokale Tests grün, **30** optionale Real-Service-Tests
übersprungen, TypeScript/Build/DX-Gate grün und Audit 0. Ohne Docker/PostgreSQL sind
die vier neuen Real-DB-Fälle nicht ausgeführt; transaktionale Produkt-Emitter,
Multi-Instance-/Crash-/Soak-/Last- und Billing-Reconciliation-Evidenz fehlen.

## Release Gates für Production

- 0 Cross-Tenant-Leaks über REST, MCP, Storage, Logs, Backups und Exporte
- 0 Secret-Canary-Treffer in Responses, Errors, Logs und MCP
- Auth-, RLS-, Storage-, OpenAPI-, MCP- und Backup-Integrationstests gegen echte Services
- Realtime-CDC/Event-Log/Fan-out gegen mehrere echte Instanzen sowie Drop-,
  Reconnect-, Ordering-, Backpressure-, Soak- und Lasttests
- Project Queues gegen einen persistenten Broker über mehrere Instanzen:
  Dedupe-, Claim-, Lease-/Crash-, Retry-, Dead-Letter-, Cleanup- und Capacity-Races
- E2E: Account → Organisation → Projekt → Tabelle/RLS → REST API
- E2E: Codex Read-only → Migration Preview → Reject/Approve once → idempotenter Apply
- E2E: Backup → Restore Preview → Restore als neues Projekt → Schema-/Datenvergleich
- Prompt-Injection-, SSRF-, SQLi-, XSS-, CSRF-, Token-Replay- und Approval-Race-Tests
- Mobile/Desktop, Keyboard, Kontrast und Screenreader-Smoke-Test
- 0 offene Critical/High Security Findings

## Empfohlene NFR-Ziele

- REST Read p95 ≤ 300 ms in der definierten Schweizer Testregion
- MCP Read-only p95 ≤ 1 s ohne Modelllauf
- Realtime Broadcast p95 ≤ 200 ms innerhalb einer definierten Region; 0 stille
  Drops oder Reihenfolgefehler im zertifizierten Lastprofil
- Console LCP ≤ 2,5 s und CLS ≤ 0,1
- Security-/Permission-/Approval-Code ≥ 90 % Branch Coverage
- Zehn fehlerfreie Wiederholungen aller kritischen E2E-Flows

Diese Zahlen sind Startwerte und müssen mit der gewählten Infrastruktur und dem Produktversprechen validiert werden.

## Real-Service Certification — Release 1.9

Beide Wegwerfstacks wurden erstmals ausgeführt. Das Ergebnis ist der eigentliche
Inhalt des Release: fünf Produktfehler, die ausschließlich unter einer realen
Datenbank auftreten. Zwei davon machten einen als fertig beziehungsweise
implementiert dokumentierten Pfad vollständig funktionsunfähig — der dauerhafte
Queue-Adapter konnte nie eine Nachricht schreiben, und die Generated Data API lud
keine einzige reale Tabelle. Details in `docs/RELEASE_1.9.md`.

`npm run test:postgres:docker` führt 28 Fälle gegen echtes PostgreSQL 17 aus:
Rollen und RLS, Upgrade-/Recovery-/Resolution-Vertrag, Generated-API-CRUD mit
Cross-Subject-Isolation und Injection-Grenze, Project-Auth-Persistenz und
Refresh-Replay, sechs Storage-Persistenz- und Concurrency-Fälle, fünf
Queue-Fälle und vier Usage-Fälle.

`npm run test:storage:docker` führt Clean- und EICAR-Pfad gegen echtes MinIO und
echtes ClamAV aus, inklusive signiertem POST, Provider-HEAD, Download und
Löschung des infizierten Objekts.

Der Harness selbst war vor diesem Release nicht startfähig. Verschachtelte
Mounts, ein `node_modules`-Volume in einem read-only Bind, ein fehlender
ClamAV-Healthcheck und eine Adressierung an der Loopback-Grenze vorbei sind
behoben. Die Harness-Tests prüfen jetzt strukturell, dass kein Mount-Ziel
innerhalb eines anderen liegt, statt die frühere Konfiguration per
String-Assertion festzuschreiben.

Weiterhin nicht zertifiziert und nicht als ausgeführt auszugeben: Realtime-CDC
und Fan-out, Queue-Multi-Instance-/Crash-/Soak-/Lastläufe, Functions-Sandbox,
Cron, Webhook-Zustellung, transaktionale Usage-Emitter, archivierte Windows- und
macOS-Läufe, Backup-/Restore-Drill, echtes Prometheus-/OTel-Scraping und ein
unabhängiger Pentest.

## Realtime Durability and Fan-out — Release 1.11

Neun lokale Tests prüfen die Zustellung über Instanzgrenzen: Broadcast von
Instanz A zu einem Abonnenten auf Instanz B, keine doppelte Zustellung auf der
sendenden Instanz, erhaltene Reihenfolge, Nachholen nach verlorenem Hinweis,
ignorierter eigener Verweis, ignorierter Verweis für einen nicht abonnierten
Kanal, Tenant-Grenze, unverändertes Verhalten ohne Bus und die Zusicherung, dass
ein Verweis keine Payload trägt.

Fünf Fälle laufen gegen echtes PostgreSQL mit zwei Instanzen, getrennten Pools
und getrennten `LISTEN`-Verbindungen: Zustellung über die Instanzgrenze, globale
Sequenz bei gleichzeitigem Schreiben beider Instanzen, Persistenz über einen
Neustart, Cross-Tenant-Unsichtbarkeit und die Append-only-Invariante.

Checkpoint `1.11.0` am 4. August 2026: **33 von 33** PostgreSQL-Fällen bestanden,
30 Migrationen angewandt, zweimal reproduziert. Lokal 720 Tests bestanden, 57
übersprungen, 0 fehlgeschlagen.

Der Realtime-Lauf war beim ersten Versuch grün. Nicht geprüft und nicht als
ausgeführt auszugeben bleiben Postgres Changes, RLS pro Ereignis, Drop-,
Reconnect-, Soak- und Lasttests sowie echter Mehrprozessbetrieb.

## Postgres Changes — Release 1.13

Sechs Fälle zertifizieren `db/project/0003_qkern_change_feed.sql` gegen echtes
PostgreSQL, indem sie die ausgelieferte Migrationsdatei selbst ausführen: Trigger
bei INSERT/UPDATE/DELETE, ausschließlich Primärschlüsselwerte im Feed,
vollständiger zusammengesetzter Schlüssel, streng aufsteigende Positionen,
Abweisung einer Tabelle ohne Primärschlüssel und die Rechtegrenze der
Laufzeitrolle.

Die letzte ist die tragende: Könnte `qkern_project_api_app` in den Feed
schreiben, ließe sich ein erfundenes Änderungsereignis einschleusen und damit
ein Lesevorgang unter fremden Claims auslösen.

Neun lokale Tests decken Kanalpolicy und Zustellung ab, darunter der Fall, dass
zwei Abonnenten desselben Kanals unterschiedliche Teilmengen derselben Änderung
erhalten, sowie der Rückstaupfad, der schließt statt zu überspringen.

Checkpoint `1.13.0`: **39 von 39** PostgreSQL-Fällen bestanden, lokal 743
bestanden, 63 übersprungen, 0 fehlgeschlagen.

Nicht ausgeführt und nicht als erbracht auszugeben: Drop- und Lasttests gegen
echte Infrastruktur sowie ein Durchlauf der ganzen Kette Feed → Dispatcher →
Abonnent gegen echtes PostgreSQL.

## Change Delivery End to End — Release 1.14

Zwölf lokale Tests decken den Poller ab: Stapelzustellung, Position erst nach
erfolgreicher Zustellung, keine überlappenden Läufe, Meldung jeder
rückgestauten Verbindung, begrenztes `drain`, Abweisung einer rückläufigen
Position und der Nachweis, dass der Poller den Feed niemals aufräumt.

Sechs Fälle fahren die ganze Kette gegen echtes PostgreSQL: `INSERT` → Trigger →
Feed → Poller → Sichtbarkeitsprüfung pro Abonnent → Zustellung. Darunter zwei
Abonnenten mit unterschiedlichen Teilmengen gegen eine echte RLS-Policy, ein
Burst von 40 Änderungen ohne Verlust oder Reihenfolgefehler, zwölf gleichzeitige
Abonnenten mit 432 einzeln geprüften Lesevorgängen, ein rückgestauter Abonnent
der geschlossen statt übersprungen wird, und die altersbasierte Aufbewahrung.

Checkpoint `1.14.0` am 5. August 2026: **45 von 45** PostgreSQL-Fällen bestanden,
zweimal reproduziert. Lokal 754 bestanden, 69 übersprungen, 0 fehlgeschlagen.

Nicht ausgeführt und nicht als erbracht auszugeben: ein Soak-Lauf mit laufendem
Poller, anhaltendem Schreiber und Messung von Durchsatz und p95-Latenz. Ein
Testfall mit expliziten `drain`-Aufrufen misst die Zustelllatenz nicht.

## Realtime in Betrieb — Release 1.15

Sieben Tests decken die Poller-Dauerschleife ab: sofortiger Folgelauf bei
gefundenen Änderungen, Leerlaufintervall nur wenn nichts zu tun war, längere
Pause nach einem Fehler ohne Abbruch der Schleife, gemeinsamer Stopp, Ablehnung
eines zweiten gleichzeitigen Laufs, Grenzen der Intervalle und sofortiges Wecken
beim Shutdown statt Aussitzen der Wartezeit.

Sieben weitere decken die Vermittlung je Projekt ab: Start je beobachtetem
Scope, kein Poller ohne Abonnent, Idempotenz, Stopp beim letzten Abonnenten,
Deduplizierung mehrfacher Scopes, lautes Scheitern an der Scope-Grenze statt
stillem Auslassen, und vollständiger Stopp mit Warten auf die Schleifen.

Der Soak-Lauf gegen echtes PostgreSQL betreibt einen laufenden Poller mit
100-ms-Intervall gegen einen anhaltenden Schreiber. Hart geprüft werden
Vollständigkeit, Reihenfolge und die Abwesenheit von Rückstau und Fehlern; die
Latenzschranken prüfen Stillstandsfreiheit, kein Leistungsversprechen.

Checkpoint `1.15.0` am 5. August 2026: **46 von 46** PostgreSQL-Fällen
bestanden, Soak mit 120 Änderungen und p95 zwischen 224 und 333 ms. Lokal 770
bestanden, 70 übersprungen, 0 fehlgeschlagen, dreimal in Folge stabil.

Behoben wurde außerdem ein zeitabhängiger Test: `project-queue-worker` erwartete
zwei Lease-Erneuerungen innerhalb einer festen Schlafdauer und fiel unter voller
Suite gelegentlich aus. Der Handler wartet jetzt, bis zweimal erneuert wurde.

## Postgres Changes in Betrieb — Release 1.16

Sieben Tests decken `ControlPlaneRealtimeProjectConnection` ab: Aufloesung ueber
Control Plane und Katalog, Abweisung eines unbekannten Projekts ohne Rueckfall
auf eine Standardverbindung, Abweisung bei abweichender Rolle oder Datenbank,
Abweisung eines privilegierten Logins in allen vier Auspraegungen, Pruefung der
Grenze bei jedem Zugriff statt einmal beim Start, und Freigabe der Verbindung
auch wenn die Arbeit wirft.

Zwei Vertragstests halten fest, dass `changes:` nur hinter einem ausdruecklichen
Opt-in entsteht, beim Shutdown gestoppt wird und Poller-Fehler nicht in das Log
dieses Prozesses gelangen.

Behoben wurden drei latente Wettlaeufe im gemeinsamen Testaufbau: Rolle, Schema
und Feed werden von drei parallel laufenden Integrationstests angelegt, und
jedes `IF NOT EXISTS` davor war ein Check-dann-Erzeuge ohne Atomarität. Sie
waren seit Release 1.13 vorhanden und blieben unentdeckt, weil zufaellig immer
eine Datei das Rennen gewann.

Checkpoint `1.16.0` am 5. August 2026: **46 von 46** PostgreSQL-Faellen
bestanden, Soak p95 198 bis 240 ms. Lokal 779 bestanden, 70 uebersprungen, 0
fehlgeschlagen.

## Queues ueber mehrere Instanzen — Release 1.17

Sechs Faelle zertifizieren Project Queues ueber mehrere Instanzen gegen echtes
PostgreSQL. Jede Instanz besitzt einen eigenen Pool, ein eigenes Repository und
einen eigenen Service; Koordination kann ausschliesslich ueber die Datenbank
laufen.

Geprueft werden Claim-Disjunktheit bei 180 Nachrichten und sechs gleichzeitig
claimenden Instanzen, genau ein Gewinner bei acht gleichzeitigen Zugriffen auf
eine Nachricht, Lease-Fencing nach echtem Ablauf mit totem Alt-Token,
Retry-Autoritaet beim Server, Kapazitaetsgrenze unter Nebenlaeufigkeit und
Dedupe ueber Instanzgrenzen.

Kein Produktfehler; alle Fehlschlaege lagen in den Testparametern. Ein
Umgehungsversuch am Trigger vorbei bestaetigte, dass
`project_queue_messages_update_guard` Zustandsuebergaenge auch gegen den
Owner-Zugang schuetzt -- eine Zusicherung, die seit Release 1.6 behauptet und
bis hierher nicht belegt war.

Checkpoint `1.17.0` am 5. August 2026: **52 von 52** PostgreSQL-Faellen
bestanden, zweimal reproduziert. Lokal 779 bestanden, 0 fehlgeschlagen.

Nicht erbracht und nicht als solches auszugeben: Functions-Sandbox, Cron und
Webhook-Zustellung, ein startbarer Handler-Host, externer Metrics-Export sowie
ein echter Prozessabsturz statt mehrerer Instanzen im selben Prozess.

## Cron mit Persistenz und Scheduler — Release 1.18

Dreizehn lokale Tests decken Migration und Scheduler ab: unveraenderliche
Definition ueber den Grant, Ruecksprungschutz und Identitaetsschutz im Trigger,
Abwesenheit jeder Lease-Konstruktion, Tenant-Isolation auf allen vier
Zugriffspfaden, Ausloesen mit Fortschritt, kein rueckwirkendes Aufarbeiten einer
frischen Definition, begrenztes Nachholen, Ueberspringen ohne faelliges
Vorkommen, Ignorieren deaktivierter Definitionen, Weiterlaufen bei einem Fehler
und Fortschritt erst nach erfolgreichem Ausloesen.

Fuenf Faelle laufen gegen echtes PostgreSQL: Ausloesen bis in die Queue mit
fortgeschriebenem Fortschritt, genau eine Nachricht bei vier gleichzeitig
ausloesenden Schedulern, abgewiesener Ruecksprung, unveraenderliche Identitaet
und Cross-Tenant-Unsichtbarkeit.

Dabei kam ein Produktfehler zutage: Der Dispatcher reichte den
Vorkommenszeitpunkt als Zustellzeit an die Queue weiter, die hoechstens fuenf
Minuten Rueckdatierung akzeptiert. Jedes nachgeholte Vorkommen wurde abgewiesen;
Catch-up konnte nie funktionieren. Im Normalbetrieb faellt das nicht auf, weil
ein regelmaessig laufender Scheduler im Fenster bleibt.

Checkpoint `1.18.0` am 5. August 2026: **57 von 57** PostgreSQL-Faellen
bestanden, 31 Migrationen. Lokal 792 bestanden, 0 fehlgeschlagen.

## Webhook-Outbox — Release 1.19

Dreizehn lokale Tests decken Migration und Outbox ab: nur eine Vault-Referenz
statt eines Geheimnisses, unveraenderliche Nutzlast, nicht rueckwaerts laufender
Versuchszaehler, finale Abschluesse, das UPDATE-Recht samt Policy fuer die
Sperrklausel, Tenant-Isolation auf allen Zugriffspfaden, serverberechnetes
Backoff mit Obergrenze und Dead Letter an der Grenze der Definition.

Acht Faelle laufen gegen echtes PostgreSQL: genau ein Gewinner bei sechs
gleichzeitigen Claimants, nur der Verifier gespeichert, Abweisung eines fremden
Workers und eines veralteten Tokens, serverbestimmte Wartezeit, Dead Letter,
unveraenderliche Nutzlast, Endgueltigkeit eines Abschlusses und
Cross-Tenant-Unsichtbarkeit.

Checkpoint `1.19.0` am 5. August 2026: **65 von 65** PostgreSQL-Faellen
bestanden, 32 Migrationen, zweimal reproduziert **vor** dem Release-Commit.
Lokal 805 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Functions-Sandbox, ein laufender Zustellprozess, ein
Signer-Adapter gegen den Vault und API-Flaechen fuer Definitionen.

## Zustellprozess — Release 1.20

Sechsundzwanzig lokale Tests decken Zustellschleife, Signatur und Transport ab:
Fehlercode des Zustellers statt eines generischen, ein unerwarteter Wurf als
Fehlschlag statt als stiller Verlust, Weiterarbeit nach einem Fehlschlag im
selben Stapel, verlorener Lease ohne Stapelabbruch, nur der Fehlercode an den
Beobachter, laengere Wartezeit nach einem gescheiterten Claim als im Leerlauf,
Signatur an den Zeitstempel gebunden, zu kurzer Schluessel abgewiesen,
Umgebungs-Provider in Produktion abgewiesen, Antwortkoerper nie gelesen, keine
Weiterleitung und kein Klartextziel.

Sechs Faelle laufen gegen echtes PostgreSQL — die **Kette**, nicht die Teile:
hinterlegen bis zur bestaetigten Zustellung mit vom Empfaenger verifizierter
Signatur, Wiederholung nach Ablehnung, fehlende Bestaetigung als Fehlschlag,
Dead Letter an der Grenze der Definition, keine Zustellung fuer eine
abgeschaltete Definition und Wiederaufnahme nach einem abgestuerzten Zusteller.

Dabei kamen zwei Produktfehler zutage, die erst der Betrieb sichtbar macht: Der
Claim gab abgelaufene Leases nie frei, sodass eine abgestuerzte Zustellung fuer
immer `in_flight` blieb; und ein abgeschalteter Webhook lief weiter und
verbrannte Versuche bis zum Dead Letter, statt zu pausieren.

Beide neuen Garantien waren im ersten Lauf sofort gruen. Deshalb wurden sie im
Adapter einzeln abgeschaltet und der Stack erneut ausgefuehrt: Genau die zwei
zugehoerigen Faelle fallen um, kein anderer. Ein gruener Fall beweist nichts,
solange nicht gezeigt ist, dass er auch rot werden kann. Protokoll:
`docs/evidence/2026-08-05/compute-chain-mutation.log`.

Checkpoint `1.20.0` am 5. August 2026: **71 von 71** PostgreSQL-Faellen
bestanden, 32 Migrationen, zweimal reproduziert **vor** dem Release-Commit.
Lokal 841 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Functions-Sandbox, ein Vault-gestuetzter Signaturschluessel-
Provider, API-Flaechen fuer Definitionen, automatische Entdeckung der zu
bedienenden Scopes und ein Lauf gegen einen echten HTTPS-Empfaenger.

## Definitionsflaeche — Release 1.21

Fuenfundzwanzig lokale Tests decken Dienst und Routen ab: nur vom Scheduler
verstandene Cron-Ausdruecke, nur existierende Zielqueues, exakt die
Webhook-Ziele die auch der Zusteller akzeptiert, doppelte Ereignistypen
zusammengefasst statt abgewiesen, Loeschen nur nach dem Abschalten, ein
Nicht-Administrator und eine fremde Organisation sehen 404 statt 403, ein
missgebildeter Bezeichner erreicht die Datenbank gar nicht, CSRF-Schutz vor
jedem Dienstaufruf, Authentifizierung vor Validierung und kein
Datenbanktext in einer Antwort.

Sieben Faelle laufen gegen echtes PostgreSQL: anlegen, auflisten und pausieren
ueber die unprivilegierte Runtime-Rolle, Namenskonflikt als 409 statt
Serverfehler, **`permission denied` fuer jede Aenderung jenseits des
Aktivierungsflags**, Loeschvorbedingung, Loeschen samt wartender Zustellungen,
Zustellstatus ohne Nutzlast und Cross-Tenant-Unsichtbarkeit.

Der dritte Fall ist der Kern: Die Unveraenderlichkeit von Ausdruck, Queue und
Ziel-URL traegt das Spaltenrecht aus den Migrationen 0031 und 0032, nicht der
Dienst. Ein Test gegen den Memory-Port koennte das gar nicht belegen.

Wie in Release 1.20 waren alle Faelle im ersten Lauf gruen, und wie dort wurden
zwei Garantien einzeln abgeschaltet — die Loeschvorbedingung und das Weglassen
der Nutzlast. Genau die zwei zugehoerigen Faelle fielen um, kein anderer.
Protokoll: `docs/evidence/2026-08-05/compute-definitions-mutation.log`.

Checkpoint `1.21.0` am 5. August 2026: **78 von 78** PostgreSQL-Faellen
bestanden, 32 Migrationen, zweimal reproduziert **vor** dem Release-Commit.
Lokal 866 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Functions-Sandbox, Vault-gestuetzter Signaturschluessel-Provider,
SDK-/CLI-Anbindung der Definitionsflaeche, manuelles Ausloesen eines
Cron-Vorkommens und Wiederholen einer toten Zustellung ueber die Flaeche.

## Functions-Sandbox — Release 1.22

Ein vierter Zertifizierungslauf kommt hinzu: `npm run test:functions:docker`. Er
braucht keinen Compose-Stack, sondern die Container-Laufzeit selbst — geprueft
wird, ob die Flags wirklich greifen.

Dreizehn Faelle laufen gegen Docker: eine Function laeuft und liefert ein
begrenztes Ergebnis, sie erhaelt Referenzen statt Geheimniswerten, die Umgebung
dieses Prozesses erreicht den Container nicht (Canary), Egress ist verweigert,
eine Definition mit erlaubten Origins wird abgewiesen statt geraten, der Prozess
laeuft nicht als root, ein Schreibversuch ausserhalb von `/tmp` scheitert, die
Speichergrenze greift, ein ueberzogener Timeout toetet den Aufruf **und**
hinterlaesst keinen laufenden Container, eine zu grosse Antwort wird abgewiesen
statt gepuffert, ein Tag als Image-Referenz wird abgewiesen, und die lokale
Image-Id ist nur ueber einen ausdruecklichen Schalter erreichbar.

Der erste Lauf war 12 von 12 gruen und trotzdem falsch. Beim Aufraeumen liess
sich das Test-Image nicht loeschen: *image is being used by running container*.
Die Sandbox toetete den Docker-Client, nicht den Container. Fuer den Aufrufer
sah das aus wie ein sauberer Timeout, waehrend die Function unbegrenzt
weiterlief. Der Fall war nur zu finden, weil der Aufraeumschritt fehlschlug und
das gemeldet wurde; ein Lauf, der stillschweigend aufraeumt, haette es
verschluckt.

Mutationsprobe: `--network none` durch `bridge` ersetzt, `--user` entfernt, die
Container-Entfernung abgeschaltet — genau die drei zugehoerigen Faelle fallen
um, kein anderer. Protokoll:
`docs/evidence/2026-08-05/functions-mutation.log`.

Checkpoint `1.22.0` am 5. August 2026: **13 von 13** Sandbox-Faellen bestanden,
zweimal reproduziert **vor** dem Release-Commit. Lokal 866 bestanden, 0
fehlgeschlagen.

Nicht erbracht: Egress-Proxy und damit jede erlaubte Ausgangsverbindung,
Deployment-Weg fuer Function-Images, Aufruf-API, Durchsetzung von
`maxConcurrency`, eigene Zertifizierung der CPU- und PID-Grenze und andere
Container-Laufzeiten als Docker 29.5.

## Functions aufrufbar — Release 1.23

Migration 0033 legt `project_functions` an. Sechs lokale Tests binden ihren
Vertrag: nur Referenzen statt Geheimnissen, Bild an einen Inhaltsdigest
gebunden, alles ausser dem Aktivierungsflag unveraenderlich, kein
Spaltenrecht auf `image`, Tenant-Isolation auf allen Zugriffspfaden und
dieselben Ressourcengrenzen wie im Validator.

Vierzehn weitere lokale Tests decken Dienst und Aufrufweg ab: eine Definition,
die der Aufruf ebenfalls akzeptiert, Abweisung genau dessen was
`validateFunctionDefinition` abweist, Aufloesen bei jedem Aufruf statt
Zwischenspeichern, Abweisung anonymer und Endnutzer-Aufrufe, fremde Organisation
unsichtbar, missgebildeter Name ohne Datenbankzugriff, Fehlerabbildung auf
404/422/502/504 und keine Container- oder Datenbankmeldung in einer Antwort.

Sieben Faelle laufen gegen echtes PostgreSQL: anlegen, auflisten und pausieren
ueber die unprivilegierte Runtime-Rolle, **`permission denied` fuer jede
Aenderung jenseits des Aktivierungsflags**, ein Tag als Bild vom Spalten-Check
abgewiesen, Namenskonflikt als 409, Aufloesen einer aktiven und Nicht-Aufloesen
einer pausierten Function, Cross-Tenant-Unsichtbarkeit und Loeschen.

Mutationsprobe: Digest-Bindung aus dem Spalten-Check entfernt und das
UPDATE-Recht auf `image` und `memory_mib` erweitert — genau die zwei
zugehoerigen Faelle fallen um, kein anderer. Protokoll:
`docs/evidence/2026-08-05/compute-functions-mutation.log`.

Checkpoint `1.23.0` am 5. August 2026: **85 von 85** PostgreSQL-Faellen
bestanden, 33 Migrationen, zweimal reproduziert **vor** dem Release-Commit,
dazu 13 von 13 Sandbox-Faellen. Lokal 886 bestanden, 0 fehlgeschlagen.

Nicht erbracht: die volle Kette Datenbank → HTTP → Container in **einem** Lauf.
Die Definitionen laufen im PostgreSQL-Stack, die Sandbox gegen Docker auf dem
Host; beide Haelften sind belegt, die Naht dazwischen nicht. Ebenfalls offen:
Egress-Proxy, Image-Deployment, Durchsetzung von `maxConcurrency` und eine
Policy je Function fuer anonyme oder Endnutzer-Aufrufe.

## Functions Ende zu Ende — Release 1.24

Der vierte Zertifizierungslauf startet jetzt zusaetzlich ein echtes PostgreSQL
mit allen 33 Migrationen. Bis Release 1.23 liefen die Definitionen im einen
Stack und die Sandbox im anderen; beide Haelften waren belegt, die Naht
dazwischen nicht.

Fuenf Faelle laufen ueber die ganze Strecke: eine ueber die Verwaltung angelegte
Definition landet in der Datenbank, wird beim Aufruf von dort gelesen und in
einem echten Container ausgefuehrt. Geprueft wird dabei, was nur die Naht zeigen
kann — Secret-Referenzen bleiben Referenzen, der Egress bleibt verweigert, eine
abgeschaltete Function hoert sofort auf zu existieren, die in der Datenbank
hinterlegte Nebenlaeufigkeitsgrenze greift, und eine fremde Organisation sieht
auch ueber diesen Weg nichts.

Drei lokale Tests decken die Grenze selbst ab: Abweisung ueber dem Limit, freies
Slot nach einem Fehlschlag und ein hoeheres Limit, das durchlaesst.

Genau eine Stelle bleibt ersetzt: Ein lokal gebautes Test-Image hat keinen
Registry-Digest, deshalb traegt die Definition eine formgueltige
Registry-Referenz, die erst beim Containerstart gegen die lokale Image-Id
getauscht wird. Validator, Spalten-Check und Sandbox-Pruefung sehen die echte
Referenz. Der erste Versuch nahm die bequeme Abkuerzung und schrieb die lokale
Id direkt in die Tabelle — der Unveraenderlichkeits-Trigger aus Release 1.23 hat
das abgewiesen, auch gegen den Owner-Zugang.

Zwei Flakes lagen im Harness, nicht im Produkt: Der Fall "nach einem Timeout
laeuft kein Sandbox-Container mehr" misst ueber alle Container mit dem Praefix,
und zwei parallel laufende Dateien teilen sich einen Docker-Daemon. Behoben ohne
die Aussage abzuschwaechen: die Dateien laufen seriell, und der Lauf raeumt
Reste frueherer Laeufe ab, bevor er misst.

Mutationsprobe: Nebenlaeufigkeitsgrenze abgeschaltet und Definition
zwischengespeichert — zwei Faelle fallen direkt um, ein dritter als Folge.
Protokoll: `docs/evidence/2026-08-05/function-chain-mutation.log`.

Checkpoint `1.24.0` am 5. August 2026: **18 von 18** Faellen des
Functions-Laufs bestanden, **dreimal** hintereinander reproduziert, dazu 85 von
85 PostgreSQL-Faellen. Lokal 889 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Egress-Proxy, Deployment-Weg fuer Images, Aufloesung einer
echten Registry-Referenz in einem Lauf und eine clusterweite
Nebenlaeufigkeitsgrenze.

## Signaturschluessel aus dem Vault — Release 1.25

Zwoelf lokale Tests decken den Provider ab: Abbildung der Referenz auf den
KV-v2-Datenpfad, Token nur im Header und nie in der URL, keine Weiterleitung,
`no-store`, unbekannte Referenz als `null` statt Fehler, abgewiesene
Nicht-Vault-Referenz, zu kurzes Geheimnis abgewiesen, falsche Antwortform,
Nicht-JSON-Antwort, weder Pfad noch Netzwerkmeldung im Fehler, Cache mit TTL
samt durchgelassener Rotation, Cache-Eintrag faellt beim Verschwinden der
Referenz, Klartext-HTTP in Produktion abgewiesen und ungueltiger Mount
abgewiesen.

Sechs Faelle laufen gegen einen echten HashiCorp Vault 1.18: ein Schluessel, den
ein Empfaenger wirklich verifizieren kann (gegengerechnet mit einem unabhaengig
gebildeten HMAC), ein zu kurz hinterlegtes Geheimnis, eine unbekannte Referenz,
fail-closed bei fehlender Tokendatei, kein Pfad im Fehler und ein Cache-Treffer.

Der Token kommt auch im Zertifizierungsstack ausschliesslich aus einer Datei;
der Stack legt sie an, statt die Produktgrenze aufzuweichen.

Zwei Fehler lagen im Stack, keiner im Produkt: `--abort-on-container-exit` riss
den Vault mit, sobald der eigene Seed-Container endete, und das Seed-Skript
mischte `require` mit Top-Level-`await`. Der Seed laeuft jetzt im Testcontainer
selbst ueber dieselbe HTTP-API wie der Provider.

Mutationsprobe: Laengengrenze fallen gelassen und die 404-Behandlung
abgeschaltet — genau die zwei zugehoerigen Faelle fallen um, kein anderer.
Protokoll: `docs/evidence/2026-08-05/webhook-vault-mutation.log`.

Checkpoint `1.25.0` am 5. August 2026: **6 von 6** Vault-Faellen bestanden,
zweimal reproduziert **vor** dem Release-Commit. Lokal 901 bestanden, 0
fehlgeschlagen.

Nicht erbracht: Betrieb eines produktiven Vault-Clusters (der Lauf nutzt den
Dev-Modus), AppRole- oder Kubernetes-Authentifizierung und ein Egress-Proxy fuer
Functions.

## Vermittelter Egress — Release 1.26

Elf lokale Tests decken die Policy ab: exakt allowlistete Origin durch,
Nachbar-Origin und abweichender Port abgewiesen, leere Liste weist alles ab,
keine Weiterleitung, kleine Methodenliste, abgewiesene Hop-by-Hop- und
Identitaetsheader samt CRLF-Injektion, begrenzte Anfrage- und Antwortgroesse,
Fehler ohne Ursache, nur vier feste Antwortheader und ein Budget, das
ausgeht.

Fuenf Faelle laufen im echten Container: eine vermittelte Anfrage an eine
erlaubte Origin geht durch, eine an `api.example.com.evil.test` wird abgewiesen
**ohne dass die Anfrage ueberhaupt gestellt wird**, das Budget begrenzt die
Anzahl je Aufruf, eine Definition mit erlaubten Origins ohne Vermittler wird
abgewiesen, und ein **direkter** Verbindungsversuch scheitert weiterhin — der
Kanal ersetzt das Netz, er ergaenzt es nicht.

Beim Umbau fiel ein Fall um, der nichts mit dem neuen Protokoll zu tun hatte:
Das harte Entfernen eines Containers lief abgekoppelt weiter und war damit nur
best-effort — eine Einschraenkung, die Release 1.24 selbst notiert hatte. Jetzt
wird darauf gewartet; die Zusage braucht keine Einschraenkung mehr.

Mutationsprobe: Allowlist auf einen Praefixvergleich aufgeweicht und das
Anfragebudget abgeschaltet — genau die zwei zugehoerigen Faelle fallen um, kein
anderer. Protokoll: `docs/evidence/2026-08-05/function-egress-mutation.log`.

Checkpoint `1.26.0` am 5. August 2026: **22 von 22** Faellen des
Functions-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 912 bestanden, 0 fehlgeschlagen.

Nicht erbracht: eine Zertifizierung gegen einen echten externen HTTPS-Server
(der ausgehende Aufruf laeuft in den Faellen gegen ein eingespeistes `fetch`),
DNS-Pinning und eine Sperre privater Adressbereiche im Egress-Pfad.

## Egress-Haertung — Release 1.27

Neununddreissig lokale Faelle decken die Adresspolicy ab, siebenundzwanzig davon
abzuweisende Adressen: Loopback, alle drei privaten Bereiche, Carrier-Grade NAT,
Link-local samt Metadatendienst, "dieses Netz", Multicast, Broadcast, Benchmark-
und Dokumentationsbereiche, 6to4-Relay; auf der IPv6-Seite Loopback,
unspezifiziert, Unique Local, Link-local, Multicast, Dokumentation, Teredo und
6to4; dazu IPv4-mapped IPv6, ohne das `::ffff:127.0.0.1` die gesamte
IPv4-Pruefung umginge.

Fuenf weitere Faelle pruefen das Auflösen: die geprüfte Adresse kommt zurueck,
eine einzige nicht oeffentliche Adresse unter mehreren weist den ganzen Namen
ab, ein Name ohne Adresse wird abgewiesen, ein unmoeglicher Name wird gar nicht
erst aufgeloest, und weder Name noch Adresse stehen in der Ausnahme.

Ein Fall laeuft im echten Container: Eine allowlistete Origin, deren Name auf
`169.254.169.254` zeigt, wird mit `EGRESS_BLOCKED` abgewiesen. Damit ist die
Kette Definition, Vermittler, Adresspolicy in einem Lauf belegt.

Mutationsprobe: Link-local durchgelassen und statt aller Adressen nur die erste
geprueft — vier lokale Faelle und der Container-Fall fallen um.
Protokoll: `docs/evidence/2026-08-05/egress-guard-mutation.log`.

Checkpoint `1.27.0` am 6. August 2026: **23 von 23** Faellen des
Functions-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 951 bestanden, 0 fehlgeschlagen.

Nicht erbracht: eine Zertifizierung gegen einen echten externen HTTPS-Server.
Der geprüfte Weg wird mit einem eingespeisten Resolver belegt, nicht mit einer
echten TLS-Verbindung nach draussen.

## Echter Empfaenger — Release 1.28

Der sechste Zertifizierungslauf (`npm run test:receiver:docker`) stellt zehn
Faelle gegen einen **echten** HTTPS-Server, der die HMAC-Signatur selbst
nachrechnet. Ein Empfaenger, der jede Nachricht bestaetigt, wuerde nur belegen,
dass irgendetwas ankam.

Auf dem Zustellweg: eine signierte Zustellung geht durch und wird in der
Datenbank `delivered`; ein Empfaenger, der mit 200 antwortet, ohne die
Zustell-ID zurueckzuspiegeln, gilt als Fehlschlag; eine Weiterleitung wird nicht
befolgt; und ein zweiter Netzwerk-Alias auf demselben Container, den das
Zertifikat nicht traegt, wird abgewiesen — mit
`ERR_TLS_CERT_ALTNAME_INVALID` als belegtem Grund. Dieser Fall zeigt, dass das
Festhalten der Adresse aus 1.27 die Identitaetspruefung nicht aushebelt.

Auf dem Egress-Weg: eine erlaubte Origin ist erreichbar und liefert von ihren
Antwortheadern nur `content-type` zurueck — `set-cookie` und der interne Header
des Empfaengers bleiben draussen; eine zu grosse Antwort wird abgebrochen; eine
Weiterleitung wird abgewiesen, statt der Function ein neues Ziel zu reichen;
eine fremde Origin faellt vor dem Verbindungsaufbau durch; und
`internal.qkern.test`, das ein echter Resolver auf 172.31.240.x abbildet, wird
mit `EGRESS_BLOCKED` abgewiesen, obwohl die Allowlist es ausdruecklich erlaubt.

**Der erste Lauf war rot, und das aus gutem Grund.** Das DNS-Pinning aus
Release 1.27 hat gegen einen echten Socket **jede** Verbindung verhindert: Node
ruft die ersetzte `lookup` seit `autoSelectFamily` mit `all: true` auf und
erwartet dann eine Liste; eine einzelne Adresse endet in
`ERR_INVALID_IP_ADDRESS`. Gegen ein eingespeistes `fetch` war davon nichts zu
sehen. Die drei negativen Faelle des Laufs waren dabei gruen — vollstaendig
wirkungslos ist eben auch ein Fehlschlag.

Mutationsprobe in zwei Wellen. Empfaengerseitig: die Zustell-ID auch auf dem
stillen Pfad zurueckgespiegelt und `wrong.qkern.test` ins Zertifikat
aufgenommen — genau die drei zugehoerigen Faelle fallen um. Codeseitig: das
Weiterleitungsverbot, die Adresspruefung und die Antwortgrenze abgeschaltet —
genau die drei zugehoerigen Faelle fallen um.
Protokoll: `docs/evidence/2026-08-06/receiver-mutation.log`.

Dabei zeigte sich, dass der Weiterleitungsfall **auf dem Zustellweg** nicht
traegt: Eine 302 faellt dort ohnehin durch die Statuspruefung. Getragen wird die
Zusage vom Egress-Fall, wo eine Weiterleitung sonst samt `location` bei der
Function ankaeme.

Checkpoint `1.28.0` am 6. August 2026: **10 von 10** Faellen des
Empfaenger-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 951 bestanden, 0 fehlgeschlagen.

Nicht erbracht: ein Empfaenger ausserhalb des eigenen Docker-Netzes und ein
oeffentlich vertrauenswuerdiges Zertifikat. Der Lauf belegt Protokoll, Signatur
und Policy, nicht die Erreichbarkeit des offenen Internets.

## Usage-Emitter — Release 1.29

Sieben Faelle im PostgreSQL-Lauf messen nicht den Emitter, sondern seine
Wirkung: Nach einem echten `enqueue` beziehungsweise einem echten `invoke` steht
eine Zahl in `usage_counters`, und ein hartes Limit verhindert die Operation
wirklich.

Gepruefte Zusagen: zwei echte Enqueues ergeben Zaehlerstand zwei und zwei
Ereignisse mit Quelle `project_queues`; ein erschoepftes `enforce`-Limit weist
den naechsten Enqueue ab **und schreibt keine Nachricht**; ein `observe`-Limit
laeuft stattdessen ueber; ein deduplizierter Enqueue zaehlt als eigene
Operation; ein echter Function-Aufruf zaehlt; ein erschoepftes Kontingent weist
den Aufruf ab, **ohne den Invoker zu starten**; und ein ausgefallenes Ledger
laesst die Operation durch, waehrend `onFailure: "reject"` sie blockiert.

Jeder Fall bekommt sein eigenes Projekt. Zaehler sind monatlich und kumulativ —
teilten sich zwei Faelle einen Scope, haenge jede Zahl an der Reihenfolge.

Neun lokale Faelle decken den Emitter selbst ab: Schluesselaufbau aus Quelle,
Metrik und Bezug; der eigene `meter`-Principal statt dem des Aufrufers;
Ausfall offen und geschlossen; ein wiederverwendeter Schluessel mit verandertem
Inhalt scheitert immer geschlossen; ein unbrauchbarer Bezug erreicht das Ledger
gar nicht.

Mutationsprobe in zwei Wellen. Erste Welle: die Zulassung im Function-Aufruf
entfernt und die Messung im Enqueue hinter das Schreiben verschoben — genau
drei Faelle fallen um. Zweite Welle: der Idempotenzschluessel konstant gesetzt
und der Ausfallmodus auf `reject` gedreht — sechs Faelle fallen um. Zusammen
zeigt jede der sieben Zusagen, dass sie rot werden kann.
Protokoll: `docs/evidence/2026-08-06/usage-emitters-mutation.log` und
`usage-emitters-mutation2.log`.

Die zweite Welle zeigt dabei etwas Eigenes: Ein Schluessel, der sich nicht
aendert, macht aus dem Ledger eine **einzige** Entscheidung, die ewig
wiederholt wird — auch die Ablehnung eines harten Limits greift dann nur
einmal. Der Idempotenzschluessel ist nicht nur Schutz gegen Doppelzaehlung,
er ist die Bedingung dafuer, dass eine Grenze mehr als einmal beisst.

Checkpoint `1.29.0` am 6. August 2026: **92 von 92** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 960 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Emitter in Generated Data API, Storage und Realtime; ein
transaktionaler Emitter, der sein Ereignis in derselben Transaktion schreibt
wie die Operation; Abgleich mit Providerwerten; Last- und Crash-Laeufe des
Messpfads.

## Transaktionale Messung — Release 1.30

Drei weitere Faelle, und alle drei betreffen die Naht zwischen Messung und
Operation.

Der erste: Eine wegen voller Warteschlange abgewiesene Nachricht verbraucht
**kein** Kontingent. Bis 1.29 zaehlte sie trotzdem, weil die Messung vor der
Operation lief.

Der zweite ist der eigentliche Nachweis der Atomaritaet: Ein Ledger, das
ablehnt, liest zuvor ueber **dieselbe** Transaktion die soeben geschriebene
Nachricht und sieht sie. Danach ist sie weg. Die Zeile existierte, und der
Rollback hat sie mitgenommen — ohne gemeinsame Transaktion waere sie geblieben.

Der dritte: acht gleichzeitige Enqueues ueber **vier** Queues ergeben genau acht
Nachrichten und Zaehlerstand acht.

Dieser dritte Fall ist der Lehrreiche. Er hiess zuerst „acht gleichzeitige
Enqueues" — ueber eine einzige Queue. Die Mutationsprobe entfernte daraufhin die
Zeilensperre auf dem Monatszaehler, und **nichts** fiel um. Grund: Enqueues
derselben Queue serialisieren ohnehin auf deren Zeile und erreichen den Zaehler
nie gleichzeitig. Der Fall war grün, ohne die Zusage zu tragen. Mit vier Queues
faellt er ohne die Sperre sofort um.

Dabei kam ein zweiter, unbequemer Befund heraus: Auch der aeltere Fall
„serializes concurrent hard-quota decisions" aus `usage-metering-postgres`
bleibt ohne die Zeilensperre grün. Er traegt seine Aussage nicht selbst — die
beiden gleichzeitigen Buchungen laufen dort in ein frisches Projekt, und der
`ON CONFLICT DO NOTHING`-Einschub in `usage_counters` serialisiert sie ueber den
Unique-Index. Die Sperre ist im Betrieb noetig, aber belegt hat sie erst der
neue Fall.

Mutationsprobe in zwei Wellen. Erste Welle: zurueck auf das Verhalten von 1.29 —
messen vor der Operation, in einer eigenen Transaktion. Genau die zwei
zugehoerigen Faelle fallen um. Zweite Welle: Zeilensperre auf dem Monatszaehler
entfernt — der korrigierte Nebenlaeufigkeitsfall faellt um.
Protokoll: `docs/evidence/2026-08-06/usage-transaction-mutation.log` und
`usage-transaction-mutation2.log`.

Checkpoint `1.30.0` am 6. August 2026: **95 von 95** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 960 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Der Function-Aufruf bleibt nicht-transaktional — er schreibt
nichts in die Control Plane, mit dem er atomar sein koennte. Generated Data API,
Storage und Realtime melden weiterhin nicht. Ein Crash-Lauf, der die
Atomaritaet unter echtem Prozessabbruch zeigt, fehlt.

## Nachtraegliche Metriken — Release 1.31

Drei weitere Faelle. Ein echtes `listRows` ueber die Generated Data API erhoeht
`database_row_reads` um genau die Zahl der zurueckgegebenen Zeilen — nicht um
die geholte Zeile mehr, die nur `hasMore` bestimmt und QKERN nie verlaesst. Eine
Lesung ohne Treffer zaehlt nicht; die Metrik heisst `database_row_reads`. Ein
echtes `createDownloadGrant` erhoeht `storage_egress_bytes` um die Groesse des
Objekts, zweimal aufgerufen also zweimal.

Der dritte Fall belegt eine Produktregel, die dieser Slice neu zieht: Fuer beide
Metriken laesst sich `enforce` **nicht setzen**. Ihre Menge steht erst fest,
wenn die Arbeit getan ist; ein hartes Limit koennte dort nichts mehr verhindern
und wuerde nur aufhoeren zu zaehlen. Ein Zaehler, der stehen bleibt, waehrend
die Nutzung weiterlaeuft, ist schlimmer als gar keiner. `observe` bleibt
erlaubt.

Damit ist auch abgesichert, dass die beiden Emitter ihre Antwort ignorieren
duerfen: Das Ledger kann diese Ereignisse gar nicht ablehnen.

Zwei Faelle scheiterten im ersten Lauf, und beide Male hatte das Produkt recht:
Die Generated Data API weist eine Tabelle ohne RLS ab, und Storage weist einen
MIME-Typ ausserhalb der Allowlist ab. Korrigiert wurde der Testaufbau, nicht die
Regel.

Mutationsprobe: Zeilenzahl durch eine feste Eins ersetzt, die Byte-Messung
abgeschaltet und das enforce-Verbot entfernt — genau die drei zugehoerigen
Faelle fallen um.
Protokoll: `docs/evidence/2026-08-06/usage-modules-mutation.log`.

Checkpoint `1.31.0` am 6. August 2026: **98 von 98** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.

Nicht erbracht: `api_requests` gehoert an die HTTP-Grenze — 71 Routendateien
ohne gemeinsamen Chokepoint, und eine Messung je Dienstmethode wuerde doppelt
zaehlen. `realtime_messages` braucht einen buendelnden Emitter; eine
Control-Plane-Transaktion je Nachricht waere auf dem Realtime-Pfad ein
absehbarer Fehler. Gemessen werden ausserdem **freigegebene**, nicht
ausgelieferte Bytes: Die Auslieferung uebernimmt der Provider direkt.

## Zaehlung an der HTTP-Grenze — Release 1.32

Der Chokepoint war doch da, nur nicht dort, wo Release 1.31 gesucht hatte. Nicht
71 Routendateien, sondern **fuenf Kontext-Resolver**: Jedes Modul loest den
Scope einer Anfrage an genau einer Stelle auf, und genau dort wird jetzt
gezaehlt.

Ein Fall im PostgreSQL-Lauf belegt das Ergebnis gegen das echte Ledger: Bei
einem `enforce`-Limit von zwei gehen zwei Anfragen durch, die dritte scheitert
mit `UsageQuotaExceededError`, und der Zaehler steht auf zwei — die abgewiesene
Anfrage erhoeht ihn nicht.

`api_requests` ist damit die Gegenprobe zu den beiden nachtraeglichen Metriken
aus 1.31: Die Menge steht **vorher** fest, genau eins. Deshalb darf und soll
diese Metrik gaten; `enforce` ist hier die sinnvolle Einstellung, nicht die
unmoegliche.

Vier lokale Faelle decken den Helfer ab: eine Anfrage zaehlt als eins, ein
erschoepftes Kontingent bricht ab, der Fehler traegt weder Scope noch Zahlen, und
beide Fehlerabbildungen antworten mit 429. Ein erschoepftes Kontingent heisst
„spaeter wiederkommen", nicht „kaputt"; faellt eine Abbildung weg, wird daraus
eine 500.

Mutationsprobe: die Ablehnung im Helfer entfernt — der Zertifizierungsfall und
der lokale Abbruchfall fallen um.
Protokoll: `docs/evidence/2026-08-06/usage-api-requests-mutation.log`.

Checkpoint `1.32.0` am 6. August 2026: **99 von 99** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 964 bestanden, 0 fehlgeschlagen.

Nicht erbracht — und das ist die wichtigste Zeile hier: Zertifiziert ist der
**Helfer**, nicht seine **Platzierung**. Dass er an allen fuenf Resolvern steht
und an keinem doppelt, ist gelesen und nicht getestet; ein Test dafuer braeuchte
eine echte HTTP-Anfrage mit Sitzung oder Projektschluessel. Wer einen Resolver
hinzufuegt, muss selbst daran denken. `realtime_messages` meldet weiterhin
nicht.

## Realtime buendelt — Release 1.33

Die letzte Metrik meldet, und zwar anders als die fuenf davor: gesammelt.

Zwei Faelle im PostgreSQL-Lauf. Vierzig Nachrichten ergeben **eine** Buchung,
und vor dem Schreiben steht im Ledger nichts — genau das ist der Handel: ein
Puffer statt vierzig Transaktionen. Ein weggeworfener Emitter, also ein
abgestuerzter Prozess, verliert seinen Puffer: fuenf ungeschriebene Nachrichten
zaehlen nicht, eine geschriebene zaehlt. Lieber zu wenig als zu viel — wer zu
viel zaehlt, stellt in Rechnung, was nie stattgefunden hat.

Neun lokale Faelle decken den Emitter ab, darunter die beiden, die die
Wiederholung tragen: Ein Stapel, den das Ledger nie erreicht hat
(`unavailable`), wird **unveraendert** und mit demselben Schluessel erneut
gesendet; ein Stapel, ueber den das Ledger entschieden hat
(`quota_exceeded`), wird verworfen. Das Zusammenlegen eines wiederholten
Stapels mit neuen Nachrichten waere ein Idempotenzkonflikt und machte ihn
dauerhaft unschreibbar — auch dafuer gibt es einen Fall.

`realtime_messages` kommt damit in dieselbe Liste wie die beiden
nachtraeglichen Metriken, aber aus einem **zweiten** Grund: Nicht die Menge
fehlt, sondern der Zeitpunkt. Man kann keine Nachricht ablehnen, die laengst in
einem offenen Stapel gezaehlt ist. Die Liste heisst deshalb jetzt
`UNENFORCEABLE_USAGE_METRICS` und traegt beide Gruende.

**Die Luecke aus Release 1.32 ist geschlossen**, wenn auch anders als dort
angekuendigt: Ein Vertragstest liest die drei Modulquellen und verlangt, dass
jeder exportierte Kontext-Resolver `admitApiRequest` ruft. Das prueft den
Quelltext, nicht das Verhalten — es faengt aber genau den Fehlerfall, der
gemeint war: Jemand fuegt einen Resolver hinzu und denkt nicht daran.

Mutationsprobe: Buendelung abgeschaltet (Schreiben je Nachricht) und
`realtime_messages` aus der Liste entfernt — genau die drei zugehoerigen Faelle
fallen um.
Protokoll: `docs/evidence/2026-08-06/usage-realtime-mutation.log`.

Checkpoint `1.33.0` am 6. August 2026: **101 von 101** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 973 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Der Realtime-Pfad ist mit eingeschaltetem Emitter nicht neu
vermessen worden — der Soak-Lauf lief ohne. Ein Absturz verliert weiterhin den
Puffer, und ein Lauf, der das unter echtem Prozessabbruch zeigt, fehlt.
`control_plane`, `project_auth` und `mcp` duerfen `api_requests` schreiben, tun
es aber nicht.

## Aenderungen zaehlen mit — Release 1.34

Zwei Dinge, und beide standen als offener Punkt in Release 1.33.

**Erstens meldet jetzt auch `deliverChanges`.** Bis 1.33 zaehlte nur
`broadcast`. Ein Projekt, das ausschliesslich `changes:`-Kanaele benutzt, haette
dauerhaft null gezeigt — gemessen, aber am falschen Weg. Gezaehlt wird **einmal
je zugestellter Aenderung**, nicht je Abonnent: dieselbe Regel wie beim
Broadcast. Eine Aenderung, die kein Abonnent sehen darf oder die niemand
abonniert hat, zaehlt nicht; es ist keine Nachricht entstanden. Drei lokale
Faelle halten das fest.

**Zweitens laeuft der Soak-Lauf jetzt mit eingeschaltetem Emitter**, und der
Flush-Schwellwert ist mit 25 klein genug, dass waehrend der Messung mehrfach
wirklich geschrieben wird. Der Lauf pruefe sonst einen Pfad, den er nicht misst.

Vier Laeufe auf derselben Maschine, im Abstand von Minuten:

| Lauf | Emitter | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| erster Lauf | ein | 359 ms | 421 ms | 456 ms |
| Basislinie | aus | 400 ms | 528 ms | 547 ms |
| run1 | ein | 1237 ms | 1846 ms | 1947 ms |
| run2 | ein | 1241 ms | 1716 ms | 1836 ms |

**Diese Messung kann die Kosten des Emitters nicht isolieren, und das ist das
Ergebnis.** Zwei Laeufe derselben Konfiguration liegen zwischen 421 und 1846 ms
p95 — die Streuung ist rund viermal so gross wie jeder Unterschied zwischen den
Konfigurationen. Ein Vergleich, der das ignoriert, waere eine Zahl mit
Nachkommastellen und ohne Aussage.

Die Ursache ist naheliegend: Die Laeufe folgten unmittelbar aufeinander, jeder
mit eigenem Container-Stack, auf einem Entwicklungsrechner. Wer die Kosten des
Emitters wirklich messen will, braucht eine ruhige Maschine und viele
Wiederholungen je Konfiguration.

Was der Lauf **belegt**: Der Soak-Lauf haelt seine Stillstandsschranken auch mit
eingeschaltetem Emitter ein, der Zaehlerstand entspricht exakt der Zahl
zugestellter Nachrichten, und fuenf Buchungen fuer 120 Nachrichten zeigen, dass
wirklich gebuendelt wurde.

Die frueher dokumentierten 198 bis 333 ms stammen von einem anderen Tag und sind
mit diesen Zahlen ohnehin nicht vergleichbar.

Mutationsprobe in zwei Teilen: Emitter aus dem Soak-Lauf entfernt — genau die
Zaehlerpruefung faellt um (Protokoll:
`docs/evidence/2026-08-06/usage-changes-baseline.log`, zugleich die Basislinie).
Zaehlung je Abonnent statt je Aenderung — der lokale Fall dazu faellt um.

Checkpoint `1.34.0` am 6. August 2026: **101 von 101** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 976 bestanden, 0 fehlgeschlagen.

Nicht erbracht (Stand 1.34): **Die Kosten des Emitters bleiben unbekannt** — die
Streuung zwischen Laeufen ueberdeckt sie. Die Messung gilt ausserdem fuer 120
Aenderungen auf einem Entwicklungsrechner, nicht fuer Last. Ein Lauf, der den
Pufferverlust unter echtem Prozessabbruch zeigt, fehlt weiterhin.
`control_plane`, `project_auth` und `mcp` melden `api_requests` nicht.

## Echte Registry — Release 1.35

Die Functions-Kette hatte seit Release 1.24 genau **eine** ersetzte Stelle: Ein
lokal gebautes Test-Image hat keinen Registry-Digest, deshalb trug die
Definition eine erfundene Referenz, und beim Containerstart wurde genau dieser
Argumentwert gegen die lokale Image-Id getauscht. Jede Release-Notiz seither
fuehrte das offen mit.

Jetzt laeuft im Stack eine `registry:2`. Das Test-Image wird gebaut, gepusht,
**lokal geloescht** und ueber seinen Digest wieder geholt. Ohne das Loeschen
beantwortete der Zwischenspeicher die Frage und die Registry waere Kulisse.

**Der Versuch, eine echte Registry zu benutzen, hat sofort einen Produktfehler
freigelegt.** Der Spalten-Check aus Migration 0033 liess keinen Doppelpunkt zu:

    image ~ '^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$'

Damit war jede Registry mit Port ausgeschlossen — jede lokale, jede in einem
Cluster, jede in einem Zertifizierungsstack. Aufgefallen ist das nie, weil bis
dahin jede Definition eine erfundene Referenz ohne Port trug. Migration 0034
laesst den Doppelpunkt zu; die bindende Stelle bleibt der Digest, denn was vor
dem `@` steht, ist nur die Adresse.

**Ein Schlupfloch ist verschwunden.** `DockerFunctionSandbox` hatte einen
benannten Schalter `allowLocalImageId`, der zusaetzlich eine blosse Image-Id
zuliess — noetig, solange der Zertifizierungslauf lokal baute. Er ist entfernt.
Was bleibt, ist eine Regel ohne Ausnahme, und der zugehoerige Fall prueft jetzt
genau das statt der Wirkung eines Schalters.

Mutationsprobe in zwei Teilen, beide direkt am Fund. Migration 0034
weggelassen: Alle fuenf Kettenfaelle fallen ueber
`project_functions_image_check` — der Fehler, der ohne diesen Slice unentdeckt
geblieben waere. Registry nach dem Push gestoppt: 15 von 23 Faellen fallen um,
weil nichts mehr zu ziehen ist. Der zweite Teil belegt, dass der Lauf wirklich
aus der Registry zieht und nicht aus einem Rest im Zwischenspeicher.
Protokolle: `docs/evidence/2026-08-06/functions-registry-mutation.log` und
`functions-registry-mutation2.log`.

Checkpoint `1.35.0` am 6. August 2026: **23 von 23** Faellen des
Functions-Laufs und **101 von 101** des PostgreSQL-Laufs bestanden, je zweimal
reproduziert **vor** dem Release-Commit. Lokal 976 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Die Registry laeuft ohne TLS und ohne Authentifizierung auf
127.0.0.1 — Docker behandelt diese Adresse ohne Zutun als unsicher erreichbar.
Ein Lauf gegen eine authentifizierte Registry mit Zertifikat fehlt, und damit
auch jede Aussage ueber Registry-Zugangsdaten. Einen Deployment-Weg, der ein
Image eines Betreibers dorthin bringt, gibt es weiterhin nicht: Der Lauf zeigt,
dass QKERN einen Digest aufloesen kann, nicht wie er entsteht.

## Clusterweite Grenze — Release 1.36

`max_concurrency` steht seit Migration 0033 in der Definition und wurde seit
Release 1.24 durchgesetzt — **prozesslokal**. Zwei Web-Instanzen zaehlten
getrennt, die tatsaechliche Obergrenze war also `max_concurrency × Instanzen`.
Jede Release-Notiz seit 1.23 fuehrte das offen mit.

Ein Platz ist jetzt eine Zeile (Migration 0035). Fuenf Faelle im
PostgreSQL-Lauf pruefen die Grenze mit **zwei getrennten Diensten**, die nichts
teilen ausser der Datenbank: Eine belegte Function weist die zweite Instanz ab;
nach dem Ende der ersten kommt die zweite durch; der Platz eines abgestuerzten
Prozesses wird nach Ablauf zurueckgeholt; eine belegte Function blockiert keine
andere; und ein Platz laesst sich nicht verlaengern, sondern nur neu nehmen.

Die prozesslokale Zaehlung bleibt daneben stehen, mit einer eigenen Aufgabe: Sie
schuetzt **diesen Host** vor einem Aufrufer, der beliebig viele Container
startet. Die geteilte Grenze schuetzt den Tenant. Beide muessen zustimmen.

Ist die Control Plane nicht erreichbar, wird der Aufruf abgewiesen. Das ist die
Gegenrichtung zur Usage-Quota aus Release 1.29, und aus gutem Grund: Eine Quota
ist eine kaufmaennische Grenze, diese hier schuetzt vor Ueberlast.

Mutationsprobe in zwei Wellen. Erste Welle: Der Zaehlweg filtert zusaetzlich
nach dem Halter — genau der Fehler, den der Kommentar im Adapter beschreibt.
Genau ein Fall faellt um, naemlich der, der zwei Instanzen gegeneinander stellt.
Zweite Welle: Ablauf ignoriert und die Unveraenderlichkeit des Platzes
aufgehoben — genau die zwei zugehoerigen Faelle fallen um.
Protokolle: `docs/evidence/2026-08-06/function-slots-mutation.log` und
`function-slots-mutation2.log`.

**Zwei Zwischenlaeufe waren wertlos und sind es wert, genannt zu werden.** Die
ersten beiden Versuche der zweiten Welle warfen alle fuenf Faelle um statt
zweier — nicht, weil die Zusage breiter traegt, sondern weil die Mutation
ungueltiges SQL erzeugte: PostgreSQL kann den Typ eines Parameters nicht
bestimmen, der nur in `IS NOT NULL` oder in `$5 - interval` vorkommt. Der
Adapter warf, und `claim` scheitert geschlossen. Eine Mutationsprobe, die das
Werkzeug zerstoert statt die Zusage aufzuweichen, sagt nichts aus. Erst der
dritte Versuch — Ablauf ueber einen uralten Vergleichszeitpunkt ausgehebelt,
SQL unveraendert — traf die zwei vorhergesagten Faelle.

Dabei kam ein zweiter Befund heraus: Das Aufraeumen abgelaufener Plaetze im
Adapter ist **nicht** das, was die Zusage traegt. Der Ablaufvergleich in der
Zaehlung tut es. Das Loeschen haelt nur die Tabelle klein; wer es entfernt,
bricht keinen Fall.

Checkpoint `1.36.0` am 6. August 2026: **106 von 106** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.

Nicht erbracht: Die zwei Instanzen sind zwei Dienste in einem Prozess. Sie
teilen nichts ausser der Datenbank, aber ein Lauf mit zwei echten Prozessen und
einem echten Absturz zwischen Belegen und Freigeben fehlt. Die Lease ist fest
auf Timeout plus 30 Sekunden; eine Function, die ihren Timeout ueberschreitet,
weil der Host haengt, gibt ihren Platz zu frueh frei.

## Aufraeumen laeuft — Release 1.37

Drei `prune`-Pfade gab es seit Release 1.11 beziehungsweise 1.13. **Keiner
hatte einen Aufrufer.** Der Change-Poller lehnt das Aufraeumen ausdruecklich ab,
mit gutem Grund — eine Instanz weiss nicht, was andere noch brauchen — und ein
eigener Test haelt das seit damals fest. Damit war die Aufgabe benannt und blieb
liegen: Event-Log und Change-Feed wuchsen unbegrenzt.

Das ist dasselbe Muster wie beim Realtime-Poller, beim dauerhaften Event-Log,
bei der Webhook-Outbox, bei der Functions-Sandbox und bei den Usage-Emittern —
zum sechsten Mal in diesem Sprint. Diesmal war es besonders gut versteckt, weil
ein Test ausdruecklich belegte, dass **nicht** aufgeraeumt wird.

Zwei Faelle im PostgreSQL-Lauf messen die Wirkung: Von drei Ereignissen mit 30,
10 und einem Tag Alter bleibt bei sieben Tagen Aufbewahrung genau eines uebrig;
und die Ereignisse einer anderen Organisation bleiben unberuehrt.

Sechs lokale Faelle decken die Runtime ab: Sie raeumt jeden konfigurierten Scope
auf statt nur die abonnierten; sie haelt die zwei Fenster auseinander; ein nicht
erreichbares Projekt haelt die uebrigen nicht auf; ohne Change-Quelle bleibt der
Feed unberuehrt; eine Aufbewahrung von null Millisekunden wird abgewiesen; und
ein `stop` wirkt zwischen zwei Projekten, nicht erst nach der Runde.

Welche Projekte aufgeraeumt werden, steht **ausdruecklich** in der Umgebung.
Die Abonnements einer Instanz waeren der falsche Massstab: Gerade das Projekt,
dem niemand zuhoert, waechst unbeobachtet.

Mutationsprobe: Das Aufbewahrungsfenster ignoriert, also bis `now` geloescht —
genau der Fall faellt um, der Altes von Neuem unterscheidet.
Protokoll: `docs/evidence/2026-08-06/realtime-retention-mutation.log`.

Checkpoint `1.37.0` am 6. August 2026: **108 von 108** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 982 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Die Tenant-Grenze im zweiten Fall traegt **RLS**, nicht der
Aufraeumer — sie laesst sich vom Adapter aus nicht brechen und ist deshalb auch
nicht durch eine Mutation belegt. Aufbewahrt wird nach Alter, nicht nach
Position: Ein Poller, der laenger als das Fenster ausgefallen war, verliert
Aenderungen; die Cursor-Pruefung meldet die Luecke, statt sie zu verschweigen.
Ein Lauf, der genau das zeigt, fehlt.

## Was noch waechst — Release 1.38

Release 1.37 schloss mit dem Satz, dass `usage_events` und
`project_webhook_deliveries` weiterhin ohne Aufraeumer wachsen. Der Blick auf
beide hat zwei verschiedene Antworten ergeben, und das ist das Ergebnis dieses
Slices.

**Webhook-Zustellungen bekommen eine Aufbewahrung.** Zugestellte und tote Zeilen
haben getrennte Fenster (sieben beziehungsweise dreissig Tage), und **wartende
oder laufende bleiben unberuehrt** — unabhaengig von ihrem Alter. Eine
ausstehende Zustellung ist keine Altlast; sie zu loeschen waere der stille
Verlust genau der Nachricht, die noch ankommen soll. Eine tote Zustellung ist
der Grund, warum ein Betreiber ueberhaupt in diese Tabelle schaut, und darf
nicht mit dem Alltagsrauschen verschwinden.

Zwei Faelle im PostgreSQL-Lauf messen die Wirkung, fuenf lokale die Runtime.

**`usage_events` bekommt bewusst keine.** Der Trigger aus Migration 0028 weist
UPDATE **und DELETE** ab, und die Runtime-Rolle hat kein DELETE-Recht — beides
Absicht. Diese Tabelle ist zweierlei zugleich: der Beleg hinter jedem
Zaehlerstand und der Idempotenz-Speicher. Ein geloeschtes Ereignis heisst, dass
derselbe Schluessel spaeter erneut zaehlt. Die Antwort auf ihr Wachstum ist
**Export**, nicht Loeschen; `docs/USAGE_METERING.md` fuehrt Retention/Export
seit Alpha 1 als offen.

Der Schlusssatz von 1.37 war damit zu schnell: Er behandelte beide Tabellen
gleich, obwohl nur eine einen Aufraeumer vertraegt.

Mutationsprobe in zwei Wellen, jede genau ein Fall: Status und Zeitstempel
ignoriert (nach `created_at` geloescht) — der Fall mit der wartenden Zustellung
faellt um. Tote Zustellungen mit dem Fenster der zugestellten behandelt — der
Fall mit dem Dead Letter faellt um.

**Drei Anlaeufe waren dabei wertlos, und zwar aus demselben Grund wie in Release
1.36.** Eine Mutation, die `$5 IS NOT NULL` einfuegt, `$5 - interval` rechnet
oder einen Parameter unbenutzt laesst, laesst PostgreSQL werfen: Der Typ ist
nicht bestimmbar beziehungsweise die Parameterzahl passt nicht. Der Adapter
scheitert dann geschlossen, und alle Faelle fallen um — die Probe misst das
Werkzeug statt der Zusage.

Daraus eine Regel, die kuenftig gilt: **Eine Mutationsprobe an einer SQL-Abfrage
aendert einen Wert oder ein Praedikat, nie die Parameterzahl und nie eine
untypisierte Referenz.** Faellt mehr um als vorhergesagt, ist zuerst die Probe
verdaechtig, nicht die Zusage.

Nebenbei: Ein Nebenlaeufigkeitsfall aus Release 1.17 riss unter Last die
Vorgabe von fuenf Sekunden. Er laeuft normalerweise in einer Sekunde, unter
mehreren parallelen Container-Stacks in knapp drei. Die Zusage bleibt
unveraendert — genau einmal je Nachricht —, nur die Wartezeit passt jetzt zur
Streuung. Ein Gate, das zufaellig rot wird, entwertet jeden anderen.

Checkpoint `1.38.0` am 6. August 2026: **110 von 110** Faellen des
PostgreSQL-Laufs bestanden, zweimal reproduziert **vor** dem Release-Commit.
Lokal 987 bestanden, 0 fehlgeschlagen.

Nicht erbracht: Ein Export- oder Archivweg fuer `usage_events` fehlt, und damit
bleibt diese Tabelle die einzige, die absichtlich waechst. Auch
`usage_counters`, `project_function_slots` (abgelaufene Zeilen ohne neuen
Aufruf) und `audit_logs` haben keinen Aufraeumer; die ersten beiden sind
klein und beschraenkt, das dritte ist absichtlich unveraenderlich.

## Zahlen pruefen sich — Release 1.39

`STATUS.md` nennt sich selbst „Teil der Definition of Done". Der bestehende
Doku-Vertrag prueft dort Zeichenketten und abgeleitete Dateinamen — aber **keine
einzige Zahl**.

Aufgefallen ist das an der eigenen Zeile: Die lokalen Vitest-Zahlen standen
ueber ein Dutzend Releases hinweg auf `951 bestanden, 138 uebersprungen`,
waehrend es laengst 987 und 173 waren. Nichts schlug an. Ein Statusdokument,
dessen Zahlen niemand prueft, ist genau die Art Behauptung, gegen die dieses
Projekt seine Mutationsproben faehrt — nur eine Ebene hoeher.

Zwei Faelle schliessen das:

**Jede Zertifizierungszahl muss durch ein archiviertes Manifest gedeckt sein.**
Geprueft wird gegen das Maximum der gruenen Laeufe eines Stacks. Die Suiten
wachsen; das Maximum ist damit der juengste Stand. Schrumpft eine Suite wirklich
einmal, verlangt der Vertrag eine bewusste Bearbeitung — und das ist richtig so.
Zusaetzlich muss „X von Y" mit X gleich Y stehen: Ein roter Lauf, als gruen
ausgegeben, faellt damit ebenfalls auf.

**Keine Zahl ohne moeglichen Beleg.** Die lokale Vitest-Zeile traegt keine
absoluten Werte mehr; sie verweist auf die Checkpoints in dieser Datei. Eine
Zahl, die niemand prueft, ist schlechter als keine.

Mutationsprobe: Die PostgreSQL-Behauptung auf 111 verfaelscht und die alte
Vitest-Zeile zurueckgeholt — beide Faelle fallen um, jeder an seiner Stelle.

Der erste Entwurf des Tests baute den Suchausdruck aus einer Vorlage zusammen
und war deshalb selbst kaputt. Er sucht jetzt zeilenweise: Ein Regex, den erst
eine Vorlage erzeugt, ist eine Fehlerquelle mehr in einem Test, der Fehler
finden soll.

Checkpoint `1.39.0` am 6. August 2026: Lokal 989 bestanden, 0 fehlgeschlagen;
die sechs Zertifizierungslaeufe unveraendert gegenueber `1.38.0`.

Nicht erbracht: Der Vertrag prueft die **Zahl**, nicht die **Aktualitaet**. Ein
gruenes Manifest von gestern deckt eine Behauptung von heute, solange die Zahl
stimmt; der Commit im Manifest wird nicht gegen den aktuellen Stand geprueft.
Die Zuordnung von Behauptung zu Stack steht als Liste im Test und ist damit
selbst handgepflegt — sie faellt aber laut aus, wenn ein Stack fehlt. Und die
uebrigen Zahlen in `STATUS.md` (Real-DB-Faelle je Modul, uebersprungene Faelle)
bleiben ungeprueft.

## Die letzte ungepruefte Zahl — Release 1.40

Release 1.39 hat die Zertifizierungszahlen an die Manifeste gebunden und
ausdruecklich offen gelassen, dass die Zahlen der Fortschrittstabelle weiter
ungeprueft bleiben. Beim Nachzaehlen stimmten fuenf von sechs: Control Plane 9,
Generated Data API 2, Object Storage 6, Project Queues 5, Usage Metering 20.

Die sechste war falsch — und zwar die einzige, die niemand rekonstruieren
konnte. „Compute Contracts | 116 Faelle" war ein ueber viele Releases von Hand
fortgeschriebener Wert ohne Ableitung; zaehlbar sind 40 Real-DB-Faelle plus 23
im Functions-Lauf und 10 gegen den echten HTTPS-Empfaenger, also 73.

Eine Zahl, die nur durch Fortschreiben entsteht, ist keine Messung. Die Zeile
nennt jetzt die drei Bestandteile getrennt, und ein Vertragstest zaehlt die
Real-DB-Faelle je Modul aus den Testdateien.

Gezaehlt wird der **Quelltext**, nicht ein Lauf. Das ist die schwaechere Aussage
und die richtige an dieser Stelle: Behauptet wird die Anzahl der Faelle, nicht
ihr Ergebnis. Ob sie bestehen, sagt der Vertrag aus Release 1.39.

Mutationsprobe: 40 auf 41 verfaelscht — der Fall faellt um.

Checkpoint `1.40.0` am 7. August 2026: Lokal 990 bestanden, 0 fehlgeschlagen;
die sechs Zertifizierungslaeufe unveraendert gegenueber `1.38.0`.

Nicht erbracht: Die Zuordnung Modul zu Testdateien steht als Liste im Test und
ist selbst handgepflegt — wer eine neue Real-DB-Datei anlegt und sie dort
vergisst, faellt nicht auf. Ungeprueft bleiben ausserdem die Zahl der
uebersprungenen Faelle und die Zahlen in `docs/QA.md` selbst.

## Der Cursor, der zu wenig weiss — Release 1.41

`usage_events` ist die einzige Tabelle, die absichtlich waechst; ihr Trigger
weist UPDATE und DELETE ab, weil sie zugleich Beleg und Idempotenz-Speicher ist.
`docs/USAGE_METERING.md` fuehrte „Retention/Export" seit Alpha 1 als fehlend.
Release 1.41 liefert den Export: seitenweise ueber einen Keyset-Cursor auf
`(recorded_at, id)`, als NDJSON, mit `npm run usage:export` als Aufrufweg.

Der erste Zertifizierungslauf war rot, und zwar an der einzigen Zusage, die
zaehlt: sieben Ereignisse kamen als dreizehn zurueck. Der Cursor wurde als
`Date.toISOString()` gereicht — Millisekunden. `recorded_at` speichert
Mikrosekunden. Der abgeschnittene Wert liess die letzte Zeile jeder Seite erneut
durch; die Seiten ueberlappten sich, statt aneinanderzustossen.

Der Cursor traegt jetzt die Textform der Datenbank und wird als
`$7::timestamptz` zurueckgegeben — nicht umgerechnet, sondern durchgereicht.
Wer einen Cursor ueber einen Typ des Clients fuehrt, muss beweisen, dass dieser
Typ den Wert der Datenbank vollstaendig traegt.

Mutationsprobe zweimal, beide nach der Regel aus 1.38 nur am Praedikat:

- `>` zu `>=`: genau der Seitenfall faellt, mit denselben dreizehn Zeilen wie der
  echte Defekt. 113 von 114.
- `project_id=$2` zu `(project_id=$2 OR $2 IS NOT NULL)`: die beiden Faelle
  fallen, die die Projektgrenze tragen. 112 von 114.

Checkpoint `1.41.0` am 7. August 2026: Lokal 990 bestanden, 0 fehlgeschlagen;
PostgreSQL 114 von 114, exit 0, zweimal reproduziert.

Nicht erbracht: Der Export nimmt der Tabelle das Wachstum nicht — er macht es
tragbar. Ungeprueft bleibt, ob eine Seite unter gleichzeitigem Schreiben stabil
bleibt; die Fenstergrenze `window_start` ist zwar unveraenderlich, aber ein
Export ueber Stunden hat keinen Beleg. Es gibt keine Route und keine
Console-Flaeche, nur das Skript.

## Wer ruft das eigentlich? — Release 1.42

Dieser Sprint hat sechsmal dasselbe gefunden: gebaut, zertifiziert und trotzdem
wirkungslos, weil niemand es aufruft. Realtime-Poller (1.14), Event-Log (1.15),
Webhook-Outbox (1.19), Functions-Sandbox (1.22), Usage-Emitter (1.29),
Prune-Pfade (1.37). Jedes Mal war es Handarbeit, und jedes Mal spaeter, als es
haette sein muessen.

Release 1.42 macht daraus eine stehende Pruefung. Der Importgraph wird von jedem
Prozesseinstieg aus gelaufen — App-Routen, `workers/`, `scripts/`, Middleware —
und was in `lib/server` liegt, ohne dabei beruehrt zu werden, ist ein Fund.

Der erste Lauf fand fuenf Module. Drei waren tote Barrel-Dateien
(`control-plane/index.ts`, `db/index.ts`, `migrations/index.ts`), die niemand
importierte; sie sind geloescht. Die anderen beiden waren der **siebte Fall**:
`ProjectQueueWorker` und `ProjectQueueWorkerRuntime` gab es seit Alpha 1,
getestet und ohne Wirt. Nachrichten liessen sich einreihen, und kein Prozess nahm
sie heraus.

Der Wirt ist jetzt da: `npm run worker:queues` gibt eine Nachricht an eine
hinterlegte Function. Nebenbei fiel auf, dass die Alpha-Grenzen in
`docs/PROJECT_QUEUES.md` noch „keine Functions, Cron-Scheduler,
Webhook-Zustellung" nannten — alles seit 1.20 bis 1.26 vorhanden.

Der Vertrag beweist **Erreichbarkeit, nicht Wirkung**. Ein Modul kann importiert
und nie ausgefuehrt werden. Das ist die schwaechere Aussage und die einzige, die
ein Importgraph tragen kann — sie haette aber alle sieben Faelle gefunden, denn
in allen sieben fehlte schon der Import.

Mutationsproben:

- Prozesseinstieg `workers/project-queue-runtime.mts` entfernt: Der Vertrag nennt
  die ganze Kette, nicht nur ihr Ende — Dispatch, Komposition, Wirt, Runtime und
  Worker.
- Wirt hoert auf `functionName` statt auf `queue`: alle drei Real-DB-Faelle
  fallen, 114 von 117. Alle drei tragen die Verdrahtung.
- Handler verschluckt den Fehlschlag statt ihn zu melden: genau der Retry-Fall
  faellt, 116 von 117.

Checkpoint `1.42.0` am 7. August 2026: Lokal 1001 bestanden, 0 fehlgeschlagen;
PostgreSQL 117 von 117, exit 0, zweimal reproduziert.

Nicht erbracht: Die `ALLOWED`-Liste des Vertrags ist leer und soll es bleiben —
wer dort etwas eintraegt, ohne den Grund zu meinen, hat die Pruefung
abgeschaltet und nicht bestanden. Der Wirt kann genau eines: eine Nachricht an
eine Function geben. Ein allgemeiner Handler-Host und ein Consumer-SDK fehlen.
Und der Vertrag deckt nur `lib/server`; `app/`, `lib/client` und `components/`
sind ungeprueft.

## Bis ans andere Ende — Release 1.43

Release 1.42 hat dem Queue-Worker einen Wirt gegeben und ausdruecklich offen
gelassen, dass die Kette Queue → Container in einem Lauf unbelegt bleibt: Die
drei Real-DB-Faelle dort verwenden einen erfundenen Aufrufer.

Release 1.43 schliesst das im Functions-Stack, wo seit 1.35 nichts mehr ersetzt
ist. Die Definition kommt aus der Datenbank, das Image ueber seinen Digest aus
einer echten Registry, der Aufruf aus dem Wirt — und was der Container
antwortet, entscheidet ueber den Zustand der Nachricht. Zwischen `enqueue` und
dem Container liegen Wirt, Worker und Lease; kein Fall ruft `invoke` selbst.

Der zweite Fall braucht keinen kaputten Container: Ein unbekannter Modus laesst
die Testfunction mit 400 antworten. Der Container laeuft also wirklich — er sagt
nur Nein, und die Nachricht bleibt erhalten.

Mutationsproben, beide am Handler und beide nur an einem Wert:

- Statuscode-Pruefung entschaerft (`< 200 || > 299` zu `< 0`): genau der
  Fehlschlag-Fall faellt, 24 von 25.
- Wirt ruft `message.queue` statt `functionName`: genau der Erfolgsfall faellt,
  24 von 25.

Beide Faelle sind also einzeln getragen und nicht durch denselben Pfad.

Checkpoint `1.43.0` am 7. August 2026: Lokal 1001 bestanden, 0 fehlgeschlagen;
Functions gegen Docker, Registry und PostgreSQL 25 von 25, exit 0, zweimal
reproduziert. Der PostgreSQL-Hauptlauf ist unveraendert gegenueber `1.42.0`.

Nicht erbracht: Der Lauf startet den Wirt als Objekt, nicht als Prozess —
`npm run worker:queues` selbst hat weiterhin keinen archivierten Lauf. Die
Nebenlaeufigkeit mehrerer Wirte auf derselben Queue ist ueber die Lease
zertifiziert, aber nicht mit echten Containern. Und der Retry-Fall belegt, dass
die Nachricht bleibt — nicht, dass ein spaeterer Versuch sie zustellt.

## Kein einziger Prozess startete — Release 1.44

Release 1.43 hat die Kette bis in den Container belegt und offen gelassen, dass
der Wirt dabei als Objekt lief: `npm run worker:queues` selbst hatte keinen
Lauf. Der Fall, der das nachholen sollte, war beim ersten Anlauf rot — und nicht
wegen des Tests.

**Keiner der sieben Worker konnte starten.** `package.json` hat kein
`"type": "module"`, also uebersetzt tsx jede `.ts` als CommonJS, und jeder
Worker benutzt Top-Level-await. Der Prozess brach ab, bevor eine Zeile eigenen
Codes lief:

```
ERROR: Top-level await is currently not supported with the "cjs" output format
```

Betroffen waren alle: Realtime, Compute, Migrationen, Apply-Publisher,
Incident-Publisher, Provisioner und der Queue-Wirt. Sieben Prozesse, jeder in
einer eigenen Scheibe gebaut, jeder dokumentiert, mehrere davon ausdruecklich
die Antwort auf ein frueher gefundenes „ruft niemand" — und kein einziger lief
je.

Die Endung entscheidet: `.mts` ist fuer tsx ein ES-Modul, `.ts` ohne
`"type": "module"` nicht. Alle sieben heissen jetzt `.mts`; `package.json`,
`lib/server/operations/runtime-deployment.ts` und die Vertragstests zeigen
darauf.

Der neue Vertrag `tests/worker-boot-contract.test.ts` startet jede Datei in
`workers/` wirklich und prueft, dass sie **ihre eigene** Konfigurationsgrenze
erreicht. Ob sie danach ohne Datenbank weiterlaeuft, ist nicht die Frage; dass
sie dorthin gelangt, war es. Genau diese Klasse Fehler — Abbruch vor der ersten
eigenen Zeile — ist durch jede bisherige Zertifizierung gefallen, weil immer
geprueft wurde, was ein Prozess aufruft, nie sein Start.

Mutationsproben:

- Eine Worker-Datei wieder als `.ts`: Der Boot-Vertrag benennt sie namentlich.
- Der Wirt startet, ruft aber seine Schleife nicht auf: 25 von 26 — genau der
  Prozess-Fall faellt, die beiden Objekt-Faelle bleiben gruen. Der Unterschied
  zwischen „startet" und „arbeitet" ist damit einzeln getragen.

Checkpoint `1.44.0` am 7. August 2026: Lokal 1009 bestanden, 0 fehlgeschlagen;
PostgreSQL 117 von 117 und Functions 26 von 26, jeweils exit 0 und zweimal
reproduziert.

Nebenbefund, **nicht** behoben: `npm run verify:dx:full` bricht auf Windows mit
Node 24 in `scripts/verify-package-tarballs.mjs` ab (`spawnSync npm.cmd
EINVAL`). Das reproduziert sich auf dem unveraenderten Stand von `1.43.0` und
haengt nicht an dieser Aenderung. STATUS.md nennt die Tarball-Pruefung deshalb
jetzt ausdruecklich als hier nicht belegt.

Nicht erbracht: Der Boot-Vertrag prueft nur, dass ein Prozess bis zu seiner
Konfigurationsgrenze kommt — nicht, dass er mit gueltiger Konfiguration seine
Arbeit tut. Das ist nur fuer den Queue-Wirt belegt; die anderen sechs Prozesse
haben weiterhin keinen Lauf, der sie arbeiten sieht.

## Zwei von sieben arbeiten belegt — Release 1.45

Release 1.44 hat gefunden, dass keiner der sieben Worker starten konnte, und
offen gelassen, dass nur der Queue-Wirt einen Lauf hat, der ihn **arbeiten**
sieht. Die anderen sechs erreichten ihre Konfigurationsgrenze; mehr wusste
niemand.

Release 1.45 holt den groessten davon nach. Der Compute-Prozess — die Datei
hinter `npm run worker:compute` — wird gestartet, nicht nachgebaut, und
gemessen wird die Wirkung in der Datenbank: Ein faelliges Cron-Vorkommen wird zu
einer Nachricht in der Projekt-Queue, ohne dass der Test einen Scheduler
anfasst.

**Der erste Anlauf war rot, und der Fehler lag im Testaufbau.** Die Definition
trug `* * * * *`; unterstuetzt sind `*/N * * * *` und `M H * * *`. Sichtbar
wurde das nur, weil ich `onError: () => undefined` in der Komposition
voruebergehend gegen eine Ausgabe getauscht habe — der Prozess meldete
„serving 1 scope(s)" und schwieg danach, waehrend seine Schleife jede Sekunde
an derselben Stelle scheiterte.

Das ist kein Produktfehler: Der Definitionsdienst prueft den Ausdruck beim
Anlegen, ein direkter INSERT umgeht das. Es ist aber ein Befund ueber
Beobachtbarkeit, und er steht unten.

**Ein zweiter Fund betraf den Zertifizierungsstack selbst.** Ein Lauf zeigte
Fehler in Dateien unter `.claude/worktrees/…`: Der Stack kopiert das
Arbeitsverzeichnis per `tar` und schliesst `node_modules`, `.next`, `.git`,
`coverage` und `docs/evidence` aus — `.claude` nicht. Ein fremdes Verzeichnis
im Baum aenderte damit, **was** zertifiziert wird, und die Zahl im Manifest
haette es nicht verraten. Alle fuenf Compose-Stacks schliessen `.claude` jetzt
aus; der Functions-Stack ist nicht betroffen, weil er seine Dateien namentlich
aufruft.

Dieselbe Luecke bestand ein zweites Mal, an anderer Stelle: `npm test` meldete
kurz darauf 304 Dateien und 2018 Faelle statt 152 und 1009 — exakt das Doppelte.
Vitest globbte den Worktree mit. `vitest.config.ts` schliesst `.claude` jetzt
aus. Wer nur die Zahl gelesen haette, haette einen Sprung nach oben gesehen und
sich gefreut.

Mutationsprobe: Die Cron-Schleife wirft vor jedem `scheduler.run`. Genau der
Prozess-Fall faellt, 117 von 118 — die zwoelf uebrigen Cron-Faelle bleiben
gruen. Der neue Fall traegt seine Zusage also allein.

Checkpoint `1.45.0` am 8. August 2026: Lokal 1009 bestanden, 0 fehlgeschlagen;
PostgreSQL 118 von 118, exit 0, zweimal reproduziert.

Nicht erbracht: **Fuenf der sieben Prozesse haben weiterhin keinen Lauf, der sie
arbeiten sieht** — Realtime, Migrationen, Apply-Publisher, Incident-Publisher
und Provisioner. Belegt ist ausserdem nur der Cron-Zweig des Compute-Prozesses;
die Webhook-Zustellung ist in diesem Lauf ausgeschaltet, weil sie einen
Signaturschluessel verlangt.

Und der Befund zur Beobachtbarkeit bleibt offen: Eine Cron-Schleife, die jede
Sekunde scheitert, sagt es niemandem. Die Redaktion ist richtig — eine
Datenbankmeldung gehoert nicht ins Log —, aber „diese Schleife kommt seit N
Versuchen nicht durch" waere weder ein Geheimnis noch eine Datenbankmeldung.
Das ist eine eigene Scheibe und keine Nebenbei-Aenderung an einem
Sicherheitsvertrag.

## Wer merkt, dass es klemmt? — Release 1.46

Release 1.45 hat eine Stunde gekostet, weil eine Schleife, die jede Sekunde
scheitert, von einer untaetigen nicht zu unterscheiden war. Der Prozess meldete
seinen Start und schwieg danach. Sichtbar wurde der Fehler erst, als ich
`onError: () => undefined` von Hand gegen eine Ausgabe getauscht habe.

Beim Nachsehen stand die Antwort schon im Baum: `RuntimeProbeState` und
`LoopbackRuntimeProbeServer` mit `/live` und `/ready` gibt es seit Alpha 1, vier
Kompositionen reichen einen `probe` durch — und
`createLoopbackRuntimeProbeFromEnv` rief **kein einziger Prozess** auf.

Das ist derselbe Fund wie siebenmal zuvor, an einer Stelle, die der
Erreichbarkeitsvertrag aus 1.42 nicht sehen kann: Das Modul **war** importiert,
denn `safeRuntimeProbe` und die Typen kommen von dort. Nur die Fabrik rief
niemand. Der Vertrag misst Erreichbarkeit, nicht Ausfuehrung — hier zeigt sich,
was das kostet.

Der Compute-Prozess startet die Probe jetzt und speist sie aus beiden Schleifen.
Zwei Details entscheiden ueber die Aussage:

**Der Scheduler faengt Fehler selbst ab.** `scheduler.run` kehrt normal zurueck,
auch wenn jede Definition gescheitert ist. Eine Erfolgsmeldung am Rundenende
haette den eben gesetzten Fehlschlag wieder geloescht. Ein Zaehler entscheidet
deshalb, ob die Runde sauber war; nur dann gilt sie als gelungen.

**Die Antwort sagt, dass es klemmt — nicht woran.** `/ready` liefert 503 mit
`not ready`. Kein Ausdruck, kein Projekt, keine Datenbankmeldung. Die Redaktion
bleibt, was sie war; sie gilt jetzt nur nicht mehr fuer die Tatsache selbst.

Der erste Anlauf des positiven Falls war rot, und der Fehler war meiner: Beide
Faelle teilten sich ein Projekt, und der Prozess bedient einen ganzen Scope. Er
sah die Definitionen der frueheren Faelle mit. Dieselbe Regel wie in 1.29 —
jeder Fall bekommt sein eigenes Projekt — und dieselbe Lektion zum zweiten Mal.

Mutationsprobe: `onError` meldet nichts mehr. Genau der negative Fall faellt,
119 von 120; der positive bleibt gruen. Die beiden haengen also nicht am selben
Pfad.

Checkpoint `1.46.0` am 8. August 2026: Lokal 1009 bestanden, 0 fehlgeschlagen;
PostgreSQL 120 von 120, exit 0, zweimal reproduziert.

Nicht erbracht: **Sechs der sieben Prozesse starten die Probe weiterhin nicht.**
Belegt ist ausserdem nur der Cron-Zweig; dass der Webhook-Zweig seinen
Fehlschlag meldet, ist verdrahtet und nicht zertifiziert. Und `/ready` sagt, dass
etwas klemmt, nicht seit wann und nicht wie oft — wer den Verlauf sehen will,
braucht einen Exporter, den es nicht gibt.

## Korrektur zu 1.46, und ein Vertrag dagegen — Release 1.47

**Die Aussage in Release 1.46 war falsch.** Dort steht,
`createLoopbackRuntimeProbeFromEnv` rufe „kein einziger Prozess" auf. Richtig
ist: **Vier von sieben taten es seit der Baseline `1.8.0`** — Migrationen,
Apply-Publisher, Incident-Publisher und Provisioner. Ohne Probe waren nur
Compute, Realtime und der Queue-Wirt.

Der Fehler war meiner und banal: Ich hatte mit
`grep "new RuntimeProbeState\|createRuntimeProbeServer\|runtimeProbe"` gesucht.
Der erste Name kommt nur in der Fabrik selbst vor, den zweiten gibt es nicht,
und der dritte traf `createLoopbackRuntimeProbeFromEnv` wegen der
Gross-/Kleinschreibung nicht. Drei Muster, kein Treffer, und daraus eine Aussage
ueber sieben Prozesse.

`docs/RELEASE_1.46.md` bleibt unveraendert — historische Release Notes werden
nicht nachtraeglich geglaettet. Die Korrektur steht hier, in
`docs/RELEASE_1.47.md` und in `STATUS.md`.

Was inhaltlich stimmt: Der Compute-Prozess startete die Probe wirklich nicht,
das Ordnungsproblem mit dem Erfolgssignal war echt, und die Zertifizierung von
1.46 belegt, was sie belegt. Falsch war allein die Reichweite.

Dieselbe Lehre wie in Release 1.39 und 1.40, diesmal an einer Aussage statt an
einer Zahl: `tests/worker-probe-contract.test.ts` zaehlt jetzt aus, welche
Prozesse die Probe starten. Realtime steht mit Begruendung auf der
Ausnahmeliste — es ist ein Server ohne Runde, und `ready` verlangt eine
gelungene Runde. Ein Herzschlag-Timer waere ein Signal, das nur behauptet, dass
der Prozess lebt; das sagt `live` bereits.

Der Queue-Wirt speist die Probe seit diesem Release. `ProjectQueueWorkerRuntime`
nimmt seit Alpha 1 einen `probe` entgegen — durchgereicht hat ihn niemand.

Zwei Mutationsproben:

- Der Wirt reicht den Beobachter nicht mehr durch: 25 von 26 im Functions-Lauf,
  genau der Prozess-Fall. `/ready` bliebe 503, waehrend Nachrichten verarbeitet
  werden.
- Dem Wirt wird der Probe-Aufruf genommen: Der Vertrag nennt die Datei
  namentlich.

Checkpoint `1.47.0` am 8. August 2026: Lokal 1012 bestanden, 0 fehlgeschlagen;
PostgreSQL 120 von 120 und Functions 26 von 26, je exit 0 und zweimal
reproduziert.

Nicht erbracht: Der Vertrag prueft, **dass** ein Prozess die Fabrik aufruft,
nicht dass die Probe danach etwas Wahres meldet. Zertifiziert ist das fuer
Compute und den Queue-Wirt; die vier Migrations-Prozesse melden seit `1.8.0`
und haben dafuer keinen archivierten Lauf.

## Zwei Defekte auf dem Pfad zur Kundendatenbank — Release 1.48

Von den fuenf Prozessen ohne Arbeitsnachweis ist der Migrations-Worker der
folgenreichste: Er ist der einzige, der Kundendatenbanken schreibt. Zertifiziert
war er seit Stufe 0.1 — immer als Bibliothek. Ein Lauf, der
`npm run worker:migrations` startet und danach nachsieht, gab es nie.

Der erste Lauf war rot, und zwar zweimal hintereinander an verschiedenen
Stellen.

**Erster Defekt: `quarantineExpiredReconciliations`.** Die Abfrage baut ein CTE
mit `SELECT id` und schreibt dann `RETURNING <spalten>` mit unqualifizierten
Namen. PostgreSQL weist das als mehrdeutig ab. Sie laeuft bei **jedem** Claim,
also konnte der Worker keinen einzigen Auftrag uebernehmen: Der Auftrag blieb
`queued`, die Schleife meldete `iteration_failed`, und niemand sah es. Die
Nachbarabfrage `claimNext` aliasiert ihr CTE seit jeher als `candidate_id`; hier
fehlte der Alias.

**Zweiter Defekt: die Zaun-Grenzpruefung.** `aclexplode(coalesce(a.attacl,
'{}'::aclitem[]))` — `'{}'::aclitem[]` ist nulldimensional, `aclexplode`
verlangt genau eine Dimension, und PostgreSQL weist die ganze Abfrage mit „ACL
arrays must be one-dimensional" ab. Die Funktion ist strikt; ein NULL liefert im
LATERAL ohnehin keine Zeile, und genau das ist gemeint. Die Nachbarpruefungen
benutzen `acldefault(...)` und waren nie betroffen.

Beide Fehler liegen auf demselben Pfad, und beide machten jede Migration ueber
den ausgelieferten Prozess unmoeglich. Gefunden hat sie kein Test, sondern der
Versuch, den Prozess einmal wirklich laufen zu lassen.

**Was nicht belegt ist, und das ist der unbequeme Teil.** Nach beiden Fixes
wendet der Prozess lokal gegen eine echte Projektdatenbank an — Auftrag
`applied`, Tabelle vorhanden, Ledger geschrieben. Im Zertifizierungscluster
weist derselbe Zaun mit `INVALID_MIGRATION_FENCE` ab. Gemessen wurden
Eigentuemer, Mitgliedschaften, Schema- und Tabellen-ACL, Spaltenrechte, RLS und
Relationsart: alle wie erwartet. Der Grund ist nicht isoliert.

Deshalb sagt der Fall nur, was er tragen kann: Der Auftrag verlaesst `queued`,
und die Schleife meldet keinen Rundenfehlschlag mehr. Ein gescheiterter Auftrag
ist etwas anderes als eine gescheiterte Runde — dieser Unterschied ist der Kern
des ersten Fixes.

Ein Produkt, das in einem echten Cluster migriert und in einem anderen nicht,
ist selbst ein Befund. Er wird hier festgehalten, nicht weggelassen.

Mutationsprobe: Der Alias wird wieder entfernt. Genau der Prozess-Fall faellt,
121 von 122.

Nebenbefund: Der Aenderungsschutz auf `change_sets` ist staerker als der erste
Testaufbau annahm — ein Trigger weist jedes nachtraegliche UPDATE ab („change
set artifact is immutable after preview creation"). Der Manipulationsfall geht
deshalb ueber eine Freigabe, die zu einer anderen Handlung gehoert, und genau
das erkennt der Worker.

Checkpoint `1.48.0` am 8. August 2026: Lokal 1012 bestanden, 0 fehlgeschlagen;
PostgreSQL 122 von 122, exit 0, zweimal reproduziert.

Nicht erbracht: Das Anwenden in einer echten Projektdatenbank hat im
Zertifizierungscluster keinen Lauf. Vier Prozesse haben weiterhin keinen
Arbeitsnachweis. Und die Provisionierung der Zieldatenbank steht im Testaufbau
von Hand — der Provisioner, der sie im Betrieb erledigt, ist selbst unbelegt.

## Die Zertifizierung stand sich selbst im Weg — Release 1.49

Release 1.48 hat als wichtigste offene Frage hinterlassen: Der Migrations-Prozess
wendet lokal an und im Zertifizierungscluster nicht, Grund unbekannt.

Der Grund war die Zertifizierung selbst.

Die Grenzpruefung des Zaunes verlangt einen Ledger-Eigentuemer **ohne jede**
Mitgliedschaft, in beide Richtungen. Drei Realtime-Testdateien fuehrten
`GRANT qkern_ledger_owner TO CURRENT_USER` aus, damit ihr eigenes DDL im Namen
des Eigentuemers durchgeht. Die Rolle ist **clusterweit**. Damit war in jedem
Lauf, in dem eine dieser Dateien mitlief, jede Migration unmoeglich — nicht nur
im Migrationstest, sondern grundsaetzlich.

Der Grant war ausserdem unnoetig: Der Zertifizierungs-Admin ist Superuser und
darf ohnehin Objekte im Namen anderer Rollen anlegen.

Dazu kommt eine Eigenheit von PostgreSQL 16: `CREATE ROLE` teilt die neue Rolle
dem Erzeuger automatisch mit ADMIN OPTION zu. Wer die Rolle anlegt, verletzt die
Bedingung im selben Atemzug. Der Migrationstest raeumt deshalb **vor jedem
Lauf** auf, nicht einmal im Setup: Die Rolle ist geteilt, und andere Dateien
legen sie parallel an.

**Wie viel Zeit die Diagnose gekostet hat, und warum.** Der erste Messversuch
baute die Grenzpruefung nach und prueft `owner_has_memberships` nur in eine
Richtung — die echte Abfrage prueft beide. Zwei Laeufe gingen dafuer verloren.
`FENCE_BOUNDARY_SQL` ist jetzt exportiert, und die Zertifizierung stellt
dieselbe Abfrage mit derselben Rolle statt einer Kopie. Wer eine Pruefung
nachbaut, prueft etwas anderes.

Die erste Mutationsprobe traf nicht: Ein einzelner wiederhergestellter Grant
blieb wirkungslos, weil das Aufraeumen vor dem Lauf ihn einholte. Die Probe, die
traegt, stellt den ganzen Stand von 1.48 wieder her — drei Grants und kein
Aufraeumen — und laesst genau den Anwendungsfall fallen, 121 von 122.

Checkpoint `1.49.0` am 8. August 2026: Lokal 1012 bestanden, 0 fehlgeschlagen;
PostgreSQL 122 von 122, exit 0, zweimal reproduziert.

Nicht erbracht: Dass eine Testdatei den Zustand einer anderen kippen kann, ist
behoben und nicht **verhindert**. Es gibt keine Pruefung, die einen dauerhaften
Grant auf eine clusterweite Rolle bemerkt. Wie viele frueheren Laeufe davon
betroffen waren, ist nicht rekonstruiert — die Realtime-Faelle selbst brauchen
den Zaun nicht und blieben gruen.

## Ein Grant, der alle trifft — Release 1.50

Release 1.49 hat den Konflikt behoben und ausdruecklich offen gelassen, dass er
damit nicht **verhindert** ist: Es gab keine Pruefung, die einen dauerhaften
Grant auf eine clusterweite Rolle bemerkt.

`tests/shared-cluster-role-contract.test.ts` schliesst das. Er prueft den
Quelltext, nicht den Cluster — die schwaechere Aussage und die, die frueh genug
kommt: beim Schreiben statt nach dem Lauf. Ein Grant, den dieselbe Datei wieder
zuruecknimmt, ist erlaubt; ein dauerhafter nicht.

Beim ersten Lauf meldete der Vertrag vier Dateien — darunter sich selbst und die
drei Realtime-Dateien, die den Fund inzwischen nur noch **beschreiben**.
Kommentare zaehlen deshalb nicht mit. Das ist keine Aufweichung: Was in einem
Kommentar steht, fuehrt PostgreSQL nicht aus.

Die Bedingung betrifft nicht nur Tests. `docs/PROJECT_DATABASE_PROVISIONING_
RUNBOOK.md` nennt jetzt beides: dass `qkern_ledger_owner` keine einzige
Mitgliedschaft haben darf, und dass PostgreSQL 16 dagegen arbeitet, weil
`CREATE ROLE` die neue Rolle dem Erzeuger automatisch zuteilt. Wer sie anlegt,
muss sie sich selbst wieder entziehen.

Mutationsprobe: Der Grant wird in einer Realtime-Datei wiederhergestellt. Der
Vertrag nennt die Datei namentlich.

Checkpoint `1.50.0` am 8. August 2026: Lokal 1015 bestanden, 0 fehlgeschlagen;
PostgreSQL 122 von 122, exit 0, zweimal reproduziert.

Nicht erbracht: Der Vertrag liest `tests/`, nicht `scripts/`, nicht `db/` und
nicht die Kubernetes-Vorlagen. Und er erkennt eine Zuteilung nur, wenn sie als
SQL-Text dasteht — wer sie zusammensetzt, faellt nicht auf.

## Der Zaun sagt jetzt, woran es liegt — Release 1.51

Release 1.48 und 1.49 haben zusammen fuenf Zertifizierungslaeufe gekostet, und
der Grund war jedes Mal derselbe: `INVALID_MIGRATION_FENCE` sagt, **dass** eine
von fuenfundzwanzig Bedingungen verletzt ist, nicht **welche**. Ich konnte die
Pruefung von Hand nachbauen — ein Betreiber haette keinen Zugang zur
Zieldatenbank, um das zu tun.

Die Erwartungen stehen jetzt als Liste im Produkt, nicht als lange
`if`-Bedingung, und die verletzten Namen gehen ins **Prozesslog**:

```
{"event":"migration.failed","errorCode":"INVALID_MIGRATION_FENCE",
 "failedChecks":["owner_has_memberships"], …}
```

Ein Name wie `owner_has_memberships` ist eine Struktureigenschaft und im Runbook
nachlesbar. Kein Rollenname, kein Schema, kein Wert, keine Datenbankmeldung: Was
die Zieldatenbank **ist**, sagt die Liste nicht — nur, was ihr fehlt. Die
Meldung an den Mandanten bleibt unveraendert redigiert.

**Und dabei fiel der eigentliche Grund auf, warum niemand je etwas sah.** Der
Prozess setzte nur den Runtime-Logger. Der Worker-Logger — der jedes einzelne
Auftragsereignis fuehrt, von `migration.claimed` bis `migration.failed` — war
nie gesetzt. Alles Auftragsbezogene ging verloren, seit es den Prozess gibt.

Der Fall traf beim ersten Versuch die falsche Grenze: Ein Grant an die
Migrationsrolle faengt schon der Katalog ab, frueher und mit eigenem Code
(`INVALID_PROJECT_DATABASE_ROLE`). Verletzt wird die Bedingung deshalb ueber
eine **dritte** Rolle — genau so lag der Fall in 1.49, wo der Erzeuger der Rolle
die Mitgliedschaft hielt.

Ein zweiter Anlauf war flaky: Die Warteschleife brach bei `running` ab statt bei
einem Endzustand. Wer auf „nicht mehr `queued`" wartet, misst den Zeitpunkt
statt das Ergebnis.

Mutationsprobe: Der Zaun meldet wieder eine leere Liste. Genau der neue Fall
faellt, 122 von 123.

Checkpoint `1.51.0` am 8. August 2026: Lokal 1015 bestanden, 0 fehlgeschlagen;
PostgreSQL 123 von 123, exit 0, zweimal reproduziert.

Nicht erbracht: Nur Zaun und Ledger nennen ihre Bedingungen. Die uebrigen
Fehlercodes des Executors sagen weiterhin nur, dass etwas nicht stimmt. Und die
Namen stehen im Prozesslog, nicht in der Projektion fuer den Mandanten — wer
kein Log sieht, sieht sie nicht.

## Wer meldet, was er tut — Release 1.52

Release 1.51 hat gefunden, dass der Migrations-Prozess seinen Worker-Logger nie
setzte, und ausdruecklich offen gelassen: Es gibt keinen Vertrag, der verlangt,
dass ein Prozess die Logger setzt, die seine Komposition anbietet.

Beim Messen zeigte sich, dass die Luecke groesser war. Zwei Kompositionen boten
**gar keine** Naht: der Queue-Wirt und der Compute-Prozess. `ProjectQueueWorker`
fuehrt seit Alpha 1 Ereignisse je Nachricht — Queue, Message-Id, Attempt, feste
Outcomes und feste Failure Codes, niemals Payload, Worker-Id oder
Lease-Geheimnis. Durchgereicht hat sie fuer den Prozess niemand. Der Wirt
verarbeitete Nachrichten und schwieg darueber.

Der Wirt reicht den Logger jetzt durch, und `npm run worker:queues` setzt ihn.

`tests/worker-logger-contract.test.ts` verlangt das kuenftig von jedem Prozess.
Die Erwartung wird **abgeleitet**, nicht gepflegt: Der Test liest, welche
`…Logger`-Abhaengigkeiten die aufgerufene Fabrik entgegennimmt, und sucht sie im
Prozess. Eine handgepflegte Liste waere die naechste Stelle, an der etwas
vergessen wird — die Lektion aus Release 1.40.

Mutationsproben:

- Dem Migrations-Prozess wird der Worker-Logger genommen: Der Vertrag nennt
  Datei, Fabrik und Logger.
- Der Wirt reicht den Logger nicht mehr durch: 25 von 26 im Functions-Lauf,
  genau der Prozess-Fall.

Checkpoint `1.52.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 123 von 123 und Functions 26 von 26, je exit 0 und zweimal
reproduziert.

Nicht erbracht: Der Compute-Prozess hat weiterhin **keine** Logger-Naht — seine
Komposition bietet keine an, und der Vertrag kann nur einfordern, was angeboten
wird. Was Cron und Webhook-Zustellung je Vorgang tun, meldet niemand; belegt ist
nur die Probe aus 1.46, die sagt, dass es klemmt, nicht was geschah.

## Der Compute-Prozess meldet jetzt auch — Release 1.53

Release 1.52 hat den Queue-Wirt zum Melden gebracht und offen gelassen, dass der
Compute-Prozess **gar keine** Naht hat: Seine Komposition bot keine an, und der
Vertrag kann nur einfordern, was angeboten wird.

Beide Bausteine darunter hatten nur Fehler-Haken — `onError` beim Scheduler,
`onFailure` beim Zusteller — und keinen Ereignisstrom. Die Naht musste also erst
entstehen.

**Ein Index statt einer Id.** Die Startzeile des Prozesses nennt seit jeher nur
die Zahl der Scopes, und dabei bleibt es: Der Index zeigt in
`QKERN_COMPUTE_SCOPES_JSON`, die der Betreiber selbst gesetzt hat. Fuer ihn ist
er aufloesbar, fuer jeden anderen bedeutungslos. Dazu die Zahl der ausgeloesten
Vorkommen und feste Failure Codes — keine Endpunkte, keine Datenbankmeldungen.

**Gemeldet wird nur, was geschehen ist.** Eine Runde ohne faelliges Vorkommen
schweigt. Sonst schriebe der Prozess im Standardtakt alle 30 Sekunden je Scope
eine Zeile ueber nichts, und ein Log, in dem Leerlauf ueberwiegt, ist so wenig
lesbar wie gar keines.

Der Fall war beim ersten Anlauf flaky, und der Fehler war meiner: Die Nachricht
steht in der Datenbank, **bevor** die Runde zu Ende ist. Wer sofort nach der
Meldung sieht, misst den Wettlauf statt die Zusage. Gewartet wird jetzt auf die
Meldung, mit eigener Frist.

Mutationsprobe: Die Cron-Schleife meldet ihre Runde nicht mehr. Genau der
Prozess-Fall faellt, 122 von 123.

Checkpoint `1.53.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 123 von 123, exit 0, zweimal reproduziert.

Nicht erbracht: Der Webhook-Zweig meldet seinen Fehlschlag — verdrahtet, nicht
zertifiziert, weil dieser Lauf die Zustellung ausschaltet. Eine gelungene
Zustellung meldet weiterhin niemand: Der Zusteller bietet dafuer keinen Haken,
und einen zu bauen waere eine eigene Scheibe.

## Der Webhook-Zweig, als Prozess — Release 1.54

Release 1.53 hat zwei Stuecke offen gelassen: Der Webhook-Zweig des
Compute-Prozesses war verdrahtet, aber nicht zertifiziert, und eine **gelungene**
Zustellung meldete niemand — der Zusteller bot nur einen Fehlerhaken.

Beides ist geschlossen, und zwar an derselben Stelle: im Empfaenger-Stack, wo
seit `1.28.0` ein echter HTTPS-Server steht, der den HMAC selbst nachrechnet.
Der Fall startet `npm run worker:compute` mit eingeschaltetem Zustellzweig und
echtem Signaturschluessel und sieht danach zweimal nach: ob die Zustellung
`delivered` ist und ob der Prozess es gesagt hat.

Ein Log, das nur Fehler kennt, beantwortet die haeufigste Frage nicht — laeuft
es? `compute.webhook_delivered` beantwortet sie, mit Scope-Index und sonst
nichts: kein Endpunkt, kein Geheimnisbezug, keine Id.

Mutationsprobe: Der Erfolgshaken meldet nichts mehr. Die Zustellung kommt
weiterhin an, aber niemand erfaehrt es. Genau der Prozess-Fall faellt, 10 von 11.

Checkpoint `1.54.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
Empfaenger-Lauf 11 von 11, exit 0, zweimal reproduziert. PostgreSQL und
Functions unveraendert gegenueber `1.53.0`.

Nicht erbracht: Der Fall belegt eine gelungene Zustellung. Dass der Prozess
einen **Fehlschlag** meldet, ist verdrahtet und ungeprueft — der Empfaenger
antwortet in diesem Fall nicht falsch. Und die Ereignisse tragen keinen
Zeitbezug: Wer wissen will, wie lange eine Zustellung brauchte, findet es hier
nicht.

## Auch das Nein wird gemeldet — Release 1.55

Release 1.54 hat die gelungene Zustellung als Prozess belegt und offen gelassen,
dass der **Fehlschlag** verdrahtet und ungeprueft bleibt.

`/hooks/no-echo` im Empfaenger-Stack antwortet mit 200, ohne die Zustell-Id zu
spiegeln — fuer den Zusteller ein Fehlschlag. Der Fall definiert einen Webhook
mit genau **einem** Versuch, startet `npm run worker:compute` und sieht danach
zweimal nach: dass die Zustellung im Dead Letter liegt und dass der Prozess
`compute.webhook_failed` mit festem Code gemeldet hat.

Ein Versuch statt drei, weil dieser Fall die Meldung misst und nicht die Geduld
des Wiederholens — die ist eigens zertifiziert.

Gemeldet wird ein fester Code, kein Endpunkt und keine Antwort des Empfaengers;
der Fall prueft das mit.

Mutationsprobe: Der Fehlerhaken meldet nichts mehr. Genau der neue Fall faellt,
11 von 12.

Checkpoint `1.55.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
Empfaenger-Lauf 12 von 12, exit 0, zweimal reproduziert. PostgreSQL und
Functions unveraendert.

Nicht erbracht: Belegt sind Erfolg und Fehlschlag **einer** Zustellung. Was der
Prozess zwischen erstem Versuch und Dead Letter meldet, sieht dieser Fall nicht
— er laesst nur einen Versuch zu. Und die Ereignisse tragen weiterhin keinen
Zeitbezug.

## Der vierte Prozess — Release 1.56

Seit Release 1.44 stand dieselbe Zeile in jeder „Ehrlich offen"-Liste: Vier
Prozesse haben keinen Lauf, der sie arbeiten sieht. Der Incident-Publisher ist
der erste davon, der sich schliessen liess — er liefert an einen Webhook, und
der echte Empfaenger steht seit `1.28.0`.

Zwei Dinge waren zu tun.

**Der Empfaenger brauchte einen eigenen Pfad.** Der Incident-Publisher verlangt
genau `{"status":"ack","eventId":"…"}` mit der Kennung, die er geschickt hat;
`{"received":true}` gilt ihm als ungueltig. Und er signiert anders: dasselbe
Verfahren, aber die Schluesselkennung steht in einem eigenen Header und die
Signatur ist hexadezimal statt base64url. Wer beide Formate in eine Pruefung
zwaengt, prueft am Ende keines von beiden richtig — `/incidents` hat deshalb
seine eigene.

**Das Geheimnis wird an zwei Stellen verschieden gelesen.** Der Empfaenger
dekodiert `QKERN_RECEIVER_SECRET` als base64url und rechnet mit den Bytes; der
Projekt-Webhook-Signierer tut dasselbe. Der Incident-Publisher nimmt
`QKERN_INCIDENT_WEBHOOK_HMAC_SECRET` als **rohe Zeichenkette**. Beide sind in
sich stimmig und passen nur zusammen, wenn man die eine Seite dekodiert
konfiguriert. Wer das uebersieht, bekommt 401 und keine Erklaerung — mich hat es
zwei Laeufe gekostet.

Gefunden habe ich es erst, nachdem der Fall den Empfaenger **direkt** befragt
hat, bevor er den Prozess startet. Wer den Prozess misst, ohne die Gegenstelle
zu kennen, sucht den Fehler an der falschen Stelle. Diese Vorabfrage bleibt im
Fall stehen.

Mutationsprobe: Der Empfaenger bestaetigt eine andere Kennung. Genau der neue
Fall faellt, 12 von 13 — die Zustellung kommt an, gilt aber zu Recht nicht als
angekommen.

Checkpoint `1.56.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
Empfaenger-Lauf 13 von 13, exit 0, zweimal reproduziert.

Nicht erbracht: Belegt ist die gelungene Veroeffentlichung. Wiederholung,
Dead Letter und die Wiederaufnahme ueber ein Delivery Command sind gegen echtes
PostgreSQL zertifiziert, aber nicht durch diesen Prozess. Drei Prozesse haben
weiterhin keinen Arbeitsnachweis: Realtime, Apply-Publisher und Provisioner.

## Der fuenfte Prozess — Release 1.57

Realtime ist ein Server, also kann ein Client ihn befragen. Der Fall startet
`npm run realtime` und laeuft die Kette, die ein Kunde sieht: verbinden, mit
einem **echten** Projekt-Key anmelden, abonnieren, senden, empfangen. Nichts
davon ist eingespeist.

Vier Anlaeufe, und jedes Mal war der Fehler meiner:

- `QKERN_AUTH_DATABASE_URL` fehlte. Der Prozess baut den Projekt-Key-Dienst
  ueber die Auth-Rolle auf — Schluessel liegen in der Control Plane, der Weg
  dorthin fuehrt ueber eine eigene Verbindung.
- Der Endpunkt ist `/realtime/v1/projects/<id>/environments/<env>`, nicht ein
  Pfad mit Query-Parametern. Die Antwort auf die falsche Adresse war 403 und
  sonst nichts.
- Ein **oeffentlicher** Schluessel authentifiziert als `anon`, und `anon` darf
  ausschliesslich `public:`-Kanaele abonnieren und niemals senden. Wer damit
  einen Rundlauf messen will, misst die Policy statt den Prozess.
- Der Service-Schluessel war ein Zeichen zu kurz: Nach dem Praefix stehen genau
  43 Zeichen, und `qk_service_` ist um eines laenger als `qk_public_`. Der
  Schluessel war formungueltig, bevor ihn irgendjemand nachschlug.

Keiner dieser vier Punkte ist ein Produktfehler. Alle vier sind Dinge, die ein
Aussenstehender beim ersten Anschluss ebenfalls falsch macht — und drei davon
antworten mit einer Zahl statt mit einem Grund.

Die erste Mutationsprobe traf nicht: Sie nahm der Fernzustellung ihre
Verdrahtung, und ein Client auf einer Instanz merkt davon nichts. Die Probe, die
traegt, gibt jedem Schluessel die Rolle `anon` — dann scheitert das Abonnement,
und genau der neue Fall faellt, 123 von 124.

Checkpoint `1.57.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 124 von 124, exit 0, zweimal reproduziert.

Nicht erbracht: Belegt ist ein Client auf einer Instanz. Fan-out ueber zwei
Instanzen, Replay ueber den Cursor und Postgres Changes sind als Bibliothek
zertifiziert, nicht durch diesen Prozess. Und zwei Prozesse bleiben ohne
Arbeitsnachweis: Der Apply-Publisher braucht einen Broker, den es im Stack nicht
gibt, der Provisioner einen Vault-Weg.

## Der sechste Prozess, und eine widerlegte Annahme — Release 1.58

Release 1.56 und 1.57 haben festgehalten, der Apply-Publisher brauche „einen
Broker, den es im Stack nicht gibt". Das war eine **Annahme**, kein Hindernis.

Der Broker ist eine HTTPS-Gegenstelle mit genau demselben Format wie beim
Incident-Publisher: `v1=<hex>` als Signatur, Schluesselkennung im eigenen
Header, Bestaetigung mit genau der gesendeten Kennung. Derselbe Empfaenger
genuegt; er bekommt nur einen zweiten Pfad, damit beide Faelle unabhaengig
voneinander fallen koennen.

Der Fall lief beim ersten Anlauf gruen — nach sechs Prozessen ist das Muster
eingeuebt: Fixture in die Control Plane, Prozess starten, Zustand in der
Datenbank abwarten, Redaktion mitpruefen.

Mutationsprobe: Der Empfaenger kennt `/apply` nicht mehr. Genau der neue Fall
faellt, 13 von 14.

Checkpoint `1.58.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
Empfaenger-Lauf 14 von 14, exit 0, zweimal reproduziert.

**Damit haben sechs von sieben Prozessen einen Arbeitsnachweis.** Offen bleibt
der Provisioner: Er legt Datenbanken an und braucht dafuer einen Vault-Weg, den
der Stack nicht hat. Das ist diesmal keine Annahme — der Kompositionscode
verlangt in Produktion ausdruecklich einen Vault-gestuetzten Katalog, und der
lokale Weg deckt nicht dasselbe ab.

Nicht erbracht: Belegt ist die gelungene Veroeffentlichung. Wiederholung und
Dead Letter des Apply-Outbox sind gegen echtes PostgreSQL zertifiziert, aber
nicht durch diesen Prozess.

## Eine Korrektur und ein abgebrochener Versuch — Release 1.59

Release 1.56, 1.57 und 1.58 haben uebereinstimmend festgehalten, der Provisioner
brauche „einen Vault-Weg". **Das ist falsch.**

Sein Adapter ist `createSignedProjectProvisioningBrokerFromEnv` — ein signierter
HTTPS-Broker mit denselben vier Variablen wie beim Incident- und beim
Apply-Publisher: URL, erlaubte Hosts, Schluesselkennung, Geheimnis. Der Vault
kommt an einer anderen Stelle vor, im Katalog des Migrations-Workers, und den
hatte ich mit dem Provisioner verwechselt.

Das ist innerhalb von zwei Releases die **zweite** Annahme derselben Art: In 1.58
war es der „Broker, den es im Stack nicht gibt". Beide Male hatte ich einen Namen
gelesen und nicht den Code. Wer eine Huerde behauptet, ohne sie geprueft zu
haben, verschiebt Arbeit, die keine gewesen waere.

**Der Versuch, den siebten Prozess zu belegen, ist abgebrochen.** Empfaengerpfad,
Fixture und Fall standen; der Prozess uebernimmt den Auftrag nicht, sondern
meldet `claim_failed`. Dahinter steckt ein `PersistenceError` — dieselbe
Verpackung wie in Release 1.48, und die Ursache liegt wieder darunter. Nach
sieben Diagnosezyklen habe ich die Scheibe zurueckgenommen statt sie halbfertig
abzulegen; unbenutzter Test-Support waere genau das Muster, das dieser Sprint
beseitigt hat.

Was bleibt: eine belastbare Spur. Der Fehler tritt im Zweig
`quarantineExpired` → `claimNext` auf, laeuft bei **jedem** Takt und verschluckt
seine Ursache. In 1.48 war an genau dieser Stelle eine mehrdeutige
Spaltenreferenz der Grund; die hiesige Abfrage `quarantineExpiredLeases` hat sie
nicht, also liegt es woanders — Rechte der Provisioner-Rolle waeren der naechste
Kandidat.

Checkpoint `1.59.0` am 8. August 2026: Keine Code-Aenderung, keine neuen Zahlen.
Lokal 1023 bestanden; PostgreSQL 124 von 124, Functions 26 von 26 und
Empfaenger 14 von 14 unveraendert gegenueber `1.58.0`.

Nicht erbracht: Der siebte Prozess bleibt offen, und zwar aus einem Grund, den
niemand kennt — das ist unangenehmer als der falsche Grund, den er vorher hatte.

## Die offene Frage wird kleiner — Release 1.60

Release 1.59 hat den Versuch abgebrochen, den Provisioner als Prozess zu belegen,
und eine Spur hinterlassen: Der Fehler tritt im Zweig `quarantineExpired` →
`claimNext` auf.

Die Spur ist jetzt abgearbeitet, und sie fuehrt nicht dorthin. **Beide
Operationen funktionieren gegen echtes PostgreSQL**, ausgefuehrt von
`qkern_provisioner_app` und nicht von einer Eigentuemerrolle: Ein wartender
Auftrag wird uebernommen und bekommt eine Lease; der Aufraeumer laesst eine
frische Lease in Ruhe; ein fremder Auftrag bleibt unberuehrt.

Diagnostiziert wurde lokal gegen eine einzeln gestartete Datenbank statt ueber
den vollen Stack — Sekunden statt Minuten je Versuch. Das ist die Lehre aus
sieben Zyklen in 1.59: Wer eine Frage verengen will, sollte den kleinsten Aufbau
waehlen, in dem sie noch dieselbe ist.

Zwei Mutationsproben, und die erste hat etwas gelehrt:

- Die Mandantenbedingung der Abfrage wird zu `(organization_id = $1 OR true)`
  aufgeweicht: **kein Fall faellt.** Die Grenze traegt hier RLS, nicht das
  Praedikat — vom Adapter aus laesst sie sich nicht brechen. Dasselbe stand
  schon in Release 1.37 ueber den Aufraeumer des Change-Feeds.
- Uebernommen werden nur noch `failed` statt `pending`: Genau der
  Uebernahmefall faellt, 126 von 127.

Checkpoint `1.60.0` am 8. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 127 von 127, exit 0, zweimal reproduziert.

Nicht erbracht: Der Prozessnachweis fehlt weiterhin. Was jetzt zusaetzlich
bekannt ist: Er scheitert **nicht** an den beiden Abfragen, die im selben Block
stehen. Der naechste Kandidat ist der Unterschied zwischen den beiden
Umgebungen — hier eine einzeln gestartete Datenbank, dort ein Stack mit
parallelen Testdateien.

## Der Herzschlag, den niemand schreiben konnte — Release 1.61

Release 1.60 hat belegt, dass Übernehmen und Aufräumen des Provisioners gegen
echtes PostgreSQL funktionieren, und die offene Frage damit verengt. Sie ist
jetzt beantwortet, und die Antwort stand die ganze Zeit eine Zeile darüber.

`heartbeat()` schreibt mit `INSERT … ON CONFLICT (organization_id,
provisioner_id) DO UPDATE`. PostgreSQL verlangt für den Konfliktpfad
**SELECT-Recht auf den Spalten des Arbiter-Index**; Migration 0021 hat mit
`REVOKE ALL` alles genommen und danach nur `INSERT` und `UPDATE (last_seen_at)`
erteilt. Der Aufruf endet mit `permission denied for table` — und zwar schon
beim ersten Einfügen, weil das Recht beim Planen geprüft wird und nicht erst
beim Konflikt.

Er steht als **erster** Aufruf in demselben `try`, das auch `quarantineExpired`
umfasst, und dessen `catch` verschluckt die Ursache. Jede Runde des Prozesses
endete deshalb in `claim_failed`, bevor sie einen Auftrag auch nur gesucht hat.
Seit es diesen Prozess gibt, hat er nie etwas getan.

Migration 0036 erteilt genau die beiden Arbiter-Spalten und keine weitere. Die
Zeilenpolitik aus 0021 bleibt die Grenze: Sie bindet jeden Zugriff an
`qkern.actor_ref`.

Zwei neue Fälle, beide gegen echtes PostgreSQL mit der echten Rolle:

- Der Heartbeat wird geschrieben und danach aufgefrischt — beide Wege, der
  Einfüge- und der Konfliktpfad.
- Ein Provisioner sieht den Heartbeat eines anderen nicht. Das neue Leserecht
  darf die Grenze nicht aufmachen, und es tut es nicht.

Mutationsprobe: Das Leserecht wird auf `started_at, last_seen_at` gelegt statt
auf die Arbiter-Spalten — **genau die zwei neuen Fälle fallen**, 127 von 129.
Damit ist belegt, dass die Arbiter-Spalten es tragen und nicht das Leserecht
als solches.

Diagnostiziert wurde wieder lokal gegen eine einzeln gestartete Datenbank, mit
der Fehlerursache ausgepackt statt verschluckt. Das ist derselbe Weg wie in
1.60 und hat wieder Minuten statt Stunden gekostet.

Checkpoint `1.61.0` am 15. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 129 von 129, exit 0, zweimal reproduziert, 36 Migrationen.

Nicht erbracht: Der Prozessnachweis fehlt weiterhin. Was ihm im Weg stand, ist
weg; was noch fehlt, ist ein Broker, den der Provisioner rufen kann — der
Zertifizierungsstack hat noch keinen.

## Der siebte Prozess — Release 1.62

Seit Release 1.44 stand in jeder „Ehrlich offen"-Liste, dass Prozesse ohne
Arbeitsnachweis bleiben. Diese Liste ist leer: **Alle sieben Prozesse sind bei
der Arbeit belegt.**

Der Provisioner macht aus einem wartenden Auftrag eine Bindung in der Datenbank
und ein Projekt im Zustand `ready` — als ausgelieferter Prozess, gegen einen
echten HTTPS-Broker mit nachgerechneter Signatur, mit der echten
Provisioner-Rolle.

Der Weg zum ersten grünen Lauf führte durch zwei weitere Produktfehler:

- `column reference "id" is ambiguous` in `complete()`. `FROM inserted_binding,
  bound_environment` bringt zwei Relationen mit `id` in denselben Namensraum;
  das unqualifizierte `RETURNING` ist mehrdeutig. Derselbe Fehler wie in 1.48,
  an anderer Stelle.
- `permission denied for table project_database_bindings`. `INSERT … RETURNING`
  verlangt SELECT-Recht auf den zurückgegebenen Spalten; Migration 0020 hat nur
  `INSERT` erteilt.

Der zweite ist die dritte Ausprägung desselben Musters in zwei Releases: ein
Recht, das nicht die Operation verlangt, sondern eine ihrer Klauseln — `ON
CONFLICT` beim Heartbeat, `RETURNING` bei der Bindung. Kein Test hat es
gefunden, weil kein Test die Operation je mit der echten Rolle ausgeführt hat.

Mutationsprobe: `RETURNING` wieder unqualifiziert — **14 von 15**, genau der
Provisionierungsfall.

Checkpoint `1.62.0` am 15. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
Empfänger 15 von 15 und PostgreSQL 129 von 129, beide exit 0 und zweimal
reproduziert, 37 Migrationen.

Nicht erbracht: Der Broker richtet keine Datenbank ein — belegt ist der Weg bis
zur Bindung. Ablehnung, Zeitablauf und verlorene Lease sind als Bibliothek
zertifiziert, nicht als Prozess.

## Ein Muster, das sich selbst findet — Release 1.63

Release 1.62 endete mit dem Satz, drei Treffer desselben Rechtemusters in zwei
Releases seien kein Zufall. Dieses Release macht daraus einen Vertrag — und der
Vertrag hat sofort einen vierten gefunden, den schwersten von allen.

**Seit Migration 0019 konnte die Control Plane keinen Apply-Auftrag mehr
einreihen.** `enqueueApproved()` schreibt das Auftragsereignis mit
`INSERT … ON CONFLICT (organization_id, migration_job_id, event_type)
DO NOTHING`; ein benannter Arbiter verlangt Leserecht auf diesen Spalten, und
0019 hat der Laufzeit `SELECT ON migration_outbox` entzogen. Auftrag und
Ereignis stehen in einer Transaktion — es entstand nicht ein Auftrag ohne
Ereignis, sondern gar nichts.

Alles dahinter war zertifiziert. Nur konnte nie jemand einen Auftrag
davorstellen; die Testaufbauten haben ihre Zeilen als Eigentümer geschrieben.

Gemessen statt angenommen, welche Form das Recht verlangt:

| Anweisung | ohne Leserecht |
| --- | --- |
| `INSERT` schlicht | läuft bis zur Zeilenpolitik |
| `INSERT … ON CONFLICT DO NOTHING` | läuft bis zur Zeilenpolitik |
| `INSERT … ON CONFLICT (spalten) DO NOTHING` | **permission denied** |

Der Vertrag liest die Anweisungen aus dem Adapter und die Rechte aus dem
laufenden Cluster — beides abgeleitet, nichts von Hand gepflegt. 95 Anweisungen
fallen darunter; 9 Spaltenlisten und 471 Platzhalter meldet er als nicht
auswertbar, statt sie zu verschweigen.

Migration 0038 erteilt genau die drei Arbiter-Spalten. Lease- und Broker-Zustand
bleiben unlesbar, belegt durch einen eigenen Fall.

Mutationsprobe: Leserecht auf `created_at` statt auf die Arbiter-Spalten — die
beiden Einreihungsfälle und der Vertrag selbst fallen. Ein vierter Fall ist
mitgefallen, der nichts damit zu tun hat: ein Lastfall auf dem Queue-Weg, den
beide grünen Läufe bestanden haben. Er ist nicht erklärt und steht so in den
Belegen.

Checkpoint `1.63.0` am 15. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 134 von 134, exit 0, zweimal reproduziert, 38 Migrationen.

## Der Pool war leer, nicht die Warteschlange — Release 1.64

Release 1.63 hat einen Lastfall offen gelassen: einmal in drei Läufen
gescheitert, mit einem `PersistenceError` beim Einreihen, nicht erklärt. Er ist
jetzt erklärt, reproduziert und behoben.

Die Ursache war keine Datenbank. `pg` meldet den Zeitablauf beim **Holen** einer
Verbindung ohne SQLSTATE; er fiel deshalb in den Sammelzweig und wurde zu
`PERSISTENCE_ERROR`. Der Queue-Dienst machte daraus ein `QUEUE_CONFLICT`, die
HTTP-Grenze eine 409 „Queue conflict". Ein Aufrufer las: *jemand anderes war
schneller* — während die Warteschlange in Ordnung und die Abfrage nie gelaufen
war.

Reproduziert mit einem Pool aus zwei Verbindungen und 100 ms Wartezeit: 165 von
180 Einreihungen abgewiesen, jede als `QUEUE_CONFLICT`.

Beim Schreiben des Falls kam ein zweiter Fehler heraus: Die Suche am Anfang fast
jeder Methode lag **ausserhalb** der Fehlerabbildung. Ein Infrastrukturfehler
dort verliess den Dienst als roher `RepositoryError`, obwohl sein Vertrag
`ProjectQueueError` zusagt. Der neue Fall ist zuerst genau daran gescheitert.

Neu: `ConnectionUnavailableError` mit Code `CONNECTION_UNAVAILABLE`, als
wiederholbar gekennzeichnet, klassifiziert beim Holen der Verbindung — dort ist
eindeutig, was gescheitert ist, und nur dort geht es ohne Textvergleich am
Treiberfehler. Im Queue-Dienst `QUEUE_UNAVAILABLE`, an der HTTP-Grenze 503.

Der Druck wird im Fall hergestellt, nicht abgewartet: ein Pool mit einer
Verbindung und 50 ms Wartezeit, davor der Gegenbeweis mit genug Verbindungen.
Ein Fall, der auf eine Zufallslast wartet, belegt nichts.

Mutationsprobe: Der Fehler beim Verbindungsholen wird wieder durchgereicht statt
klassifiziert — **134 von 135**, genau der neue Fall.

Checkpoint `1.64.0` am 15. August 2026: Lokal 1023 bestanden, 0 fehlgeschlagen;
PostgreSQL 135 von 135, exit 0, zweimal reproduziert, 38 Migrationen.

Nicht erbracht: Nur Project Queues übersetzt die Klassifikation in eine eigene
Antwort. Der direkte `pool.query()`-Weg ohne Transaktion ist nicht erfasst.
Wiederholt wird nichts von selbst, und die Poolgrösse bleibt unverändert — das
Release macht die Erschöpfung sichtbar, es verhindert sie nicht.

## Neun Grenzen, nicht sechs — Release 1.65

Release 1.64 hat den erschöpften Verbindungspool klassifizierbar gemacht und in
**einer** Grenze richtig beantwortet. Die anderen meldeten ihn weiter als 500 —
eine Aussage, die dem Aufrufer sagt, es sei etwas kaputt, obwohl nur gerade
keine Verbindung frei war.

Die Regel ist überall dieselbe: 503, wiederholbar. `isConnectionUnavailable` ist
ein Prädikat und keine Antwort, denn jede Grenze hat ihr eigenes Antwortformat.
Geprüft wird auch die verpackte Form — Dienste hüllen den Fehler in ihre eigene
Fehlerklasse, bevor er die Grenze erreicht.

Ich hätte sechs Grenzen bedient. Es sind **neun**. Der Vertrag zählt sie selbst
und hat drei gefunden, die in Route-Dateien statt in `lib/server` stehen:
Projekt-API-Keys, Automation Policy und Schema-Introspektion. Dabei kam noch
etwas heraus: Drei Grenzen heissen schlicht `routeError`, und die erste Fassung
des Vertrags zählte nach Namen und hielt drei für eine. Er zählt jetzt
`datei:name`.

Zwei Mutationsproben:

- Die Regel in einer Grenze entfernt — **17 von 19**, genau deren zwei Fälle.
- Eine zehnte Grenze angelegt, die der Vertrag nicht kennt — **16 von 19**, die
  Abdeckungsprüfung schlägt an und nennt sie. Das ist die wichtigere Probe: Sie
  belegt, dass der Vertrag die nächste Grenze mitbekommt.

Checkpoint `1.65.0` am 16. August 2026: Lokal 1042 bestanden, 0 fehlgeschlagen;
Vertrag 19 von 19 zweimal reproduziert; PostgreSQL 135 von 135, exit 0, zweimal
reproduziert.

Nicht erbracht: Der Vertrag prüft die Antwort, nicht den Weg dorthin, und
erkennt Grenzen an ihrem Namen. Nur Project Queues hat einen eigenen Code für
diesen Fall; die übrigen acht antworten richtig, nennen aber keinen
maschinenlesbaren Grund.

Beim Zurücknehmen der ersten Mutationsprobe habe ich mit `git checkout` eine
noch nicht eingecheckte Änderung derselben Datei mitgelöscht und neu schreiben
müssen. Der Lauf danach war grün; erwähnt, weil ein stiller Verlust die
gefährlichere Variante gewesen wäre.

## Der Schritt bekommt einen Namen — Release 1.66

`claim_failed` hat drei Releases gekostet: 1.59 vermutete die falsche Stelle,
1.60 schloss sie aus, erst 1.61 fand den Heartbeat — für eine Frage, die eine
Zeile im Log beantwortet hätte. Der `catch` des Provisioners verschluckte die
Ursache, und das stand seither in jeder „Ehrlich offen"-Liste.

`claim_failed` nennt jetzt den **Schritt** (`heartbeat`, `quarantine`, `claim` —
jeder Aufruf hat sein eigenes `catch`) und die **Fehlerklasse** (`reason`: die
festen Codes aus `RepositoryError`, sonst `UNKNOWN`). Eine Datenbankmeldung
gehört nicht in ein Prozesslog — sie kann Tabellen- und Spaltennamen fremder
Mandanten tragen.

Belegt wird das, indem der Fehler aus 1.61 absichtlich wiederhergestellt wird:
Leserecht auf den Arbiter-Spalten entzogen, ausgelieferten Prozess gestartet.
Er meldet `step: "heartbeat"`, `reason: "PERSISTENCE_ERROR"` — und gibt weder
`permission denied` noch einen Tabellennamen aus.

Mutationsprobe: Das `step`-Feld wird nicht mehr gesetzt — **15 von 16**, genau
der neue Fall.

Ausserdem: `docs/PARITAET.md` vermisst die Lücke zu Supabase Fähigkeit für
Fähigkeit und legt die Abbaureihenfolge fest. Ein „Rutsch" auf Supabase-Niveau
ist unter der Messvorschrift dieses Projekts keine erfüllbare Aufgabe; die
Leiter ist die ehrliche Form derselben Absicht.

Checkpoint `1.66.0` am 16. August 2026: Lokal 1042 bestanden, 0 fehlgeschlagen;
Empfänger 16 von 16, exit 0, zweimal reproduziert.

Nicht erbracht: `reason` ist so grob wie `RepositoryError`. Nur der
Heartbeat-Schritt ist rot belegt. Der PostgreSQL-Stack wurde nicht neu gefahren;
die Änderung liegt im Prozesslog, und der Empfängerstack führt genau diesen
Prozess.

## Die erste Sprosse — Release 1.67

Sprosse 1 der Paritätsleiter: Die sechs Metriken haben Preise, und aus echten
Zählern wird ein projizierter Monatsbetrag.

Migration 0039 legt `billing_rate_cards` an — append-only wie das Audit-Log und
aus demselben Grund: Ein Preis, der rückwirkend umgeschrieben werden kann,
taugt nicht als Grundlage einer Abrechnung. FORCE RLS ohne UPDATE-/DELETE-Policy
lässt auch den Eigentümer nichts umschreiben. Ein Preis ist ein Bruch
(`unit_price_micros` je `per_units`), gerechnet wird in BigInt, abgerundet auf
den Mikro — der angebrochene Mikro-Franken gehört dem Kunden.

`setRate` ist Operatoren vorbehalten wie die Quota-Policies; die REST-Fläche
(`GET …/usage/billing`) ist lesend und trägt `kind: "projection"` — keine
Rechnung, keine Nummer, keine Fälligkeit.

Zertifiziert mit der echten Kette: Nutzung über den Usage-Dienst verbucht,
Projektion durch die Laufzeitrolle, RLS scharf. 1000 echte `queue_operations`
× 250 Mikro → `0.250000` CHF; späterer Stichtag schlägt früheren; fremde
Organisation sieht ein leeres Preisblatt; UPDATE/DELETE scheitern.

Mutationsprobe: `ORDER BY effective_from DESC` → `ASC` — **138 von 139**, genau
der Fall „der neueste Preis gewinnt".

Checkpoint `1.67.0` am 16. August 2026: Lokal 1049 bestanden, 0 fehlgeschlagen;
PostgreSQL 139 von 139, exit 0, zweimal reproduziert, 39 Migrationen.

Nicht erbracht: keine Rechnung (Sprosse 2); der Preis am Fensterende gilt für
den ganzen Monat; eine Währung je Organisation prüft der Dienst, nicht die
Datenbank; `setRate` hat keine Produktfläche; die REST-Route ist lokal
getestet, nicht im Stack.

## Der achte Prozess schliesst den Monat — Release 1.68

Sprosse 2 der Paritätsleiter: Der Rechnungslauf existiert, läuft als eigener
Prozess (`npm run worker:billing-invoices`) und ist bei der Arbeit belegt — der
achte Prozess mit Arbeitsnachweis.

Eine Rechnung unterscheidet sich von der Projektion aus 1.67 in genau einem
Punkt: Sie friert ein. Das Fenster muss abgeschlossen sein, die Rechnung ist
append-only, und je (Projekt, Umgebung, Periode) entsteht höchstens eine — die
eindeutige Beschränkung aus Migration 0040 trägt die Idempotenz, nicht der
Code. Rechnung und Posten entstehen in einer Tenant-Transaktion. Die
Worker-Rolle bekam mit 0040 erst ihre Leserechte auf Umgebungen, Zähler und
Preisblatt — sie hatte keines davon.

Drei Prozessfälle gegen echtes PostgreSQL: Aus echten Juli-Zählern und dem
echten Preisblatt entsteht die Rechnung mit zwei Posten und Summe 430000
Mikro-CHF, und der Preis vom 1. August gilt für den Juli nicht; ein zweiter
Lauf meldet `exists` und lässt sie unangetastet; ein Lauf über die offene
Periode scheitert an der Konfigurationsgrenze. Dazu fünf lokale Fälle.

Mutationsprobe: Periodenabschluss entfernt — **141 von 142**, genau der
Abschlussfall. Der erste Mutationslauf endete mit exit 1, ohne dass die Probe
lief: Docker Desktop war ausgefallen. Nur der Blick in den Log hat das
unterschieden; der Lauf wurde verworfen und wiederholt. Ein Exit-Code allein
beglaubigt keine Mutationsprobe.

Checkpoint `1.68.0` am 16. August 2026: Lokal 1056 bestanden, 0 fehlgeschlagen;
PostgreSQL 142 von 142, exit 0, zweimal reproduziert, 40 Migrationen.

Nicht erbracht: keine kaufmännische Nummer, keine Fälligkeit, keine
Zahlungsanbindung; keine Lesefläche in REST/Console; die Juli-Zähler des
Prozessfalls sind als Eigentümer eingelegt (der Schreibweg ist seit 1.29 eigens
zertifiziert); kein Deployment-Rendering; kein Fall für zwei konkurrierende
Läufe.

## Teile, die ankommen — Release 1.69

Sprosse 3 der Paritätsleiter, erste Hälfte: fortsetzbare Uploads in Teilen, auf
der Provider-Schicht gegen echtes MinIO zertifiziert — beginnen, je Teil eine
signierte URL, abschliessen, abbrechen, im S3- und im Memory-Adapter.

Zwei Funde. Erstens: `canonicalQueryString` sortierte mit `localeCompare`, AWS
verlangt Byte-Ordnung. Bei rein grossgeschriebenen `X-Amz-`-Schlüsseln fiel das
nie auf; mit `partNumber` und `uploadId` platzt die Signatur
(`SignatureDoesNotMatch`, erster MinIO-Lauf). Latent betroffen war auch der
Bestand: signierte Downloads mit Dateinamen hätten dieselbe falsche Ordnung
erzeugt — kein Fall hatte je einen gesetzt.

Zweitens: Die erste Mutationsprobe traf nicht, und das war die Antwort. Die
Abweisung manipulierter Bytes trägt der mitgesendete Header, nicht die
Signatur; die Signatur macht den Header verpflichtend. Der Fall nagelt jetzt
beides fest, und erst damit trifft die Probe: Prüfsumme nicht mehr signiert —
**3 von 4**, genau der Resumable-Fall.

Prozessvorfälle, beide offen dokumentiert: Zum zweiten Mal hat ein
`git checkout` unkommittierte Arbeit gelöscht (die ganze
Multipart-Implementierung; wiederhergestellt aus den Patch-Skripten —
Wiederherstellung läuft jetzt über Sicherungskopien). Und ein als Mutation
beschrifteter Lauf war ein grüner Lauf, weil das Mutationsskript vor dem
Schreiben scheiterte; aufgefallen an 4/4 im vermeintlichen Mutationslog,
verworfen, zeilengenau wiederholt.

Checkpoint `1.69.0` am 16. August 2026: Lokal 1056 bestanden, 0 fehlgeschlagen;
MinIO/ClamAV 4 von 4, exit 0, zweimal reproduziert.

Nicht erbracht: Der Dienstweg (Upload-Zeilen, Quota, Virenprüfung, REST) kennt
Multipart nicht — ein Kunde kann es noch nicht benutzen. `headObject` liefert
für Multipart-Objekte eine zusammengesetzte Prüfsumme, die die bestehende
Formprüfung abweisen würde; der Dienstweg muss das behandeln.

## Der Scanner rechnet nach — Release 1.70

Sprosse 3 der Paritätsleiter ist abgebaut: Fortsetzbare Uploads laufen über den
ganzen Dienstweg — Reservierung, Quota, Teil-Grants, Abschluss, Virenprüfung,
REST.

Die Architekturentscheidung: Ein Multipart-Objekt hat beim Provider keine
Ganzdatei-Prüfsumme (MinIO liefert im HEAD gar keinen Header). Verifiziert wird
über den Virenscanner, der das fertige Objekt ohnehin lädt und die SHA-256
mitrechnet. Ein Multipart-Objekt wird **nur** sauber, wenn der Scanner Bytes
gesehen hat, die zur deklarierten Summe passen; ohne nachrechnenden Scanner
bleibt es in Quarantäne, weil seine Summe sonst niemand geprüft hat.

Ein Fund: `headObject` warf für jedes Multipart-Objekt
`STORAGE_PROVIDER_UNAVAILABLE`, weil es einen wohlgeformten Prüfsummen-Header
verlangte. Ein fehlender Wert wird jetzt leer durchgereicht; die Zusage des
einfachen Wegs trägt der Gleichheitsvergleich im Dienst. Gefunden in Minuten
gegen ein einzelnes MinIO.

Zertifiziert über den Dienst gegen echtes MinIO/ClamAV: zwei Teile, Abschluss,
clean, Download byte-identisch; und eine gelogene Ganzdatei-Prüfsumme bei
korrekt geprüften Teilen bleibt quarantined. Mutationsprobe: Der Scanner
vergleicht die Prüfsumme nicht mehr — **5 von 6**, genau der Lügen-Fall.
PostgreSQL-Regression 142 von 142 mit Migration 0041, zweimal.

Checkpoint `1.70.0` am 16. August 2026: Lokal 1060 bestanden, 0 fehlgeschlagen;
MinIO/ClamAV 6 von 6 zweimal, PostgreSQL 142 von 142 zweimal, alle exit 0.

Nicht erbracht: Kein Fall lädt 5 GiB. Verwaiste Provider-Uploads altern nicht
weg. Die Multipart-REST-Routen sind lokal getestet. Kein Real-DB-Fall
reserviert gezielt einen Multipart-Upload.

## Der View trägt die Grenze des Aufrufers — Release 1.71

Sprosse 4 der Paritätsleiter, erste Hälfte: Die Generated Data API bedient
Views — lesend, und nur solche mit `security_invoker`. Ein View läuft sonst mit
den Rechten seines Eigentümers, und die RLS der Basistabellen gilt für den
Aufrufer nicht; er wird mit demselben Code abgewiesen wie eine Tabelle ohne
RLS, denn es ist derselbe Mangel. Schreibversuche enden mit dem neuen
`GENERATED_DATA_API_READ_ONLY` (405). Ein View trägt keinen Primärschlüssel:
verlangt wird eine ausdrückliche Sortierspalte, Cursor werden abgewiesen statt
still falsch zu blättern.

Zertifiziert gegen echtes PostgreSQL: Der Invoker-View zeigt Mandant A nur A;
der View ohne `security_invoker`, der beide zeigen würde, wird nicht bedient.
Mutationsprobe: Die Invoker-Bedingung entfernt — der Views-Fall fällt.

Zwei Zertifizierungsbefunde nebenbei: Der Queue-Lastfall riss zum zweiten Mal
(nach 1.63), diesmal mit dem seit 1.64 ehrlichen `QUEUE_UNAVAILABLE` — der als
wiederholbar gekennzeichnet ist, aber der Fall wiederholte nicht. Er reagiert
jetzt wie ein Aufrufer reagieren soll: begrenzte Wiederholungen; die Zusage
(genau einmal je Nachricht) ist unverändert. Und ein Webhook-Fall riss am
5-Sekunden-Standardbudget auf einem Host, der nach fünfzehn Docker-Läufen 200
Sekunden für Imports brauchte — die Lektion aus 1.38 an der nächsten Datei;
alle Fälle dort tragen jetzt ein ausdrückliches Budget. Ein roter Zwischenlauf
wurde verworfen, der Stand zweimal frisch belegt.

Checkpoint `1.71.0` am 16. August 2026: Lokal 1060 bestanden, 0 fehlgeschlagen;
PostgreSQL 143 von 143, exit 0, zweimal reproduziert, 41 Migrationen.

Nicht erbracht: RPC (zweite Hälfte der Sprosse). Materialisierte Views sind
nicht dabei. OpenAPI unterscheidet Views nicht und bewirbt Schreiboperationen,
die mit 405 enden. Der Mutationslauf lief vor der Härtung des Lastfalls; sein
Views-Fall ist unverändert.

## Die Funktion läuft als Aufrufer — Release 1.72

Sprosse 4 der Paritätsleiter ist abgebaut: Nach den Views (1.71) ruft die
Generated Data API jetzt Funktionen — `POST /rpc/<funktion>` mit benannten
Argumenten.

Die Regeln: Nur `SECURITY INVOKER` (der Rumpf läuft als Aufrufer, die RLS
gilt; `DEFINER` wird mit demselben Code abgewiesen wie ein View ohne
`security_invoker`). Die deklarierte Flüchtigkeit entscheidet über die
Transaktion — `STABLE`/`IMMUTABLE` laufen READ ONLY, und eine falsch
deklarierte Funktion scheitert daran, statt zu wirken. Benannte Argumente
werden parametrisiert mit Cast auf den introspektierten Typ gebunden; nur
gefahrlos interpolierbare Typnamen sind zugelassen, Überladungen sind
mehrdeutig und werden abgewiesen. Set-Ergebnisse sind begrenzt und ein
Beschnitt wird als `truncated` genannt.

Zertifiziert gegen echtes PostgreSQL: Die Set-Funktion sieht durch die RLS des
Aufrufers (A findet nur A); die flüchtige Funktion schreibt als Aufrufer, und
ein Schreibversuch für einen fremden Mandanten scheitert an dessen WITH CHECK;
die DEFINER-Variante wird nicht bedient; unbekannte Funktion und fehlendes
Pflichtargument sind Aufruffehler.

Mutationsprobe: Die DEFINER-Abweisung entfernt — **143 von 144**, genau der
RPC-Fall.

Checkpoint `1.72.0` am 16. August 2026: Lokal 1060 bestanden, 0 fehlgeschlagen;
PostgreSQL 144 von 144, exit 0, zweimal reproduziert, 41 Migrationen.

Nicht erbracht: Eigene Typen ausserhalb des Suchpfads sind nicht aufrufbar
(bewusste Cast-Grenze). Die RPC-Route spricht in keinem Fall HTTP. OpenAPI
kennt `/rpc` nicht. Prozeduren (`CALL`) sind nicht dabei.

## Das Verbot wird ein Tor — Release 1.73

Sprosse 5 der Paritätsleiter: Das bedingungslose Production-Verbot des
Realtime-Transports ist durch ein Tor mit benannten, einzeln geprüften
Bedingungen ersetzt. Das Verbot aus Alpha 1 nannte seine Gründe selbst — TLS,
dauerhafter Log, Fan-out —, und zwei der drei sind seit 1.11 beziehungsweise
1.16 gebaut und zertifiziert. Ein Verbot, dessen Gründe erfüllt sind, ist
keine Sicherheit mehr, sondern eine Erinnerung.

Production startet genau dann, wenn jede Bedingung hält: dauerhafter Log,
Cursor-Geheimnis mit mindestens 32 Bytes (sonst überlebt kein Replay-Cursor
einen Neustart), Aufbewahrung konfiguriert, https-only Origins — und bei
öffentlichem Binding die TLS-Attestierung `TLS_TERMINATED=proxy`, die genau
das ist: eine Attestierung, kein Beweis. Nicht-Loopback-Binding verlangt in
jeder Umgebung ein ausdrückliches `PUBLIC_BIND=true`; ohne neue Variablen ist
das Verhalten unverändert.

Zertifiziert als Prozess: Die Abweisung benennt die verletzte Bedingung
(Memory-Log an, alles andere erfüllt — der Worker weigert sich zu lauschen
und sagt warum), und das öffentliche Binding arbeitet wirklich (Prozess auf
0.0.0.0, echter Client, echter Projekt-Key). Der alte Vertrag ist auf das Tor
fortgeschrieben und verlangt dessen fünf Bedingungen namentlich.

Mutationsprobe: Die Log-Bedingung aus dem Tor entfernt — **145 von 146**,
genau der Abweisungsfall.

Ein Befund am Rand: Der erste Lauf scheiterte vor dem Tor, weil die
Pool-Konfiguration in Production `DATABASE_SSL=require` beim Import verlangt.
Die Reihenfolge ist dokumentiert: Die SSL-Regel steht vor dem Tor.

Checkpoint `1.73.0` am 16. August 2026: Lokal 1064 bestanden, 0 fehlgeschlagen;
PostgreSQL 146 von 146, exit 0, zweimal reproduziert, 41 Migrationen.

Nicht erbracht: Ein vollständiger Production-Start (der Wegwerfstack hat kein
SSL-PostgreSQL). Die TLS-Attestierung ist keine Prüfung. History und Presence
liegen weiter im Prozessspeicher.

## Die eine Tür für neue Images — Release 1.74

Sprosse 6 der Paritätsleiter: Der Image-Deployment-Fluss existiert. Eine
Function bekommt ein neues digest-gepinntes Image, ohne gelöscht und neu
angelegt zu werden — und ohne dass ihre Unveränderlichkeit fällt.

Die Konstruktion: Spaltenrecht und Wachtrigger aus 0033 bleiben; neu ist genau
eine Tür hindurch. `qkern_deploy_project_function` wechselt das Image und
schreibt im selben Atemzug die Historienzeile — über ein transaktionslokales
Flag, das nur diese Funktion setzt. Eine Image-Änderung ohne ihre Historie ist
auf Datenbankebene nicht ausdrückbar, auch nicht für den Eigentümer:
`project_function_deployments` ist append-only mit FORCE RLS ohne UPDATE- und
DELETE-Policy. Rollback ist ein Deployment auf den alten Digest — dieselbe
Tür, die nächste Revision.

Zertifiziert gegen echtes PostgreSQL mit der echten Laufzeitrolle: Der direkte
UPDATE auf das Image scheitert weiter an `permission denied`; durch die Tür
ist Image B Revision 1, der Rollback auf A Revision 2, die Definition zeigt A,
und die Historie nennt beide Schritte mit Akteur.

Mutationsprobe: Die Tür schreibt die Historienzeile nicht mehr — **146 von
147**, genau der Deployment-Fall.

Beinahe zum dritten Mal: Ein reflexhaftes `git checkout` zielte auf die
uncommittierte Migrationsdatei — es schlug fehl, und das vorbereitete
Python-Fallback stellte den Stand wieder her. Der Reflex ist das Problem;
Wiederherstellung nach Mutationen läuft ausschliesslich über Kopien.

Checkpoint `1.74.0` am 16. August 2026: Lokal 1064 bestanden, 0 fehlgeschlagen;
PostgreSQL 147 von 147, exit 0, zweimal reproduziert, 42 Migrationen.

Nicht erbracht: Kein Aufruf-Fall wechselt das Image unter Last. Die
Deployment-Route spricht in keinem Fall HTTP. Der zentrale Audit-Weg kennt
Deployments noch nicht.

## Der Editor hört auf zu schauspielern — Release 1.75

Sprosse 9 der Paritätsleiter: Der SQL-Editor der Console ist echt.

Der Fund: Der Editor zeigte auf „Validate query" vorbereitete Beispielzeilen —
hartkodiert — und rief die Query-Route nie, obwohl der echte Weg seit langem
existiert (`POST …/query` mit Parser-Wächter, `BEGIN READ ONLY`, Zeitbudgets,
Limits, Redaktion). Die Signatur-Fehlerklasse dieser Sprint in ihrer neunten
Ausprägung, diesmal als Fläche. Und das Rückgrat darunter war ausschliesslich
mit Mocks getestet.

Jetzt führt die Console Read-only-SQL wirklich aus — echte Spalten, echte
Zeilen, ehrliches `truncated`, Fehlercodes im Klartext; schreibende Statements
werden weiter ein geprüftes Change Set. Und das Rückgrat ist erstmals gegen
echtes PostgreSQL zertifiziert: echte SELECT-Zeilen mit `truncated`; eine
Spalte, die wie ein Geheimnis heisst, verlässt QKERN nie im Klartext; ein
getarntes UPDATE und ein Multi-Statement werden abgewiesen, und die Daten
bleiben nachweislich unverändert.

Mutationsprobe: Der Parser-Wächter entfernt — **148 von 149**, genau der
Abwehrfall. Bemerkenswert: Die Daten blieben auch unter Mutation unverändert,
weil `BEGIN READ ONLY` als zweite Linie stand — aber der zugesagte Fehlercode
fehlte, und genau daran fiel der Fall.

Checkpoint `1.75.0` am 16. August 2026: Lokal 1064 bestanden, 0 fehlgeschlagen;
PostgreSQL 149 von 149, exit 0, zweimal reproduziert, 42 Migrationen.

Nicht erbracht: Die Console-Ansicht selbst ist nicht automatisiert getestet
(kein Browser-E2E im Projekt). Die Ergebnisdarstellung ist bewusst schlicht.
Das 5-Sekunden-Zeitbudget ist nicht als Fall belegt.

## Zwei Provider, ein Konto, klare Grenzen — Release 1.76

Sprosse 8 der Paritätsleiter: Der Provider-Katalog ist gegen zwei echte,
getrennte OIDC-Gegenstellen belegt. Der Katalog existierte seit der
OIDC-Einführung, belegt war ein einziger Provider.

Der Aufbau: ein zweiter, eigenständiger Dex — eigener Issuer, eigene
Schlüssel, eigener Client. Derselbe Mensch existiert bei beiden Providern
unter derselben E-Mail mit verschiedenen Subjects. Belegt: Der Login über den
zweiten Provider landet beim selben Auth-User, verknüpft über die verifizierte
E-Mail und niemals über Subject-Gleichheit; ein Autorisierungs-State des einen
Providers wird beim anderen mit `INVALID_TOKEN` abgewiesen; ein unbekannter
Slug existiert nicht.

Ein Fund am Werkzeug: Der erste Lauf scheiterte an `ENOTFOUND` — das
Startskript des Auth-Stacks fährt seine Dienste namentlich hoch, und der neue
Dex stand in der Compose-Datei, aber nicht in der Liste. Ein Dienst, der
existiert und nie läuft, diesmal am Zertifizierungswerkzeug selbst.

Mutationsprobe: Die Provider-Bindung des States entfernt — **5 von 6**, genau
der Zwei-Provider-Fall.

Checkpoint `1.76.0` am 16. August 2026: Lokal 1064 bestanden, 0 fehlgeschlagen;
Mailpit/Dex 6 von 6, exit 0, zweimal reproduziert.

Nicht erbracht: Dex ist kein GitHub — kommerzielle Provider-Eigenheiten
brauchen echte Konten. Die E-Mail-Verknüpfung vertraut der Verifizierung des
Providers; ein `email_verified`-Erfordernis je Provider fehlt. Kein
Console-Fluss für die Provider-Auswahl.

## Rechnungen bekommen Leser — Release 1.77

Zwei offene Punkte aus 1.68 sind geschlossen — beides lokal voll belegbar:
die Rechnungs-Lesefläche und der Wettlauf zweier Rechnungsläufe.

`GET …/usage/invoices` liefert die ausgestellten Rechnungen mit Posten,
neueste Periode zuerst, hinter demselben Schalter und derselben Fehlergrenze
wie die Usage-Fläche. Der Rechnungslauf schreibt als Worker, gelesen wird als
Laufzeit über das Leserecht aus Migration 0040 — die Grenze war gezogen, bevor
die Fläche existierte.

Der Wettlauf: Zwei Prozesse starten gleichzeitig für dieselbe Periode, beide
laufen sauber durch, und es entsteht genau eine Rechnung. Die Idempotenz trägt
der benannte ON-CONFLICT-Arbiter aus 0040.

Zertifiziert: Liste durch die Laufzeitrolle (eine Rechnung, zwei Posten,
total 0.430000; fremde Organisation sieht eine **leere** Liste — RLS, nicht
WHERE) und der Wettlauf (zwei ausgelieferte Prozesse, eine Rechnung, kein
run_failed).

Mutationsprobe: Der Arbiter aus dem Rechnungs-INSERT entfernt — **149 von
151**, genau die zwei idempotenzgebundenen Fälle: der zweite Lauf und der
Wettlauf. Dass beide fallen, ist der Punkt — Wiederholung und Wettlauf sind
dieselbe Zusage, getragen von derselben Zeile.

Checkpoint `1.77.0` am 16. August 2026: Lokal 1064 bestanden, 0 fehlgeschlagen;
PostgreSQL 151 von 151, exit 0, zweimal reproduziert, 42 Migrationen.

Nicht erbracht: keine Console-Fläche für Rechnungen; keine kaufmännische
Nummer, keine Fälligkeit; die Invoices-Route spricht in keinem Fall HTTP.

## Waisen altern weg — Release 1.78

Der offene Punkt aus 1.70: Verwaiste Provider-Uploads alterten nicht weg.
`expireLifecycle` räumt jetzt zusätzlich verfallene Multipart-Reservierungen
ab (Quota frei, Provider-Abbruch — bis dahin verfielen sie nur lazy beim
nächsten reserveUpload, und niemand sagte dem Provider Bescheid) und bricht
Provider-Waisen ab: begonnene Uploads, alt genug und ohne lebende
Reservierung, über das neue Provider-Verb `listMultipartUploads` (eine Seite,
höchstens 1000). Lebende Reservierungen sind ausdrücklich geschützt.

Zwei Produktfunde. Erstens: MinIO beantwortet ListMultipartUploads mit
Verzeichnis-Präfixen **leer** — nur ohne Präfix oder mit vollem
Objektschlüssel kommen Einträge; der erste Zertifizierungslauf fiel genau
daran, der Präfix wird jetzt clientseitig gefiltert. Zweitens: Der CHECK auf
`provider_upload_id` aus Migration 0041 nutzte `{1,1024}` — PostgreSQL
erlaubt in POSIX-Regexen höchstens 255 Wiederholungen, die Bedingung warf zur
Laufzeit `invalid regular expression`. **Seit 1.70 konnte keine
Multipart-Reservierung in eine echte Datenbank geschrieben werden**;
Single-Uploads blieben unberührt (NULL wertet die Bedingung nie aus).
Gefunden vom ersten Real-DB-Fall, der gezielt einen Multipart-Upload
reserviert — exakt die in 1.70 offen ausgewiesene Lücke. Migration 0043
ersetzt die Bedingung (Länge über length(), Alphabet ohne Zählgrenze).

Zertifiziert gegen echtes MinIO/ClamAV: verfallene Reservierung → Provider-
Abbruch und STORAGE_INVALID_TOKEN für spätere Teil-URLs; Waise fällt, der
Upload einer lebenden Reservierung bleibt und läuft bis clean durch. Gegen
echtes PostgreSQL: reservieren, verfallen, aufräumen — expired,
reserved_bytes 0, Provider-Upload weg.

Mutationsprobe: Die Schutzprüfung für lebende Reservierungen entfernt —
**7 von 8**, genau der Verschonungsfall.

Checkpoint `1.78.0` am 16. August 2026: Lokal 1065 bestanden, 0
fehlgeschlagen; MinIO/ClamAV 8 von 8 zweimal, PostgreSQL 152 von 152 zweimal
mit 43 Migrationen, alle exit 0.

Nicht erbracht: Die eine Seite (1000) ist die Grenze, den Rückstand misst
niemand. Kein Prozess ruft den Lifecycle von selbst. Die Waisen-Schwelle
vertraut der Provider-Uhr.

## Deployments stehen im Audit — Release 1.79

Der offene Punkt aus 1.74: Der zentrale Audit-Weg kannte Deployments nicht.
`deployFunction` schreibt den Eintrag jetzt in **derselben** Transaktion wie
den Aufruf der Tür aus 0042 — Aktion
`project.compute.function.deployed`, Ressource ist die Function, Metadaten
tragen Image-Digest und Revision. Die Hash-Kette füllt der Trigger aus 0002
wie für jeden anderen Eintrag; ein Deployment ohne Audit ist vom Dienstweg
aus nicht ausdrückbar. Bewusst **kein** SQL-seitiger Audit-Insert in der
DEFINER-Tür: Die Kette wird app-seitig über denselben Appender geführt wie
überall, und eine zweite Hash-Implementierung in plpgsql wäre eine zweite
Wahrheit.

Zertifiziert gegen echtes PostgreSQL: zwei Deployments, zwei verkettete
Einträge mit Revision 1 und 2, echte Hashes, der zweite zeigt auf einen
Vorgänger.

Mutationsprobe: Der Append aus der Transaktion entfernt — **152 von 153**,
genau der Audit-Fall, und nur er.

Checkpoint `1.79.0` am 16. August 2026: Lokal 1065 bestanden, 0
fehlgeschlagen; PostgreSQL 153 von 153, exit 0, zweimal reproduziert, 43
Migrationen.

Nicht erbracht: Die Console zeigt die Deployment-Historie, aber keine
Audit-Ansicht dafür. Wer die Tür per Hand-SQL mit der Laufzeitrolle ruft,
umgeht den Audit-Weg — die Zusage gilt für den Dienstweg, nicht für die
Datenbank selbst.

## Das Dokument sagt die Wahrheit — Release 1.80

Die offenen Punkte aus 1.71 und 1.72: Das OpenAPI-Dokument der Generated Data
API kannte weder die Nur-Lese-Natur der Views noch die /rpc-Pfade. Jetzt
beschreibt es beide — **nach denselben Grenzen, nach denen die Fläche
bedient**: Ein View erscheint nur mit `security_invoker` und nur mit GET samt
Pflicht-Sortierspalte (`column.asc|desc`, Cursor gibt es nicht); eine
Funktion erscheint nur, wenn `callFunction` sie annähme — SECURITY INVOKER,
ausführbar, nicht überladen, benannte Argumente mit sicheren Typen. Die
Volatilität steht im Summary, weil sie das Verhalten bestimmt: Alles ausser
volatile läuft in einer READ-ONLY-Transaktion. Argumente mit Default sind im
Schema optional, Pflichtargumente stehen in `required`.

Zertifiziert gegen echtes PostgreSQL: Der invoker-View steht mit genau einem
GET und Pflicht-`order` im Dokument, der View ohne `security_invoker` fehlt
ganz; die stabile Funktion trägt „read-only", die flüchtige „write
transaction"; DEFINER und Überladung fehlen — genau wie beim Aufruf selbst.

Mutationsprobe: Die `security_invoker`-Bedingung aus dem Views-Filter
entfernt — **153 von 154**, genau der OpenAPI-Fall: Das Dokument bewürbe
einen View, den die Fläche mit demselben Code abweist wie eine Tabelle ohne
RLS.

Checkpoint `1.80.0` am 16. August 2026: Lokal 1065 bestanden, 0
fehlgeschlagen; PostgreSQL 154 von 154, exit 0, zweimal reproduziert, 43
Migrationen.

Nicht erbracht: Höchstens 200 Funktionen je Schema landen im Dokument — mehr
kappt es bewusst und ohne Hinweiszeile im Dokument selbst. Die
Antwortschemata der RPC-Pfade sind generisch (`type: object`), nicht aus dem
Rückgabetyp abgeleitet. Typen ausserhalb des Suchpfads bleiben wie beim
Aufruf aussen vor.

## Der Kreis ohne Lücken — Release 1.81

Der letzte rein datenbankseitige Billing-Punkt aus 1.68: Die Rechnung hatte
weder kaufmännische Nummer noch Fälligkeit. Migration 0044 gibt ihr beides.
Die Nummer ist **lückenlos je Organisation** und entsteht im selben Statement
wie die Rechnung: Eine datenmodifizierende CTE upsertet den Zähler
(`billing_invoice_counters`, serialisiert den Kreis je Organisation über die
Zeilensperre), der äussere INSERT trägt die Nummer. Die Rechnungen bleiben
append-only — kein UPDATE trägt je eine Nummer nach. Weil die CTE auch läuft,
wenn der äussere INSERT im ON CONFLICT verliert, steht das Ganze in einem
SAVEPOINT: Der Verlierer rollt seinen Zählerstand zurück, eine vergebene
Nummer ohne Rechnung ist nicht ausdrückbar.

Die Fälligkeit ist eine feste Regel — 30 Tage nach Ausstellung — als DEFAULT
auf derselben Transaktionszeit wie `issued_at`. Eine generierte Spalte
scheiterte ehrlich: `timestamptz + interval` ist in PostgreSQL nicht
immutable; der erste Stack-Lauf wies die Migration ab, bevor ein Test lief.
Schreibbar ist die Spalte für niemanden: kein Spalten-Grant, keine Policy.

Zertifiziert gegen echtes PostgreSQL: Vier Rechnungen über vier Perioden
tragen exakt die Nummern 1 bis 4 — quer über Projekte, mit einem verlorenen
Wiederholungslauf dazwischen, der keine Lücke hinterlässt; `due_at` ist für
jede Rechnung exakt `issued_at + 30 Tage`; der Leser liefert `invoiceNumber`
und `dueAt` mit.

Mutationsprobe: Der SAVEPOINT-Rollback des Verlierers entfernt — **154 von
155**, genau der Nummernkreis-Fall.

Checkpoint `1.81.0` am 16. August 2026: Lokal 1065 bestanden, 0
fehlgeschlagen; PostgreSQL 155 von 155, exit 0, zweimal reproduziert, 44
Migrationen.

Nicht erbracht: Die 30 Tage sind fest, keine Zahlungsbedingung je
Organisation. Der Zähler serialisiert Rechnungsläufe je Organisation — bei
sehr vielen gleichzeitigen Läufen ist das eine bewusste Bremse. Keine
Console-Fläche, keine Zahlungsanbindung.
