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
