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

- Prozesseinstieg `workers/project-queue-runtime.ts` entfernt: Der Vertrag nennt
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
