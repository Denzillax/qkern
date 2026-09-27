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

## Rechnungen erreichen den Browser — Release 1.82

Zwei offene Punkte aus 1.77: Die Invoices-Route sprach in keinem Fall HTTP,
und die Console kannte keine Rechnungen.

Die Route spricht jetzt — durch dieselbe authentifizierte Grenze wie die
Usage-Fläche: 200 mit `private, no-store` und dem eingefrorenen Dokument
samt `invoiceNumber` und `dueAt`; doppelte, unbekannte oder missgeformte
`limit`-Parameter enden mit 400 **vor** dem Dienstzugriff. Der Dienst
dahinter ist seit 1.77/1.81 gegen echtes PostgreSQL zertifiziert; Gegenstand
hier ist die HTTP-Grenze.

Die Console-Monitoring-Ansicht trägt eine Rechnungs-Karte. Die Lektion aus
1.75 (ein Editor, der nie eine Route rief) bestimmt den Zuschnitt: Der
Ladeweg ist als reine Funktion extrahiert (`components/console/invoices.ts`)
und vertraglich geprüft — exakte URL, `no-store`, eigene Zustände für 503,
Fehler und missgeformte Antworten. Die React-Karte hängt ihn nur ein.

Dieser Slice ändert keinen Server-Code; es gibt bewusst keinen neuen
Stack-Lauf. Mutationsprobe lokal: Die URL des Ladewegs auf die Usage-Route
verbogen — **1 von 1069 fällt**, genau der Ladeweg-Vertrag.

Checkpoint `1.82.0` am 16. August 2026: Lokal 1069 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Mutationslauf archiviert. PostgreSQL
bleibt auf dem Stand von 1.81: 155 von 155.

Nicht erbracht: Die React-Karte selbst rendert ungeprüft — geprüft ist der
Ladeweg als Funktion, nicht das Einhängen in React (keine
Browser-Testumgebung im Repo). Keine Detailansicht der Posten, keine
Zahlungsanbindung.

## Die Auswahl wird aufzählbar — Release 1.83

Der offene Punkt aus 1.76: Kein Console-Fluss für die Provider-Auswahl. Und
dahinter der zehnte Fund der Sprint-Klasse „gebaut und nie gerufen": Der
Provider-Katalog kannte `list()` seit 1.76 — gerufen hat es niemand, weder
Console noch App konnten die konfigurierten Provider aufzählen.

`listOidcProviders` liefert eine **Zwei-Felder-Projektion**: Slug und Issuer.
Client-ID, Endpunkte und der Name der Secret-Umgebungsvariablen bleiben
drinnen. Die Admin-Route `auth/admin/providers` bedient die Console über
dieselbe Session-Grenze wie die Nutzerliste (kein Projekt-Key, kein
Query-Parameter, `private, no-store`); die AuthView zeigt statt „Configured
by environment" die echten Slugs, über einen extrahierten, vertraglich
geprüften Ladeweg (Muster aus 1.82).

Zertifiziert gegen die zwei echten Dex-Provider des Auth-Stacks: Die Liste
nennt exakt `certification` und `partner` mit ihren Issuern — und die
Serialisierung enthält kein Client-, Secret-, Endpoint- oder JWKS-Muster.

Mutationsprobe: Die Projektion wird zur Durchreichung der vollen
Provider-Objekte — **6 von 7**, genau der Projektions-Fall.

Checkpoint `1.83.0` am 16. August 2026: Lokal 1073 bestanden, 0
fehlgeschlagen, zweimal reproduziert (exit 0); Mailpit/Dex 7 von 7, exit 0,
zweimal reproduziert. Ehrlich vermerkt: Ein erster lokaler Lauf zeigte einen
einzelnen transienten Fehlschlag, dessen Fall im ungespeicherten Output nicht
identifizierbar war; zwei anschliessende vollständige Läufe waren grün — die
beiden archivierten Läufe sind diese.

Nicht erbracht: Die öffentliche Login-Auswahl (App-seitig, mit Projekt-Key)
fehlt weiterhin — die Admin-Route ist die Console-Fläche, kein
Login-Chooser. Die React-Anzeige selbst rendert ungeprüft; geprüft ist der
Ladeweg.

## Der Login kennt seine Türen — Release 1.84

Der bewusst offene Punkt aus 1.83: Die Admin-Route war die Console-Fläche,
ein App-seitiger Login-Chooser fehlte. Jetzt gibt es ihn:
`GET …/auth/oidc/providers` hinter derselben pre-auth-Grenze wie `authorize`
daneben — Projekt-Key, Origin-Gate, CORS-Echo, `private, no-store`, keine
Query-Parameter. Eine App kann ihre Login-Buttons aufzählen, statt Slugs zu
raten. Was zurückkommt, ist die Zwei-Felder-Projektion aus 1.83, gegen zwei
echte Dex-Provider zertifiziert; ein fremder Schlüssel bekommt **404, nicht
403** — er erfährt nicht, dass es das Projekt gibt, derselbe Vertrag wie an
den übrigen Auth-Routen.

Nebenbefund mit Ursache: Der transiente Einzelfall aus 1.83 ist erklärt.
Drei Quellscan-Verträge (Zertifizierungszahlen, Routen-Grenzen,
Erreichbarkeitsgraph) lesen inzwischen jedes Manifest bzw. jede Quelle und
rissen unter der I/O-Last eines vollen Suitenlaufs die
5-Sekunden-Voreinstellung. Alle drei tragen jetzt explizite 30s-Budgets —
dieselbe Regel wie bei den Webhook-Fällen aus 1.63: Budgets werden
ausgesprochen, Aussagen nicht abgeschwächt.

Mutationsprobe: Die Schlüsselprüfung aus der Chooser-Route entfernt — **1 von
1075 fällt**, genau der Abweisungs-Fall (anonym bekäme 200).

Checkpoint `1.84.0` am 16. August 2026: Lokal 1075 bestanden, 0
fehlgeschlagen, zweimal reproduziert, exit 0; Mutationslauf archiviert.
Stacks unverändert: PostgreSQL 155, MinIO/ClamAV 8, Mailpit/Dex 7.

Nicht erbracht: Das SDK kennt den Chooser noch nicht als typisierte Methode.
Die Route ist lokal gegen die echte Grenz-Implementierung belegt, aber kein
Stack-Fall spricht sie über das Netz.

## Wer bürgt, sagt es — Release 1.85

Der offene Punkt aus 1.76: ein `email_verified`-Erfordernis je Provider. Bis
1.85 galt hart und global `email_verified === true` — Provider, die den Claim
gar nicht senden (real häufig), waren stumm ausgeschlossen. Jetzt trägt jeder
Katalogeintrag `emailVerification: "required" | "trusted"`. "required"
(Voreinstellung) verlangt den Claim; "trusted" akzeptiert einen **fehlenden**
Claim, weil der Operator bürgt — ein explizites `false` bleibt in jedem
Modus eine Abweisung. Trusted heisst „ohne Claim", nie „gegen den Claim".
Ein unbekannter Modus ist ein Konfigurationsfehler, kein stilles required.

Zertifiziert: Der Auth-Stack (beide echten Dex-Provider senden `true`)
belegt den unveränderten echten Pfad, 7 von 7 zweimal. Die Matrix —
required ohne Claim abgewiesen, trusted ohne Claim akzeptiert, trusted mit
`false` abgewiesen, unbekannter Modus abgewiesen — ist lokal gegen dieselbe
`verifyIdToken`-Implementierung belegt, die der Stack durchläuft.

Fund nebenbei, mit Ursache: `tests/auth-service.test.ts` fragte an einer
Stelle die **echte** Uhr, während der Dienst auf den 17. Juli 2026 fixiert
ist. Im August bestand der Fall zufällig; am 24. September war die fixierte
Session abgelaufen und er fiel deterministisch. Behoben: Die Fixture reicht
`now()` durch. Der Produktcode war nie betroffen — er nutzt konsequent seine
eigene Uhr.

Mutationsprobe: trusted schluckt auch `false` — **1 von 1076 fällt**, genau
der Matrix-Fall.

Checkpoint `1.85.0` am 24. September 2026: Lokal 1076 bestanden, 0
fehlgeschlagen, zweimal reproduziert, exit 0; Mailpit/Dex 7 von 7, exit 0,
zweimal reproduziert. Stacks sonst unverändert: PostgreSQL 155, MinIO/ClamAV 8.

Nicht erbracht: Kein echter Provider im Stack sendet den Claim nicht — der
Trusted-Positivfall ist lokal, nicht gegen eine Gegenstelle belegt. Der
Modus steht nur im Katalog-JSON, nicht in der Console.

## Zählen unter der eigenen Grenze — Release 1.86

Die Lücke „Aggregate" der Paritätsleiter (Data API). `aggregateRows` bietet
count/sum/avg/min/max mit optionaler Gruppierungsspalte — unter **denselben**
Grenzen wie das Listen: nur wählbare, nicht-sensible Spalten, dieselben
Filter, Views nur mit `security_invoker`, und vor allem die RLS des
Aufrufers. sum/avg verlangen einen numerischen Typ, min/max einen
sortierbaren; `count(*)` braucht keine Spalte. Zähler und Summen kommen als
Dezimalstrings — bigint/numeric verlören in JSON sonst Präzision. Mehr als
100 Gruppen werden beschnitten und als `truncated` genannt.

Die Route `GET tables/<table>/aggregate?fn=count&fn=sum:amount&group=…`
importiert die Fehlergrenze der Zeilenliste statt sie zu duplizieren — der
Routen-Grenzen-Vertrag zählt weiterhin genau die deklarierten Grenzen.

Zertifiziert gegen echtes PostgreSQL: A zählt nur seine eigene Zeile, auch
gruppiert nach `owner_id` (nur die eigene Gruppe erscheint) und gefiltert;
`min(api_token)` — text, also sortierbar — scheitert allein an der
Sensibel-Prüfung; `sum(name)` am Typ.

Mutationsprobe: Die Sensibel-Prüfung aus der Aggregatspaltenwahl entfernt —
**155 von 156**, genau der Aggregat-Fall.

Checkpoint `1.86.0` am 24. September 2026: Lokal 1078 bestanden, 0
fehlgeschlagen; PostgreSQL 156 von 156, exit 0, zweimal reproduziert, 44
Migrationen.

Nicht erbracht: nur eine Gruppierungsspalte, kein HAVING, keine Aggregate im
OpenAPI-Dokument und nicht im SDK; eingebettete Joins bleiben die letzte
Data-API-Lücke der Leiter.

## Die ganze Uhr — Release 1.87

Die Cron-Lücke der Paritätsleiter: Bis 1.86 kannte QKERN nur `*/N * * * *`
und `M H * * *`. Jetzt gilt die klassische Fünf-Feld-Grammatik in UTC — je
Feld `*`, `*/N`, `a`, `a-b`, `a-b/N` und Listen; Minute 0-59, Stunde 0-23,
Tag 1-31, Monat 1-12, Wochentag 0-7 (7 ist Sonntag wie 0). Die klassische
Regel für Tag und Wochentag: Sind beide eingeschränkt, genügt einer; sonst
zählt der eingeschränkte. Ein Ausdruck ohne Vorkommen in fünf Jahren (der
31. Februar) ist ein Fehler, keine Planung. `* * * * *` ist gültig — bis
1.86 wurde es abgewiesen, was nie eine dokumentierte Zusage war.

Zertifiziert gegen echtes PostgreSQL: `0,30 6-8 * * 1-5` läuft durch
Scheduler, Datenbankfortschritt und Queue — am Dienstag, 4. August 2026, mit
Fortschritt 06:00 und Uhr 06:31 wird genau das 06:30-Vorkommen versendet.
Lokal die Matrix: Listen, Bereiche, Schritte über Bereiche, nur Wochentage,
7 als Sonntag, die ODER-Regel in beiden Richtungen, Jahreswechsel, jede
Minute, und sechs ungültige Formen.

Fund der Mutationsprobe: Der Readiness-Fall des Cron-Stacks („stops
reporting ready when every definition fails") stützte sich darauf, dass
`* * * * *` unlesbar ist. Seit der Grammatik lief diese Definition
**erfolgreich**, und der Fall bestand in Lauf 1 nur, weil die Probe das
anfängliche 503 vor der ersten Runde erwischte — unter der Mutation, mit
anderem Timing, fiel er mit „expected 200 to be 503". Er nutzt jetzt Stunde
24 als echten Fehler (der DB-CHECK prüft nur die Länge) und trägt sich
wieder selbst. Ein Lauf 2 auf dem Zwischenstand fiel am Realtime-Soak (p95
6200 ms > 5000 ms, kurz nach einem Docker-Neustart) — verworfen, archiviert,
nicht abgeschwächt; die drei Endstand-Läufe sind frisch.

Mutationsprobe: Bereichsform `a-b` entfernt — Stack **156 von 157** (der
Zwilling), lokal **1 von 1079** (die Matrix).

Checkpoint `1.87.0` am 24. September 2026: Lokal 1079 bestanden, 0
fehlgeschlagen; PostgreSQL 157 von 157, exit 0, zweimal reproduziert auf
dem Endstand, 44 Migrationen.

Nicht erbracht: keine Namen (JAN, MON), kein `@daily`, kein `L`/`W`/`#`;
alles in UTC, keine Zeitzone je Definition.

## Zeitreihen, bevor sie sich bewegen — Release 1.88

Der Metrics-Export der Queues, letzter Punkt der Queue-Zeile der
Paritätsleiter. `GET …/queues/metrics` liefert Prometheus-Textformat (0.0.4)
über **alle** Queues des Scopes: `qkern_queue_messages` je Queue und Zustand
(available, scheduled, in_flight, completed, dead_lettered) und
`qkern_queue_oldest_available_age_seconds`. Jede Queue erscheint mit allen
fünf Zuständen — auch eine leere, mit 0 statt Abwesenheit: Ein Scraper
braucht die Zeitreihe, bevor sie sich bewegt. Die Zähler entstehen aus
derselben Wahrheit wie `status` (inklusive Lease-Erholung und Aufräumen je
Queue). Die Formatierung ist eine reine Funktion mit maskierten
Label-Werten; die Route hält dieselbe Admin-Grenze wie `status`, antwortet
mit Text und `no-store` und weist Query-Parameter ab.

Zertifiziert gegen echtes PostgreSQL: zwei Queues, eine mit einer wartenden
und einer geleasten Nachricht, eine leer — der Export nennt beide, die leere
mit allen Zählern auf null; ein Worker darf nicht exportieren.

Mutationsprobe: Leere Queues fallen aus dem Export — **157 von 158**, genau
der Export-Fall. Lokal bleibt die Suite unter dieser Mutation grün, weil die
Zusage im Dienst lebt und nur der Real-DB-Fall sie prüft — kein zweiter
Beleg, ehrlich vermerkt.

Checkpoint `1.88.0` am 24. September 2026: Lokal 1083 bestanden, 0
fehlgeschlagen; PostgreSQL 158 von 158, exit 0, zweimal reproduziert, 44
Migrationen.

Nicht erbracht: kein Tracing; keine Prozesszähler des Wirts im Export (nur
Queue-Zustände); eine Queue namens `metrics` verliert den Pfad
`/queues/metrics` an den Export, ihre Unterrouten bleiben.

## Was gelaufen ist, steht — Release 1.89

„Function-Logs als Produktfläche" aus der Paritätsleiter, in der Form, die
QKERN vertreten kann: ein **Aufrufprotokoll** je Function (Migration 0045,
append-only, RLS). Protokolliert wird der Aufruf — Beginn, Dauer, Ausgang,
Statuscode oder ein fester Fehlercode. Bewusst nicht protokolliert werden
stdout und stderr: Sie stammen aus fremdem Code und könnten alles enthalten,
was die Function gesehen hat (die Haltung aus 1.22). Ein Protokollfehler
stürzt den Aufruf nicht — der Container ist gelaufen, seine Wirkung ist da;
der Fehler geht an `onLogFailure`. Route
`GET compute/functions/<id>/invocations`, Admin-Session, `limit` bis 200.

Zertifiziert: gegen echtes PostgreSQL ein gelungener und ein gescheiterter
Aufruf, neueste zuerst, der gescheiterte nur mit festem Code, nur die
Record-Schlüssel; im Functions-Stack der Eintrag eines **echten
Container-Laufs** mit Statuscode 200 und gemessener Dauer — und nichts vom
Inhalt des Containers. Lokal: Erfolg, Scheitern, Protokollfehler ohne
Wirkung auf den Aufruf.

Zwei eigene Testfehler auf dem Weg, beide ehrlich: eine fixierte Uhr für den
scheiternden Dienst machte „neueste zuerst" unprüfbar (dieselbe Lektion wie
1.85), und eine Leck-Prüfung per Regex fand „timeout" im festen Code
`FUNCTION_TIMEOUT` selbst — ersetzt durch Schlüssel- und Alphabetprüfung.

Befund, als Nächstes zu beheben: Ein Lauf 2 fiel mit `remaining connection
slots are reserved for roles with the SUPERUSER attribute` in einem fremden,
bisher stets grünen Fall. Der Zertifizierungs-Postgres läuft mit Standard-
`max_connections=100`, die Suite deklariert 76 Pools mit 233 Verbindungen
und vitest fährt Dateien parallel. Verworfen, archiviert; der Parameter kommt
mit 1.90.

Mutationsprobe: nur noch Erfolge protokolliert — Stack **158 von 159**,
lokal **1 von 1088**, jeweils genau der Scheiter-Fall.

Checkpoint `1.89.0` am 24. September 2026: Lokal 1088 bestanden, 0
fehlgeschlagen; PostgreSQL 159 von 159, exit 0, zweimal reproduziert, 45
Migrationen; Functions-Stack 27 von 27, exit 0, zweimal reproduziert.

Nicht erbracht: keine Inhaltslogs (stdout/stderr), keine Aufbewahrungsregel
für das Protokoll (es wächst), keine Console-Fläche.

## Platz für jeden Pool — Release 1.90

Der Befund aus 1.89, behoben: Der Zertifizierungs-Postgres lief mit der
Voreinstellung `max_connections=100`, während die Suite 76 Pools mit 233
deklarierten Verbindungen öffnet und vitest Dateien parallel fährt. Einmal
riss das — `remaining connection slots are reserved for roles with the
SUPERUSER attribute` in einem fremden, sonst grünen Fall. Jetzt startet der
Cluster mit `max_connections=300` (Compose-Parameter), und ein Real-DB-Fall
prüft `SHOW max_connections` im Lauf: Ein Parameter, den niemand prüft, ist
genau die Art Behauptung, gegen die dieses Projekt seine Mutationsproben
fährt.

Mutationsprobe: Der Parameter aus dem Compose entfernt — **159 von 160**,
genau der Verbindungs-Fall; der Cluster läuft dann wieder mit 100.

Checkpoint `1.90.0` am 24. September 2026: Lokal 1088 bestanden, 0
fehlgeschlagen; PostgreSQL 160 von 160, exit 0, zweimal reproduziert, 45
Migrationen.

Damit ist die lokal belegbare Liste der Paritätsleiter abgearbeitet (1.78
bis 1.90: dreizehn Releases, elf davon mit Real-Service-Zertifizierung).
Offen bleiben Sprosse 7 (SDK/CLI-Publishing mit Multi-OS-Evidenz über CI)
und Sprosse 10 (PITR-/Restore-Drill, SSL-PostgreSQL, belegter Realtime-
Production-Start) — beide brauchen Infrastruktur ausserhalb dieser Maschine.

Nicht erbracht: 300 ist eine gemessene Reserve, keine abgeleitete Grenze —
wächst die Suite weiter, muss der Wert mitwachsen, und der Fall sagt es.

## Die Seite liest, statt abzuschreiben — Release 1.91

Beim ersten Start von QKERN nach dem Umzug fiel es auf: Die Landingpage
zeigte „Prüflauf 6. August 2026 — Control Plane 85 von 85, Storage 2 von 2,
Auth 5 von 5, Functions 22 von 22", während längst 160, 8, 7 und 27 galten.
`STATUS.md` war seit 1.39 durch einen Vertrag an die Manifeste gebunden — die
Seite für Kunden nicht. Auch die Listen `modules` und `gaps` nannten Lücken,
die seit 1.27 (DNS-Pinning), 1.33 (Emitter) und 1.36 (Cluster-Grenze)
geschlossen sind.

Jetzt liest die Seite ihre Zahlen zur Laufzeit aus `docs/evidence/`:
`summarizeCertification` nimmt je Stack den **besten grünen Lauf** (dieselbe
Messvorschrift wie der Zahlen-Vertrag), das Datum des jüngsten grünen Laufs,
und zählt die archivierten Mutationsläufe als Gegenproben. Ein Vertrag
verbietet literale Zählwerte und Daten in `app/page.tsx` und prüft, dass die
gerenderten Zahlen je Stack denen in `STATUS.md` gleichen. `modules` und
`gaps` sind auf den Stand der Paritätsleiter gebracht.

Belegt am laufenden Dev-Server: 160 / 8 / 7 / 27 / 6 / 14, „24. September
2026", 77 Gegenproben. Der neue Vertrag bekam wie die anderen Quellscan-
Verträge ein explizites 30-Sekunden-Budget — beim ersten vollen Lauf riss
die Voreinstellung.

Mutationsprobe: schlechtester statt bester grüner Lauf — **2 von 1093**,
genau der Zusammenfassungs-Fall und der Landingpage-Vertrag.

Checkpoint `1.91.0` am 24. September 2026: Lokal 1093 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert (PostgreSQL 160,
MinIO/ClamAV 8, Mailpit/Dex 7, Functions 27).

Nicht erbracht: `modules` und `gaps` sind weiterhin handgepflegter Text ohne
Vertrag; die Seite liest die Manifeste bei jeder Anfrage (kein Cache).

## Schwebende Flächen — Release 1.92

Redesign von Landingpage, Konto-Seiten und Console nach der Formensprache
einer Framer-SaaS-Referenz: schwebende Kapsel-Navigation mit weichem
Schatten, vollrunde Bedienelemente, Flächen mit Radius 24 px, Pill-Badges
und -Zähler, pastellene Halos — und ein zentrierter Hero, unter dem die
Belegtafel als „schwebendes Dashboard" steht, dazu eine Kennzahlenreihe aus
denselben Manifesten. Das Markenblau und der Light/Dark-Modus bleiben
unverändert die Tokens am Anfang von `globals.css`; die neue Formschicht
liegt am Ende der Datei und überschreibt ausschliesslich Radien, Schatten,
Abstände und Grössen, nie Farbe. Die Console bekam keine Markup-Änderung —
nur gerundete Karten, Navigations-Pills, eine Kapsel-Kopfleiste und lesbare
Schriftgrössen (die alten 7–9 px sind auf 10–13 px gewachsen).

Belegt am laufenden Dev-Server in beiden Modi: Hero, Belegtafel, Kennzahlen,
Feature-Karten, Methode, Preise, Anmeldeseite. Die Console konnte in dieser
Sitzung nicht bebildert werden — sie braucht ein Konto, und Konten lege ich
nicht an; die Sichtprüfung dort steht aus.

Checkpoint `1.92.0` am 24. September 2026: Lokal 1093 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert. Keine eigene
Mutationsprobe: Ein Redesign trägt keine neue Zusage; die Verträge aus 1.91
halten über den Umbau hinweg.

Nicht erbracht: Console nur umgestylt, nicht bebildert; keine Testimonials
oder FAQ wie in der Referenz (QKERN hat keine Kunden, die zitierbar wären —
erfundene Stimmen wären die erste unbelegte Zusage der Seite).

## Die Console sagt, was sie nicht kann — Release 1.93

Nutzerbefund nach dem Redesign, in der Console auf Desktop: unschöne
Scrollleiste, uneinheitliche Buttons, der Kicker „FIRST PROJECT ·
DEVELOPMENT" in Monospace-Versalien, eine Kopfleiste, die beim Scrollen
„hin und her springt", und Buttons und Tabs, die sich nicht klicken lassen.

Vier Ursachen, vier Korrekturen. Die Kopfleiste war seit 1.92 eine
transparente Kapsel, unter der der Inhalt durchscrollte — jetzt wieder eine
volle, geblurrte Leiste. Der Kicker ist Sans in Satzschreibung („First
Project · Development"). Scrollleisten sind schmal und rund, aus den Tokens.
Alle Console-Buttons haben eine Höhe (40 px, vollrund). Und die
nicht klickbaren Elemente waren Attrappen: Backups zeigte erfundene
Wiederherstellungspunkte vom Juli, Settings ein erfundenes Projekt „Nova
Market", dazu Team, Glocke, Filter und Beispiel-Endpunkte ohne Funktion.
Statt sie klickbar zu machen, ohne dass dahinter etwas wäre, sind sie
sichtbar abgeschaltet und sagen im Tooltip, dass sie noch nicht verbunden
sind; Settings liest jetzt den echten Projektnamen und die echte ID, Backups
erklärt, dass es ein WAL-Archiv braucht (Sprosse 10).

Der fünfte Fund ist das „Springen": `.console-root` war ein Grid mit
`auto 1fr`, die Sidebar aber `position: fixed` und damit kein Grid-Item.
Der Arbeitsbereich landete im `auto`-Track, der sich nach dem Inhalt
bemisst, während `1fr` den Rest schluckte — gemessen bei 1440 px: 837 von
1208 px. Jede Ansicht mit anderer Inhaltsbreite verschob so die Kopfleiste.
Das Grid ist weg, der Arbeitsbereich füllt die Breite neben der Sidebar.
Ehrlich: Der Fund wurde zwischendurch für falsch gehalten und der Block
entfernt; erst die Messung im Browser hat ihn bestätigt — ein Screenshot
bei 1000 px Breite hatte die Lücke kaschiert.

Checkpoint `1.93.0` am 24. September 2026: Lokal 1093 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Die abgeschalteten Flächen sind ehrlich, aber leer — Team,
Benachrichtigungen, Filter und Projekt-Einstellungen bleiben zu bauen.

## Der Weg zurück — Release 1.94

Nutzerbefund mit Screenshot: Wer die Sidebar einklappt, kommt nicht mehr
heraus; das Logo führt auf die Startseite statt in die Console; der
Umgebungs-Button oben ist „schlecht design".

Die Sidebar war eine Einbahnstrasse: `.is-collapsed .console-brand button {
display: none }` versteckte genau den Button, der sie wieder öffnet. Jetzt
steht er in der 70-px-Leiste unter dem Symbol, 32 × 32 px, mit Tooltip
„Sidebar ausklappen"; im Browser gemessen: 232 → 70 → 232 px. Das Logo
verlinkt `/console`. Die Umgebungswahl ist ein natives `select` in Sans
(600, 13 px) mit farbigem Status-Punkt und Chevron in einer Pille — die
Rahmenfarbe trägt weiter die Umgebung (grün, gelb, rot).

Checkpoint `1.94.0` am 24. September 2026: Lokal 1093 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Der Zustand der Sidebar wird nicht gespeichert — nach
einem Reload ist sie wieder ausgeklappt.

## Menüs statt Attrappen — Release 1.95

Drei Nutzerbefunde in Folge: Das native Dropdown der Umgebungswahl sah
schlecht aus, der Aufklapp-Pfeil gehörte neben das Symbol, die Sidebar
sollte ihren Zustand merken. Dazu die Frage, wo man Kontoeinstellungen
findet, und dass „Denis.mihaljevic Workspace / First Project" in der
Kopfzeile komisch aussieht. Und der untere Bereich der eingeklappten
Sidebar war unschön.

Das Umgebungsmenü ist jetzt eine eigene Listbox: Status-Punkt, Name,
Hinweistext je Umgebung, Häkchen auf der aktiven, Escape und Klick
ausserhalb schliessen. Der Pfeil steht in der 70-px-Leiste rechts neben dem
Symbol. Der Sidebar-Zustand liegt in `localStorage` und wird erst im Effekt
gelesen, damit Server und Client gleich rendern. Unten in der Sidebar ist
das Konto jetzt ein Menü: E-Mail, Workspace, Konto- und
Workspace-Einstellungen sichtbar abgeschaltet („Bald", noch nicht
verbunden) und Abmelden — die ehrliche Antwort auf die Frage nach den
Kontoeinstellungen ist: es gibt sie noch nicht. Die Krume zeigt den
automatisch aus der E-Mail gebildeten Workspace-Namen lesbar („Denis
Mihaljevic" mit Etikett „Workspace"), drei Fälle in
`tests/workspace-name.test.ts`. Der untere Bereich der eingeklappten
Leiste hat einheitliche 46-px-Kacheln, keine Scrollleistenpfeile, und die
Next-Dev-Anzeige liegt nicht mehr über dem Kontomenü.

Ehrlich: Die Änderung an `next.config.ts` hat den Dev-Server neu gestartet,
und der Memory-Auth-Adapter (Default ohne `.env.local`) hat dabei alle
Konten und Sessions verloren. Die Sichtprüfung des unteren Bereichs und
des Kontomenüs im Browser steht deshalb aus; die Masse sind aus dem CSS
abgeleitet, nicht gemessen.

Checkpoint `1.95.0` am 24. September 2026: Lokal 1096 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Konto- und Workspace-Einstellungen bleiben zu bauen; der
Memory-Adapter vergisst Konten bei jedem Serverneustart.

## Bewegung beim Scrollen — Release 1.96

Nutzerwunsch: Scroll-Effekte auf der Frontpage wie in der Referenz, und bei
den Preisen „CHF" statt des komischen Zeichens, aufgebaut genau wie dort.

Die Referenz blendet Abschnitte beim ersten Sichtkontakt ein und zählt
Kennzahlen hoch. Beides ist jetzt in `components/reveal.tsx`: `Reveal`
beobachtet mit `IntersectionObserver` und setzt `data-in`; Kinder eines
gestaffelten Containers folgen mit 70 ms Abstand. `CountUp` zählt ab halber
Sichtbarkeit in 1,4 s mit kubischem Auslauf hoch. Ohne JavaScript bleibt
alles sichtbar, weil die Ausblendung nur unter `html[data-reveal="on"]`
greift; `prefers-reduced-motion` schaltet beides ab. Die Preise stehen in
drei gleichen Karten wie in der Referenz: Name, „CHF 0" mit „/pro Monat",
Beschreibung, voller Button, gepunktete Linie, Häkchenliste — das
Franken-Icon ist weg.

Ehrlich: Beim ersten Browsertest blieben die Zähler bei 3, 0 und 0 stehen.
Ursache war nicht der Code allein, sondern der Hintergrund-Tab:
`requestAnimationFrame` pausiert dort, und der Zähler wartete auf einen
Takt, der nicht kam. Der Endwert wird jetzt zusätzlich per Timeout gesetzt
— eine Kennzahl darf nie unter ihrem Beleg stehen bleiben. Im
Vordergrund-Tab gemessen: 7 → 145 → 160. Ein erster Umbau-Skript brach vor
dem CSS ab (Assertion nach dem Schreiben statt davor); der Browser zeigte
das sofort, weil die Regel `data-reveal` im Stylesheet fehlte.

Checkpoint `1.96.0` am 24. September 2026: Lokal 1096 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` exit 0; Stacks
unverändert.

Nicht erbracht: Die Referenz animiert zusätzlich Wort für Wort im Hero;
QKERN behält dort die Ladeanimation aus 1.92.

## Grosse Zahlen, kleines Menü — Release 1.97

Drei Nutzerbefunde mit Screenshot: Die Kennzahlen unter dem Hero waren
winzig, das Plus stand in einer eigenen Zeile, und „der Effekt ist nicht
da"; auf dem Telefon fehlte der Website das Hamburger-Menü; und in der
Console ergab der Ein-/Ausklapp-Pfeil der Sidebar auf dem Telefon keinen
Sinn.

Die winzige Zahl war ein Selektor: `.stat span` — gedacht fürs Label —
traf seit 1.96 auch den Zähler-Span in `strong`, machte ihn 13,5 px und
`display: block`. Jetzt gilt `.stat > span` fürs Label, der Zähler erbt die
Schrift, die Zahl ist 44 bis 64 px. Im Vordergrund-Tab gemessen: 62 → 106
→ 136 → 160 in 1,4 s. Das Hamburger-Menü (`components/site-menu.tsx`)
erscheint unter 1000 px, dort, wo die Desktop-Navigation verschwindet: ein
Blatt unter der Kapsel mit allen Ankern, Anmelden und Projekt erstellen;
Escape, Klick auf einen Eintrag, Klick daneben und Wechsel auf
Desktop-Breite schliessen es, der Body scrollt derweil nicht. Nach dem
ersten Screenshot des Nutzers noch nachgezogen: Die Abdunkelung lag mit
Blur über der Kapsel selbst (Logo verschwommen) — Blatt und Abdunkelung liegen
jetzt per Portal ausserhalb der Kopfzeile, unter deren Stapel (z 48/49
gegen 50), die Kapsel bleibt scharf und ungedimmt; der Button-Text im Menü
erbte die Menüfarbe statt Weiss; die Einträge sind 19 px halbfett. Im Browser
bei 375 px geprüft: Knopf 44 × 44 px, Menü öffnet, Klick auf „Produkt"
schliesst und springt zu `#product`. In der Console zeigt die Sidebar auf
dem Telefon ein Schliessen-Kreuz statt des Pfeils, und ein zuvor auf
Desktop gemerkter eingeklappter Zustand wird unter 760 px neutralisiert —
die Schublade ist immer voll breit.

Checkpoint `1.97.0` am 24. September 2026: Lokal 1096 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Das Schliessen-Kreuz der Console ist nicht im Browser
geprüft — ohne Konto (siehe 1.95) bleibt die Console zu.

## Texte ohne Tells — Release 1.98

Denzil hat den Skill `humanizer` installieren lassen (GitHub blader/humanizer
3.0.0, um einen deutschen Abschnitt ergänzt) und die Landingpage damit
überarbeiten lassen. Zwölf Passagen in `app/page.tsx`, nur Prosa.

Was gefunden wurde: zwei Absätze, die ihre Überschrift wiederholten (Hero,
Entwickler); ein Eyebrow und eine Überschrift mit demselben Wortlaut
(„Was noch fehlt"); eine inszenierte Pointe („Sie hier wegzulassen wäre
die erste unbelegte Zusage der Seite"); Werbeton bei den Preisen („Preise,
die mit dir wachsen"); sechsmal „echtes" in einem Satz; Nominalstil und
Passiv in der Entwurfsnotiz („sind zu validieren", „werden geprüft"); ein
Nicht-X-sondern-Y als Schlussparole („Baue den Kern. Nicht die
Infrastruktur."). Behalten wurde, was eine Behauptung des Lesers
korrigiert: „Ein grüner Testlauf ist keine Zertifizierung."

Keine Zahl und kein Datum kam hinzu oder fiel weg; der Vertrag
`landing-numbers-contract` ist grün.

Checkpoint `1.98.0` am 24. September 2026: Lokal 1096 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Login, Registrierung und Console-Texte sind noch nicht
durch den Skill gelaufen.

## Die Console spricht Deutsch — Release 1.99

Denzils Auftrag: die Console auch durch den Skill `humanizer`. Beim Lesen
zeigte sich zuerst etwas anderes: Die Console mischte Englisch (Kern seit
dem MVP) mit Deutsch (Freigabemodus, Rechnungen, die Platzhalter aus 1.93
bis 1.95). Entscheidung: durchgehend Deutsch, Produktbegriffe bleiben
englisch — Table Editor, SQL Editor, Change Set, RLS, Storage, Functions.
Rund 200 Zeichenketten in `console-app.tsx`, jede Ersetzung per Assertion
eindeutig verankert.

Der zweite Fund wog schwerer als die Sprache. Die Console zeigte Werte,
die kein Dienst liefert: „+18.2 %" und „3.4 % used" an den Kacheln, 24
Balken Verlauf, „p95 184 ms", Latenzen von fünf Diensten, eine Datenbank
„nova-market-dev" in „ch-zrh-1" mit Pool 12/100, sechs Demo-Tabellen mit
Zeilenzahlen, zwei „verbundene" Agenten mit „letztem Aufruf vor 4 min",
Badges 2 und 1 in der Navigation. Der Skill sagt: nichts erfinden. Dieselbe
Regel wie in 1.93: Was nicht verbunden ist, sagt das jetzt selbst. Die
Kacheln zeigen die Werte aus dem Projektdatensatz ohne erfundene Deltas;
Verlauf, Dienststatus, Datenbank-Provisionierung und Agentenverbindung sind
Platzhalterkarten; die Datenbank-Ansicht verweist auf den Table Editor, der
wirklich live liest. Das Freigabe-Badge zählt die echten offenen Freigaben,
der Projekt-Umschalter zeigt den echten Workspace, die Statuspille
„Verbunden" erscheint nur, wenn der Snapshot geladen ist. `demoTables`,
`TableList` und die unbenutzte `ApiView` sind weg.

Im Browser geprüft, in Denzils angemeldeter Session: Navigation,
Übersicht, Datenbank, AI Bridge, Freigabezentrale und Einstellungen zeigen
die neuen Texte; das Schliessen-Kreuz der Sidebar aus 1.97 ist auf dem
Telefon sichtbar (Pfeil ausgeblendet, Kreuz `display: flex` bei 500 px).

Checkpoint `1.99.0` am 24. September 2026: Lokal 1096 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Login und Registrierung sind noch nicht durch den Skill
gelaufen; Rollen wie „Owner" und Statuswerte aus der API (active, pending,
delivered) bleiben englisch, weil sie Werte sind, keine Texte.

## Das Menü von Supabase — Release 2.0

Denzils Auftrag: Supabase durchsuchen und alles, was QKERN fehlt, als
Platzhalter einfügen, damit es danach Stück für Stück gebaut werden kann.
Statt durch das eingeloggte Dashboard zu klicken, habe ich das
Routen-Verzeichnis von Supabase Studio gelesen: `apps/studio/pages/project/
[ref]` im Repo supabase/supabase, über den GitHub-Tree, am 24. September
2026. 18 Verzeichnisse, rund 90 Seiten.

`components/console/navigation.ts` bildet das ab: 19 Gruppen, davon 12 mit
Untermenü; 15 echte Ansichten bleiben, 83 Platzhalter kommen dazu. Jeder
Platzhalter sagt, wie die Seite bei Supabase heisst, ob QKERN das Backend
dazu hat (vorhanden, teilweise, fehlt) und was genau fehlt — etwa dass
Queues, Migrationen, Realtime-Inspector und Function-Aufrufe im Backend
zertifiziert sind und nur die Ansicht fehlt, während Trigger, Enum-Typen,
Passkeys oder Wrappers gar kein Backend haben. Die Platzhalterseite zeigt
das und die Nachbarn der Gruppe; die Suche findet alle Einträge
(„Datenbank · Trigger").

Der Vertrag `console-navigation-contract` hält es zusammen: jedes
Studio-Verzeichnis hat eine QKERN-Gruppe, jede Ansicht steht genau einmal,
jede Erklärung hat mindestens 40 Zeichen. Er fand beim ersten Lauf zwei
Fehler: Backups stand doppelt (Gruppe und Unterpunkt von Datenbank, wie bei
Supabase), und zehn Erklärungen waren Einzeiler ohne Inhalt.

Im Browser, in Denzils Session, geprüft: Gruppe Datenbank klappt 18
Unterpunkte auf, Trigger öffnet die Platzhalterseite mit „Backend fehlt",
die Suche findet den Eintrag.

Checkpoint `2.0.0` am 24. September 2026: Lokal 1100 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: 83 Platzhalter sind 83 offene Ansichten. Die Reihenfolge
ist Denzils Entscheidung; das Backend-Urteil sagt, wo es schnell geht.

## Gruppen, die zugehen — Release 2.1

Nutzerbefund direkt nach 2.0: Die Sidebar-Gruppen liessen sich nicht
schliessen, und bei längeren Namen verschwanden die Pfeile.

Zwei Ursachen. Der Zustand „geschlossen" war ein leerer String, und ein
leerer String ist in JavaScript falsch — die Bedingung fiel deshalb auf
„die aktive Gruppe ist offen" zurück, und genau die aktive Gruppe liess
sich nie schliessen. Jetzt hält eine Menge die offenen Gruppen; jede lässt
sich per Klick auf den Kopf öffnen und schliessen, und die aktive Gruppe
öffnet sich per Effekt, wenn die Ansicht wechselt (Suche, Nachbarn,
Gruppenwechsel). Die Pfeile verschwanden, weil die Beschriftung nicht
umbrach und nicht kürzte und den Pfeil bei 232 px aus der Leiste schob;
jetzt nimmt der Text den Rest, kürzt mit Ellipse, und der Pfeil hat feste
Breite.

Im Browser, in Denzils Session, gemessen: alle zwölf Pfeile liegen
innerhalb der Leiste; Datenbank und Functions & Jobs öffnen und
schliessen je zweimal.

Checkpoint `2.1.0` am 24. September 2026: Lokal 1100 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

## Vier Sprachen — Release 2.2

Denzils Auftrag: die Website mehrsprachig, DE, EN, FR, IT. Der Weg: ein
Cookie statt Pfaden wie `/en`, damit Anker, Links und die bestehenden
Routen unverändert bleiben. Beim ersten Besuch entscheidet der
Accept-Language-Header des Browsers, danach die Wahl in der Kopfzeile; die
Sprachwahl schreibt das Cookie und lässt den Server die Seite neu rendern,
ohne Reload. Die Console bleibt deutsch.

Die Texte liegen in typisierten Wörterbüchern (`lib/i18n/landing.ts`,
`lib/i18n/auth.ts`); Deutsch ist die Vorlage, die drei anderen sind
Übersetzungen davon. Zahlen und Daten kommen weiter aus den Manifesten;
deren deutsche Namen („Control Plane und Data API", „MinIO und ClamAV")
übersetzt eine kleine Abbildung je Sprache, fehlt ein Eintrag, bleibt das
Original. Das Datum des Prüflaufs folgt der Sprache: „24. September 2026",
„September 24, 2026", „24 septembre 2026", „24 settembre 2026".

Der Vertrag `i18n-contract` prüft fünf Dinge: jede Sprache hat dieselbe
Struktur wie Deutsch, kein Text ist leer, kein Text ist nur die deutsche
Vorlage (Eigennamen und Produktbegriffe ausgenommen), die
`{n}`-Platzhalter stimmen überein, und die Browser-Erkennung fällt bei
Spanisch oder Portugiesisch auf Deutsch zurück. Ein erster Entwurf des
Vertrags verglich auch die Namensabbildung und scheiterte, weil sie im
Deutschen absichtlich leer ist; sie ist jetzt ausgenommen.

Im Browser geprüft: Der Testbrowser bekam ohne Cookie Englisch (seine
Sprache), Cookie `fr` lieferte die französische Anmeldeseite, Cookie `it`
die italienische Startseite, und der Klick auf „Deutsch" im Menü schaltete
ohne Reload zurück. `next build` exit 0.

Checkpoint `2.2.0` am 25. September 2026: Lokal 1105 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Die Übersetzungen hat niemand gegengelesen, der Deutsch
und die Zielsprache spricht; die Console ist nur deutsch; es gibt keine
Sprach-URLs für Suchmaschinen.

## Die Console in vier Sprachen — Release 2.3

Zwei Nutzerbefunde: Der Sprachknopf der Website sah schlecht aus (Globus
über dem Kürzel gestapelt, weil er das Raster des Icon-Buttons erbte), und
in der Console sollte die Sprache ebenfalls wählbar sein.

Der Knopf ist jetzt eine Pille mit Globus und Kürzel nebeneinander. Die
Console spricht Deutsch, Englisch, Französisch und Italienisch: Jeder Text
in `console-app.tsx` steht als `t("deutscher Text")`, der deutsche Text ist
der Schlüssel und kann nie fehlen. Die Umstellung lief per Skript mit
einem anführungszeichenbewussten Scanner statt einer Regex; ein erster
Regex-Versuch hatte Anführungszeichen verschoben und die Datei beschädigt
— zurück zur Sicherung, Scanner, neu. Ein zweiter Fund im eigenen Skript:
ein Patch hatte `` als Backspace-Zeichen in die Ausschluss-Regex
geschrieben, weshalb bereits umhüllte Texte ein zweites Mal umhüllt
wurden; der Vertrag hätte es nicht gesehen, der Typecheck schon.

Die aktive Sprache liegt in einer Modulvariablen, die `ConsoleApp` zu
Beginn jedes Renderns setzt — bewusst kein Context, weil rund dreissig
kleine Komponenten `t` direkt aufrufen und React einen Baum synchron von
oben nach unten rendert. Navigation, Platzhalter und Suche übersetzen am
Render; die Suche findet deutsche und übersetzte Namen. 454 Übersetzungen
je Sprache in `lib/i18n/console.ts`.

Der Vertrag `console-i18n-contract` liest alle `t("…")`-Aufrufe und alle
Navigationstexte aus dem Code und verlangt für jeden alle drei Sprachen,
ohne verwaiste Einträge und mit gleichen Auslassungspunkten und
Leerzeichen am Rand. Er war beim ersten Lauf grün.

Im Browser, in Denzils Session, geprüft: Sprachwahl in der Kopfleiste auf
Englisch stellt Navigation, Titel und Karten um, zurück auf Deutsch ebenso.

Checkpoint `2.3.0` am 25. September 2026: Lokal 1108 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Werte aus der API (`active`, `delivered`, Modusnamen im
Audit) bleiben Daten; Datumsformate der Console bleiben `de-CH`; niemand
hat die Übersetzungen gegengelesen.

## Knöpfe, die stillhalten — Release 2.4

Zwei Nutzerbefunde. Das Schliessen-Kreuz der Sidebar erschien auf dem
Desktop neben dem Pfeil; und Buttons sollen ihre Grösse nie ändern, wenn
ihre Beschriftung wechselt — Denzil: „du machst das fast jedesmal, schreib
das in die memories". Es steht jetzt im Gedächtnis (`stable-button-widths`).

Das Kreuz: Die Regel von 1.94 (`.console-brand button { display: flex }`)
schlug die von 1.97 (`.sidebar-close { display: none }`) in der
Spezifität. Jetzt `.console-brand .sidebar-close`, auf dem Telefon
umgekehrt. Denzil sah das Kreuz danach noch im eingeklappten Zustand: dort
lag eine dritte Regel (`.is-collapsed .console-brand button`) noch darüber;
jetzt `.console-sidebar .console-brand button.sidebar-close`. Im Browser bei
1280 px gemessen: ausgeklappt und eingeklappt kein Kreuz, bei 375 px Kreuz
statt Pfeil; Sprachknopf und Umgebungsmenü behalten beim Wechsel auf
Französisch die Breite (63 und 148 px).

Die Breite: `components/stable-label.tsx` legt alle Varianten einer
Beschriftung in dieselbe Grid-Zelle, nur die aktive ist sichtbar, die
anderen nehmen unsichtbar Platz. Die Breite ist damit immer die der
längsten Variante, über Zustände und Sprachen hinweg; `tAll()` liefert
einen Text in allen vier Sprachen. Angewandt auf den Sprachknopf, auf
Anmelden und Projekt erstellen in der Kopfzeile, auf das Umgebungsmenü
und auf jeden Zustandswechsel in der Console.

Dabei fanden sich fünf Zustandswechsel mit nackten deutschen Literalen,
die der Scanner von 2.3 übersprungen hatte, weil sie ein Wort ohne Umlaut
waren („Pausieren", „Aktivieren", „Deaktivieren", „Zustellstatus"). Jetzt
übersetzt, zehn neue Schlüssel, der Vertrag ist grün.

Checkpoint `2.4.0` am 25. September 2026: Lokal 1108 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Navigations-Buttons bleiben volle Breite; Beschriftungen
in Tabellen (Statuswerte) sind Daten und nicht reserviert.

## Das Flyout — Release 2.5

Denzils Befund: Im eingeklappten Zustand sind die Untermenüs unsichtbar.
Im Brainstorming standen drei Varianten im Browser: ein Flyout am Icon (wie
Supabase Studio), eine zweite Spalte (wie VS Code) und ein kurzes
Aufklappen der ganzen Leiste. Gewählt: das Flyout, per Hover mit
Verzögerung und per Klick, Gruppen ohne Unterpunkte wechseln direkt, und
das Flyout schliesst bei Wahl, Escape, Klick ausserhalb und nach einer
Gnadenfrist beim Verlassen mit der Maus. Der Entwurf liegt unter
`docs/superpowers/specs/`.

`components/console/sidebar-flyout.tsx` kapselt Icon-Button und Flyout je
Gruppe: 150 ms Hover-Verzögerung, 250 ms Gnadenfrist, 220 px breit, per
Portal `position: fixed` rechts neben dem Icon, innen scrollbar bis
Fensterhöhe minus Rand, und nach dem Rendern nach oben verschoben, wenn es
unten hinausragte. Pfeiltasten bewegen den Fokus, Escape schliesst und gibt
den Fokus ans Icon zurück. Auf dem Telefon bleibt das Untermenü inline,
weil die Schublade voll breit ist.

Im Browser bei 1280 × 720 gemessen: zwölf Flyout-Gruppen, keine
Inline-Untermenüs; Klick öffnet, Escape schliesst, Wahl eines Unterpunkts
wechselt die Ansicht („Einstellungen · Infrastruktur") und schliesst; Auth
zeigt 16 Einträge, Unterkante 708 bei 720 Fensterhöhe; das Flyout von
Einstellungen (Icon bei 559) rutscht auf 237, damit es im Fenster bleibt.
Bei 375 px: kein Flyout, zwölf Inline-Untermenüs. Hover: bei 60 ms noch
zu, bei 260 ms offen; beim Wechsel aufs Flyout bleibt es offen; nach dem
Verlassen 150 ms später noch offen, nach 350 ms zu. Zwei Prüfversuche davor
zeigten kein Flyout und waren Fehler des Tests, nicht des Codes: React
leitet `onMouseEnter` aus dem `mouseout` des verlassenen Elements ab, und
der `body` ist in Next ein React-Element; ein synthetisches `mouseenter`
oder ein `mouseover` allein erreicht den Handler nicht. Das Datenbank-Flyout
mit 18 Einträgen rutscht bei 720 px Fensterhöhe von 252 auf 21.

Checkpoint `2.5.0` am 25. September 2026: Lokal 1110 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: Das Flyout merkt sich nichts; bei sehr kleiner Fensterhöhe
scrollt es, statt sich zu teilen.

## Queues in der Console — Release 2.6

Denzils Auftrag „mach 1–3": zuerst die vier Ansichten, die nur eine
Oberfläche brauchen. Queues zuerst, weil Backend und Metrics-Export dort am
vollständigsten sind (1.88).

`components/console/queues-view.tsx` liest live die Admin-Routen unter
`/queues`: die Liste der Queues mit ihren Regeln (Einreihrecht, Versuche,
Lease, Retry-Fenster, Dedupe), je Queue den Status (wartend, in
Bearbeitung, erledigt, Dead Letters, älteste wartet seit), die Dead Letters
mit Versuch, Fehlercode und Zeitpunkt sowie dem Wiedereinreihen, das die
Replay-Route ruft. Eine Queue anlegen geht per Prompt mit der Regel der
Route. Der Metrics-Export ist als Endpunkt genannt, weil ein Scraper Text
will, nicht die Console. Payloads erscheinen nie. Der Platzhalter
`int-queues` ist damit eine echte Ansicht.

Der i18n-Vertrag las bisher nur `console-app.tsx`; seit 2.6 liest er jede
`.tsx` in `components/console`, damit ausgelagerte Ansichten nicht stumm
auf Deutsch zurückfallen. Er fand beim ersten Lauf die verwaiste Erklärung
des Platzhalters und einen fehlenden Schlüssel („Versuch"), beides
behoben; 37 neue Schlüssel in drei Sprachen.

Ehrlich: Die Sichtprüfung im Browser steht aus. Während des Slices hat die
App den Dev-Server neu gestartet; die Memory-Session ist mit dem alten
Prozess gestorben, und die Console meldet „Console-Daten nicht verfügbar",
bis sich Denzil neu registriert. Die Ansicht ist per Typecheck und Vertrag
geprüft, nicht mit echten Queues im Browser.

Checkpoint `2.6.0` am 25. September 2026: Lokal 1110 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: kein Einreihen von Nachrichten aus der Console (das ist
Sache der Anwendung mit ihrem Key), keine Zeitreihe der Queue-Tiefe.

## Drei Ansichten mehr — Release 2.7

Die restlichen drei Ansichten mit zertifiziertem Backend, Punkt 1 von
Denzils „mach 1–3".

Migrationen (`migrations-view.tsx`) hat drei Quellen, alle vorhanden: die
Change Sets des Projekts aus dem Console-Snapshot, vom Entwurf bis
angewendet, mit Risiko, Agent, Diff-Zeilen und Rollback; die
Migrations-Reviews, also Läufe, deren Ausgang der Worker nicht selbst
klären konnte, mit Abgleich- und Zyklus-Zähler; und die Vorfälle mit dem
Stand ihrer Zustellung. Alles je Umgebung gefiltert, nur lesend.

Function-Aufrufe (`invocations-view.tsx`) listet die Functions der
Umgebung und je Function das Aufrufprotokoll der Route aus 1.89: Zeit,
Auslöser, Dauer, Ausgang, Statuscode oder Fehlercode, neueste zuerst; dazu
Fehlerquote und mittlere Dauer der geladenen Aufrufe. Ohne stdout und
stderr, wie die Route.

Der Realtime-Inspector (`realtime-inspector-view.tsx`) ist ein reiner
Browser-Client für das Protokoll `qkern.realtime.v1`: Server-URL, Projekt-
Key, Kanal; verbinden, anmelden, abonnieren, Broadcast senden, alles
Empfangene im Protokoll. Der Key bleibt in der Browser-Sitzung und geht
nur an den Realtime-Server; die Console speichert ihn nicht. Der
Realtime-Server ist ein eigener Prozess (`workers/realtime-runtime.mts`,
Port 8788) und läuft im Dev-Setup nicht von allein; der Inspector sagt
das, wenn die Verbindung scheitert.

Der i18n-Vertrag fand drei verwaiste Erklärungen und 85 fehlende
Schlüssel, alle ergänzt.

Ehrlich: Die Sichtprüfung im Browser steht für alle drei aus, aus demselben
Grund wie in 2.6: Die Memory-Session ist mit dem Neustart des Dev-Servers
gestorben. Der Realtime-Inspector ist ausserdem gegen keinen laufenden
Realtime-Server geprüft; das Protokoll stammt aus `protocol.ts` und
`model.ts`, nicht aus einem Handschlag.

Checkpoint `2.7.0` am 25. September 2026: Lokal 1110 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: kein Reconciliation-Antrag aus der Migrationen-Ansicht,
keine Presence-Anzeige als Liste im Inspector, keine Zeitreihe der
Aufrufdauer.

## Derselbe Fehler, andere Klasse — Release 2.8

Die Console zeigte in Denzils Session „Console-Daten konnten nicht geladen
werden", und `/api/v1/console` antwortete 500, im Serverlog abwechselnd
mit 200. Die Route schwieg dazu, sie fing alles und gab 500 zurück. Erste
Massnahme: eine Logzeile vor dem 500. Sie zeigte `AuthError:
INVALID_SESSION` aus `getSession`, also genau den Fall, den
`authenticatedContext` in einen 401 übersetzen soll, und zwar mit
`instanceof AuthError`.

Der Grund, warum das fehlschlug: Die Auth-Laufzeit liegt im Dev-Modus auf
`globalThis`, damit die Memory-Konten Hot-Reloads überleben. Die Klasse
`AuthError` wird bei jedem Reload neu geladen. Ein Fehler, den die alte
Laufzeit wirft, ist für das `instanceof` der neuen Route ein Fremder, und
aus 401 wurde 500. Das erklärt die Abwechslung im Log: nach jedem Edit an
Serverdateien bis zum nächsten vollen Neustart. Der Stack zeigte die
Datei einmal als `C:\Projekte\qkern\…` und einmal ohne Präfix, zwei
Modulgraphen.

Jetzt prüft `isAuthError(error, code)` Name und Code statt der
Klassenidentität, an allen sechs Stellen. Der Test
`auth-error-identity` wirft eine fremde Kopie der Klasse und verlangt,
dass sie erkannt wird, und dass ein blosser `Error` mit gleichem Text
nicht erkannt wird. Im Browser danach: `/api/v1/console` und
`/api/v1/auth/session` antworten 401, `/console` leitet zum Login.

Dazu Punkt 3 aus „mach 1–3": Die offenen Sidebar-Gruppen werden in
`localStorage` gemerkt wie die Sidebar-Breite; die Register-Parole „Bau
den Kern. Behalte die Kontrolle." ist ein Satz geworden. Die
Übersetzungen hat weiterhin niemand gegengelesen, der die Sprache spricht;
das kann ich nicht ersetzen.

Ehrlich: Die Notizen zu 2.6 und 2.7 nannten „die Memory-Session ist weg"
als Grund für die ausstehende Sichtprüfung. Das war nur die halbe
Wahrheit; dazwischen lag dieser Fehler. Nach dem vollen Neustart ist die
Session tatsächlich weg, deshalb steht die Sichtprüfung der vier
Ansichten weiter aus, bis Denzil sich neu registriert.

Checkpoint `2.8.0` am 25. September 2026: Lokal 1113 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert (kein
Real-DB-Pfad berührt; die Änderung liegt in der Fehlerabbildung).

Nicht erbracht: Dieselbe Falle droht bei jedem anderen Fehlertyp, der aus
einer auf `globalThis` gehaltenen Laufzeit geworfen wird; geprüft ist nur
Auth.

## Trigger aus dem Katalog – Release 2.9

Punkt 2 von Denzils „mach 1–3“: die Funktionen von Supabase Studio
übertragen. Nicht deren Code, der an pg-meta hängt, sondern das Verhalten:
pg-meta ist ein Satz Katalogabfragen, und QKERN hat mit `/schema` schon
eine. Die erste neue Objektart sind die Trigger.

`inspectTriggers` im Data-Plane-Port läuft durch denselben Weg wie die
Schemaabfrage: `BEGIN READ ONLY`, Rollen- und Datenbankgrenze geprüft,
Timeouts gesetzt. Die Abfrage ist aus `triggers.sql` von
supabase/postgres-meta (Apache 2.0) abgeleitet und auf `pg_catalog`
reduziert, weil `information_schema.triggers` nur Trigger auf Tabellen
zeigt, an denen die Rolle Rechte hat, und je Ereignis eine Zeile liefert.
Stattdessen entscheiden die Bits in `tgtype` über BEFORE, AFTER oder
INSTEAD OF, ROW oder STATEMENT und die vier Ereignisse; die
WHEN-Bedingung kommt aus `pg_get_triggerdef`, interne Trigger der
Fremdschlüssel bleiben draussen, die Liste endet bei 200 mit ehrlichem
`truncated`. Die Route `GET /schema/triggers` geht durch dieselbe Tür wie
`/schema`: Session mit Leserecht oder scope-gebundener Projekt-Key. Die
Console zeigt die Trigger des Schemas `public` mit Filter; anlegen läuft
weiter über ein Change Set.

Der Real-DB-Fall legt fünf Trigger an: einen mit drei Ereignissen, einen
auf Anweisungsebene bei TRUNCATE, einen abgeschalteten mit WHEN, einen
INSTEAD OF auf einem View, und einen Fremdschlüssel, dessen interner
Trigger nicht erscheinen darf. Fake-Client-Fälle prüfen Decodierung,
Abschneiden bei 201 Zeilen, Abweisung fremder Werte und den
abgeschalteten Zustand; Routen-Fälle die Tür.

Gegenprobe: Der Filter `NOT tgisinternal` fällt aus der Abfrage. 160 von
161, genau der Trigger-Fall, weil der Fremdschlüssel-Trigger erscheint.

Checkpoint `2.9.0` am 25. September 2026: PostgreSQL-17-Stack 161
bestanden, 0 fehlgeschlagen, zweimal; Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert.

Nicht erbracht: Nur Trigger; Funktionen, Indizes, Enum-Typen,
Erweiterungen, Rollen, Policies, Publikationen und Spaltenrechte folgen
nach demselben Muster. Nur das Schema `public` in der Console. Die
Sichtprüfung im Browser steht aus, bis sich Denzil neu registriert.

## Das Q-Feld – Release 2.10

Denzils Wunsch: eine Animation im Hintergrund mit dem Q-Logo, wie bei der
Referenz, oder eine, die mit der Maus interagiert. Die Referenz hat im Hero
keinen bewegten Hintergrund, nur den Glanz; das Q-Feld ist deshalb eine
eigene Antwort: sieben blasse Q-Symbole, der Pfad aus dem Marken-SVG
inline gezeichnet, an festen Positionen, damit Server und Client dasselbe
rendern. Sie treiben per CSS-Keyframe langsam (17 bis 34 Sekunden, jede
anders), weichen der Maus je Tiefe aus, und ein weicher Lichtfleck folgt
dem Zeiger und hellt die Symbole auf.

Die Maus geht über zwei CSS-Variablen an die Symbole; ein einziger
rAF-Loop dämpft die Bewegung und hält an, sobald nichts mehr zu
glätten ist. Nur Zeiger mit `hover: hover` bekommen die Parallaxe,
`prefers-reduced-motion` schaltet Drift und Parallaxe ab, auf dem Telefon
bleiben vier Symbole in kleinerer Grösse. Der Inhalt liegt über dem Feld
(`z-index` 1 auf der Hülle), das Feld nimmt keine Klicks an.

Im Browser bei 1280 px gemessen: sieben Symbole mit laufender Animation,
Transformationen ändern sich nach einer Mausbewegung, der Lichtfleck geht
von Deckkraft 0 auf 0,89 und wandert mit dem Zeiger, die Hülle liegt
über dem Feld.

Checkpoint `2.10.0` am 25. September 2026: Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unverändert.

Nicht erbracht: kein Bezug auf die Scrollposition; die Positionen sind
handgesetzt, nicht nach Textbreite berechnet.

## Der Q-Orbit – Release 2.11

Denzils Referenz: der Hero auf nexalead.framer.ai, ein Partikelring, der
mit der Maus interagiert, bei QKERN mit dem Q in der Mitte. Ein Canvas
zeichnet rund 1400 Partikel auf drei gleich geneigten Bahnen, alle in
einer Richtung, innen schneller als aussen; hinten sind sie kleiner und
blasser, das Q steht still mit weichem Halo. Die Maus kippt den ganzen
Ring sanft, Partikel in Zeigernaehe weichen aus und kehren zurueck.

Zweimal kam "es bewegt sich komisch". Beim ersten Mal drehten die drei
Bahnen in verschiedene Richtungen, wackelten und das Q drehte mit. Beim
zweiten Mal blieb eine Eigendrehung der Blickachse, die den geneigten Ring
taumeln liess wie einen Kreisel. Jetzt steht die Bahn fest, nur die
Partikel laufen darauf, und nur die Maus kippt sie.

Layout nach Denzils Wunsch: ab 961 px steht der Text links und der Orbit
gross rechts (bis 720 px), der Pruefbericht darunter ueber beide Spalten;
auf dem Handy bleibt es wie zuvor, zentriert mit dem Orbit hinter der
Ueberschrift. Das Q-Feld aus 2.10 ist entfernt, samt CSS.

Stillhalten: `prefers-reduced-motion` zeichnet ein Bild; ausserhalb des
Sichtfelds pausiert die Schleife; nur Zeiger mit Hover bekommen die
Interaktion. Rein dekorativ, `aria-hidden`, keine Klicks.

Im Browser bei 1280 px gemessen: Ueberschrift linksbuendig ab x 45, Canvas
rechts ab x 687 mit 578 px Kante, Canvas bemalt.

Checkpoint `2.11.0` am 25. September 2026: Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen; Stacks
unveraendert.

Nicht erbracht: kein Test fuer die Canvas-Bewegung selbst (Vitest hat kein
Canvas); der Ring ist Denzils Auge noch nicht vorgefuehrt worden.

## Wie Menschen reden – Release 2.12

Denzil zur Hero-Zeile "Backend-Bausteine, die ihre Zusagen belegen": so
reden keine Menschen. Stimmt. Die Zeile personifiziert Software und traegt
zwei Substantive, die niemand im Gespraech benutzt. Neu: "Dein Backend.
Getestet, bevor du es anfasst." Der Lead nennt die Teile mit
Alltagswoertern, Login statt Auth, Dateien statt Storage, und sagt, wo die
Logs liegen. Gleiche Zeile in Englisch, Franzoesisch und Italienisch, im
Seitentitel, in der Beschreibung und in der Fusszeile.

Checkpoint `2.12.0` am 25. September 2026: Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Stacks unveraendert.

Nicht erbracht: die uebrigen Ueberschriften der Seite sind nicht neu
geprueft, nur der Hero.

## Eine Schrift – Release 2.13

Denzil zur Badge "282 archivierte Pruefläufe": die Schriftart ist
schrecklich, ueberall aendern. Es war JetBrains Mono, als Schrift fuer
Labels, Kicker, Zaehler und Kleintexte auf der ganzen Seite und in der
Console. Jetzt laufen alle diese Stellen in Manrope mit Gewicht 600, der
Schrift, die auch der Fliesstext hat. Mono bleibt nur, wo wirklich Code
steht: die `<code>`-Zeilen bei den Schnittstellen, Editor, Zeilennummern,
`pre`-Bloecke und der Diff, ueber `--qkern-font-mono`.

Gemessen bei 1280 px: die Badge rendert in Manrope 600; JetBrains Mono
sitzt nur noch auf `code`-Elementen.

Checkpoint `2.13.0` am 25. September 2026: Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen; Stacks
unveraendert.

Nicht erbracht: Buchstabenabstaende der alten Mono-Labels (bis 0,16 em)
sind geblieben und koennten in der Sans enger sein.

## Ein Server, der noch da ist – Release 2.14

Denzil fragte, ob ich das Repository nicht selbst auf GitHub anlegen kann.
Kann ich, bis auf die Anmeldung: die GitHub CLI installiert, Denzil hat sich
im Browser angemeldet, dann `Denzillax/qkern` privat angelegt und den Stand
2.13.0 gepusht. Die beiden Workflows liefen zum ersten Mal ausserhalb dieser
Maschine, und zwei Jobs waren rot.

Windows-Runner: `spawnSync npm.cmd EINVAL`. Node 24 verweigert den Start von
`.cmd`-Dateien ohne Shell (Folge von CVE-2024-27980). Der Tarball-Pruefer ruft
jetzt `npm-cli.js` direkt mit dem laufenden Node auf; die Datei liegt neben
der Node-Binary (Windows) oder unter `../lib` (Unix). Keine Shell, keine
Warnung, lokal geprueft.

Storage-Stack: `pull access denied for minio/minio`. Das Repository ist von
Docker Hub verschwunden, quay.io traegt die Tags ebenfalls nicht. Lokal lief
der Stack nur noch aus dem Image-Cache. Drei Ersatzserver geprueft, mit
einer Wegwerf-Sonde gegen den echten Provider-Code: RustFS 1.0.0 nimmt den
POST-Policy-Upload an, gibt aber im HEAD keine `x-amz-checksum-sha256`
zurueck, und der Dienst vergleicht genau diese Summe, zwei Faelle fielen mit
`STORAGE_INVALID_INPUT`. versitygw v1.8.0 (Apache 2.0) verhaelt sich wie S3:
Summe im HEAD zurueck, falsche Summe mit 400 abgewiesen, Objekt nicht da.
Garage und SeaweedFS blieben ungeprueft, weil versitygw schon passte.

Der Zertifizierungsstack laeuft jetzt gegen versitygw (Port 7070 im
geteilten Netz-Namespace), der Dev-Compose ebenfalls, hinter dem gewohnten
Port 9000 und ohne Web-UI; `npm run storage:bucket` legt den Bucket per
signiertem PUT an, 200 oder 409. Das Label heisst `versitygw und ClamAV`,
die alten Manifeste mit `MinIO und ClamAV` bleiben in der Zusammenfassung
lesbar. Handbuch, Landing (vier Sprachen), Console-Notiz, STATUS und der
Jobname im Workflow sind nachgezogen.

Checkpoint `2.14.0` am 25. September 2026: Storage gegen versitygw und
ClamAV 8 von 8, exit 0, zweimal reproduziert; Lokal 1118 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: keine Mutationsprobe, weil kein Produktcode geaendert wurde;
der GitHub-Lauf auf diesem Stand steht noch aus, Sprosse 7 ist begonnen,
nicht belegt. Die Fassung `RELEASE.2025-09-07` von MinIO ist damit nur
noch im lokalen Image-Cache reproduzierbar.

## Was der Runner fand – Release 2.15

Der zweite GitHub-Lauf, auf dem Stand 2.14.0. Developer Experience war auf
Ubuntu, Windows und macOS gruen; das ist die erste Evidenz fuer Windows und
macOS ausserhalb dieser Maschine, archiviert als JSON und gekuerztes Log.
Die Zertifizierung: Storage gegen versitygw gruen, Auth gruen, PostgreSQL
161 von 161 gruen und trotzdem exit 1.

Der Grund: Vitest meldete einen unbehandelten Fehler, `terminating
connection due to administrator command` (57P01), ausgeloest waehrend
`tests/migration-process-postgres.integration.test.ts`. Das Teardown
raeumt die Projektdatenbank mit `DROP DATABASE ... WITH (FORCE)` ab, und
das beendet jede noch offene Verbindung, auch die unbenutzte eines Pools,
den der Migrationsprozess selbst geoeffnet hatte. node-postgres meldet so
etwas als `error`-Ereignis des Pools. Ohne Zuhoerer ist das ein
unbehandelter Fehler des Prozesses. Auf dieser Maschine hat das Timing das
Loch nie getroffen; der schnellere Runner schon.

Das ist ein Produktfehler, kein Testfehler: ein Dienst, dessen unbenutzte
Verbindung der Server beendet (Failover, Admin-Kill), darf davon nicht
sterben. `createPostgresPool` haengt jetzt einen Zuhoerer an, der `[db]
idle connection lost` protokolliert; die naechste Anfrage bekommt ohnehin
eine frische Verbindung. Vertrag: `tests/postgres-pool-idle-error.test.ts`
prueft, dass genau ein Zuhoerer haengt und ein `emit("error")` nicht
wirft. Mutation: Zuhoerer entfernt, 1 von 1 faellt.

Dazu ein Workflow zum Veroeffentlichen der Pakete, nur von Hand startbar,
mit Probelauf als Voreinstellung. Der echte Lauf verweigert Pakete mit
`private: true` oder `UNLICENSED`; beides steht heute noch in beiden
Manifesten, und beides ist Denzils Entscheidung. Der `bin`-Pfad der CLI
verliert sein `./`, weil npm 11 ihn sonst beim Veroeffentlichen als
ungueltig verwirft.

Checkpoint `2.15.0` am 25. September 2026: PostgreSQL 17 zweimal 161 von
161, exit 0, ohne unbehandelten Fehler; Lokal 1119 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nachtrag: der GitHub-Lauf auf diesem Stand ist gruen, alle sechs Jobs
(Zertifizierung 161/161, 8/8, 7/7; Developer Experience auf drei
Betriebssystemen). Nicht erbracht: der
Teardown des Migrationstests beendet weiterhin fremde Verbindungen mit
FORCE, statt den Prozess-Pool sauber zu schliessen.

## Apache 2.0 – Release 2.16

Denzils Entscheidung nach meiner Empfehlung: `@qkern/sdk` und `@qkern/cli`
unter Apache License 2.0. Gruende: Firmen koennen es ohne Rueckfrage
einsetzen, die Patentklausel fehlt MIT, und Supabase, postgres-meta und
versitygw stehen unter derselben Lizenz. Die Plattform selbst bleibt
unlizenziert, also proprietaer; das ist eine andere Entscheidung an einem
anderen Tag.

Umgesetzt: der Lizenztext als `LICENSE` in beiden Paketen und im
`files`-Feld, `license: "Apache-2.0"`, `private` entfernt, ein
README-Abschnitt. `tests/developer-experience.test.ts` prueft alle drei.
Die Namen sind auf npm frei, die Organisation `qkern` gehoert Denzil, der
Token liegt als Secret, von ihm gesetzt.

Checkpoint `2.16.0` am 25. September 2026: Lokal 1119 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen; Tarballs
geprueft.

Der Probelauf des Workflows auf GitHub ist gruen: beide Tarballs gebaut und
geprueft, `LICENSE` drin, Ziel registry.npmjs.org mit Tag `alpha` und
oeffentlichem Zugang, nichts hochgeladen. Nicht erbracht: die echte
Veroeffentlichung, sie wartet auf Denzils Okay.

## Hilfe, die antwortet – Release 2.17

Denzil hat die Veroeffentlichung freigegeben und ist einkaufen gegangen:
autonom weiter testen und fertig bauen. Der erste echte Lauf des
Publish-Workflows fiel mit E422: npm nimmt einen Herkunftsnachweis
(Provenance) nur aus oeffentlichen Repositories an, das Repo ist privat.
`provenance` ist im Workflow jetzt ein Eingabefeld mit Voreinstellung
false; der zweite Lauf hat `@qkern/sdk@1.7.0-alpha.3` und
`@qkern/cli@1.7.0-alpha.3` hochgeladen, Tag `alpha`, Apache 2.0, beide
mit `LICENSE` im Tarball.

Dann die Probe, die zaehlt: Installation in ein leeres Projekt. Beide
Pakete kamen an, `npx qkern --help` antwortete aber nur "QKERN CLI command
failed." Der Einstieg fing jeden Fehler und warf die Meldung weg, auch die
Nutzung, die als Fehler geworfen wurde. Wer die CLI zum ersten Mal
startet, sieht nichts als einen Fehlschlag.

Umbau: `main.ts` ist ein duenner Einstieg, die Befehle liegen in
`commands.ts` mit `run(args, io)`, das den Exit-Code liefert und ohne
Kindprozess testbar ist. `help`, `--help`, `-h` und der leere Aufruf
zeigen die Nutzung auf stdout mit Exit 0. Ein unbekannter oder halber
Befehl zeigt sie auf stderr mit Exit 1, und zwar bevor die Konfiguration
gelesen wird, damit `qkern schema` nicht "qkern.config.json fehlt" meldet.
Jeder andere Fehler nennt seinen Grund. Vertrag: `tests/cli-usage.test.ts`.
Mutation: Help-Zweig entfernt, 1 von 3 faellt.

Die CLI steht auf `1.7.0-alpha.4`; das SDK bleibt bei alpha.3, es hat sich
nicht geaendert. Der Workflow fragt npm vor jedem Paket, ob die Version
schon da ist, und ueberspringt sie dann, statt am SDK zu scheitern.

Checkpoint `2.17.0` am 25. September 2026: Lokal 1122 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen; Tarballs
geprueft.

Nachtrag: `@qkern/cli@1.7.0-alpha.4` ist auf npm, das SDK wurde vom
Workflow uebersprungen; die frische Installation zeigt bei `--help` die
Nutzung und bei `status` ohne Konfiguration den Grund. GitHub-Laeufe auf
2.17.0 gruen. Nicht erbracht: `latest` zeigt auf npm auf die Alpha, weil es
die erste Version ist.

## Funktionen aus dem Katalog – Release 2.18

Zweiter Schritt von Punkt 2, nach dem Muster der Trigger aus 2.9. Die
Abfrage ist aus `functions.sql` in supabase/postgres-meta (Apache 2.0)
abgeleitet und auf das reduziert, was die Liste braucht: `pg_proc` und die
Katalogfunktionen `pg_get_function_arguments`,
`pg_get_function_identity_arguments` und `pg_get_function_result`, statt
die Argument-Arrays selbst zu entfalten. `prokind` in f und p: Funktionen
und Prozeduren, keine Aggregate, keine Fensterfunktionen. Der Quelltext
bleibt draussen; er kann Geheimnisse tragen und gehoert in eine eigene,
bewusst geoeffnete Ansicht.

Gegen echtes PostgreSQL belegt: Vorgaben (`since date DEFAULT`) und
OUT-Parameter stehen in der Signatur, aber nicht in der
Identitaets-Signatur; `SETOF integer` und `TABLE(n integer, twice
integer)` als Rueckgabe mit `returnsSet`; SECURITY DEFINER; eine Prozedur
mit `IN before date` und ohne Rueckgabe; die Trigger-Funktion mit leerer
Signatur. Ein Aggregat und eine Funktion im Nachbarschema erscheinen nicht.

Console: `db-functions` ist jetzt eine echte Ansicht, Zaehler fuer
Funktionen, Prozeduren und SECURITY DEFINER, Filter nach Name, Sprache
oder Rueckgabetyp, SECURITY DEFINER rot markiert; drei Sprachen.

Checkpoint `2.18.0` am 25. September 2026: PostgreSQL 17 162 von 162
bestanden, exit 0, zweimal reproduziert; Mutation (`prokind`-Filter
entfernt, das Aggregat erscheint) 1 von 162 faellt, exit 1; Lokal 1127
bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: kein Quelltext in der Ansicht; die Ansicht ist im Browser
nicht gesehen, weil Denzils Console-Konto seit dem Neustart des
Dev-Servers fehlt; nur Schema `public`.

## Drei aus dem Katalog – Release 2.19

Indizes, Policies und Enum-Typen in einem Zug, nach dem Muster der Trigger
und Funktionen. Die drei Abfragen sind aus postgres-meta (Apache 2.0)
abgeleitet und auf `pg_catalog` reduziert.

Indizes: postgres-meta joint `pg_indexes` ueber den Indexnamen, was bei
gleichnamigen Indizes in zwei Schemas doppelt liefert; hier kommt die
Definition direkt aus `pg_get_indexdef`, die Spalten aus `indkey`, und ein
Ausdrucksindex (`lower(email)`, GIN auf `to_tsvector`) hat leere Spalten
und seine Definition. Gegen echtes PostgreSQL belegt: Primaerschluessel,
eindeutiger Ausdrucksindex, partieller Index mit Praedikat
`(note IS NOT NULL)` und Spaltenreihenfolge, GIN.

Policies: `polroles = {0}` heisst PUBLIC; USING und WITH CHECK kommen als
Text aus `pg_get_expr`, der Server schreibt `CURRENT_USER` gross. Belegt:
eine erlaubende SELECT-Regel fuer alle, eine einschraenkende INSERT-Regel
nur fuer `qkern_project_api_app` mit WITH CHECK, eine ALL-Regel mit `true`
auf beiden Seiten.

Enum-Typen: die Werte in `enumsortorder`, belegt mit `ADD VALUE 'ok'
BEFORE 'happy'`, was alphabetisch falsch und in der Typreihenfolge richtig
`sad, ok, happy` ergibt.

Console: drei Ansichten mit Zaehlern und Filter; ungueltige Indizes und
einschraenkende Policies sind markiert. Drei Sprachen.

Checkpoint `2.19.0` am 25. September 2026: PostgreSQL 17 165 von 165
bestanden, exit 0, zweimal reproduziert; drei Mutationen (Praedikat auf
NULL, `permissive` auf true, Enum-Sortierung nach Label), je 1 von 165
faellt, exit 1; Lokal 1136 bestanden, 0 fehlgeschlagen, zweimal
reproduziert; `next build` gruen.

Nicht erbracht: nur Schema `public`; die Ansichten sind im Browser nicht
gesehen (Console-Konto fehlt); ob RLS auf einer Tabelle eingeschaltet ist,
steht weiter nur in `/schema`, nicht in der Policy-Liste.

## Der Rest des Katalogs – Release 2.20

Erweiterungen, Rollen, Publikationen und Spaltenrechte. Drei davon sind
datenbankweit und kennen kein Schema; ihre Routen kommen aus einer eigenen
Vorlage, die jeden Query-Parameter mit 400 abweist. Spaltenrechte gelten
je Schema und laufen ueber dieselbe Tuer wie die uebrigen Katalogansichten.

Erweiterungen: `pg_available_extensions()` mit LEFT JOIN auf
`pg_extension`, installierte zuerst. Belegt: plpgsql installiert in
`pg_catalog` mit derselben Version wie die Vorgabe, pg_trgm verfuegbar,
nicht installiert, mit Kommentar.

Rollen: `pg_roles` ohne die vordefinierten `pg_*`, ohne Passwort (dort
ohnehin maskiert) und ohne Verbindungszaehler (`pg_stat_activity` zeigt
fremde Sitzungen nur mit Sonderrecht). Belegt: keine `pg_`-Rolle, die
Projekt-API-Rolle mit Anmeldung, ohne Superuser, ohne BYPASSRLS, ohne
Limit. Der Alias heisst `account`, damit der Fake-Client die Abfrage nicht
mit der Grenzpruefung verwechselt, die `pg_roles AS role` liest.

Publikationen: `pg_publication` mit Eigentuemer, den vier Operationen,
FOR ALL TABLES und den Tabellen als `schema.name`. Belegt: eine Publikation
fuer zwei Tabellen mit `publish = 'insert, update'`, Eigentuemer `qkern`.

Spaltenrechte: `aclexplode` auf `pg_attribute.attacl`, gruppiert je
Spalte und Rolle, `grantee 0` heisst PUBLIC. Belegt: SELECT auf zwei
Spalten, UPDATE mit GRANT OPTION auf einer, SELECT fuer PUBLIC auf einer
anderen Tabelle, in Spaltenreihenfolge.

Checkpoint `2.20.0` am 25. September 2026: PostgreSQL 17 169 von 169
bestanden, exit 0, zweimal reproduziert; vier Mutationen (Join auf false,
`pg_`-Filter weg, `publish_update` auf false, PUBLIC-Abbildung weg), je 1
von 169 faellt, exit 1; Lokal 1147 bestanden, 0 fehlgeschlagen, zweimal
reproduziert; `next build` gruen.

Nicht erbracht: Tabellenrechte stehen nirgends, nur die je Spalte
gesetzten; die Ansichten sind im Browser nicht gesehen (Console-Konto
fehlt); von Punkt 2 bleiben Schema-Visualizer, Tabellen-Verwaltung und
Replikation Platzhalter, alle brauchen Schreibpfade.

## Drei, die es schon gab – Release 2.21

Drei Platzhalter trugen seit 2.0 den Vermerk "vorhanden": Cron lief unter
Functions & Jobs, die API-Keys unter API, die Anmeldeverfahren als Karte
unter Nutzer. Supabase fuehrt sie als eigene Menuepunkte, und wer sie dort
sucht, fand bei QKERN nur den Hinweis, wo sie stattdessen liegen. Jetzt
sind es eigene Ansichten mit denselben Routen und denselben Aktionen.

Cron: Liste, anlegen, pausieren, loeschen ueber `/compute/cron`; Ausdruck
und Queue bleiben unveraenderlich, das steht so als Spaltenrecht in der
Datenbank. API-Keys: Public und Service Keys anlegen und widerrufen ueber
`/api-keys`, das Geheimnis erscheint einmal. Anmeldeverfahren: die vier
zertifizierten Verfahren und die konfigurierten OIDC-Provider ueber die
Admin-Route aus 1.83; ein Verfahren ein- oder auszuschalten geht weiter
nicht ueber die Console, und der Zaehler "Schalter: 0" sagt das.

Kein Server-Code, keine neue Route, deshalb keine Zertifizierung und keine
Mutation; die Vertraege fuer Navigation und Uebersetzung pruefen die drei
neuen Ansichten. Drei Sprachen.

Checkpoint `2.21.0` am 25. September 2026: Lokal 1147 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: die Ansichten sind im Browser nicht gesehen (Console-Konto
fehlt); die alten Stellen unter Functions & Jobs, API und Nutzer zeigen
dasselbe weiterhin, doppelt statt verschoben.

## Die Schluessel zum Token – Release 2.22

`set-jwt` trug seit 2.0 den Vermerk "Ed25519-JWKS ist online; Rotation ueber
die Console fehlt". Die erste Haelfte ist jetzt eine Ansicht: sie liest das
JWKS des Projekts ueber dieselbe Adresse, die eine App zum Pruefen der
Tokens liest, und zeigt jeden Schluessel mit kid, Typ, Kurve, Verfahren und
Verwendung, dazu die absolute Adresse zum Kopieren. Welcher Schluessel
gerade signiert, steht nicht im JWKS, sondern im Token-Header; die Ansicht
sagt das, statt es zu raten. Die zweite Haelfte, die Rotation, bleibt in
der Konfiguration des Auth-Dienstes, und der Zaehler "Rotation: nicht ueber
die Console" sagt auch das.

Kein Server-Code, keine neue Route, deshalb keine Zertifizierung und keine
Mutation; Navigation und Uebersetzung sind vertraglich geprueft. Drei
Sprachen.

Checkpoint `2.22.0` am 25. September 2026: Lokal 1147 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: Rotation; die Ansicht ist im Browser nicht gesehen
(Console-Konto fehlt).

## Was das Review fand – Release 2.23

Nach zehn Releases an einem Tag hat ein Review-Agent 2.14 bis 2.22 gelesen,
nur auf Korrektheit und Sicherheit. Zwei Befunde waren echt.

Erstens: `/schema/roles` las `pg_roles`, und das ist clusterweit. Im
gelieferten Stack liegt die Projektdatenbank auf demselben Cluster wie
die Steuerung, also sah ein Projektleser mit Schluessel die Rollen
`qkern` (Superuser), `qkern_app`, `qkern_auth_app`, `qkern_worker_app`,
`qkern_provisioner_app` mitsamt Anmeldung, BYPASSRLS und Limits; auf
einem geteilten Cluster auch die Rollen der Nachbarn. Die Release-Notiz
2.20 nannte das "datenbankweit", was die Abfrage nicht war. Jetzt bleiben
nur Rollen, die diese Datenbank betreffen: die eigene, Eigentuemer von
Objekten in Anwendungsschemata, Empfaenger von Tabellen- oder
Spaltenrechten dort, in einer Policy genannte; Superuser nie. Belegt:
eine frisch angelegte Rolle ohne jeden Bezug erscheint nicht, kein
Superuser in der Liste, die Projekt-API-Rolle wie zuvor. Mutation:
Superuser-Filter entfernt, 1 von 169 faellt.

Zweitens: die Bezeichner-Grammatik `IDENTIFIER` (Kleinbuchstaben, Ziffern,
Unterstrich) galt auch fuer Namen, die der Katalog zurueckgibt. Ein
einziger Policy-Name mit Leerzeichen, und Supabase Studios Vorlage heisst
`Enable read access for all users`, oder ein Index `Order_pkey` aus Prisma
warf `DATA_PLANE_BOUNDARY_REJECTED`, die Route antwortete 503, die Ansicht
war leer. Dieselbe Klasse wie `uuid-ossp` in 2.20, nur breiter. Jetzt
prueft `catalogName` Typ, Laenge (1 bis 63) und Steuerzeichen; die Werte
sind parametrisiert gelesen und gehen nur als JSON hinaus. Gilt fuer alle
Katalogansichten seit 2.9. `IDENTIFIER` bleibt fuer Eingaben und die
Grenzpruefung.

Kleiner: Publikationen mit FOR TABLES IN SCHEMA zeigen `schema.*`;
`publish.yml` gibt den dist-tag als Umgebungsvariable weiter und prueft
ihn, statt ihn in die Shell zu interpolieren.

Checkpoint `2.23.0` am 25. September 2026: PostgreSQL 17 169 von 169
bestanden, exit 0, zweimal reproduziert; Mutation 168 von 169, exit 1;
Lokal 1147 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

GitHub auf diesem Stand: Zertifizierung gruen; Developer Experience auf
Ubuntu einmal rot, weil `scripts/verify-provider-e2e-evidence.ts` im
Test `provider-e2e-evidence` mit exit 1 antwortete, absichtlich ohne
Ursache im Ausgang. Die Wiederholung war gruen, macOS und Windows auch.
Der Test traegt seither stderr und stdout in der Meldung, damit der
naechste Fall lesbar ist; die Ursache bleibt unbekannt, die Zusicherung
unveraendert.

Nicht erbracht: `inspectSchema` aus 1.x prueft Tabellen- und Spaltennamen
weiter mit `IDENTIFIER`; das betrifft Table Editor und Data API und ist
ein eigener Slice, weil dort Namen in SQL eingesetzt werden. Extensions
sind serverweit, nicht je Datenbank; die Ansicht sagt es nicht.

## Derselbe Fehler, zweiter Fall – Release 2.24

Denzil hat sich neu registriert, und zum ersten Mal seit 2.6 war die
Console im Browser zu sehen. Jede Katalogansicht sagte "nicht verfuegbar",
dahinter ein 500 ohne Code. Der alte Table Editor auch. `/queues`
antwortete 500 ohne Koerper. Im Dev-Server-Log stand nichts, weil der
500-Zweig nicht loggte.

Ursache eins ist die von 2.8, nur beim Data Plane: der Dienst liegt im
Dev-Modus auf `globalThis` und ueberlebt das Neuladen der Module, die
Route importiert danach eine andere Klasse, `instanceof
ProjectDataPlaneError` ist falsch, und aus einem sauberen
`DATA_PLANE_DISABLED` mit 503 wird ein stummes 500. Jetzt erkennt
`isProjectDataPlaneError` den Fehler an Name und Code, in `run()` und in
beiden Routen, und der 500-Zweig schreibt die Ursache ins Log. Vertrag:
ein Fehler aus einer fremden Kopie der Klasse bekommt denselben Status wie
die eigene; Mutation (Route zurueck auf `instanceof`) 1 von 2 faellt.

Ursache zwei: `getProjectQueueService()` warf `PROJECT_QUEUES_DISABLED`
schon beim Anlegen, und elf Routen riefen es vor dem `try`. Jetzt liefert
die Laufzeit einen Proxy, der erst beim Aufruf wirft, ohne ihn zu merken,
damit ein spaeter eingeschalteter Dienst gesehen wird; die
Fehlerabbildung macht daraus 503 "Project Queues are disabled". Und
`isProjectQueueError` ersetzt `instanceof` in http, service und worker,
bevor derselbe Fall dort auftritt.

Im Browser danach: `/schema/triggers` 503 mit Code, die Ansicht sagt
"Datenbank nicht bereit"; `/queues` 503 mit Koerper. Die uebrigen
Katalogrouten blieben auf 500, und diesmal stand die Ursache im Log:
`service.inspectRoles is not a function`. Die auf `globalThis` gemerkte
`DisabledProjectDataPlane` stammte von vor 2.18 und kannte die neuen
Methoden nicht. `getProjectDataPlane()` merkt den abgeschalteten Plane
nicht mehr, er haelt keinen Zustand; nur der echte Dienst mit seinen Pools
wird gemerkt. Vertrag im selben Test.

Checkpoint `2.24.0` am 25. September 2026: PostgreSQL 17 169 von 169
bestanden, exit 0, zweimal reproduziert; Lokal 1152 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Im Browser durchgegangen, alle Ansichten seit 2.6 im Zustand ohne Dienste:
die neun Katalogansichten sagen "Datenbank nicht bereit" (503 mit Code);
API-Keys zeigt die echte, leere Liste; Migrationen die echten, leeren
Change Sets; Anmeldeverfahren die vier Verfahren und "Auth nicht aktiv";
JWT-Schluessel "Auth nicht aktiv"; Cron und Aufrufe "Compute nicht aktiv";
Queues "nicht verbunden"; der Realtime-Inspector sein Formular. Keine
Browser-Fehler ausser den erwarteten 503.

Nicht erbracht: die Ansichten mit Daten habe ich weiter nicht gesehen,
weil der Dev-Server keine Projektdatenbank hat (`QKERN_DATA_PLANE_ENABLED`
ist aus); gesehen sind die Zustaende ohne Datenbank. Die Zertifizierung
lief vor der letzten Aenderung an `runtime.ts`, die sie nicht beruehrt
(der Dienst wird dort injiziert); die lokale Suite lief danach.

## Alle Faelle dieser Klasse – Release 2.25

Dreimal an einem Tag derselbe Fehler: Auth in 2.8, Data Plane und Queues
in 2.24. Ein Dienst auf `globalThis` ueberlebt das Neuladen der Module,
die Route importiert eine andere Kopie der Fehlerklasse, `instanceof` ist
falsch, und aus 503 wird 500. Im Server gibt es 76 exportierte
Fehlerklassen und rund hundert `instanceof`-Stellen; eine `isXError`-
Funktion je Klasse waere der vierte Flicken gewesen.

Stattdessen macht `recognisedByName` die Klasse selbst robust: ein
`Symbol.hasInstance` auf der Klasse akzeptiert neben der Prototypkette
jeden Error mit demselben Namen. Der Name ist ein Literal, nie
`constructor.name`, weil ein minifiziertes Bundle Klassennamen kuerzen
darf, und liegt auf dem Prototyp, damit ihn auch Klassen ohne eigenes
`this.name` tragen. Basisklassen kennen die Namen ihrer Unterklassen,
damit `instanceof RepositoryError` eine fremde `ConflictError` erkennt.
`RepositoryError` nahm den Namen aus `new.target`, das ist ersetzt.

Alle 76 Klassen sind registriert, per Skript, eine davon von Hand, weil
ihr Name eine Ziffer traegt. Der Vertrag prueft das Verhalten (fremde
Kopie erkannt, echte Unterklasse wie bisher, Fremde und Nicht-Fehler
draussen, Name als Literal) und scannt `lib/server` nach exportierten
Fehlerklassen ohne Registrierung. Mutation: Registrierung von
`ProjectAuthError` entfernt, 2 von 3 faellt.

Checkpoint `2.25.0` am 25. September 2026: PostgreSQL 17 169 von 169
bestanden, exit 0, zweimal reproduziert; Lokal 1155 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: die `isXError`-Helfer aus 2.8 und 2.24 bleiben, sie
schaden nicht; das Neuladen selbst ist nicht nachgestellt, nur die fremde
Kopie der Klasse.

## Namen mit Grossbuchstaben – Release 2.26

Denzils Auftrag: mach den Table Editor. Der Befund aus 2.23 war, dass die
Namensgrammatik `[a-z_][a-z0-9_]*` nur Kleinbuchstaben kannte. Wer seine
Tabellen mit Prisma, TypeORM oder Drizzle anlegt, bekommt `"Order"`,
`"UserProfile"` und Spalten wie `"createdAt"`, und die fehlten im Table
Editor, in der generierten REST-API, in den erzeugten Typen der CLI und
im SDK.

Die Grammatik liegt jetzt an einer Stelle, `DATA_IDENTIFIER` in
`lib/server/data-plane/identifiers.ts`, und erlaubt Gross- und
Kleinbuchstaben, Ziffern, Unterstrich, hoechstens 63 Zeichen. Sonst
nichts Neues: kein Leerzeichen, kein Anfuehrungszeichen, kein Punkt. Die
Grenze bleibt eine Sicherheitsgrenze, weil jeder Name nur ueber `"..."` in
SQL landet und ein Name dieser Grammatik das Anfuehrungszeichen nicht
verlassen kann. Sie gilt fuer Tabellen, Spalten, Funktionen und Argumente
in der Data API, in der Schema-Inspektion, in den drei Routen (auch fuer
Sortier- und Aggregatspalten aus der URL), im SDK und in der CLI.
Schemanamen bleiben klein.

Gegen echtes PostgreSQL belegt: eine Tabelle `"Order"` mit `"createdAt"`
und `"totalCents"` unter RLS; Einfuegen fuer zwei Eigentuemer, Lesen mit
Filter auf `totalCents` und Sortierung nach `createdAt` liefert genau die
eigene Zeile, Aendern trifft eine Zeile, und die Schema-Inspektion listet
die Tabelle mit ihren Spalten in Reihenfolge. Die Injektionsfaelle
(`items; DROP SCHEMA public`, `name) OR true --`) bleiben abgewiesen.
Mutation: Grammatik in der Data API zurueck auf Kleinbuchstaben, 2 von
170 fallen: der Order-Fall und die OpenAPI-Dokumentation, weil die alte
Grammatik beim ersten Grossbuchstaben das ganze Schema verwarf. Genau das
war der Befund aus 2.23.

CLI und SDK: der Typgenerator schreibt `Order` und `createdAt` als nackte
Schluessel, `from("Order")` mit Filter auf `createdAt` baut die Anfrage,
`from("Order; DROP")` wirft vor jeder Anfrage. Beide Pakete stehen auf
`1.7.0-alpha.5`.

Checkpoint `2.26.0` am 25. September 2026: PostgreSQL 17 170 von 170
bestanden, exit 0, zweimal reproduziert; Mutation 168 von 170, exit 1;
Lokal 1158 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen; Tarballs geprueft.

Nachtrag: alpha.5 von SDK und CLI ist auf npm, frische Installation
geprueft; GitHub-Laeufe auf 2.26.0 gruen. Nicht erbracht: Schemanamen mit
Grossbuchstaben; der Table Editor ist mit einer solchen Tabelle im Browser nicht
gesehen, weil der Dev-Server keine Projektdatenbank hat.

## Regeln und Grenzen je Bucket – Release 2.27

Zwei Storage-Platzhalter trugen seit 2.0 "die Werte stehen am Bucket, eine
Ansicht zum Aendern fehlt". Die Route dafuer gab es seit 1.4:
`PATCH /storage/buckets/{id}` nimmt Lese- und Schreibregel, MIME-Liste,
Objektgroesse, Speicherplatz und Aufbewahrung in einem Stueck. Jetzt sind
es zwei Ansichten. Policies: je Bucket eine Auswahl fuer Lesen (private,
authenticated, owner, public, service) und Schreiben (ohne public), mit
Klartext, was die Regel bedeutet, und Speichern nur, wenn sich etwas
geaendert hat. Einstellungen: Objektgroesse und Speicherplatz in MiB,
Aufbewahrung in Tagen oder leer, MIME-Typen als Liste; die Ansicht prueft
Ganzzahlen und Mindestwerte, alles Weitere prueft der Dienst und die
Ansicht zeigt seine Antwort.

Im Browser zeigten beide Ansichten zuerst "Storage nicht verfuegbar" mit
einem 500 ohne Koerper. Das Log sagte, was: `getProjectStorageService()`
warf `PROJECT_STORAGE_DISABLED` schon beim Anlegen, und die Routen rufen
es vor dem `try`. Derselbe Fall wie die Queues in 2.24. `/usage`,
`/usage/billing` und `/usage/invoices` antworteten aus demselben Grund 500.
Jetzt liefern die drei Laufzeiten einen Proxy, der erst beim Aufruf wirft,
und die Routen antworten 503 mit Begruendung; ein Vertrag prueft alle drei.
Damit verhalten sich alle vier Laufzeiten mit Schalter gleich. Im Browser
danach: beide Ansichten sagen "Storage nicht aktiv".

Server-Code nur in den drei Laufzeit-Zugriffen; PostgreSQL 17 dazu 170 von
170, zweimal. Navigation und Uebersetzung sind vertraglich geprueft.

Checkpoint `2.27.0` am 25. September 2026: PostgreSQL 17 170 von 170
bestanden, exit 0, zweimal reproduziert; Lokal 1160 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: mit einem echten Bucket im Browser nicht gesehen; Regeln
je Pfad gibt es weiter nicht.

## Was das zweite Review fand – Release 2.28

Ein zweiter Review-Agent hat 2.24 bis 2.26 gelesen. Sechs Befunde, keiner
davon ein Loch in der Mandantengrenze, alle behoben.

`recognisedByName` setzte `Symbol.hasInstance` auf die Klasse, und das ist
statisch vererbt: eine nicht registrierte Unterklasse von
`RepositoryError` haette die 17 Namen ihres Vorfahren als eigene
genommen, `new ConflictError() instanceof Unregistriert` waere wahr
gewesen. Jetzt fuehrt eine WeakMap die Namen je Klasse, Unterklassen
melden sich bei ihren registrierten Vorfahren an, und wer nicht
registriert ist, faellt auf die Prototypkette zurueck. Die aufgezaehlten
Unterklassen in den Basisklassen bleiben stehen und sind nicht mehr
noetig.

Die Data API prueft Pflichtargumente eines RPC-Aufrufs mit `name in
args`; mit der neuen Grammatik ist `valueOf` ein gueltiger Argumentname,
und `"valueOf" in {}` ist wahr. Ein Pflichtargument, das der Aufrufer nie
schickte, waere als NULL an die Funktion gegangen. Jetzt `Object.hasOwn`,
gegen PostgreSQL belegt mit `echo_value("valueOf" jsonb)`: ohne Argument
400, mit Argument kommt der Wert zurueck. Mutation: `in` zurueck, 1 von
171 faellt.

`getProjectDataPlane` merkte den Dienst erst nach dem `await`; N
gleichzeitige erste Anfragen bauten N Dienste mit eigenen Pools, N-1
davon nie geschlossen. Jetzt wird das Versprechen sofort gemerkt, ein
abgelehntes wieder vergessen, und der abgeschaltete Plane am Literal
`kind` erkannt statt am Klassennamen, den ein Bundle kuerzen darf.

Die veroeffentlichte OpenAPI nannte fuer `table` und `order` noch die
alte Grammatik; ein Client, der dagegen prueft, haette `Order` abgelehnt,
was der Server annimmt. Jetzt kommt das Muster aus `identifiers.ts`, und
ein Funktionsname ausserhalb der Grammatik kommt nicht mehr als
unerreichbarer Pfad in die OpenAPI.

Checkpoint `2.28.0` am 25. September 2026: PostgreSQL 17 171 von 171
bestanden, exit 0, zweimal reproduziert; Mutation 170 von 171, exit 1;
Lokal 1161 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

Nicht erbracht: das gleichzeitige erste Anfragen selbst ist nicht
nachgestellt, nur die Reihenfolge von Merken und await; die Namenslisten
in den Basisklassen sind Altlast.

## Backup und Restore, lokal bewiesen – Release 2.29

Sprosse 10 brauchte bisher einen Hoster. Denzil fragte, ob das auch lokal
geht; die Antwort ist ein Wegwerfstack, der dieselbe Technik faehrt wie
spaeter der Hoster, nur mit anderen Adressen.

Der Quellserver ist ein PostgreSQL 17 mit TLS-Pflicht: `pg_hba` kennt nur
`hostssl`, eine unverschluesselte Verbindung wird abgewiesen, und der Test
belegt beides. Jedes WAL-Segment landet per `archive_command` in einem
geteilten Archiv. Der Drill schreibt Phase A, zieht ein Basisbackup ueber
`sslmode=verify-full` gegen das im Stack erzeugte Zertifikat, verschluesselt
es mit AES-256, schreibt Phase B, merkt sich Manifest und Zielzeit, schreibt
Phase C, erzwingt einen Segmentwechsel und wartet, bis `pg_stat_archiver`
das Segment bestaetigt. Dann startet er einen zweiten Server aus dem
entschluesselten Backup mit `restore_command` und `recovery_target_time`.
Belegt: Zeilen 1 bis 6, keine aus Phase C; Schema gleich (pg_dump ohne
Kommentare und ohne die zufaelligen `\restrict`-Schluessel, die pg_dump seit
17.6 einstreut); Audit-Kette nachgerechnet; Manifeste gleich. Die Evidenz
wird mit Ed25519 signiert und vom Produkt-Verifier
(`BackupRestoreEvidenceVerifier`) angenommen; das Skript legt sie unter
`docs/evidence/backup-restore/` ab.

Mutation: `archive_mode=off`. Der Drill faellt an der Stelle, an der er das
archivierte Segment lesen will, 0 von 1, exit 1.

Sechs Anlaeufe bis gruen, alle im Stack, keiner im Produkt: das WAL-Volume
gehoerte root; die archivierten Segmente sind 0600 und gehoeren uid 70,
also laeuft der Restore-Server als derselbe Benutzer; der Alpine-Socketpfad
`/run/postgresql` gehoert ihm nicht, der Socket liegt im Drill-Ordner; uid
70 war vom apk-Paket schon belegt; pgcrypto fehlte im Restore-Server;
`--abort-on-container-exit` nahm den Zertifikat-Container als Abbruch,
deshalb `up --wait` fuer den Quellserver und `run` fuer den Drill.

Checkpoint `2.29.0` am 25. September 2026: Backup und Restore 1 von 1
bestanden, exit 0, zweimal reproduziert; Mutation 0 von 1, exit 1; Lokal
1171 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: der Verifier-Lauf auf dem Host scheitert an Windows-Pfaden
(er verlangt absolute POSIX-Pfade), er laeuft im CI-Job auf Ubuntu; ein
echter Hoster, ein externes Archiv und ein fremd verwahrter Schluessel
fehlen weiterhin; die Konsole zeigt unter Backups noch den Platzhalter.

## Drei Türen – Release 2.30

Die Einstiegsdoku fuer drei Zielgruppen: Entwickler, die Supabase kennen,
Entwickler beim ersten Backend, Gruender ohne Entwicklerhintergrund. Fuenf
deutsche Seiten unter `docs/guide/de/`, auf der Website unter `/docs`.

Der Renderer ist ein eigener Parser, der genau die Elemente kennt, die die
Doku braucht, und bei allem anderen mit Zeilennummer wirft: Ueberschriften
bis Ebene 3, Absaetze, Listen mit Bindestrich, Codeblock mit Sprache,
Tabellen, Zitat; im Text fett, kursiv, Code, Link. Links in Ueberschriften,
HTML, Bilder, verschachtelte Listen, `*`-Aufzaehlungen, Trennlinien,
`javascript:`-Ziele: alles wirft. 44 Faelle im Parsertest.

Drei Vertragstests halten die Texte wahr. `docs-guide-contract`: jeder Link
trifft eine Datei, einen Anker oder einen Glossareintrag; das Glossar hat
mindestens 80 Eintraege, alphabetisch nach deutscher Sortierung, je genau
drei Zeilen mit festen Vorspaennen; keine Sperrwoerter und keine
Gedankenstriche im Fliesstext; jede Seite hat einen Titel und keinen
uebrigen Platzhalter. `docs-quickstart-contract`: Schnellstart und Erstes
Backend haben dieselben Codebloecke; jedes `npm run` steht in package.json,
jeder CLI-Befehl in der Nutzung, jede kopierte Datei liegt auf der Platte,
jeder API-Pfad in der OpenAPI, Versionen nur als Platzhalter.
`docs-founder-numbers-contract`: die Gruenderseite nennt Zahlen nur ueber
Platzhalter, auch gebeugt und zusammengesetzt.

Der Schnellstart wurde am 26. September 2026 in einem frischen Ordner
komplett durchlaufen; Denzil registrierte das Konto, der Agent liest keine
Geheimnisse. 31 Minuten am Stueck, rund 7 Minuten Kommandos. Zwei
Textfehler fielen dabei auf und sind behoben: die Anleitung nannte zwei
Geheimnisse, der Server braucht drei; der Key-Dialog laeuft ueber
`window.prompt`, nicht ueber ein Eingabefeld. Log und Manifest unter
`docs/evidence/2026-09-26/`.

Mutation: ein Glossareintrag auf zwei Zeilen gekuerzt; genau ein Fall
faellt ("genau drei Zeilen"), exit 1.

Checkpoint `2.30.0` am 26. September 2026: Lokal 1236 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Mutation 1 von 1236 faellt, exit 1;
`next build` gruen.

Nicht erbracht: Uebersetzungen (Schritt 2 des Plans); der Weg ueber Change
Set fuer Projektdatenbanken ist lokal nicht verdrahtet, die Tabelle
entsteht per SQL; das Bindungsskript macht nur das eine UPDATE.

## Vier Sprachen – Release 2.31

Die fuenf Einstiegsseiten gibt es jetzt auf Deutsch, Englisch,
Franzoesisch und Italienisch. Deutsch ist das Original; drei Agenten
uebersetzten parallel nach denselben Regeln: gleiche Blockfolge, gleiche
Ueberschriftenebenen, Codebloecke byteidentisch, Platzhalter unveraendert,
Links auf die uebersetzten Anker, Glossar mit 99 Eintraegen und den
Vorspaennen der Sprache, sortiert nach dem Collator der Sprache.

Die Website erkennt verfuegbare Sprachen an der Platte: eine Sprache ist
da, wenn alle fuenf Dateien da sind; sonst faellt sie auf Deutsch zurueck
und sagt es. Die Seitentitel je Sprache stehen in `lib/docs/pages.ts` und
muessen der Ueberschrift der Seite gleichen; der Vertrag prueft es.

Die drei Vertragstests laufen je verfuegbarer Sprache: Links und Anker,
Glossarform und Reihenfolge, Sperrliste je Sprache (Gedankenstriche
ueberall), Abschnitt "Ehrlich offen" in der Sprache, Kommandos identisch
zwischen Schnellstart und Erstes Backend, Zahlen der Gruenderseite nur als
Platzhalter (auch "bancs d'essai", "banchi di prova"). Dazu der Vergleich
mit dem Deutschen: gleiche Zahl Abschnitte je Seite, gleiche
Glossargroesse, identische Codebloecke.

Mutation: im franzoesischen Glossar der Eintrag Row Level Security auf
zwei Zeilen gekuerzt; genau ein Fall faellt, exit 1.

Checkpoint `2.31.0` am 26. September 2026: Lokal 1264 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Mutation 1 von 1264 faellt, exit 1;
`next build` gruen.

Nicht erbracht: die Uebersetzungen hat kein Mensch gegengelesen; der
franzoesische Text nennt die Freigabezentrale im Glossar "Centre
d'approbation" und in der Konsole "Centre de validation", das ist im Text
erklaert, aber zwei Namen fuer eine Sache.

## Was die Data API kann – Release 2.32

Die Ansicht Einstellungen, Data API zeigt, was die Data API dieser
Umgebung wirklich tut, und behauptet nichts, was sie nicht weiss. Der
Status kommt aus der generierten OpenAPI: 200 heisst bereit, 409 nicht
bereit (die Umgebung hat keine gebundene Datenbank), 503 mit dem
passenden Code abgeschaltet, alles andere ein Fehler. Die Tabellenliste
kommt aus der Schema-Route; freigegeben ist, was in der OpenAPI einen
Pfad hat, und wenn die OpenAPI nicht da ist, steht "unbekannt", nie
"nein". Views stehen getrennt, weil der Server sie nur lesend freigibt.

Die Regeln kommen aus `lib/data-api-limits.ts`, und dieselbe Quelle nutzt
der Server: Zeilen je Anfrage, Filterzahl, Operatoren, Muster fuer
sensible Spalten, Key-Claims. Ein Vertrag liest die Quelltexte und
verlangt, dass `generated-api.ts` und `generated-http.ts` die Konstanten
nutzen und dass die Ansicht keine Zahl von Hand und keine Schreibmethode
enthaelt.

Mutation: in `lib/console/data-api-exposure.ts` wird 409 als bereit
gedeutet; genau ein Fall faellt, exit 1.

Checkpoint `2.32.0` am 26. September 2026: Lokal 1270 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Mutation 1 von 1270 faellt, exit 1;
`next build` gruen.

Nicht erbracht: die Ansicht ist im Browser nur im Ladezustand gesehen,
weil die Konsolensitzung im Speichermodus abgelaufen war; die Zustaende
sind durch Einheitstests belegt, nicht durch einen Klick.

## Schemanamen mit Grossbuchstaben – Release 2.33

Seit 2.26 duerfen Tabellen, Spalten, Funktionen und Argumente der Data API
Grossbuchstaben tragen; Schemanamen blieben klein. Jetzt gilt fuer sie
dieselbe Grammatik, `isDataSchemaName` in `identifiers.ts`: das Muster
der Bezeichner, ohne `pg_*`, `information_schema` und `qkern_internal`.
Elf Routen, der Katalogdienst, die generierte API und die OpenAPI nutzen
sie. Andere Namen (Datenbanken, Rollen, Ledger-Owner, Realtime-Kanaele,
Provisionierung) bleiben klein.

SQL-Audit, zweimal gemacht (Implementierer und Reviewer): jeder Schemawert
erreicht SQL als Parameter (`nspname = $1` in allen Katalogabfragen) oder
durch `quoted()`, das die Grammatik erneut prueft und in `"..."` setzt;
kein `lower(`, kein `ILIKE`, kein `search_path`. `Shop` und `shop` sind
zwei Schemata, und der PostgreSQL-Fall belegt es: Schema `Shop_<hex>` mit
Tabelle `Items`, RLS und Rechten fuer den API-Login; `inspectSchema` sieht
die Tabelle, `listRows` liefert die Zeile, der Zwilling in Kleinschrift
liefert nichts, die Grossschreibung ist nicht gefunden, die OpenAPI traegt
den Pfad. Einheitstests: `Shop` angenommen, `pg_Shop`, `pg_catalog`,
`information_schema`, `qkern_internal`, `Shop"`, 64 Zeichen, `shop.x`
abgewiesen, ohne Verbindung.

Mutation: `isDataSchemaName` auf die alte Grammatik (nur klein)
zurueckgesetzt; genau der neue Fall faellt, 171 von 172, exit 1.

Nebenbei: der Realtime-Soak-Test wartete hoechstens 30 s auf 120
Aenderungen; ein geteilter CI-Runner schaffte 112 (2.32, Wiederholung
gruen). Das Wartebudget ist jetzt ausdruecklich 75 s, die Testzeit 150 s,
und die Meldung nennt beim Fehlschlag die fehlende Zahl und die Wartezeit.
Vollstaendigkeit, Reihenfolge und die Latenzschranken je Ereignis sind
unveraendert.

Checkpoint `2.33.0` am 26. September 2026: PostgreSQL 17 172 von 172
bestanden, exit 0, zweimal reproduziert; Mutation 171 von 172, exit 1;
Lokal 1275 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

Nicht erbracht: die generierte OpenAPI fuer ein anderes Schema als `public`
nennt die Tabellenpfade ohne `schema`-Parameter (schon vor 2.33 so); die
Konsole schickt weiterhin nur `schema=public`.

## Sitzungen sehen und beenden – Release 2.34

Project Auth hatte Sitzungen mit Refresh-Familien, aber keine Liste und
keinen Widerruf fuer Administratoren. Jetzt: `listActiveSessions` liefert
je Nutzer die aktiven Sitzungen (nicht widerrufen, nicht abgelaufen, nicht
kompromittiert), ohne Token-Hash; die Select-Liste nennt die Spalte nicht,
und die Tests pinnen die Schluesselmenge der Antwort. `revokeSession`
prueft, dass die Sitzung dem genannten Nutzer gehoert, und widerruft die
ganze Refresh-Familie, weil eine rotierte Sitzung sonst weiterlebte; eine
fremde Sitzung sieht aus wie eine unbekannte (404). `revokeAllSessions`
beendet alles eines Nutzers, ohne ihn zu deaktivieren.

Die Routen folgen den Admin-Routen fuer Nutzer: Konsolensitzung,
Admin-Faehigkeit, Scope aus Organisation plus Pfad, CSRF auf DELETE,
UUID-Pruefung, keine Caches. Route-Tests: Liste, Widerruf einer und aller,
404 fuer unbekannte und fremde Nutzer und Sitzungen, 400 fuer schlechte
UUIDs und Query-Parameter, 401 ohne Anmeldung, CSRF-Abweisung.
Service-Tests: Familie A widerrufen laesst Familie B leben; Widerruf
aller trifft den zweiten Nutzer nicht; eine Sitzung aus einer anderen
Umgebung ist 404.

PostgreSQL-Fall: Nutzer registriert, zweimal angemeldet (zwei Familien),
eine Familie erneuert, Liste zeigt genau die aktiven; eine Familie
widerrufen, ihr Refresh-Token scheitert (TOKEN_REPLAYED), die andere
Familie erneuert weiter; alle widerrufen, beide scheitern, der zweite
Nutzer erneuert weiter. 173 von 173, zweimal. Mutation: der Widerruf in
`revokeSession` ausgelassen; genau der neue Fall faellt, 172 von 173.

Sicherheits-Review offen gelassen: ein Refresh mit dem Token einer vom
Administrator beendeten Familie landet in der Replay-Pruefung und markiert
die Familie als kompromittiert, statt als schlicht widerrufen. Auf dem
Draht ist beides 401 ohne Unterschied; ein eigener Code wuerde dem
Tokeninhaber verraten, dass das Token gueltig war.

Checkpoint `2.34.0` am 26. September 2026: PostgreSQL 17 173 von 173
bestanden, exit 0, zweimal reproduziert; Mutation 172 von 173, exit 1;
Lokal 1279 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

Nicht erbracht: kein Audit-Ereignis fuer den Widerruf (Project Auth
schreibt heute keine); die Ansicht ist im Browser nicht gesehen, weil die
Konsolensitzung im Speichermodus abgelaufen war.

## Was die Anmeldung tat – Release 2.35

Project Auth schrieb bis 2.34 keine Audit-Ereignisse. Jetzt landen
Registrierung, Anmeldung (mit und ohne Erfolg), Abmeldung, MFA-Anlage und
-Pruefung sowie die Admin-Aktionen (Nutzer geaendert, Sitzung widerrufen,
alle widerrufen) in derselben Hash-Kette wie die Plattform-Ereignisse.
Refresh wird nicht aufgezeichnet.

Der Auth-Login braucht dafuer Rechte, die er nicht hatte: Migration 0046
gibt `qkern_auth` SELECT und INSERT auf `audit_logs`. SELECT, weil der
Kettentrigger den letzten Hash der Organisation liest und nicht SECURITY
DEFINER ist, und weil `append` mit RETURNING arbeitet. Kein UPDATE, kein
DELETE; der Append-only-Trigger und RLS FORCE bleiben. Der Sink schreibt
in einer Mandantentransaktion; ein Fehler im Sink wird ohne Geheimnisse
geloggt und bricht die Anmeldung nicht, die Kette bleibt dann unberuehrt.

Was nie ins Audit darf: E-Mails, Tokens, Passwoerter. `actor_ref` ist die
Nutzer-ID oder `anonymous`, Admin-Routen uebergeben nur die ID des
Konsolennutzers, und `sanitizeProjectAuthAuditEvent` verwirft jedes
Ereignis mit `@` oder `qk_` in einem Feld (geloggt, nicht halb
geschrieben). Tests belegen es mit Einheitsfaellen und im PostgreSQL-Fall:
Registrierung, Anmeldung ueber die Verifikation, ein Fehlversuch, ein
Admin-Widerruf; vier Ereignisse, neueste zuerst, Cursor funktioniert, kein
`@` und kein `qk_` in den Zeilen, die Kette nachgerechnet, eine fremde
Organisation sieht nichts, `console.error` nie gerufen. 174 von 174,
zweimal. Mutation: der Sink schreibt nichts mehr; genau der neue Fall
faellt, 173 von 174.

Beim Aufraeumen zeigte sich, was die Kette wert ist: `audit_logs` ist
append-only ohne Ausnahme, auch fuer den Superuser, und eine Organisation
mit Audit-Zeilen laesst sich nie loeschen. Der Fall haengt deshalb an einem
eigenen Besitzer und raeumt nur Project-Auth-Daten auf.

Checkpoint `2.35.0` am 26. September 2026: PostgreSQL 17 174 von 174
bestanden, exit 0, zweimal reproduziert; Mutation 173 von 174, exit 1;
Lokal 1289 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

Nicht erbracht: `qkern_auth` darf alle Audit-Zeilen der gesetzten
Organisation lesen, nicht nur `project_auth.*` (die Einschraenkung steht
in der Abfrage); jeder Fehlversuch schreibt eine Kettenzeile unter dem
Organisationslock, begrenzt nur durch das Passwortlimit von 10 je 15
Minuten; die Ansicht ist im Browser nur im Zustand "nicht aktiviert"
gesehen.

## Die Kette in Zeitreihenfolge – Release 2.36

Das Sicherheits-Review zu 2.35 fand eine alte Schwaeche, die mit den
Anmelde-Ereignissen wahrscheinlich wurde: `audit_logs.created_at` ist
`now()`, also der Beginn der Transaktion, der Kettenlock wird erst im
Trigger genommen. Beginnen zwei Transaktionen in der einen und nehmen den
Lock in der anderen Reihenfolge, zeigt `previous_hash` auf eine Zeile mit
spaeterem Zeitstempel. Wer die Kette nach `(created_at, id)` nachrechnet,
so wie der Backup-Drill und der Auth-Audit-Fall, meldet dann einen Bruch
ohne Manipulation.

Migration 0047 ersetzt den Trigger: nach dem Lock liest er Hash und
Zeitstempel der neuesten Zeile der Organisation und setzt den eigenen
Zeitstempel auf das Maximum aus Wanduhr und Vorgaenger plus einer
Mikrosekunde, bevor er den Hash rechnet. Der Hash-Payload, der Lock und
die SECURITY-Art sind unveraendert; `CREATE OR REPLACE` behaelt die
EXECUTE-Grants. Damit gilt: Kettenreihenfolge gleich `(created_at, id)`
je Organisation.

Der PostgreSQL-Fall stellt das Rennen nach: A beginnt und liest `now()`,
B haengt an und committet, dann haengt A an. A traegt einen spaeteren
Zeitstempel als B, A.previous_hash ist B.entry_hash, und die Nachrechnung
ist intakt. 175 von 175, zweimal. Mutation: die Anhebung im Trigger
entfernt; genau dieser Fall faellt, 174 von 175.

Checkpoint `2.36.0` am 26. September 2026: PostgreSQL 17 175 von 175
bestanden, exit 0, zweimal reproduziert; Mutation 174 von 175, exit 1;
Lokal 1290 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build`
gruen.

Nicht erbracht: der Trigger ueberschreibt einen explizit gesetzten
Zeitstempel (kein Codepfad setzt einen; eine logische Wiederherstellung
mit aktiven Triggern wuerde Hashes brechen); Zeilen vor 0047 koennen alte
Paare tragen; unter REPEATABLE READ saehe der Trigger frische Zeilen nicht,
kein Code setzt diese Stufe.

## Was es kostet – Release 2.37

Die Ansicht Einstellungen, Abrechnung zeigt, was das Abrechnungs-Backend
weiss, und nichts darueber hinaus. Es gibt keinen eigenen
Preisblatt-Endpunkt; die Preise stehen in den bepreisten Zeilen der
Monatsprojektion, und die Karte sagt, dass es die Preise zum Monatsende
sind. Der laufende Monat nennt Summe, Zeitraum und je Metrik den Betrag
oder "ohne Preis"; unbepreiste Metriken sind als nicht enthalten
ausgewiesen. Die Rechnungen kommen aus derselben Karte wie unter Nutzung
& Limits, die dafuer aus `console-app.tsx` herausgeloest wurde.

Geld wird an einer Stelle formatiert (`lib/console/money.ts`), mit BigInt
und ohne Gleitkomma, und es rundet ab wie der Rechnungslauf: die Anzeige
zeigt nie mehr, als der Ledger bucht; der genaue Mikrobetrag steht im
Tooltip. Der Vertragstest liest die Quelle der Ansicht: keine
Schreibmethode, kein Betrag von Hand, jede Metrikbezeichnung in allen
vier Sprachen.

Mutation: die Anzeige rundet auf statt ab; 2 Faelle fallen, exit 1.

Checkpoint `2.37.0` am 26. September 2026: Lokal 1302 bestanden, 0
fehlgeschlagen, zweimal reproduziert; Mutation 2 von 1302 fallen, exit 1;
`next build` gruen. Kein Serveraenderung, deshalb keine
Docker-Zertifizierung.

Nicht erbracht: keine Zahlungsanbindung, kein Versand; im Browser nur der
Aus-Zustand gesehen, weil Metering lokal aus ist; ein "gueltig ab" je Preis
fehlt, weil kein Endpunkt es liefert.

## Secrets, ohne Werte – Release 2.38

Die Ansicht Functions & Jobs, Secrets zeigt je Function die
Secret-Referenzen ihrer Definition und ob der Vault sie aufloest: vorhanden,
fehlt oder kein Zugriff. Einen Wert liefert weder die Route noch die
Ansicht, und die Frage "gibt es ihn" stellt der Inspektor nur an den
Metadaten-Endpunkt von KV Version 2. Der Datenendpunkt wird nie angefragt;
der Vault-Fall beweist das mit einem Fetch-Spion, der nach sechs Referenzen
genau drei Anfragen sieht, alle unter `metadata/`.

Die Pfadregel ist die des Signatur-Resolvers, jetzt als eine exportierte
Funktion, die beide benutzen. `vault:../sys/policies/acl/root`,
`STRIPE_KEY` und `vault:/sys/health` sind kein Zugriff, ohne dass eine
Anfrage den Prozess verlaesst. Ein echter 403 vom Vault, geprueft mit einem
Token, dessen Policy nur zwei Metadatenpfade lesen darf, ist ebenfalls kein
Zugriff. Der typisierte Fehler traegt weder Pfad noch Vault-Meldung.

Mutation: 403 gilt als fehlend. Lokal faellt 1 von 10 Faellen der
Inspektor-Tests, im Vault-Stack 1 von 7, exit 1 beide Male.

Checkpoint `2.38.0` am 26. September 2026: Vault-Stack 7 von 7, exit 0,
zweimal reproduziert; Lokal 1319 bestanden, 0 fehlgeschlagen, zweimal
reproduziert; `next build` gruen.

Nicht erbracht: Anlegen und Aendern von Secrets bleibt im Vault. Eine
Referenz ohne `vault:` ist in einer Definition erlaubt und erscheint hier
als kein Zugriff; die Ansicht sagt das in einem Satz. Die Metadaten laufen
durch den Serverprozess, auch wenn sie ihn nie verlassen. Im Browser nicht
gesehen.

## Was offen steht – Release 2.39

Die Ansicht Advisors, Sicherheit rechnet Befunde aus Daten, die QKERN
ohnehin liest: Tabellen und Policies aus dem Katalog, die Richtlinien der
Buckets, Art und Ablauf der API-Keys. Nichts wird geschrieben, nichts
repariert. Das Regelmodul ist rein und sortiert stabil, damit zwei Laeufe
dieselbe Liste in derselben Reihenfolge ergeben.

Zwei Entscheidungen sind enger als die Vorlage. Eine Schreib-Policy ohne
WITH CHECK gilt nur als Befund, wenn auch keine USING-Bedingung da ist,
denn PostgreSQL wendet USING ersatzweise auf neue Zeilen an; sonst waere
fast jede UPDATE-Policy ein Fehlalarm. Und "RLS ohne Policy" bleibt
ungeprueft, wenn die Policy-Liste am Limit abgeschnitten ist, weil die
fehlende Policy dann nur abgeschnitten sein koennte. Beides steht in der
Karte "Was geprueft wurde".

Der PostgreSQL-Fall legt drei Tabellen in einem eigenen Schema an: eine
ohne RLS, eine mit RLS und einer Policy `USING (true)`, eine mit RLS und
zwei sauberen Policies. Gelesen wird ueber die Leserolle der Data API,
gerechnet mit dem Regelmodul. Genau zwei Befunde kommen heraus, und die
saubere Tabelle traegt keinen.

Mutation: eine Policy ohne Bedingung wird nur noch bei WITH CHECK
gemeldet, also nicht mehr bei `USING (true)`. Im Stack faellt 1 von 176,
lokal fallen 2 von 18 Regeltests, exit 1 beide Male.

Checkpoint `2.39.0` am 26. September 2026: PostgreSQL 17 mit 176 von 176,
exit 0, zweimal reproduziert; Lokal 1341 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Der Berater repariert nichts. Eine absichtlich
oeffentliche Tabelle erscheint als Befund hoher Schwere, und ein
Service-Key in Produktion ebenfalls; beides kann gewollt sein. Nicht im
Blick sind Funktionen mit SECURITY DEFINER, Views ohne security_invoker,
Spaltenrechte und jedes Schema ausser public. Im Browser nicht gesehen.

## Wo es langsam wird – Release 2.40

Die Ansicht Advisors, Leistung rechnet Befunde aus den Statistiken von
PostgreSQL: sequenzielle Scans gegen Indexscans, Scans je Index samt
Groesse, tote gegen lebende Zeilen, Zeitpunkt der letzten Stichprobe. Die
Schwellen stehen an einer Stelle, und jeder Text nennt sie in Worten.

Zwei Entscheidungen sind bewusst. Als letzte Stichprobe zaehlt der spaetere
Zeitpunkt aus manuellem und automatischem Analyze, sonst waere jede
autoanalysierte Tabelle ein Fehlalarm. Und `pg_stat_statements` liest der
Berater nicht: die Sicht ist clusterweit, und der Text eines
Utility-Statements behaelt seine Literale, bis zu einem Passwort aus einem
Rollenbefehl. Ein Statement aus einem fremden Projekt koennte so mitkommen.
Die Regel steht deshalb als nicht geprueft mit diesem Grund in der Karte;
das Regelmodul hat sie fertig, damit die Quelle spaeter geoeffnet werden
kann.

Der PostgreSQL-Fall legt fuenf Tabellen in einem eigenen Schema an,
Autovacuum je Tabelle abgeschaltet, damit der Daemon das Bild nicht
waehrend des Laufs aufraeumt. Der Statistiksammler schreibt verzoegert,
also wartet der Fall auf die Bedingung statt auf eine Dauer, mit 20
Sekunden Budget und dem letzten gesehenen Zustand in der Meldung. Der erste
Lauf fiel in die Fuenf-Sekunden-Grenze der Datei; der Fall hat jetzt ein
eigenes Budget von 120 Sekunden, und keine Zusicherung wurde dafuer
angetastet.

Die Mutationsprobe fand eine echte Luecke. Mit ignorierten Indexscans blieb
der Stack gruen, weil keine Tabelle viele sequenzielle Scans und trotzdem
genug Indexscans zeigte. Der Fall prueft das jetzt mit einer eigenen
Tabelle, deren Index der Planer benutzt; sie darf keinen Befund tragen.
Danach faellt die Mutation im Stack in 1 von 177 Faellen und lokal in 1 von
31 Regeltests, exit 1 beide Male.

Checkpoint `2.40.0` am 26. September 2026: PostgreSQL 17 mit 177 von 177,
exit 0, zweimal reproduziert; Lokal 1358 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen. Ein Lauf dazwischen fiel am
Realtime-Soak mit p95 5088 ms gegen 5000 ms; der Wiederholungslauf lag bei
980 ms. Das Budget blieb unveraendert.

Nicht erbracht: Der Berater repariert nichts und sagt nicht, welche Spalte
einem Index fehlt. Ein Index fuer den Quartalsbericht erscheint als
unbenutzt, und eine frische Datenbank hat noch keine Zaehler. Bloat ist
eine Schaetzung des Kollektors, keine Messung. Im Browser nicht gesehen.

## Das Schema als Bild – Release 2.41

Die Ansicht Datenbank, Schema-Visualizer zeichnet, was der Katalog hergibt:
Tabellen mit ihren Spalten und die Fremdschluessel dazwischen. Die
Fremdschluessel kommen aus `pg_constraint`, und die Spalten beider Seiten
stehen in der Reihenfolge des Schluessels, nicht in der des Alphabets. Genau
das ist der Punkt, an dem eine Verwechslung unsichtbar bliebe: ein
zusammengesetzter Schluessel mit verdrehten Zielspalten sieht in einer
falschen Reihenfolge immer noch plausibel aus.

Das Diagramm rechnet eine reine Funktion ohne neue Abhaengigkeit und ohne
Farbe. Gleiche Eingabe gibt dieselbe Geometrie; die Kaesten liegen in einem
Gitter, dessen Zeilen so hoch sind wie ihr hoechster Kasten, und darum kann
sich kein Kasten mit einem anderen ueberschneiden. Der Test prueft das fuer
Tabellenzahlen von eins bis vierzig. Neben dem Bild steht dieselbe Liste in
Worten, damit das Bild nicht die einzige Quelle ist, und das SVG traegt
`role="img"` mit einer Beschriftung, die Schema und Zahlen nennt.

Mutation: die Zielspalten werden alphabetisch statt in Schluesselreihenfolge
zurueckgegeben. Im Stack faellt 1 von 178 Faellen, exit 1. Lokal faellt
nichts, weil die Regeltests mit Attrappen arbeiten; die Reihenfolge ist nur
am echten Katalog beweisbar, und genau dafuer gibt es den Fall. Ein erster
Mutationsversuch drehte die verweisende Seite, deren Namen im Fall schon
alphabetisch stehen: er bewies nichts und wurde verworfen.

Checkpoint `2.41.0` am 26. September 2026: PostgreSQL 17 mit 178 von 178,
exit 0, zweimal reproduziert; Lokal 1375 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Das Bild bleibt etwa bis fuenfzehn Tabellen lesbar; Kanten
weichen keinem Kasten aus, und Beschriftungen koennen sich an einem
gemeinsamen Knick ueberlagern. Primaerschluessel fehlen, weil die
Schema-Route sie nicht liefert; das steht in der Ansicht statt geraten zu
werden. Einen Schema-Waehler gibt es nicht, die Ansicht zeigt `public`. Die
neue Route nennt Namen von Tabellen und Spalten in fremden Schemas, die die
Schema-Route nicht zeigt: nur Namen, keine Daten, und kein Recht, das die
Leserolle nicht schon hatte. Im Browser nicht gesehen.

## Was der Zeitplan ausgeloest hat – Release 2.42

QKERN protokolliert keine Cron-Laeufe. Die Ansicht Logs, Cron baut das Log
deshalb aus zwei Quellen zusammen: den erwarteten Vorkommen aus dem
Ausdruck und den Nachrichten der Queue. Verbunden werden sie ueber den
Verifikator, den der Dispatcher beim Einreihen schreibt und den die Queue
nur als Hash speichert, nie im Klartext.

Genau daran haengt die ganze Behauptung. Bildet der Leser den Verifikator
anders als der Dispatcher, zeigt die Ansicht lauter Luecken, wo in
Wirklichkeit alles eingereiht wurde, und niemand merkt es. Der
Dedupe-Schluessel stand bisher inline im Dispatcher; er ist jetzt eine
benannte Funktion, die der Dispatcher selbst benutzt, und die Hashfunktion
wurde nicht nachgebaut, sondern exportiert. Der Zertifizierungsfall reiht
ueber Dispatcher und Queue-Dienst ein, nicht von Hand, sonst pruefte er
seine eigene Annahme.

Es gibt vier Zustaende, nicht drei. Neben gefunden, fehlt und noch nicht
faellig steht erwartet: fuer Vorkommen vor der Anlage der Definition und
fuer solche, deren Dedupe-Fenster abgelaufen ist. Dort beweist ein
fehlender Eintrag nichts, und die Ansicht sagt das, statt eine Luecke zu
behaupten.

Der Fall brauchte drei Anlaeufe beim Aufraeumen, und jeder Fehlschlag war
eine Produktzusage: Audit-Zeilen sind nachtraeglich unveraenderlich und
verweisen auf das Projekt; eine Queue-Nachricht mit Dedupe-Schluessel darf
vor Ablauf der Aufbewahrung nicht geloescht werden; und eine Organisation
mit Audit-Zeilen laesst sich nicht mehr loeschen. Der Fall hat jetzt eine
eigene Organisation und raeumt nur ab, was er abraeumen darf.

Mutation: der Leser bildet den Verifikator aus dem Namen statt aus der
Kennung. Im Stack faellt 1 von 179 Faellen, lokal 2 von 11
Cron-Tests, exit 1 beide Male.

Checkpoint `2.42.0` am 26. September 2026: PostgreSQL 17 mit 179 von 179,
exit 0, zweimal reproduziert; Lokal 1395 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Was der Container ausgegeben hat, steht nicht im Log. Ein
Dedupe-Fenster, das kuerzer ist als der Cron-Takt, macht aeltere Vorkommen
unbeweisbar; die Voreinstellung sind fuenf Minuten. Die Nachsicht von fuenf
Minuten misst gegen die Uhr der API, nicht die des Schedulers. Ein
geaenderter Ausdruck ist nicht rekonstruierbar, weil Ausdruck und Queue
unveraenderlich sind und eine Aenderung eine neue Definition ist. Die
Aufbewahrung loescht Nachrichten, ein Vorkommen wandert dann von gefunden
zu erwartet. Offen und nicht repariert: eine Queue mit Dedupe-Fenster 0
laesst zusammen mit einem Dedupe-Schluessel jeden Cron-Lauf scheitern. Im
Browser nicht gesehen.

## Ein Fenster von null – Release 2.43

Dieser Release baut nichts Neues. Er behebt einen Fehler, den die Arbeit am
Cron-Log zutage brachte: Eine Queue mit Dedupe-Fenster null liess jedes
Einreihen mit Dedupe-Schluessel scheitern, und weil der Dispatcher immer
einen Schluessel mitgibt, scheiterte jeder Cron-Job auf so einer Queue bei
jedem Vorkommen.

Die Ursache lag anders, als die erste Vermutung sagte. Nicht ein gleicher
Zeitpunkt war das Problem, sondern eine fehlende Frist: Das Repository
schrieb bei Fenster null den Verifikator ohne `dedupe_expires_at`, und die
Bedingung verlangt beides oder keines. Nach aussen kam `QUEUE_CONFLICT`,
also eine Aussage ueber ein Rennen, das nie stattfand. Der Fehler war
unsichtbar, weil der Speicherport diese Bedingung nicht kennt; erst die
Zertifizierung gegen echtes PostgreSQL bringt so etwas ans Licht.

Entschieden wurde: Fenster null heisst keine Entdopplung. Der Grund steht
am Entscheidungspunkt im Code. Null ist in Schema, OpenAPI und Route als
gueltige Einstellung zugesagt; Queue-Definitionen sind unveraenderlich, ein
Ablehnen wuerde bestehende Queues also dauerhaft unbrauchbar machen statt
sie zu reparieren; jede andere Stelle liest null ohnehin als "kein
Fenster"; und ein Verifikator ohne Frist waere nicht nur ungueltig, sondern
schaedlich, weil der eindeutige Index ihn fuer immer hielte. Eine Migration
braucht es nicht, weil solche Zeilen nie einfuegbar waren.

Der Preis steht im Handbuch statt im Verborgenen: Wer Entdopplung braucht,
und das tut jeder Cron-Job, muss ein Fenster groesser als null waehlen. Auf
einer Queue ohne Fenster laeuft ein Cron-Job mindestens einmal je
Vorkommen, nicht genau einmal.

Der Zertifizierungsfall prueft nicht nur das neue Verhalten, sondern auch,
dass die Bedingung wirklich greift: Er versucht von Hand, einen Verifikator
ohne Frist einzufuegen, und erwartet die Ablehnung.

Mutation: die Behebung wird an beiden Stellen zurueckgedreht. Im Stack
faellt 1 von 180 Faellen, lokal 1 von 17, exit 1 beide Male.

Checkpoint `2.43.0` am 26. September 2026: PostgreSQL 17 mit 180 von 180,
exit 0, zweimal reproduziert; Lokal 1398 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Ein Aufrufer, der den Konflikt bisher als "schon
eingereiht" gelesen hat, sieht jetzt mehrere Nachrichten. Genau auf der
Fensterkante entdoppelt der Speicherport einschliessend und PostgreSQL
nicht; der Test meidet die Kante und nennt den Grund, geaendert wurde
nichts.

## Was gerade laeuft – Release 2.44

Die Ansicht Advisors, Gesundheit probt acht Teilsysteme eines Projekts und
sagt je Teil, ob es erreichbar, abgeschaltet, nicht eingerichtet oder
gestoert ist, mit dem Beleg fuer dieses Urteil. Die Proben laufen
nebenlaeufig, und jede faengt ihren eigenen Fehler: ein abgeschalteter
Dienst kippt nicht die Seite. Fehlt dem Aufrufer eine Faehigkeit, meldet
genau diese Probe "unbekannt" mit Grund, statt die ganze Seite mit 403 zu
beenden.

Der Beleg kann strukturell kein Geheimnis tragen. Er besteht aus einem
Schluessel in eine feste Texttabelle und einer Zahl oder null; im
Regelmodul wird keine Zeichenkette zusammengesetzt, und der Vertragstest
prueft genau das. Der Routentest wirft eine Verbindungszeichenkette samt
Passwort als Fehler in eine Probe und verlangt, dass nichts davon in der
Antwort erscheint.

Der Zertifizierungsfall fiel zuerst, und zwar an seiner eigenen Probe: Er
suchte die Zeichenfolge "at ", um Stapelspuren auszuschliessen, und traf
damit das deutsche Wort "hat" im eigenen Text. Die Probe sucht jetzt die
Form einer Stapelzeile mit Datei, Zeile und Spalte und prueft zusaetzlich,
dass jeder Beleg nur eine bekannte Messgroesse mit Zahl oder null traegt.
Das ist schaerfer als vorher, nicht lockerer.

Mutation: der Beleg baut seine Beschriftung aus dem Mass zusammen, oeffnet
also genau den Schlitz, durch den spaeter ein Wert rutschen koennte. Im
Stack faellt 1 von 181 Faellen, lokal 3 von 13 Gesundheitstests,
exit 1 beide Male.

Checkpoint `2.44.0` am 26. September 2026: PostgreSQL 17 mit 181 von 181,
exit 0, zweimal reproduziert; Lokal 1418 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Gesund heisst hier erreichbar und eingerichtet, nicht dass
die Anwendung funktioniert. Bei Realtime und beim Vault heisst gruen nur,
dass eine Adresse hinterlegt ist; der Dienst wird nicht gefragt. Der
Sandbox-Schalter der Functions ist prozessweit und keine Aussage je
Projekt. Acht Proben je Aufruf ohne Zwischenspeicher: die Datenbankprobe
liest Spalten je Tabelle, die Data-API-Probe erzeugt das ganze
OpenAPI-Dokument. Im Browser nicht gesehen.

## Der Verlauf – Release 2.45

Drei Platzhalter hingen an derselben fehlenden Sache, und die Daten dafuer
lagen bereits da: `usage_events` traegt seit 0028 einen Zeitstempel je
Ereignis. Eine Zeitreihe ist deshalb eine Aggregation, keine neue Tabelle.
Gerechnet wird in der Datenbank, mit `date_trunc` auf beiden Seiten in UTC,
getrennten Summen fuer angenommen und abgelehnt und einer Obergrenze;
geladen wird nie eine Zeile zum Zusammenzaehlen.

Leere Eimer fuellt die reine Schicht im Dienst statt `generate_series` in
SQL. Der Grund steht im Code: die Datenbank liest dann nur vorhandene
Zeilen, und das Fuellen ist ohne Datenbank pruefbar. Das Fenster folgt der
Eimergroesse und nicht dem Aufrufer, damit niemand eine Reihe ueber ein
Jahr in Stundenschritten anfordern kann.

Ehrlich bleibt die Ansicht dort, wo die Vorlage zu viel versprach. Die alten
Notizen kuendigten Antwortzeiten, Belegung und Fehler an; nichts davon
steckt in einem Nutzungsereignis. Statt das zu erfinden, sagt jede Ansicht,
was sie nicht zeigen kann, und die Notizen sind aus der Navigation
verschwunden. "Abgelehnt" heisst immer, dass ein Kontingent gegriffen hat,
nie ein HTTP-Fehler.

Der Zertifizierungsfall hatte zwei falsche Erwartungen, und beide entstanden
durch Abschreiben. Erst zaehlte die Summe ein Ereignis mit, das
ausdruecklich vor dem Fenster liegt; dann uebernahm die Tageserwartung die
Zahlen der Stunde, obwohl das Tagesfenster neunzig Tage umfasst und das
aeltere, von der Quota abgelehnte Ereignis darin liegt. Beide Erwartungen
rechnen jetzt je Fenster, mit der Rechnung im Kommentar. Die zweite ist
damit die interessantere Zusicherung geworden: sie zeigt, dass das Fenster
entscheidet, was mitzaehlt, nicht die Eimergroesse.

Mutation: die Aggregation trennt angenommen und abgelehnt nicht mehr. Im
Stack faellt 1 von 182 Faellen, exit 1. Lokal faellt nichts, weil die
Regeltests mit Attrappen arbeiten und das SQL gar nicht ausfuehren; genau
dafuer gibt es den Fall gegen echtes PostgreSQL.

Checkpoint `2.45.0` am 26. September 2026: PostgreSQL 17 mit 182 von 182,
exit 0, zweimal reproduziert; Lokal 1444 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Keine Antwortzeiten, keine Belegung, keine Containerfehler.
Der letzte Eimer ist immer angebrochen, und ein leerer Eimer heisst kein
gemessenes Ereignis, nicht ein gesunder Dienst. Die Aggregation ist am
Praefix indexfreundlich, aber `observed_at` steckt nicht im Index; bei
echtem Volumen braucht es eine Rollup-Tabelle oder einen BRIN-Index.
`usage_events` wird heute nie geraeumt, die Reihe ist also vollstaendig;
kaeme eine Aufbewahrungsfrist, wuerde sie stillschweigend kuerzer. Auf dem
Speicherport meldet die Route "Metering nicht aktiv", obwohl es eher "kann
nicht aggregieren" heisst. Im Browser nicht gesehen.

## Zahlen statt Abfragetexte – Release 2.46

Die Ansichten Berichte, Datenbank und Berichte, Verbindungen lesen die
Statistiksichten der Projektdatenbank. Die heikle Stelle ist
`pg_stat_activity`: dort steht der Abfragetext, und ein Abfragetext kann
Werte eines fremden Mandanten tragen. Gelesen werden deshalb nur Rolle,
Zustand, Anzahl und das Alter der aeltesten Sitzung, gefiltert auf die
eigene Datenbank und gruppiert. Eine einzelne Sitzung ist ein Mensch bei
der Arbeit, eine Zahl ist eine Betriebsgroesse.

Nicht gelesen werden `query`, `query_start`, `state_change`,
`backend_xmin`, `client_addr`, `client_hostname`, `client_port`, `pid`,
`application_name`, `wait_event` und `backend_type`. Die letzten beiden
waeren harmlos; sie fehlen trotzdem, weil sie nicht gebraucht werden. Es
gibt kein `pg_terminate_backend` und kein `pg_cancel_backend`, auch nicht
als toter Code, und der Vertragstest verbietet die beiden Woerter im Dienst,
in der Route und in beiden Ansichten.

Die Leserolle ist kein Superuser und gehoert nicht zu `pg_monitor`. Sie
sieht fremde Sitzungen nur teilweise. Statt das zu verschweigen, steht
`numbackends` aus `pg_stat_database` neben den gezaehlten Gruppen, die
Ansicht sagt, dass die Zahl niedriger sein kann, und der
Zertifizierungsfall sichert genau diese Richtung ab.

Der Fall prueft ausserdem, dass er nicht leer laeuft: Er stellt fest, dass
sein Markertext im selben Moment wirklich in `pg_stat_activity.query`
stand, und fragt das mit einem gebundenen Parameter ab, damit die Pruefung
den Marker nicht selbst in ihren eigenen Abfragetext schreibt.

Mutation: der Abfragetext wandert in das Zustandsfeld. Im Stack faellt 1 von
183 Faellen, exit 1.

Checkpoint `2.46.0` am 26. September 2026: PostgreSQL 17 mit 183 von 183,
exit 0, zweimal reproduziert; Lokal 1458 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: `usename` ist der einzige freie Text, der die Datenbank
verlaesst; in QKERN sind das Dienstrollen, eine Installation mit einer
Login-Rolle je Person wuerde hier Namen zeigen. Eine hohe Trefferquote
ueber eine frisch zurueckgesetzte Statistik sagt wenig, darum steht der
Zeitpunkt des Zuruecksetzens daneben. Rollbacks zaehlen auch gewollte
Ruecknahmen. Im Browser nicht gesehen.

## Grenzen und Rechte von Realtime – Release 2.47

Die beiden Platzhalter unter Realtime sind jetzt Ansichten, und beim Bauen
kamen zwei Dinge ans Licht, die vorher niemand aufgeschrieben hatte.

Die Nachrichtengrenze laesst sich nicht einstellen. Sie steht mit hundert
Nachrichten je zehn Sekunden in der Sitzungsklasse, aber der Server reicht
die Einstellung nie durch, also erreicht sie keine Umgebungsvariable. Die
Ansicht weist die Herkunft deshalb als `code` aus statt als
`environment`, und die Notiz, die "Grenzen fuer Nachrichten je Sekunde"
versprach, ist weg.

Kanalrechte gibt es, anders als der alte Hinweis nahelegte. Sie entscheiden
aus Organisation, Rolle und Kanalpraefix; bei Aenderungskanaelen entscheidet
zusaetzlich die Zeilensicherheit der Tabelle je Abonnent, und nach einem
DELETE erfaehrt nur die Dienstrolle den Schluessel, weil die Zeile weg ist
und niemand mehr beantworten kann, wer sie haette sehen duerfen.
Gespeichert ist nichts davon: die Regeln stehen im Code, und genau das sagt
die Ansicht. Der Vertragstest gleicht alle sechsunddreissig Felder der
gezeigten Matrix gegen die echte Pruefklasse ab, dazu einen fremden
Teilnehmer und eine fremde Organisation.

Betriebszahlen zeigt die Seite nicht. Sie liegen im Realtime-Prozess, und
der Next-Prozess haelt keinen Dienst davon. Statt Nullen zu zeigen, sagt
die Antwort, dass die Zahlen in einem anderen Prozess liegen.

Kein PostgreSQL-Fall: Der Slice liest nur Umgebungsvariablen und beruehrt
die Datenbank nicht. Ein Fall haette die Arbeit der Nachbarn geprueft, nicht
diese.

Mutation: anon darf angeblich private Kanaele lesen. Lokal faellt 1 von 6
Vertragsfaellen, exit 1.

Checkpoint `2.47.0` am 26. September 2026: Lokal 1476 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen. Keine
Serveraenderung an der Datenbank, deshalb keine Docker-Zertifizierung.

Nicht erbracht: Die Route liest die Umgebung dieses Prozesses. In den
Zertifizierungsstacks ist sie dieselbe wie im Realtime-Prozess, in einer
geteilten Installation koennte sie abweichen; die Seite sagt das. Aendern
lassen sich die Grenzen nur in der Umgebung, die Rechte nur im Code. Im
Browser nicht gesehen.

## Drei Slices nebeneinander – Release 2.48

Zum ersten Mal haben mehrere Implementierer gleichzeitig gearbeitet, jeder
in einer eigenen Arbeitskopie desselben Repositorys. Das Zusammenfuehren
brachte fuenf Konflikte, alle mechanisch, weil drei Zweige an dieselben
Listenenden angefuegt hatten. Danach fielen zwei Vertraege, und beide zu
Recht: neun verwaiste Uebersetzungen, weil jeder Zweig nur seine eigenen
Platzhalternotizen entfernt hatte, und die Zahl der Datenbankfaelle, die
zwei neue Faelle nicht kannte. Das Verfahren hat also genau das gefangen,
was paralleles Arbeiten neu einbringt.

Die Anmeldungen bekommen eine Reihe und ein Protokoll. Die Handlungsarten
stammen aus dem Code, nicht aus einer Liste im Kopf, und eine Sammelgruppe
faengt auf, was eine kuenftige Version schreiben koennte: ohne sie waeren
die Summen irgendwann falsch, ohne dass es jemand merkt. Der
Zertifizierungsfall kann keine Zeitstempel in die Vergangenheit legen, weil
die Tabelle anhaengend ist; er liest die echten Zeitstempel zurueck und
verschiebt das Fenster darum herum.

Der Tabellen-Designer ist der erste Slice heute, der schreibt. Er schreibt
aber nichts selbst: jede Aenderung wird ein Change Set und geht durch
dieselbe Freigabe wie jede andere Schemaaenderung. Geloescht wird nichts,
Typen werden nicht gewechselt. Die einzige freie Eingabe sind Namen.

Die Mutationsprobe wurde dort zur interessantesten des Tages. Beim
Aufheben der Bezeichnerpruefung fielen lokal 20 von 66 Faellen, im Stack
aber keiner – weil das Zitieren den Namen ein zweites Mal prueft. Der
Kommentar im Code sagt "zwei Pruefungen, weil eine zu wenig waere", und das
ist jetzt belegt statt behauptet. Erst mit beiden aufgehobenen Schichten
faellt der Zertifizierungsfall. Die zweite Mutation, Fehlversuche nicht
mehr getrennt zu zaehlen, faellt im Auth-Fall.

Checkpoint `2.48.0` am 26. September 2026: PostgreSQL 17 mit 185 von 185,
exit 0, zweimal reproduziert; Lokal 1567 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Der Designer legt keine Schluessel an und kennt nur das
Schema `public`; breite Tabellen muessen ueber den SQL-Editor. Ein
Aufrufer kann weiterhin beliebiges SQL an die Change-Set-Route schicken,
das war schon vorher so; der Designer fuegt keine Flaeche hinzu. Die
Reihe der Anmeldungen kennt kein Auffrischen von Token, weil der Dienst es
nicht protokolliert. Im Browser nicht gesehen.

## Was der Scanner sah – Release 2.49

Der Platzhalter versprach "Uploads, Downloads und Scanner-Urteile je
Objekt". Zwei Drittel davon gibt es nicht. Der Speicher fuehrt kein
Ereignisprotokoll: eine Zeile je Objekt traegt den aktuellen Stand, ein
Urteil ueberschreibt das vorherige, und ein Download hinterlaesst nichts
ausser einer kurzlebigen signierten Adresse. Statt ein Protokoll zu
erfinden, zeigt die Ansicht den Stand der Objekte mit ihrem Urteil und sagt
vor der ersten Zeile, was sie nicht hat.

Beim Bauen kam ein Fehler ans Licht, der ohne diese Arbeit unentdeckt
geblieben waere. Stuft der Scanner ein Objekt als befallen ein, setzt
derselbe Schritt auch den Loeschzeitpunkt. Die bestehende Auflistung
filtert entfernte Zeilen weg. Ein infiziertes Objekt waere damit in keiner
Liste je aufgetaucht: genau das Urteil, das am meisten zaehlt, waere
unsichtbar gewesen. Die neue Abfrage behaelt solche Zeilen, und der
Kommentar im Code sagt, warum.

Die Mutationsprobe belegt es. Blendet die Abfrage entfernte Zeilen wieder
aus, faellt der Zertifizierungsfall, weil das infizierte Objekt aus der
Liste verschwindet.

Ein Wort zum Verfahren: Ich habe den Fall zuerst im falschen Stack laufen
lassen. Die Storage-Integrationsdatei gehoert zum PostgreSQL-Lauf, nicht
zum versitygw-Lauf, und die acht bestandenen Faelle dort kamen aus einer
ganz anderen Datei. Ein gruener Lauf beweist nichts, wenn er die falsche
Datei faehrt.

Checkpoint `2.49.0` am 26. September 2026: PostgreSQL 17 mit 186 von 186,
exit 0, zweimal reproduziert; Lokal 1581 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Kein Zugriffsprotokoll, keine Historie der Urteile, keine
signierte Adresse und kein Provider-Schluessel in der Antwort. Die Zahlen je
Urteil folgen dem gewaehlten Bucket, nicht dem gewaehlten Urteil. Die
Reihe fuer Realtime zaehlt zugestellte Nachrichten, nicht Verbindungen. Im
Browser nicht gesehen.

## Zweiter Faktor und Datenbank-Webhooks – Release 2.50

Zwei Slices, beide mit einem Fund, der ohne sie nicht aufgefallen waere.

Der Schalter fuer den zweiten Faktor wirkt an drei Stellen im Dienst, nicht
in der Console: dort wo eine Sitzung entsteht, beim Auffrischen und bei
jeder Pruefung eines Zugriffstokens. Die dritte kostet einen kleinen
Lesezugriff je Anfrage und schliesst dafuer das Fenster von bis zu fuenfzehn
Minuten, in dem ein vor dem Umschalten ausgegebenes Token sonst weitergaelte.
Wer noch keinen Faktor hat, bekommt statt einer Sitzung einen
Einrichtungsschein, der nur die Einrichtung oeffnet; ohne ihn wuerde das
Einschalten alle aussperren.

Der Fall dazu brachte einen alten Fehler ans Licht: Die
Wiederherstellungscodes gehen in eine jsonb-Spalte, wurden aber als
JavaScript-Feld uebergeben, und der Treiber macht daraus ein Postgres-Feld
in geschweiften Klammern. Die Datenbank weist das ab. Die Einrichtung des
zweiten Faktors hat gegen eine echte PostgreSQL-Datenbank also nie
funktioniert, in zwei Pfaden, obwohl TOTP als zertifiziert galt: kein
Zertifizierungsfall ging bisher diesen Weg, und die Einzeltests arbeiten mit
einer Attrappe, die keine Spaltentypen kennt.

Die Datenbank-Webhooks koppeln an den vorhandenen Change Feed statt einen
zweiten Trigger in die Kundendatenbank zu legen. Die Begruendung steht im
Code: zwei Erfassungswege hiessen zwei Zusagen darueber, was eine erfasste
Aenderung traegt, und genau diese Zusage ist der einzige Grund, warum die
Flaeche sicher ist. Eine Zustellung traegt Schema, Tabelle, Vorgang,
Primaerschluessel, Position und Zeitpunkt.

Die Mutationsprobe war hier lehrreich. Der erste Versuch, die geaenderte
Zeile in die Nutzlast zu schmuggeln, schrieb schlicht nichts: eine Aenderung
im Feed traegt gar keine Zeilenwerte. Die Sicherheit liegt nicht in einem
Filter der Bruecke, sondern darin, dass die Quelle die Werte nie hergibt.
Der zweite Versuch, die Kopplung jede Tabelle nehmen zu lassen, blieb
ebenfalls gruen – weil der Fall nur eine Tabelle kannte. Seit der
Erweiterung um eine zweite, nicht gekoppelte Tabelle faellt er.

Checkpoint `2.50.0` am 26. September 2026: PostgreSQL 17 mit Vault 1.18 mit
188 von 188, exit 0, zweimal reproduziert; Lokal 1648 bestanden, 0
fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: Die Bruecke der Webhooks hat keinen dauerhaften Aufrufer;
sie ist gebaut, zertifiziert und untaetig, weil der Compute-Prozess keine
Verbindung zur Projektdatenbank haelt. Der Primaerschluessel erreicht den
Empfaenger, auch beim Loeschen, und laesst sich nicht unterdruecken. Eine
Tabelle ohne Erfassung erzeugt keine Zustellung. Beim zweiten Faktor bleibt
ein Restweg: Wer QKERN-Token eigenstaendig gegen den oeffentlichen
Schluessel prueft, sieht ein vor dem Umschalten ausgegebenes Token bis zum
Ablauf als gueltig; das Token traegt seine Stufe, aber QKERN kann einen
fremden Pruefer nicht zwingen, sie zu lesen. Im Browser nicht gesehen.

## Die Bruecke laeuft – Release 2.51

Release 2.50 hinterliess einen Satz, der so nicht stehen bleiben durfte: die
Webhook-Bruecke war gebaut, zertifiziert und untaetig, weil kein Prozess sie
aufrief. Jetzt laeuft sie, und der Zertifizierungsfall beweist es als
Prozess und nicht als Funktionsaufruf: Er startet den Worker, macht eine
Aenderung, wartet auf die Zustellung, schickt ein Beendigungssignal, prueft
dass waehrend der Pause nichts geliefert wird, startet neu und zaehlt genau
drei Zustellungen in Reihenfolge.

Die Position ist dafuer dauerhaft geworden. Sie wird nie rueckwaerts
geschrieben, weil zwei Instanzen eine zulaessige Aufstellung sind und die
langsamere die schnellere nicht zurueckdrehen darf. Laesst sie sich nicht
lesen, startet die Umgebung gar nicht: bei null zu beginnen hiesse, den
ganzen Strom zu wiederholen.

Bei den Ruecksprungzielen kam ein Befund heraus, der die Arbeit einfacher
machte als gedacht: QKERN leitet nirgends selbst um. Das Ziel reist nur in
die Adresse einer Aktionsmail und in den verschluesselten OIDC-Zustand, wo
es ungenutzt bleibt. Es gibt also wirklich nur eine Engstelle, und der
Vertragstest verlangt, dass genau sie viermal aufgerufen wird und die alte
Direktpruefung nirgends mehr steht.

Bei den Protokollen wurde vor allem abgeraeumt. Das Aufrufprotokoll der
Functions ist echt, traegt aber weder die Ausgabe des Containers noch die
Ausgangsverbindungen noch einen Endzeitpunkt; der Platzhalter versprach
alle drei. Fuer die Data API gibt es ueberhaupt kein Protokoll je Anfrage,
und der vorhandene Zaehler mischt alle Quellen in eine Zahl. Die Ansicht
sagt das zuerst und zeigt dann zwei belegbare Dinge, benannt als das, was
sie sind.

Drei Mutationen, drei Treffer: ein wirkungsloser Ausgangsfilter, eine leere
Projektliste bei den Ruecksprungzielen, ein Neustart der wieder bei null
beginnt. Eine vierte Mutation traf daneben und lehrte etwas: Sie drehte nur
den Aktualisierungspfad des Cursors, und weil der Fall nur einmal neu
startet, blieb sie folgenlos. Der Fehler lag in der Mutation, nicht im Fall.

Checkpoint `2.51.0` am 26. September 2026: PostgreSQL 17 mit 191 von 191,
exit 0, zweimal reproduziert; Lokal 1719 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Werden alle Kopplungen einer Umgebung geloescht statt
ausgeschaltet, haelt ihre Position an, und eine spaeter angelegte Kopplung
sieht, was der Strom noch haelt. Ein Absturz zwischen Einreihen und
Schreiben der Position wiederholt hoechstens eine Stapelmenge. Die Migration
`0051` ist nicht optional: fehlt sie, scheitert jede Anmeldung laut, weil
dieselbe Zeile den Zweitfaktor-Schalter traegt. Mailtexte gibt es nur in
einer Sprache und nur fest. Im Browser nicht gesehen.

## Regeln, die nie liefen – Release 2.57

Vier offene Punkte aus 2.39, 2.40, 2.44 und 2.46, alle vier von den Releases
selbst notiert. Die Frage war jedes Mal dieselbe: Ist der Grund, aus dem
damals nichts geschah, noch der Grund, oder war es Bequemlichkeit?

Bei den Anmeldeanbietern war es der Grund, aber ein zu weiter. Die Projektion
gab Slug und Issuer heraus, und die Regel brauchte weder das eine noch das
andere, sondern ein Ja/Nein. Ein abgeleitetes `boolean` ist kein Durchreichen:
Es ist ein Vergleich, und in einen Vergleich passt kein Secret. Die
oeffentliche Provider-Route verengt trotzdem weiter auf zwei Felder, weil die
Betriebsart eines Anbieters niemanden etwas angeht, der noch nicht angemeldet
ist.

Bei `pg_stat_statements` traf der Grund die Spalte `query` und die Zeilen
fremder Datenbanken — und nicht die Zaehler. Zwei Klauseln reichten: `dbid`
auf die eigene Datenbank, und `query` nirgends auswaehlen. Dazu ist das Feld
`text` aus `PerformanceAdvisorStatement` verschwunden, das seit 2.40 nie
gefuellt wurde. Ein Feld, das einen Abfragetext tragen koennte, ist ein Feld,
das jemand spaeter fuellt.

Bei Realtime und Vault war eine Probe der falsche Weg: Eine Verbindung
aufzubauen oder den Vault zu fragen ist mehr, als diese Seite tun soll. Der
ehrliche Weg war der billigere — der Zustand heisst jetzt `configured` und
nicht mehr `ok`. Er liegt im Rang ueber `ok`, und damit sagt das Gesamturteil
eines Projekts mit Realtime nicht mehr „erreichbar“. Das sieht aus wie eine
Verschlechterung und ist die Korrektur einer Unwahrheit.

Bei den Verbindungen war es nur eine Subtraktion, die bisher der Leser machen
musste. `backends` minus die gezaehlten Gruppen steht jetzt als Kachel da,
nach unten auf null geklemmt: Beide Zahlen kommen aus zwei Abfragen
nacheinander, und eine dazwischen geschlossene Sitzung darf keine negative
„unsichtbare“ Zahl ergeben.

Der Zertifizierungsfall `(2.57) proves the advisor rules that used to be
unreachable` legt einen Marker als Literal in den Text eines Utility-Befehls,
weist nach, dass `pg_stat_statements` ihn wirklich traegt, und prueft danach,
dass die ganze Antwort von `inspectStatements` frei davon ist — nach dem
Muster von 2.46, wo derselbe Beweis fuer `pg_stat_activity` gefuehrt wurde.
Dafuer laedt der PostgreSQL-Stack die Erweiterung seit diesem Release ueber
`shared_preload_libraries`; die anderen Stacks legen sie nicht an, und der
Berater meldet sie dort als nicht installiert.

Lokal `2.57.0`: `npx tsc --noEmit -p .` gruen, Vitest 1724 bestanden, 0
fehlgeschlagen, 275 uebersprungen.

Nicht erbracht: Die PostgreSQL-Zertifizierung dieses Slices ist nicht
gefahren; die Zahl 192 ist gezaehlt, nicht belegt. Ohne `pg_read_all_stats`
sieht die Leserolle fremde Zeilen ohne Kennung, der Berater sieht also weniger
als im Cluster steht. Die Provider-Regel sagt etwas ueber die Konfiguration
und nichts darueber, ob ein Anbieter mit `required` seine Adressen wirklich
prueft. Im Browser nicht gesehen.

## Grenzen, Geheimnisse, alte Versprechen – Release 2.52

Dieser Release raeumt vor allem auf, und dabei kamen drei Schwaechen der
Anmeldung ans Licht, die vorher niemand aufgeschrieben hatte. Die Bremse
gegen zu viele Versuche zaehlte im Arbeitsspeicher eines Prozesses: bei
mehreren Instanzen war die wirkliche Grenze ein Vielfaches der gemeinten,
und ein Neustart setzte alles zurueck. Sie zaehlte ausserdem nach einem
Hash der Client-Adresse, und ohne gesetzte Proxy-Einstellung landeten alle
Aufrufer in einem einzigen Topf. Und das Auffrischen von Token hatte
ueberhaupt keine Grenze.

Jetzt zaehlt die Datenbank, nach Identitaet oder Sitzungsfamilie, nie nach
Adresse. Der Schluessel steht nur als Pseudonym in der Zeile; das ist keine
Anonymisierung, und genau das steht im Modul, im Handbuch und auf der Seite.
Die Pruefung sitzt vor jedem Nachschlagen, damit eine bekannte und eine
unbekannte Adresse dieselbe Antwort bekommen. Bei einem Fehler des Zaehlers
geht der Versuch durch: die eigentliche Tuer ist die Passwortpruefung
dahinter, und das Gegenteil machte aus einem Fehler in der Zaehlertabelle
einen vollstaendigen Anmeldeausfall.

Die Vault-Uebersicht zeigt jede Referenz, die QKERN kennt, mit ihrem
Zustand und keinen einzigen Wert. Den Vault selbst listet sie nicht auf,
obwohl das ginge: ein Verzeichnis der Pfade in einer Webkonsole gaebe die
Struktur des Schluesselspeichers an jeden weiter, der die Konsole lesen
darf. Nebenbei fiel auf, dass ein Datenbank-Webhook zusaetzlich eine Zeile
des ausgehenden Webhooks besitzt; beide zu listen haette dieselbe Referenz
wie zwei Geheimnisse aussehen lassen.

Vier Punkte, die frueher Releases ehrlich als offen notiert hatten, sind
eingeloest. Zwei Beraterregeln standen dauerhaft auf "nicht geprueft"; eine
Regel, die nie laufen kann, gehoert nicht als Dauerzustand in eine Liste.
Die Anbieterregel bekam ein einziges zusaetzliches Feld, einen
Wahrheitswert, der keine Stelle hat, an der eine Kennung stehen koennte.
Die Regel zu langsamen Anweisungen liest jetzt einen sicheren Ausschnitt
ohne die Spalte `query`, und das Feld, das den Text haette tragen koennen,
ist aus dem Typ verschwunden: was es nicht gibt, fuellt auch niemand
spaeter. Die Gesundheit hat einen sechsten Zustand, weil gruen vorher nur
"Adresse hinterlegt" hiess. Und der Datenbankbericht nennt die fuer diese
Rolle unsichtbaren Verbindungen als Zahl statt als Einschraenkung in Prosa.

Drei Mutationen, drei Treffer: der Griff zum Datenendpunkt des Vault faellt
in zwei Faellen, der durchgereichte Anweisungstext in einem, der
stehengebliebene Zaehler in einem.

Checkpoint `2.52.0` am 26. September 2026: PostgreSQL 17 mit 193 von 193,
exit 0, zweimal reproduziert; HashiCorp Vault 1.18 mit 8 von 8, exit 0,
zweimal reproduziert; Lokal 1774 bestanden, 0 fehlgeschlagen, zweimal
reproduziert; `next build` gruen.

Nicht erbracht: Eine Grenze je Identitaet haelt keinen verteilten Angriff
ueber viele Konten auf. Die Pruefung der Mehrfaktor-Antwort und der
OIDC-Start haengen weiter an der Bremse im Prozess, weil dort keine
Identitaet feststeht. Der Zustand `configured` laesst jedes Projekt mit
Realtime schlechter aussehen als vorher; das ist die Korrektur, nicht eine
Verschlechterung. Ohne erweiterte Leserechte fallen fremde Zeilen ohne
Kennung aus der Anweisungsstatistik. Im Browser nicht gesehen.

## Was das Passwort verraet – Release 2.53

Der Platzhalter "Angriffsschutz" versprach drei Dinge: Captcha, Pruefung
gegen bekannte Lecks und Bot-Abwehr. Gebaut ist das eine, das ohne fremden
Dienst auskommt. Ein Abgleich bei einem externen Anbieter hiesse, dass jede
Anmeldung jedes Kunden zu einem fremden Rechner reist, und das ist keine
Entscheidung, die ein Backend fuer seine Nutzer treffen sollte.

Die unbequeme Haelfte steht ueberall dort, wo jemand sie lesen muss: Die
eingebaute Liste hat 25 Eintraege aus einer benannten Quelle, und alle sind
kuerzer als die zwoelf Zeichen, die QKERN ohnehin verlangt. Ohne eigene
Listendatei weist der Schalter also nichts ab, was die Laengenregel nicht
schon abweist. Er gibt dem Schalter ein definiertes Verhalten, keinen
Schutz. Die Alternative waere gewesen, Eintraege zu erfinden und eine Quelle
zu behaupten.

Bei den Datenbank-Einstellungen hat sich die Untersuchung gelohnt. Von den
vier versprochenen Dingen existieren zwei: Verbindungsdaten, die aber nie
gezeigt werden duerfen, und TLS, das ausserhalb der Console entschieden
wird. Pooler und Netzbeschraenkung gibt es ueberhaupt nicht. Die Ansicht
zeigt Rollen, TLS-Zustand und Grenzen und sagt den Rest, statt eine
Oberflaeche fuer etwas zu bauen, das nicht da ist.

Beim Punkt-in-Zeit war die beste Arbeit, nichts zu tun. Die Uebung aus 2.29
beweist laengst eine Wiederherstellung auf einen gewaehlten Zeitpunkt: Sie
schreibt Markierungen, merkt sich einen Zeitpunkt dazwischen, stellt darauf
wieder her und prueft, dass die fruehe Markierung da und die spaete weg ist.
Die Grunddatensicherung wird ohne mitgeschriebene Protokolle genommen, der
Rest kommt also wirklich aus dem Archiv. Ein zusaetzliches Feld im Beleg
haette dessen Signatur ungueltig gemacht, fuer eine Tatsache, die ohnehin
geprueft wird.

Zwei Mutationen, zwei Treffer: ohne die Pruefung beim Anmelden kommt ein
bekanntes Leck-Passwort durch, und eine Antwort, die jede Verbindung als
verschluesselt ausgibt, faellt auf. Der zweite Fehler waere der gefaehrlichere,
weil eine gruene Anzeige dazu fuehrt, dass niemand etwas unternimmt.

Drei Korrekturen am eigenen Verfahren stehen dabei im Log. Die
Schwaerzungsregel trifft jeden Schluessel, der "password" enthaelt, und
machte aus einem Wahrheitswert ein geschwaerztes Feld; der Audit-Eintrag
heisst jetzt anders, die Regel bleibt. Ein globales Umbenennen im Test traf
auch die Eingaben an die Schnittstelle. Und eine Leckprobe verglich jeden
Wert mit dem Zugangsnamen, obwohl im Stack Rechner, Zugang und Eigentuemer
der Datenbank alle "postgres" heissen; sie prueft jetzt die Form der Antwort
statt einzelner Woerter, was schaerfer ist.

Checkpoint `2.53.0` am 27. September 2026: PostgreSQL 17 mit 195 von 195,
exit 0, zweimal reproduziert; Mailpit und Dex mit 7 von 7, exit 0; Lokal
1844 bestanden, 0 fehlgeschlagen, zweimal reproduziert; `next build` gruen.

Nicht erbracht: Kein Captcha und keine Bot-Abwehr ueber die Grenzen aus 2.52
hinaus. Bestehende Passwoerter werden nie geprueft, weil ein Argon2-Hash
nicht lesbar ist. Kein Pooler, keine Netzbeschraenkung. Fuer echte
Installationen fehlt die Archivkonfiguration, also auch die Wiederherstellung
auf einen Zeitpunkt. Im Browser nicht gesehen.

## Was hinausgeht – Release 2.54

Ein Log-Drain ist die Stelle, an der Daten das Haus verlassen. Deshalb gilt
hier eine harte Grenze: Weitergeleitet wird nur, was die Console ohnehin
zeigt. Das ist keine Absichtserklaerung, sondern zwei Pruefungen. Eine
Positivliste je Quelle entscheidet, was ueberhaupt in eine Ladung kommt, und
ein Test liest die Zeilentypen der Konsolenansichten aus den Quelldateien
und haelt jedes weitergeleitete Feld dagegen. Ein Gegentest sorgt dafuer,
dass die Zusage nicht leer ist: Zwei Felder, die die Console zeigt, duerfen
ausdruecklich nicht hinausgehen, weil sie eine Adresse tragen koennen.

Zwei Quellen fehlen mit Absicht. Das Cron-Log wird je Anfrage rekonstruiert
und nicht gespeichert; ein Vorkommen ginge sonst immer wieder mit
wechselndem Zustand hinaus. Und Zustellungen, die zu einem Drain selbst
gehoeren, sind ausgenommen, sonst erzeugte jede weitergeleitete Ladung eine
Zeile, die der naechste Lauf wieder weiterleitet.

Die Vorlagen des SQL-Editors fuegen ein und fuehren nichts aus. Den Knopf
drueckt ein Mensch. Jede Vorlage laeuft im Test durch denselben Waechter,
den auch die Route benutzt, und die Mutationsprobe zeigt, dass das
kein Zierat ist: eine Vorlage mit einer Funktion mit Nebenwirkung faellt
sowohl im Einzeltest als auch im Zertifizierungsfall.

Der dritte Slice beantwortet die Frage, was ein angemeldeter Nutzer darf,
und foerdert zwei Dinge zutage, die man wissen sollte. Ein angemeldeter
Nutzer wird gar keine eigene Datenbankrolle: Es gibt nirgends einen
Rollenwechsel, jede Anfrage laeuft ueber dieselbe Anwendungsrolle, und die
Identitaet steckt ausschliesslich in Anspruechen, die transaktionslokal
gesetzt werden. Und eine Tabelle ohne Zeilensicherheit ist nicht offen,
sondern fuer die Data API unerreichbar. Das ist die Tatsache, die Leute
ueberrascht, und die Mutationsprobe dreht genau sie um.

Checkpoint `2.54.0` am 27. September 2026: PostgreSQL 17 mit 198 von 198,
exit 0, zweimal reproduziert; Lokal 2013 bestanden, 0 fehlgeschlagen,
zweimal reproduziert; `next build` gruen.

Nicht erbracht: Der Sammler der Drains hat noch keinen dauerhaften
Aufrufer; seine Position liegt im Prozess, ein Neustart beginnt in der
Gegenwart und eine abgebrochene Ladung kann doppelt gehen. Ein Objektname
kann persoenliche Angaben enthalten und geht trotzdem hinaus, weil die
Console ihn zeigt; die Ansicht benennt das. Das Urteil zu den Anmelderechten
kann eine Bedingung nicht auswerten, die eine Einstellung oder eine Funktion
liest. Im Browser nicht gesehen.

## Welle sieben (2.55): die eigene Sicht

Drei Schnitte, die nebeneinander in getrennten Arbeitsbaeumen entstanden
sind, und zwei Befunde, die erst der Lauf gegen die echte Datenbank
hervorgeholt hat.

Die Darstellung der Console gehoert jetzt der Person. Sprache, Zahlenformat,
Zeitzone, Startseite und Thema liegen in `user_console_settings` neben
`users`, nicht in der Ablage des Browsers: Die Einstellung muss lesbar sein,
bevor eine Organisation gewaehlt ist, und sie soll auf dem zweiten Geraet
derselben Person gelten. Fuenfunddreissig Ansichten formatieren seither ueber
dieselbe Stelle, und ein Vertrag verbietet in `components/console` jedes
`Intl`, jedes `toLocale` und jedes `toFixed`.

Der Log-Explorer sucht ueber genau die drei Quellen, fuer die es eine
Leseroute ueber die ganze Umgebung gibt, und sagt bei den uebrigen, warum
nicht. Freies SQL bekommt er bewusst nicht: Alle log-artigen Zeilen von QKERN
liegen in der Control Plane, wo die Zeilen aller Organisationen in denselben
Tabellen stehen, und eine Abfragefaeche darueber hinge mit jeder Zeile an
einer einzigen Policy.

Zwei Befunde aus dem Lauf. Erstens: `timestamptz::text` schreibt den Versatz
zweistellig, wenn er auf volle Stunden faellt. Der Explorer hielt `+00` fuer
eine Zeit ohne Zone, hing ein `Z` an und erzeugte ein ungueltiges Datum. Die
Quelle warf, der Faecher meldete sie als nicht erreichbar, und die gemischte
Liste zeigte stumm die Haelfte ihrer Zeilen. Zweitens, und das ist der
unangenehmere: Der Zertifizierungsfall hatte sich die Lesungen der Route
nachgebaut, weil er die Route ohne HTTP nicht betreten konnte. Der Filter
`authStatus` stand damit einmal in der Route und im Fall gar nicht, und beide
waren gruen. Die Lesungen liegen jetzt in `lib/server/logs/log-explorer-fetchers`,
und der Fall setzt nur noch die Tuer ein.

Der Sammler der Drains laeuft als eigener Prozess und haelt seinen Stand in
`project_log_drain_cursors`. Ein Neustart springt nicht mehr auf die Spitze
und ueberspringt nicht, was in der Zwischenzeit entstanden ist. Die
Mutationsprobe dreht genau das um und laesst den Neustartfall fallen.

Checkpoint `2.55.0` am 27. September 2026: PostgreSQL 17 mit 201 von 201,
exit 0, zweimal reproduziert; Lokal 2088 bestanden, 0 fehlgeschlagen,
zweimal reproduziert.

Nicht erbracht: Der Drain liefert mindestens einmal, nicht genau einmal. Der
Puffer wird bei SIGTERM nicht geleert. Ein Objektname kann persoenliche
Angaben enthalten und geht trotzdem hinaus. Gespeicherte Suchen des
Explorers liegen nur im Browser. Vier Log-Seiten haben weiterhin kein
Backend. Im Browser nicht gesehen.

## Welle acht (2.56): was die Datenbank ueber sich sagt

Drei Schnitte, drei Platzhalter weniger, und alle drei lesen nur. Der rote
Faden ist diesmal nicht eine neue Faehigkeit, sondern eine Grenze, die jede
der drei Seiten selbst ausspricht.

Die Abfrage-Leistung zeigt, was eine Abfrage kostet, und nicht, welche es
ist. `pg_stat_statements` normalisiert nur Abfragen; ein Utility-Befehl steht
mit seinem Literal in der Sicht, und damit auch das Passwort aus einem
`CREATE ROLE`. Dazu traegt auch eine normalisierte Abfrage noch Bezeichner.
Die Entscheidung steht ausgeschrieben ueber der Anweisung, und die Seite
nennt den Ersatz: wer einen einzelnen Plan sehen will, bekommt ihn in den
Abfrage-Einblicken.

Die Abfrage-Einblicke planen, ohne auszufuehren: `EXPLAIN` ohne `ANALYZE`.
Die Pruefung auf eine lesende Abfrage steht vor dem Praefix, sonst waere ein
`EXPLAIN ANALYZE DELETE` moeglich. Die Mutationsprobe setzt genau dieses
`ANALYZE` ein, und der Fall faellt am Zaehler `pg_stat_user_tables.seq_scan`:
Er belegt an einer echten Tabelle, dass fuenf Plaene sie nicht gelesen haben,
und weist mit einer Gegenprobe nach, dass sich der Zaehler ueberhaupt bewegen
kann.

Die Infrastruktur beantwortet "worauf laeuft das hier". Jede Angabe wird im
Fall ein zweites Mal als Eigentuemer nachgelesen und verglichen, und die
gemeldete Groesse muss mit zehn Megabyte mitwachsen, die wirklich geschrieben
und danach wieder geloescht werden. Lese-Replikate gibt es nicht; das steht
als Zeile mit Grund da und nicht als leere Kachel.

Zwei Befunde aus dem Parallelbetrieb, beide im Verfahren und nicht im
Produkt. Alle drei Agenten haben dieselbe freie Fallnummer gegriffen. Und der
Stash gehoert dem Repository, nicht dem Arbeitsbaum: Ein `git stash pop` hat
die Arbeit eines anderen Arbeitsbaums erwischt. Sie ist sofort zurueckgelegt
worden, nichts ist verloren, und in parallelen Arbeitsbaeumen wird kein Stash
mehr benutzt.

Checkpoint `2.56.0` am 27. September 2026: PostgreSQL 17 mit 204 von 204,
exit 0, zweimal reproduziert; Lokal 2130 bestanden, 0 fehlgeschlagen,
zweimal reproduziert.

Nicht erbracht: Die Abfrage-Leistung zeigt keinen Text, auch keinen
normalisierten. Die Planungszeit ist die einzige gemessene Zahl der
Abfrage-Einblicke; alles andere ist die Schaetzung des Planers. Die
Infrastruktur kennt keine Instanzgroesse und keine Platte. Im Browser nicht
gesehen.

## Welle neun (2.57): was nicht da ist, steht auch da

Drei Schnitte, drei Platzhalter weniger, und diesmal beginnt jede der drei
Seiten mit dem, was sie **nicht** hat.

Logs -> Postgres versprach ein Serverlog. Es gibt keines: QKERN hat keinen
Dateizugriff auf die Projektdatenbank, und eine Flaeche, die so taete, waere
eine Luege. Gebaut ist stattdessen der Zustand aus den Statistiksichten,
ehrlich benannt. Dabei hat der Schnitt zwei Dinge richtig gemacht, die man
leicht falsch macht. Erstens fragt der Dienst mit `to_regclass` nach, welche
Sicht ein Server hat, statt es anzunehmen: PostgreSQL 17 hat die
Checkpoint-Zaehler nach `pg_stat_checkpointer` verschoben, und ein
unbekannter Name scheitert schon beim Parsen. Zweitens meldet die Antwort
`null` statt `0`, wenn eine Datenbank keine Pruefsummen hat. Eine Null waere
die Behauptung, es sei nachgesehen worden; die Mutationsprobe dreht genau das
um.

Auth-Leistung versprach Antwortzeiten. Die gibt es nicht, und zwar aus einem
Grund, der in der Ablage steht: Ein Eintrag der Audit-Kette traegt einen
Zeitpunkt, keine Dauer, und den zweiten Zeitpunkt derselben Handlung
schreibt kein Code. Dafuer war die Fehlerrate je Handlungsart laengst da und
wurde weggeworfen: Die Aggregation zaehlt seit 2.47 `COUNT(*) FILTER (WHERE
status = 'failed')` je Eimer **und** je Handlung, und beim Aufbau der Reihe
fiel das zu einer Summe je Eimer zusammen. Die Seite zeigt es jetzt, ohne
eine einzige zusaetzliche Abfrage.

Wrappers liest fremde Datenquellen, und der heikle Teil sind die Optionen.
`srvoptions` darf jede Rolle lesen, die den Katalog liest, und dort kann ein
Passwort stehen. Gezeigt wird der Wert nur bei Schluesseln auf einer
Positivliste; jede andere Option steht mit Namen da und ohne Wert. Eine
Sperrliste waere bei `pwd` oder `api_key` blind gewesen. Die Entscheidung
steht im Dienst und nicht in der Ansicht, damit sie auch fuer die
MCP-Bruecke gilt, und der Zertifizierungsfall legt ein echtes Geheimnis an
und liest als Gegenprobe nach, dass es im Katalog wirklich steht.

Drei Befunde im Verfahren. Eine Datei `RELEASE_2.57.md` trug die Fallnummern
eines Schnitts als Versionsnummer, fuer ein Release, das es nie gab; sie
heisst jetzt `SLICE_BERATERREGELN.md`. Das Scratchpad ist zwischen den
Agenten geteilt, und zwei haben dieselbe Datei unter demselben Namen
gesichert. Und beim Zusammenfuehren haengen zwei Zweige ihren neuen Fall an
dieselbe Stelle der Testdatei: Beide Seiten zu behalten schiebt die Faelle
ineinander.

Checkpoint `2.57.0` am 27. September 2026: PostgreSQL 17 mit 207 von 207,
exit 0, zweimal reproduziert; Lokal 2141 bestanden, 0 fehlgeschlagen,
zweimal reproduziert.

Nicht erbracht: Vier neue Routen stehen nicht in der OpenAPI-Beschreibung.
Postgres-Zustand und Berichte -> Datenbank ueberschneiden sich. Die Zaehler
haben keinen Zeitpunkt. Eine gescheiterte Anmeldung ist kein Angriff. Im
Browser nicht gesehen.

## Welle zehn (2.58): die Beschreibung hinkt nicht mehr

Zwei Platzhalter weniger, eine vollstaendige API-Beschreibung samt Vertrag,
und ein Fehler, der seit 2.54 ausgeliefert war.

Der Fehler zuerst, weil er der wichtigste Teil dieser Welle ist. Der Treiber
gibt `timestamptz` als JavaScript-`Date` heraus, und ein `Date` kennt nur
Millisekunden. Der Drain-Sammler merkt sich die Position einer Zeile als deren
Zeitpunkt und Kennung; diese Position war damit **kleiner** als die Zeile, aus
der sie stammt, und der Zeilenvergleich liess dieselbe Zeile bei jedem Lauf
wieder durch. Beim Aufrufprotokoll fiel es nicht auf, weil dort ein
JavaScript-Zeitpunkt geschrieben wird und die Mikrosekunden ohnehin null sind.
In `audit_logs` setzt die Datenbank `now()`, und dort trifft es zu. Gefunden
hat es der Schnitt zu den Dashboard-Webhooks an seinem eigenen Code; behoben
ist es an beiden Stellen, in vier von fuenf Lesungen des Drains. Die fuenfte
braucht es nicht, weil ein Nutzungs-Eimer auf die Stunde abgeschnitten ist,
und dort steht der Grund als Kommentar.

Der Nachweis dazu hat selbst zwei Anlaeufe gebraucht, und das ist die Lehre
dieser Welle. Der erste Versuch prueft den Sammler: ein zweiter Lauf ohne neue
Zeile soll nichts schicken. Die Mutationsprobe ist **nicht** gefallen, und
genau das war der Befund: Eine wieder hereingelesene Zeile legt sich in den
Puffer und wartet dort auf ihr Zeitfenster, der Lauf meldet null, und der
Fehler bleibt unsichtbar. Geprueft wird jetzt die Zusage selbst, am Leser: Die
Position einer Zeile schliesst diese Zeile aus, und die Position der ersten
von zwei Zeilen laesst genau die zweite uebrig. Eine Probe, die nicht faellt,
ist die einzige Stelle, an der ein zu schwacher Fall auffaellt.

Die API-Beschreibung hinkte hinter den Routen her: 27 Pfade fehlten, darunter
zehn Schema-Kataloge, die Aggregate und RPC der Data API, die
Multipart-Uploads und die Rechnungsrouten. Sie stehen jetzt drin, mit den
echten Grenzen aus den Konstanten. Der eigentliche Wert ist der Vertrag: Er
findet jede Routendatei, uebersetzt ihren Pfad und verlangt, dass er
beschrieben ist oder mit Grund auf einer Ausnahmeliste steht. Er prueft auch
die Gegenrichtung, weil ein beschriebener Pfad ohne Route eine Zusage ohne
Deckung ist, und er haelt einen Riegel gegen sich selbst: Ein leerer
Dateilauf wuerde jede Luecke durchlassen, darum verlangt er ueber hundert
gefundene Routen. Beim ersten Einsatz hat er sofort gegriffen und die neue
Replikations-Route benannt.

Die Replikation zeigt Publikationen, Abonnements und Slots. Die Zahl, auf die
es im Betrieb ankommt, ist der Rueckstand: Ein verlassener Slot haelt WAL
fest, bis die Platte voll ist. `subconninfo` wird nicht gefiltert, sondern in
keiner Anweisung ausgewaehlt. Die Dashboard-Webhooks tragen Ereignisse des
Projekts hinaus, ueber dieselbe Outbox, denselben Vault-Signierer und dasselbe
Backoff wie die Datenbank-Webhooks, mit einer Positivliste der Felder je
Ereignisart.

Checkpoint `2.58.0` am 27. September 2026: PostgreSQL 17 mit 209 von 209,
exit 0, zweimal reproduziert; Lokal 2174 bestanden, 0 fehlgeschlagen,
zweimal reproduziert.

Nicht erbracht: Die Beschreibung prueft Pfade, nicht Methoden. Die Zustellung
ist mindestens einmal. Die Audit-Ansicht faltet den Zustand des Provisioners
falsch. Ein logischer Slot ist im Stack nicht pruefbar, weil der Cluster
`wal_level = replica` faehrt. Im Browser nicht gesehen.

## Welle elf (2.59): geschlossen faellt, was nicht antwortet

Zwei Platzhalter weniger, ein Vertrag ueber die HTTP-Verben, und zwei Fehler,
die der eigene Zertifizierungsfall gefunden hat.

Die Auth-Hooks sind der Schnitt, an dem eine einzige Entscheidung alles
bestimmt: Was passiert, wenn der Hook nicht antwortet. Beide Punkte fallen
**geschlossen**. Keine Antwort in der Frist heisst keine Sitzung und kein
Token, und die Seite nennt den Preis wortwoertlich: Ein Hook, der haengt,
sperrt diese Projektumgebung aus. Drei Ausgaenge bleiben unterschieden, damit
die Console "hat abgewiesen" von "war nicht erreichbar" und von "hat
unbrauchbar geantwortet" trennen kann.

Die Auswahl der Punkte folgt einer Regel, die es wert ist, aufgeschrieben zu
werden: Ein Punkt, an dem das Ergebnis des Aufrufs verworfen wuerde, ist kein
Hook, sondern eine Benachrichtigung, die wie eine Wirkung aussieht. Darum gibt
es keinen Punkt "nach der Anmeldung" und keinen Mail-Hook; der Link einer
Aktionsmail traegt das Token im Klartext.

Der Fall hat zwei echte Fehler gefunden. Der Anspruchs-Hook stand hinter dem
Schreibzugriff, und eine Abweisung liess damit eine Sitzung ohne Token zurueck;
bei einer Erneuerung waere die Sitzungsfamilie erledigt gewesen. Und die
erklaerten Ansprueche fielen im Audit still weg, weil die Bereinigung kein
Komma in einem Metadatenwert durchlaesst.

Der S3-Zugang ist der Schnitt, der am meisten weggelassen hat. Beide moeglichen
Wege sind begruendet verworfen: Beim Anbieter laesst sich kein Paar anlegen,
weil alle Objekte aller Projekte in einem Bucket liegen und nur das Praefix sie
trennt; und gegen QKERN selbst laesst sich ein Paar nicht pruefen, solange nur
sein Hash liegt, weil eine S3-Signatur nachgerechnet wird und die Rechnung das
Geheimnis braucht. Gebaut ist die Ausgabe samt Verwaltung, und der erste
Absatz der Seite sagt, dass das Paar heute nichts oeffnet.

Der Verb-Vertrag hat **nichts gefunden**, und das ist ein gutes Ergebnis: 165
exportierte Verben deckten sich genau mit 165 beschriebenen Operationen, in
beide Richtungen. Nachgetragen wurde nichts. Der Wert liegt in der Strenge des
Lesers: Er kennt die drei Exportformen des Bestands, und jede andere Form am
Zeilenanfang laesst den Vertrag mit Datei und Zeile fallen.

Ein Nachtrag zum Verfahren, der mir selbst gilt. Nach elf Stack-Laeufen hatte
die Maschine 1.9 von 15.7 GiB frei, und die lokale Suite ist darunter
zerfallen. Ich habe zuerst den falschen Schluss gezogen und einen statischen
Import als Ursache benannt; die Gegenprobe gegen den Stand von 2.58, heute
zweimal gruen, hat das widerlegt. Die Ursache war der Speicher. Die
Entkopplung bleibt, weil sie fuer sich richtig ist, aber ohne den falschen
Messwert im Kommentar.

Checkpoint `2.59.0` am 27. September 2026: PostgreSQL 17 mit 211 von 211,
Mailpit und Dex mit 7 von 7, versitygw und ClamAV mit 8 von 8, alle exit 0;
Lokal 2191 bestanden, 0 fehlgeschlagen, zweimal reproduziert mit
`--maxWorkers=3`.

Nicht erbracht: Ein S3-Paar oeffnet nichts, und es gibt keine Rotation. Der
Container laeuft nach Ablauf der Hook-Frist weiter. Der Verb-Vertrag prueft nur
Exporte am Zeilenanfang. Die CORS-Vorfluege stehen mit Grund draussen. Im
Browser nicht gesehen.
