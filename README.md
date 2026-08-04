# QKERN 1.8 Alpha 1

QKERN ist der intelligente Kern deiner Anwendung: ein AI-nativer Backend-Vertical-Slice mit Marketingseite, QKERN Console, serverseitiger Tenant-Prüfung, echter PostgreSQL-Data-Plane, Generated Data API, getrenntem Project Auth, privatem Object Storage, lokaler Realtime-Foundation, Project Queues, tenantgebundenem Usage Metering, Migration Previews, einstellbarer Agentenautonomie, Approval Center, Audit Log und MCP Server.

> Status: belastbarer Product MVP und Architekturgrundlage — keine fertige globale BaaS-Infrastruktur. Die Console unterscheidet implementierte Kernflows klar von Roadmap-Funktionen. Schweizer Hosting- und Datenresidenz-Aussagen bleiben bis zur Wahl und Prüfung der Infrastruktur ausdrücklich unbestätigt.

## Was funktioniert

- Eigenständige responsive Landingpage mit den verbindlichen QKERN-SVG-Assets und `#004DD5` als Brand Token
- Light/Dark Mode, interaktive Console-Vorschau und vollständige QKERN Console
- Module für Overview, Database, Table Editor, SQL, Auth, Storage, REST API, AI Bridge, Activity, Approvals, Logs, Usage & Quotas, Backups und Settings
- Registrierung, Login, Logout und Session-Prüfung mit nativem Argon2id, gehashten Session-Tokens und gehärtetem Host-only-Cookie
- Serverseitig aus der Session abgeleitete Organisationsrollen; Client-Header können keine Mitgliedschaft oder Actor-Identität erfinden
- SQL-AST-Guard und echte PostgreSQL-Data-Plane: Schema-Introspection sowie Read-only-Abfragen laufen tenantgebunden, RLS-erzwungen, rollenverifiziert, zeilen-/bytebegrenzt und mit Secret-Redaction
- Generated Data API mit live-schema-gebundenem CRUD, Projekt-Keys, parametrierten Filtern, Cursor-Pagination, RLS-Pflicht, dynamischem OpenAPI und echtem Table Editor
- Von QKERN-Accounts getrennte Project-Auth-App-User mit Email/Passwort, Verifikation, Magic Link, Reset, TOTP-/Recovery-MFA, OIDC Authorization Code + PKCE und Admin API
- Kurzlebige Ed25519-Access-JWTs, JWKS-Rotation, opaque Refresh-Einmalrotation samt Familienwiderruf bei Replay und serverseitiges App-User-Claim-Mapping in PostgreSQL-RLS
- Standardmäßig deaktiviertes Object Storage mit privaten Buckets, festen Policies,
  MIME-/Größenlimits, atomarer Quota, verifier-only Upload-Completion, S3-SigV4-
  Grants, Provider-HEAD-Verifikation, Quarantäne, fail-closed ClamAV-Streaming,
  Scanner-Port, Race-gehärteter Quota/Completion/Delete-Buchhaltung, Lifecycle und
  portlosen MinIO-/ClamAV- sowie PostgreSQL-Concurrency-Harnesses
- Disabled-by-default Realtime-WebSocket-Foundation mit First-Frame-Auth über
  Project Key plus optionales App-JWT, scope-isolierten Channels, Broadcast,
  privater Presence, signierten Replay-Cursors, Ordering und Backpressure; der
  Alpha-1-Host ist loopback-only und verweigert Production
- Disabled-by-default Project-Queues-Foundation mit Scope-/Policy-Isolation,
  verzögertem JSON-Enqueue, verifier-only Dedupe, atomaren Claims,
  workergebundenen Lease-Tokens, Renewal, Retry und Dead Letters; PostgreSQL 17
  persistiert Queues und Claims tenantisoliert mit RLS und `SKIP LOCKED`, während
  der `ephemeral` Memory-Adapter in Production technisch abgewiesen wird
- injizierbarer separater Queue-Worker mit Handler-Timeout, Lease-Heartbeat,
  Shutdown/Abort, festen Fehlerklassen und redigierten Ereignissen/Zählern;
  Admin-only DLQ-Liste und genau-einmalig gebundenes Replay ohne Payloadausgabe
- Compute-Vertragsports für digest-gepinnte Node.js-Functions außerhalb des
  Webprozesses, UTC-Cron→Queue-Dedupe und signierte HTTPS/443-Webhooks mit
  SSRF-/Redirect-/Timeout-/Exact-Ack-Grenzen und Secret-Referenzen statt Werten
- frameworkfreies `@qkern/sdk` mit generischem Database-Typ für Typed Table CRUD,
  Schema, Project Auth, Storage und Queues; Header-only Credentials, bounded
  Timeout/Responses, redirectfreie Requests und keine automatischen Write-Retries
- secretfreie `@qkern/cli`-Workflows für init/status/schema pull/migration plan/
  seed check; deterministische Typgenerierung, Pfadgrenze, Single-SQL-Planung und
  INSERT-only Seed-Vertrag ohne automatische Ausführung
- reproduzierbare ESM-/DTS- und CLI-Paketbuilds, eigenständige Tarball-Prüfung,
  ausführbarer Fresh-Project-Smoke-Test und vorbereitete Linux-/Windows-/macOS-
  CI-Matrix; der aktuelle lokale Nachweis stammt ausdrücklich nur von Linux
- Disabled-by-default Usage Metering mit sechs festen UTC-Monatsmetriken,
  verifier-only Idempotenz, atomaren `observe`-/`enforce`-Quotas, RLS-gebundener
  PostgreSQL-Persistenz und echter read-only Console-/REST-Projektion; Preise,
  Tarife und Rechnungen sind ausdrücklich noch nicht implementiert
- Pro Projekt und Umgebung einstellbare Modi `manual`, `guarded` und `autonomous`; autonome Policies ersetzen die menschliche Freigabe pro Änderung innerhalb einer expliziten Risikogrenze, behalten aber Decision-Artefakt, Audit, Not-Aus und Worker-Prüfungen
- An den Change Set gebundene Approval-Hashes mit TTL und Einmaligkeit, Audit Events und Secret Redaction
- Lokales MCP über STDIO und Streamable HTTP mit Bearer-Token, Sessions, engen Schemas, Result-Limits und Read-only-Tools
- Laufzeitwählbare Memory- oder PostgreSQL-Adapter für Auth, Sessions, Memberships und Control Plane; API-Routen und MCP nutzen dieselbe Service-Grenze
- PostgreSQL-Control-Plane mit erzwungener RLS, getrennten Auth-/Runtime-Rollen, verschlüsselten SQL-Artefakten und lokalem Docker-Stack
- Explizite Apply-Queue-API nach einer Approval: `POST /api/v1/changesets/{changeSetId}/apply` legt nur einen asynchronen Auftrag an und führt im Request niemals SQL aus
- Tenantgebundene PostgreSQL-Queue und referenzbasierte Outbox mit genau einem Job pro Change Set, idempotentem Enqueueing, geleasten Claims und Fencing über Worker-ID, Lease-Token und Ablaufzeit
- Dedizierte Control-Plane-Datenbankgrenze `qkern_worker`: Web-/API-Runtime darf enqueueen, aber nur der separat geprüfte Worker-Login darf Job-, Outbox- und Change-Set-Zustände fortschreiben
- Worker-Sicherheitsdomäne, die Approval-Bindung, Ablaufzeit, Tenant, Projekt, Umgebung, Lease, entschlüsselten Statement-Hash und genau ein erlaubtes SQL-Statement unmittelbar vor dem Executor-Aufruf erneut prüft
- Serieller, abbrechbarer Worker-Loop mit Idle-Wait, begrenztem Fehler-Backoff, sauberem SIGINT-/SIGTERM-Shutdown und redigierter Runtime-Telemetrie
- Standardmäßig deaktivierte, ausschließlich an `127.0.0.1` gebundene Liveness-/Readiness-Proben für Provisioner, Migration Worker und beide Publisher; Readiness ist erst nach aktuellem erfolgreichem Poll grün und fällt bei Fehler, Veraltung, Clock-Rollback oder Shutdown geschlossen
- Deterministischer Kubernetes-Basisvertrag und fail-closed CLI-Gate für genau diese vier Prozesse: digest-gepinntes Image, Non-root, read-only Root-Dateisystem, keine Capabilities/Privilege-Escalation/Service-Account-Tokens/Host-Namespaces, feste Ressourcen, private Authority-Referenzen und keine Service-/Ingress-Exposition
- Ed25519-signiertes Live-Deployment-Evidenzgate: ein externer Cluster-Runner bindet Rollout, Probes, SIGTERM-/Restart-Tests, Security Contexts, Secret-Projektionen, Default-deny/Egress, Image-Signatur/SBOM/Provenance und Alarmrouting an den exakten aktuell generierten gehärteten Bundle-, Image-, Cluster- und Policy-Pin; QKERN projiziert nur feste redigierte Readiness
- Ed25519-signiertes Real-Service-E2E-Gate: ein unabhängiger Zertifizierungsrunner muss 15 feste PostgreSQL-17-Szenarien für Provisioning/Idempotenz, Broker-Negativpfad, Vault-Ausgabe/Rotation/Widerruf, TLS-Pin, Apply/Reconciliation/Retry, Stale-Worker-Cancellation, Cross-Tenant-Isolation, Apply-Delivery, Incident-Pager und den vollständigen Alert-Lifecycle bestehen; sieben externe Artefaktpins binden Provider, Konfiguration, Broker, Vault, Pager sowie die exakten Restore- und Deployment-Nachweise
- Ed25519-signiertes Security-Assessment-Gate: eine unabhängige Prüfstelle muss 14 feste Kontrollen einschließlich Threat Model, Dependency/SAST/DAST/Secret-Scans, Cross-Tenant-, REST-/MCP-, Prompt-Injection-, SSRF-, Approval-Race-, Backup-, Session-/Token- und Penetrationstests bestätigen; acht exakte Artefaktpins binden Release, SBOM und Prüfberichte, während Critical und High Findings zwingend null bleiben
- Gemeinsamer Release-Evidence-Preflight: ein einzelner fail-closed Befehl verifiziert die vier signierten Evidence-Envelopes und hasht Release-ZIP sowie alle Evidence-Dateien exakt gegen die fünf bereits serverseitig gepinnten Production-Apply-Digests
- Finaler Production-Readiness-Preflight: verbindet den gehärteten Vier-Workload-Bundle, die vollständige Evidence-Kette und eine secretfreie Production-/TLS-/Tenant-/Origin-Konfigurationsprüfung zu einer redigierten `ready_for_controlled_rollout`-Entscheidung, während Production Apply zwingend deaktiviert bleibt
- Kryptografische Production-Apply-Sperre: Eine höchstens vier Stunden gültige externe Ed25519-Autorisierung bindet genau Tenant, Projekt, Change Set, Approval, Zielreferenz-Hash, Statement-/Action-Hash sowie fünf separat gepinnte Release-/Live-Evidenzen; Apply-Service und Worker prüfen unabhängig, Memory Mode verweigert Production immer
- Lease-Heartbeat während Zielausführung und Ledger-Reconciliation sowie eine monotone `claim_sequence`, die jeden Reclaim als neue Fence-Epoche ausweist
- `TrustedProjectDatabaseConnectionCatalog` als serverseitig injizierte Exact-Match-Allowlist für opaque Instanzreferenzen, getrennte Pools und erwartete Datenbank-/Rollen-/Ledger-Owner-Bindungen
- Production-Katalog mit HashiCorp-Vault-Static-Credentials, pro TTL rotierendem Passwort, koaleszierten Refreshes, fail-closed Provider-Ausfällen und atomarem Pool-Generationswechsel ohne Abbruch aktiver Clients
- Exakte TLS-Bindung jeder Projekt-Datenbank an Hostname und SHA-256-Leaf-Zertifikat; Vault-Token werden pro Refresh aus einem privaten, rotierbaren Agent-Sink gelesen und nie als Environment-Wert akzeptiert
- Tenantgebundene Projekt-Datenbank-Provisioning-API mit idempotenter Anforderung, fünf gefencten Versuchen pro Zyklus, höchstens drei autorisierten Recovery-Zyklen und redigiertem Status ohne Infrastrukturdetails
- Separater `qkern_provisioner`-Login und startbarer Provisioner-Host: signierter reference-only Brokervertrag, exakter Bootstrap-Hash, atomare Pending→Managed-Bindung und unveränderliches secret-freies Binding-Ledger
- Persistente, an Tenant und eigene Provisioner-ID gebundene Heartbeats sowie `GET /api/v1/projects/provisioning/health`: feste Zwei-Minuten-Liveness- und Fünf-Minuten-Queue-SLOs, disjunkte Fehlerursachen und fail-closed Health-Klassifizierung ohne direkte Job-/Heartbeat-Tabellenrechte
- Standardmäßig deaktivierter OpenMetrics-Exporter unter `GET /api/internal/v1/projects/provisioning/metrics`: ein fest konfigurierter Tenant, eigener rotierbarer Private-File-Bearer, keine Cookie-/Header-Impersonation und ausschließlich feste redigierte Metriknamen/-Labels
- Fail-closed Backup-/Restore-Evidenzgate: ein externer Drill-Runner signiert einen strikten, secretfreien Control-Plane-Nachweis mit Ed25519; QKERN pinnt den Public Key, prüft Frische, RPO/RTO, Zeitfolge, Verschlüsselungs-/Checksum-/Schema-/Rowcount-/Audit-Assertions und gleiche Datenmanifeste und exportiert optional nur feste Readiness-Metriken
- Persistierter Production-Vault-Katalog: Der Migration Worker löst nur provisionierte Control-Plane-Bindings auf; Host, Rolle und Zertifikatspin kommen nicht mehr aus einer normalen Runtime-Umgebungsvariable
- Transaktionaler `PostgresProjectDatabaseExecutor` mit exakter, kataloggebundener Least-Privilege-Rollenprüfung, `SET LOCAL`-Timeouts und einem nach Change-Set-ID plus SHA-256 geführten Ziel-Ledger
- Persistentes, separat besessenes Target-Fence in der Projekt-Datenbank; zurückeroberte Retries sind nur nach dauerhaft bestätigter neuer Fence-Epoche zulässig
- Persistente Reconciliation-only-Queue für unbekannte Ausführungsergebnisse: getrennte Versuchszähler verbieten jede erneute SQL-Ausführung und führen nach drei erfolglosen Ledger-Prüfungen in den auditierten Zustand `review_required`
- Autorisierter Operator-Recovery-Pfad für `review_required`: ausschließlich Owner und Administratoren dürfen eine referenzbasierte, fest typisierte Reconciliation-Anweisung anlegen; nur der Worker setzt sie in bis zu drei weiteren, weiterhin SQL-freien Prüfzyklen um
- Automatische Incident-Eskalation nach ausgeschöpften Review-Zyklen: nur der Worker darf einen unveränderlichen, referenzbasierten Critical-Incident erzeugen; Owner und Administratoren können ihn mit festen Codes quittieren, Support darf ihn nur lesen
- Worker-verifizierte Incident-Auflösung: Owner und Administratoren dürfen höchstens drei feste Target-Ledger-Rechecks anfordern; ausschließlich ein exakter Ledger-Treffer im SQL-freien Reconciliation-Pfad kann Job, Change Set und Incident atomar als angewendet beziehungsweise `resolved` markieren
- Atomare Incident-Notification-Outbox: jeder neu eröffnete Incident erzeugt genau ein referenzbasiertes `migration.incident.opened`-Event; ein eigenständig aktivierbarer At-least-once-Publisher liefert es mit Lease-Fencing, exaktem Ack und Backoff
- Ausführbarer Incident-Publisher-Host mit HMAC-signiertem Pager-/Ticket-Webhook, pro Zustellung aufgelöstem Rotationsschlüssel und versionierter Key-ID, exakter Host-Allowlist, Production-HTTPS/Port-443-Gate, deaktivierten Redirects, begrenzter Antwortgröße und redigierten Fehlern
- Persistente Incident-Dead-Letter-Policy: acht bestätigte Zustellfehler beenden automatisches Retrying atomar; Recovery-Commands binden den erwarteten Fehlercode, die erwartete Retry-Generation und einen kompatiblen festen Grund über API, Datenbank-Trigger und Worker-Revalidierung, bevor höchstens drei weitere Zustellzyklen öffnen
- Reproduzierbares Real-PostgreSQL-Zertifizierungs-Harness: ein portloser, tmpfs-basierter PostgreSQL-17-Stack prüft Upgrade 0017→0018, Backfill/Reject, NULL-Constraints, ABA-Replay, exakten Retry, Command-first-Lock-Ordering und Worker-only-Resolution in einer erzeugten Wegwerf-Datenbank
- Tenant-isolierte Incident-Delivery-Sicht: jede Incident-Antwort enthält den redigierten Zustellzustand und einen festen letzten Fehlercode; `GET /api/v1/migrations/incidents/delivery/health` liefert disjunkte aktive Fehler-Counts, Handlungsstatus und älteste relevante Zeitpunkte über enge Datenbankfunktionen
- Signierter Apply-Broker-Host mit referenzbasiertem Body, HMAC-SHA-256, versionierter Key-ID, pro Zustellung neu gelesener privater Schlüsseldatei, exakter Host-Allowlist, Production-HTTPS/443, deaktivierten Redirects, begrenztem Ack und gemeinsamem Timeout
- Persistente Apply-Delivery-Policy: feste redigierte Fehlercodes, acht gefencte Fehler bis `dead_lettered`, höchstens drei ABA-sicher an Fehlercode und Retry-Generation gebundene Recovery-Zyklen sowie tenantisolierte Status-/Health-APIs ohne direkte Outbox-Leserechte
- Eigenständig konfigurierbarer Apply-Outbox-Publisher, der kein aktiviertes Migration-Worker-Flag und keine Worker-ID voraussetzt
- Lokales MCP-Tool `qkern_migration_apply_queue`, als destruktiver Write annotiert und deshalb vor jedem Aufruf durch den MCP-Client bestätigungspflichtig
- Unit-/Security-Tests für SQL, Tenant-Isolation, Rollen-Grenzen, Secret-Maskierung, Approval-/Queue-Replay, Lease-Fencing, Worker-Retries, PostgreSQL-Executor und Adapter-Auswahl

Die Apply-Infrastruktur ist fail-closed: Provisioning-Zustandsautomat, Worker-Loop, persistente Provisioner-Heartbeats, tenantisolierte Health-Projektion, authentifizierter OpenMetrics-Export, kryptografische Backup-/Restore-, Live-Deployment-, Provider-E2E- und Security-Assessment-Evidenzgates, loopbackgebundene Prozess-Probes, gehärteter Pre-Deployment-Vertrag, PostgreSQL-Executor, Runtime-Komposition, Target-Ledger/-Fence, Reconciliation-Quarantäne, beide signierten Publisher und ihre Dead-Letter-/Recovery-Spuren sind implementiert. `npm run provisioner:projects` sendet ausschließlich Referenzen und den gepinnten Bootstrap-Vertrag an einen externen Infrastruktur-Broker; Provider-Credentials bleiben außerhalb von QKERN. `npm run worker:migrations` löst das daraus gespeicherte Binding über Vault auf. Die Evidenzgates verifizieren nur extern erzeugte, signierte Nachweise und besitzen weder Provider-, Backup-/Restore-, Cluster-, Pager- noch Audit-Autorität. Der Deployment-Generator erstellt nur vier enge Kubernetes-Workloads. v0.30 erzwingt die Change-Set-gebundene Release-Signatur; v0.31 liefert Provider-/Pager-E2E; v0.32 schließt Security Assessment und den fünfteiligen Release-Preflight. RC1 verbindet diese Grenzen zu einer letzten secretfreien, redigierten Go-live-Entscheidung, die ausdrücklich keinen Rollout ausführt und Production Apply deaktiviert halten muss. Provider-Onboarding und die tatsächlichen Backup-/Restore-, Cluster-, Prometheus-/OTel-, Pager-, Real-Service- und unabhängigen Security-Zertifizierungsläufe bleiben offen; da die Lieferung keine positive Autorisierung erzeugt oder enthält, bleibt Production-Apply technisch gesperrt. Der normale Web-/MCP-Prozess provisioniert keine Infrastruktur und führt kein Projekt-SQL aus.

## Lokal starten

Voraussetzung: Node.js 24.7+; QKERN verwendet das native Argon2id aus `node:crypto`.

```bash
npm install
npm run dev
```

Öffne `http://localhost:3000`, erstelle unter `/register` einen Account und öffne danach `/console`.

Prüfungen:

```bash
npm run typecheck
npm test
npm run build
```

Das zusätzliche Release-Gate `npm run verify:backup-restore` benötigt eine echte, extern signierte Evidenz und die drei in `.env.example` dokumentierten Datei-/Public-Key-Pin-Werte. Ohne diesen Live-Nachweis muss es absichtlich fehlschlagen.

`npm run verify:runtime-deployment-evidence` verifiziert entsprechend eine extern signierte Live-Cluster-Zertifizierung gegen den exakten vom aktuellen Release generierten Bundle, den Cluster-/NetworkPolicy-/Provenance-Pin und den separat gepinnten Public Key. Ohne echten Runner-Nachweis muss auch dieses Gate absichtlich fehlschlagen.

`npm run verify:security-assessment` verifiziert die unabhängig signierte Security-Zertifizierung gegen das exakte Release-Artefakt, SBOM und sieben Prüfberichte. `npm run verify:release-evidence` führt danach alle vier Evidence-Gates zusammen und bindet die tatsächlich gelesenen fünf Dateien an die Production-Apply-Pins. Ohne reale externe Nachweise müssen beide Befehle absichtlich fehlschlagen.

`npm run verify:production-readiness` ist der letzte trockene RC-Check. Er verlangt die gehärtete Runtime-Datei, die gesamte grüne Evidence-Kette, Production/PostgreSQL/TLS, exakt eine Tenant-Bindung, HTTPS-Ursprünge und alle Monitoring-/Evidence-Gates. Der Befehl rollt nichts aus und verweigert einen Zustand, in dem Production Apply bereits aktiviert ist.

`npm run verify:production-apply` prüft die externe, auf genau ein Production-Change-Set gebundene Release-Autorisierung. Es benötigt zusätzlich die in `.env.example` dokumentierten Subject- und fünf Evidenz-Pins. Das ausgelieferte Projekt besitzt absichtlich weder Private Key noch positive Autorisierung; ohne reale abgeschlossene Live-Gates muss der Befehl fehlschlagen.

Echte PostgreSQL-Zertifizierung in einem isolierten, nach dem Lauf vollständig entfernten Docker-Stack:

```bash
npm run test:postgres:docker
```

Echte MinIO-/ClamAV-Zertifizierung mit Clean- und EICAR-Pfad in einem ebenfalls
vollständig entfernten, portlosen Docker-Stack:

```bash
npm run test:storage:docker
```

Lokalen Realtime-Host nach gestarteter PostgreSQL-Control-Plane separat starten:

```bash
export QKERN_RUNTIME_MODE=postgres
export QKERN_REALTIME_ENABLED=true
export QKERN_REALTIME_ALLOWED_ORIGINS=http://localhost:3000
npm run realtime
```

Protokoll und Alpha-Grenzen: [docs/REALTIME_PROTOCOL.md](docs/REALTIME_PROTOCOL.md).

Project Queues lokal im Webprozess aktivieren:

```bash
export QKERN_PROJECT_QUEUES_ENABLED=true
export QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS=http://localhost:3000
export QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES=65536
npm run dev
```

Queue-Vertrag und Alpha-Grenzen: [docs/PROJECT_QUEUES.md](docs/PROJECT_QUEUES.md).

Optionale Infrastruktur:

```bash
docker compose up -d
```

Die nummerierten SQL-Dateien unter `db/migrations` laufen im offiziellen PostgreSQL-Image nur bei der ersten Initialisierung eines leeren Volumes. Für ein bestehendes Volume ist vor jedem Versionsupgrade ein eigener, kontrollierter Migrationslauf erforderlich; ein erneutes `docker compose up` aktualisiert das Schema nicht. Migration `0006_worker_runtime_boundary.sql` führt die Non-Login-Rolle `qkern_worker` ein, entzieht der Web-Runtime die terminalen Queue-/Outbox-Updates, bindet bestehende und neue Jobs per `approval_request_id` an den exakten Approval-Snapshot und gewährt dem Worker nur die für Claims, gefencte Übergänge und redigierte Audit-Einträge erforderlichen Rechte. Das Backfill muss bei bestehenden Daten erfolgreich genau eine zeitlich passende genehmigte Approval finden; inkonsistente Altbestände blockieren das Upgrade fail-closed. Migration `0008_migration_reconciliation_quarantine.sql` ergänzt den Enum-Zustand `review_required` ausserhalb der nachfolgenden Schema-Transaktion und installiert danach die begrenzten Reconciliation-Spalten und Constraints. Sie muss deshalb als Datei in ihrer dokumentierten Reihenfolge ausgeführt und darf nicht zusätzlich als Ganzes in eine äussere Transaktion eingeschlossen werden. Migration `0009_migration_review_commands.sql` ergänzt begrenzte Review-Zyklen und eine tenantgebundene, referenzbasierte Command-Tabelle: Die Web-Runtime darf nur feste Recovery-Anweisungen einfügen und niemals Jobzustände aktualisieren; ausschliesslich `qkern_worker` prüft und konsumiert diese Anweisungen. Migration `0010_migration_incident_escalations.sql` ergänzt genau einen referenzbasierten Incident pro ausgeschöpftem Job, erzwungene RLS, Worker-only-Erzeugung und eine einmalige, datenbankseitig an den Transaktions-Actor gebundene Quittierung ohne Incident-Auflösung oder Jobmutation. Migration `0011_migration_incident_outbox.sql` legt Incident-Eröffnung und genau ein Notification-Event in dieselbe Transaktion, übernimmt bestehende v0.9-Incidents und reserviert Claim-, Publish- und Backoff-Übergänge vollständig für `qkern_worker`. Migration `0012_migration_incident_dead_letters.sql` ergänzt `dead_lettered` ausserhalb ihrer nachfolgenden Schema-Transaktion, persistiert feste Fehlercodes und getrennte Failure-/Recovery-Zähler und installiert eine actor-gebundene, referenzbasierte Recovery-Command-Tabelle. Wie `0008` muss sie in Dateireihenfolge und ohne äussere Gesamttransaktion ausgeführt werden. Migration `0013_migration_incident_delivery_health.sql` führt die aggregate, tenantgebundene Fünf-Minuten-SLO-Projektion ein. Migration `0014_migration_incident_delivery_visibility.sql` erhält diese Upgrade-Linie, erweitert Health um disjunkte Zustands- und Recovery-Counts und ergänzt die auf 100 Incident-IDs begrenzte Detailprojektion. Migration `0015_migration_incident_delivery_failure_classification.sql` erweitert additiv die feste Fehlercode-Allowlist und die Health-Funktion um disjunkte aktive Ursachen-Counts. Migration `0016_migration_incident_delivery_recovery_binding.sql` bindet jedes neue Recovery-Command atomar an den aktuell beobachteten Fehlercode, erzwingt eine ursachenkompatible feste Begründung und verwirft inkompatible Alt-Commands beim Upgrade. Migration `0017_migration_incident_verified_resolution.sql` ergänzt `resolved` vor ihrer Schema-Transaktion, installiert den höchstens dreimal anforderbaren Ledger-Recheck, erlaubt die Auflösung nur der Worker-Rolle nach atomar geprüftem `applied`-Job und vereinheitlicht die Command-first-Sperrreihenfolge für Resolution und Delivery-Recovery. Wie `0008` und `0012` muss sie in Dateireihenfolge und ohne äussere Gesamttransaktion ausgeführt werden. Migration `0018_migration_incident_delivery_recovery_generation.sql` ergänzt die Retry-Generation als zweiten unveränderlichen Recovery-Snapshot, übernimmt ausschließlich noch aktuelle pendente Commands und verwirft veraltete beim Upgrade. Explizite `IS NOT NULL`-Constraints schließen PostgreSQL-`CHECK`-NULL-Bypässe; Trigger und Worker verlangen danach Fehlercode und Generation. Migration `0019_migration_apply_delivery_resilience.sql` überträgt denselben begrenzten Fehler-/Dead-Letter-/Recovery-Vertrag auf die Apply-Outbox, entzieht `qkern_runtime` ihre direkte Outbox-Sicht und ersetzt sie durch enge tenantgebundene Status-/Health-Funktionen sowie actor-, Fehlercode- und generationsgebundene Commands. `qkern_runtime` erhält weiterhin keine direkten Job-/Outbox-Mutationsrechte.

Migration `0020_project_database_provisioning.sql` führt `qkern_provisioner`, den tenantgebundenen Provisioning-Zustandsautomaten und das unveränderliche Binding-Ledger ein. Sie entzieht `qkern_runtime` direkte Projekt-/Environment-Updates; der Webprozess darf nur actor-gebundene Request-/Status-Funktionen ausführen. Ausschließlich der separate Provisioner-Login darf einen gültigen Lease-Claim fortschreiben und eine noch pendente Environment-Referenz atomar genau einmal binden. Der Bootstrap-Hash ist auf die beiden geordneten Data-Plane-Verträge festgelegt.

Migration `0021_project_database_provisioning_health.sql` ergänzt eine persistente Heartbeat-Tabelle, deren RLS jeden Write an Tenant und `qkern.actor_ref` des Provisioners bindet. Die Web-Runtime erhält weder Tabellen- noch Identitätssicht, sondern ausschließlich `EXECUTE` auf eine aggregate Health-Funktion mit festen Fünf-Minuten-Queue-, Zwei-Minuten-Liveness- und 24-Stunden-Beobachtungsfenstern. Service und API prüfen Zustands-, Ursachen- und Provisioner-Summen fail-closed.

Migration `0022_project_automation_policies.sql` ergänzt tenantgebundene Policies pro Projektumgebung und erweitert Approval Decisions um eine überprüfbare User-/Agent-/System-Attribution. Auto-Approvals behalten damit den exakt gebundenen Approval- und Audit-Vertrag, obwohl keine menschliche Entscheidung pro Änderung erforderlich ist.

Migration `0023_project_api_keys.sql` ergänzt verifier-only Public-/Service-Keys
für die Generated Data API. Migration `0024_project_auth.sql` führt davon und von
QKERN-Accounts getrennte App-User, Sessions, Einmal-Tokens, MFA-Faktoren und OIDC-
Identitäten mit unveränderlichem Tenant-/Projekt-/Environment-Scope ein.
Migration `0025_project_storage.sql` ergänzt RLS-gebundene Bucket-, Upload- und
Object-Metadaten, unveränderliche Identitäten und enge Runtime-Spaltengrants.
Migration `0026_project_queues.sql` ergänzt tenantgebundene Queue-Definitionen und
Nachrichten, verifier-only Dedupe-/Lease-Felder, monotone Claim-Generationen,
State-Transition-Trigger, RLS, Retention sowie enge Runtime-Spaltengrants. Claims
verwenden transaktionales `FOR UPDATE SKIP LOCKED`.
Migration `0027_project_queue_dead_letter_replay.sql` ergänzt eine unveränderliche
same-tenant Replay-Referenz, einen partiellen Unique-Index für genau ein Replay pro
Dead Letter und einen redigierten Operator-Listenindex.

`db/project/0001_qkern_migration_ledger.sql` und `db/project/0002_qkern_migration_fence.sql` sind dagegen Data-Plane-Provisionierungsverträge und gehören nicht in die Control-Plane-Migrationskette. Vor ihrer einmaligen, geordneten Ausführung pro Projekt-Datenbank muss der vertrauenswürdige Provisioner die getrennten Rollen `qkern_ledger_owner` (Non-Login) und `qkern_project_migrator` (Least-Privilege-Login ohne Rollenmitgliedschaften) anlegen. Der spätere Resolver muss Datenbankname, Login und Ledger-Owner exakt an diese provisionierte Instanz binden. Ledger und monotones Fence sind ownergeschützt; unsichere Struktur oder ACLs werden vom Executor fail-closed abgewiesen.

Für den vollständigen persistenten Pfad die Werte aus `.env.example` als lokale Umgebung übernehmen. Entscheidend ist ein einheitlicher Schalter für alle drei Adapter:

```bash
export QKERN_RUNTIME_MODE=postgres
export QKERN_RUNTIME_DATABASE_URL="postgresql://qkern_app:qkern_runtime_local_only@localhost:5432/qkern_control"
export QKERN_AUTH_DATABASE_URL="postgresql://qkern_auth_app:qkern_auth_local_only@localhost:5432/qkern_control"
export DATABASE_SSL=disable
export QKERN_STATEMENT_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm run dev
```

`DATABASE_URL` gehört ausschließlich dem Migrations-Owner. Web-, Auth-, Worker- und Provisioner-Prozess verwenden vier getrennte Datenbank-URLs. Beim ersten Verbindungsaufbau werden privilegierte Attribute, gefährliche Mitgliedschaften und jede Überlappung der vier Rollengrenzen abgewiesen. In Production sind `QKERN_RUNTIME_MODE=postgres` und `DATABASE_SSL=require` Pflicht.

Der ausführbare Worker-Host ist bewusst nur für lokale Entwicklung und kontrollierte E2E-Läufe vorgesehen:

```bash
export QKERN_RUNTIME_MODE=postgres
export QKERN_MIGRATION_WORKER_ENABLED=true
export QKERN_WORKER_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_MIGRATION_WORKER_ID="local-worker-1"
export QKERN_WORKER_DATABASE_URL="postgresql://qkern_worker_app:qkern_worker_local_only@localhost:5432/qkern_control"
export QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG=true
export QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON='[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_migrator:local-only@localhost/project_database","expectedRole":"qkern_project_migrator","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]'
npm run worker:migrations:local
```

Dieser Adapter liest rohe Projekt-Datenbank-URLs und ist deshalb nur nach `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG=true` verfügbar. Er verweigert in `NODE_ENV=production` den Start unabhängig vom Flag.

Der Provisioner-Host läuft getrennt vom Web- und Migration-Worker-Prozess:

```bash
export NODE_ENV=production
export QKERN_PROJECT_PROVISIONER_ENABLED=true
export QKERN_PROVISIONER_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_PROJECT_PROVISIONER_ID="project-provisioner-1"
export QKERN_PROVISIONER_DATABASE_URL="postgresql://qkern_provisioner_app:secret@control-plane/qkern_control"
export QKERN_PROVISIONING_BROKER_URL="https://provisioner.service.internal/qkern/projects"
export QKERN_PROVISIONING_BROKER_ALLOWED_HOSTS="provisioner.service.internal"
export QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE="/run/qkern/provisioning-broker-key.json"
npm run provisioner:projects
```

Der Broker muss Job-ID und Bootstrap-Hash idempotent verarbeiten, die Projekt-Datenbank samt getrenntem Ledger-Owner und Least-Privilege-Migrator bootstrappen und ausschließlich das exakt definierte secret-freie Binding zurückgeben. Die Schlüsseldatei wird pro Anfrage neu gelesen; Production verlangt eine private reguläre Datei, HTTPS/443, exakte Host-Allowlist, keine Redirects und mindestens 1000 ms Lease-Reserve.

Der Production-Migration-Host verwendet das persistierte Control-Plane-Binding, einen HashiCorp-Vault-Database-Static-Role und einen vom Vault Agent aktualisierten Token-Sink:

```bash
export NODE_ENV=production
export QKERN_WORKER_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_WORKER_DATABASE_URL="postgresql://qkern_worker_app:secret@control-plane/qkern_control"
export QKERN_PROJECT_DATABASE_CATALOG_SOURCE=control-plane
export QKERN_VAULT_DATABASE_URL="https://vault.service.internal:8200/v1/database"
export QKERN_VAULT_TOKEN_FILE="/run/qkern/vault/token"
npm run worker:migrations
```

Der Token-Sink muss eine private reguläre Datei sein; in Production werden world-readable/-writable Bits abgewiesen. Der Katalog liest ihn bei jedem Credential-Refresh neu, sendet das Token nur im `X-Vault-Token`-Header an den exakt konfigurierten HTTPS-Mount und folgt keinen Redirects. Die statische Vault-Rolle muss denselben stabilen Login wie `expectedRole` liefern. Vor Ablauf der Vault-TTL wird das Passwort aktualisiert; identische Credentials verlängern nur die Lease, geänderte Credentials erzeugen atomar eine neue Pool-Generation. Alte Pools schließen erst, nachdem ihre aktiven Clients freigegeben wurden. Neue Verbindungen scheitern bei überfälligem, fehlgeschlagenem Refresh geschlossen. Der SHA-256-Pin bindet zusätzlich zur normalen Hostnamen-/CA-Prüfung das erwartete Leaf-Zertifikat. SIGINT und SIGTERM stoppen neue Claims, lassen die laufende Iteration auslaufen und schliessen danach Control-Plane- und alle Projekt-Pool-Generationen.

Der Apply-Publisher läuft unabhängig vom Migration Worker und sendet ausschließlich Referenzen an den Broker:

```bash
export NODE_ENV=production
export QKERN_RUNTIME_MODE=postgres
export QKERN_WORKER_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_WORKER_DATABASE_URL="postgresql://qkern_worker_app:qkern_worker_local_only@localhost:5432/qkern_control"
export QKERN_OUTBOX_PUBLISHER_ENABLED=true
export QKERN_OUTBOX_PUBLISHER_ID="apply-publisher-1"
export QKERN_APPLY_BROKER_URL="https://broker.service.internal/qkern/apply"
export QKERN_APPLY_BROKER_ALLOWED_HOSTS="broker.service.internal"
export QKERN_APPLY_BROKER_SIGNING_KEY_FILE="/run/qkern/apply-broker-key.json"
npm run publisher:apply
```

Die Schlüsseldatei enthält exakt `{"keyId":"<version>","secret":"<mindestens-32-Bytes>"}`, muss in Production privat sein und wird für jede Zustellung neu gelesen. Der Host signiert `<unix-seconds>.<raw-json-body>`, verbietet Redirects und verlangt das exakte JSON-Ack `{"status":"ack","eventId":"<Event-ID>"}`. Der Receiver muss Key-ID/Timestamp prüfen, die Event-ID idempotent verarbeiten und Tenant-/Topic-ACLs erzwingen. Owner und Administratoren dürfen einen behobenen Dead Letter über `POST /api/v1/migrations/{jobId}/delivery/retry` mit dem unmittelbar zuvor aus `GET /api/v1/migrations/{jobId}/delivery` gelesenen Fehlercode und Retry-Zyklus öffnen; der Request publiziert nicht und führt kein SQL aus. `GET /api/v1/migrations/delivery/health` liefert nur redigierte Tenant-Aggregate. Broker-Onboarding, Netzwerk-Egress, ACLs und Live-SLO-Nachweise bleiben Deployment-Gates.

Der Incident-Publisher läuft unabhängig vom Migration Worker:

```bash
export QKERN_RUNTIME_MODE=postgres
export QKERN_WORKER_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_WORKER_DATABASE_URL="postgresql://qkern_worker_app:qkern_worker_local_only@localhost:5432/qkern_control"
export QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED=true
export QKERN_INCIDENT_OUTBOX_PUBLISHER_ID="incident-publisher-1"
export QKERN_INCIDENT_WEBHOOK_URL="https://pager.example.com/qkern/incidents"
export QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS="pager.example.com"
export QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID="pager-primary-2026-07"
export QKERN_INCIDENT_WEBHOOK_HMAC_SECRET="$(openssl rand -hex 32)"
npm run publisher:incidents
```

In Production akzeptiert der Host nur HTTPS auf Port 443 mit einem öffentlichen, exakt erlaubten DNS-Namen. Credentials, Query-Parameter, Fragmente, Redirects, Wildcards sowie lokale oder literale IP-Ziele werden abgewiesen. Der Receiver wählt den Verifikationsschlüssel über `X-QKERN-Signature-Key-ID`, prüft `X-QKERN-Signature` über `<timestamp>.<raw-body>`, erzwingt einen engen Timestamp-/Replay-Zeitraum, verarbeitet Event-IDs idempotent und antwortet exakt `{"status":"ack","eventId":"<Event-ID>"}` als JSON. Ein injizierter `IncidentWebhookSigningKeyProvider` wird für jede Zustellung neu aufgelöst und kann dadurch überlappende Vault-Rotation bereitstellen; Environment-Schlüssel und Provider dürfen nicht gleichzeitig konfiguriert sein. Key-Auflösung und Netzwerkzugriff teilen sich das Timeout, das mindestens 1000 ms Abschlussreserve innerhalb der Outbox-Lease lassen muss. DNS-/Netzwerk-Egress und Provider-Onboarding bleiben Deployment-Gates.

Ein Transportfehler oder ungültiges Ack erhöht den persistenten Failure-Zähler erst nach einem gültigen, gefencten Claim; Abbruch und Lease-Verlust zählen nicht als Providerfehler. Beim achten Fehler wechselt das Event atomar nach `dead_lettered`. Nachdem die Ursache behoben wurde, senden Owner und Administratoren an `POST /api/v1/migrations/incidents/{incidentId}/delivery/retry` den aktuell gelesenen `expectedFailureCode`, den aktuellen `expectedRetryCycle` und einen kompatiblen festen `reasonCode`. Signing-Key-Ausfälle erlauben nur `credentials_rotated`; generische Publish-, Timeout- und Ack-Fehler erlauben `destination_recovered` oder `provider_incident_resolved`; Zielablehnungen erlauben alle drei kontrollierten Gründe. Ein `SECURITY DEFINER`-Trigger vergleicht Code und Generation atomar, und der Publisher-Worker prüft denselben Snapshot beim Verbrauch erneut. Nur dann öffnet er höchstens drei weitere Zustellzyklen. Selbst wenn derselbe Fehlercode in einer späteren Generation erneut auftritt, kann ein altes Command deshalb keinen ABA-Replay öffnen. Die Route sendet selbst nichts und verändert weder Incident-/Jobzustand noch SQL.

Die technische Incident-Auflösung ist davon getrennt. Owner und Administratoren können über `POST /api/v1/migrations/incidents/{incidentId}/resolution/verification` ausschließlich den festen Grund `target_ledger_recheck` anfordern. Die Route führt weder SQL noch Ledger-Zugriff aus. Der Worker verbraucht höchstens drei Commands, öffnet jeweils nur den bestehenden Reconciliation-only-Pfad und ruft niemals `execute()` auf. Erst ein exakter Target-Ledger-Treffer für Change-Set-ID und Statement-Hash setzt Job und Change Set auf `applied` und den Incident in derselben Control-Plane-Transaktion mit `target_ledger_match` auf `resolved`. Ein leerer oder unklarer Ledger-Befund führt zurück nach `review_required`; eine Operator-Aussage kann den Incident nicht schließen.

Autorisierte Incident-Leser sehen den redigierten Delivery-Zustand und einen festen letzten Fehlercode in `GET /api/v1/migrations/incidents`. Die zusätzliche Route `GET /api/v1/migrations/incidents/delivery/health` klassifiziert den Tenant als `healthy`, `degraded` oder `critical`: Dead Letters und aktive Signing-Key-Ausfälle sind kritisch; andere aktive Zustellfehler, Pending-Events nach fünf Minuten oder abgelaufene Leases degradieren die Sicht. Sie liefert disjunkte Zustands-, Recovery-, Exhaustion- und aktive Ursachen-Counts, pendente Recovery-Commands sowie älteste und letzte relevante Zeitpunkte. Erfolgreich publizierte Events zählen nicht als aktive Fehler. Beide Antworten sind `private, no-store`. Lease-Inhaber/-Token, Providerdaten, Actoren, SQL und Credentials sind weder Teil der Datenbankprojektion noch des API-Vertrags.

Die drei grundlegenden PostgreSQL-Rollen-/RLS-Tests werden nur ausgeführt, wenn `QKERN_TEST_OWNER_DATABASE_URL`, `QKERN_TEST_RUNTIME_DATABASE_URL` und `QKERN_TEST_AUTH_DATABASE_URL` gesetzt sind. Die sechs erweiterten Upgrade-/Recovery-/Resolution-Tests verlangen zusätzlich `QKERN_TEST_ADMIN_DATABASE_URL`, `QKERN_TEST_WORKER_DATABASE_URL` und das ausdrückliche Gate `QKERN_TEST_ALLOW_DATABASE_CREATE_DROP=true`; sie erzeugen und löschen ausschließlich eine zufällig benannte Testdatenbank. `npm run test:postgres:docker` setzt diese Werte nur innerhalb des portlosen tmpfs-Stacks, führt alle neun Real-DB-Tests aus und entfernt Container sowie Testdaten danach. Ohne vollständige Voraussetzungen bleiben die Tests bewusst übersprungen.

## QKERN MCP Server

STDIO:

```bash
export QKERN_MCP_ORGANIZATION_ID="org_moqro"
export QKERN_MCP_PROJECT_ID="prj_novamarket"
export QKERN_MCP_ENVIRONMENT="development"
npm run mcp
```

Streamable HTTP (nur lokal; bindet an `127.0.0.1`):

```bash
export QKERN_MCP_TOKEN="replace-with-a-short-lived-token"
export QKERN_MCP_ORGANIZATION_ID="org_moqro"
export QKERN_MCP_PROJECT_ID="prj_novamarket"
export QKERN_MCP_ENVIRONMENT="development"
npm run mcp:http
```

Codex-Konfiguration für einen späteren OAuth-geschützten Remote-Endpunkt:

```toml
[mcp_servers.qkern]
url = "https://mcp.your-qkern-domain.ch/mcp"
auth = "oauth"
required = true
enabled_tools = ["qkern_project_get", "qkern_automation_policy_get", "qkern_schema_list", "qkern_query_readonly", "qkern_queues_list", "qkern_queue_status", "qkern_queue_message_enqueue", "qkern_logs_search", "qkern_migration_preview", "qkern_migration_apply_queue"]
default_tools_approval_mode = "writes"
```

STDIO vertraut ausschließlich der lokalen Prozessgrenze und verwendet kein Bearer-Token. Das Token für den lokalen HTTP-Transport gehört nur in die Umgebung, nie in eine versionierte Datei. Der statische-Bearer-HTTP-Prozess verweigert den Start mit `NODE_ENV=production`; die in `docs/MCP_REMOTE_AUTH.md` beschriebenen OAuth/OIDC-, Scope-, Revocation- und Session-Bindungs-Gates müssen zuerst implementiert werden. Aktuelle Codex-Clients unterstützen STDIO und Streamable HTTP sowie Bearer-Token und OAuth für Remote-MCP-Server; siehe die [offizielle MCP-Dokumentation](https://learn.chatgpt.com/docs/extend/mcp).

`qkern_migration_apply_queue` verändert Control-Plane-Zustand und kann nach einer späteren Executor-Anbindung destruktive Datenbankeffekte auslösen. Das Tool trägt deshalb `readOnlyHint: false` und `destructiveHint: true`; der MCP-Client muss vor dem Aufruf einen ausdrücklichen Nutzer-Prompt anzeigen. `default_tools_approval_mode = "writes"` setzt diese Vorgabe für die gezeigte Codex-Konfiguration um. Das Tool selbst führt kein SQL aus und meldet ausdrücklich `executed: false`.

Mit aktivierten Project Queues kann MCP Queue-Definitionen und Aggregate lesen
sowie Nachrichten enqueueen. `qkern_queue_message_enqueue` ist ein Write und nur
mit stabilem `dedupeKey` retry-sicher. Claim, Ack, Fail und Lease werden nicht über
MCP exponiert und bleiben einer Service-Worker-Grenze vorbehalten.

## Architektur und Grenzen

Aktueller Stand, Handbuch, Stufen und Modulgrenzen sind über [STATUS.md](STATUS.md) und [docs/INDEX.md](docs/INDEX.md) zentral auffindbar. Diese Dokumente sind durch einen automatisierten Dokumentationsvertrag Teil jedes weiteren Releases.

- [Systemarchitektur](docs/ARCHITECTURE.md)
- [Sicherheitsmodell](docs/SECURITY.md)
- [MVP und Roadmap](docs/ROADMAP.md)
- [Qualitäts- und Testplan](docs/QA.md)
- [Migration Apply Delivery Runbook](docs/MIGRATION_APPLY_DELIVERY_RUNBOOK.md)
- [Migration Incident Runbook](docs/MIGRATION_INCIDENT_RUNBOOK.md)
- [Project Database Provisioning Runbook](docs/PROJECT_DATABASE_PROVISIONING_RUNBOOK.md)
- [Backup/Restore Evidence Runbook](docs/BACKUP_RESTORE_EVIDENCE_RUNBOOK.md)
- [Background Runtime Probes Runbook](docs/RUNTIME_PROBES_RUNBOOK.md)
- [Background Runtime Deployment Runbook](docs/BACKGROUND_RUNTIME_DEPLOYMENT_RUNBOOK.md)
- [Runtime Deployment Evidence Runbook](docs/RUNTIME_DEPLOYMENT_EVIDENCE_RUNBOOK.md)
- [Project Queues](docs/PROJECT_QUEUES.md)
- [Usage Metering und Quotas](docs/USAGE_METERING.md)
- [Release 1.8 Alpha 1](docs/RELEASE_1.8_ALPHA1.md)
- [Release 1.7 Alpha 3](docs/RELEASE_1.7_ALPHA3.md)
- [Developer Experience](docs/DEVELOPER_EXPERIENCE.md)
- [Release 1.7 Alpha 2](docs/RELEASE_1.7_ALPHA2.md)
- [Release 1.7 Alpha 1](docs/RELEASE_1.7_ALPHA1.md)
- [Release 1.6 Alpha 4](docs/RELEASE_1.6_ALPHA4.md)
- [Release 1.6 Alpha 3](docs/RELEASE_1.6_ALPHA3.md)
- [Release 1.6 Alpha 2](docs/RELEASE_1.6_ALPHA2.md)
- [Release 1.6 Alpha 1](docs/RELEASE_1.6_ALPHA1.md)
- [Release 1.5 Alpha 1](docs/RELEASE_1.5_ALPHA1.md)
- [Release 1.4 Alpha 3](docs/RELEASE_1.4_ALPHA3.md)
- [Release 1.4 Alpha 2](docs/RELEASE_1.4_ALPHA2.md)
- [Release 1.4 Alpha 1](docs/RELEASE_1.4_ALPHA1.md)
- [Release 1.3 Alpha 1](docs/RELEASE_1.3_ALPHA1.md)
- [Release 0.29](docs/RELEASE_0.29.md)
- [Release 0.28](docs/RELEASE_0.28.md)
- [Release 0.27](docs/RELEASE_0.27.md)
- [Release 0.26](docs/RELEASE_0.26.md)
- [Release 0.25](docs/RELEASE_0.25.md)
- [Release 0.24](docs/RELEASE_0.24.md)
- [Release 0.23](docs/RELEASE_0.23.md)
- [Release 0.22](docs/RELEASE_0.22.md)
- [Release 0.21](docs/RELEASE_0.21.md)
- [Release 0.20](docs/RELEASE_0.20.md)
- [Release 0.19](docs/RELEASE_0.19.md)
- [Release 0.18](docs/RELEASE_0.18.md)
- [Release 0.17](docs/RELEASE_0.17.md)
- [Release 0.16](docs/RELEASE_0.16.md)
- [Release 0.15](docs/RELEASE_0.15.md)
- [Release 0.14](docs/RELEASE_0.14.md)
- [Release 0.13](docs/RELEASE_0.13.md)
- [Release 0.12](docs/RELEASE_0.12.md)
- [Release 0.11](docs/RELEASE_0.11.md)
- [Release 0.10](docs/RELEASE_0.10.md)
- [Release 0.9](docs/RELEASE_0.9.md)
- [Release 0.8](docs/RELEASE_0.8.md)
- [Release 0.7](docs/RELEASE_0.7.md)
- [Release 0.6](docs/RELEASE_0.6.md)
- [Release 0.5](docs/RELEASE_0.5.md)
- [Release 0.4](docs/RELEASE_0.4.md)
- [Release 0.3](docs/RELEASE_0.3.md)

Ohne Laufzeitvariable bleibt die direkt startbare Demonstration bewusst im prozesslokalen Memory-Modus. Mit `QKERN_RUNTIME_MODE=postgres` sind persistente Auth-, Membership- und Control-Plane-Repositories tatsächlich verdrahtet; tenantgebundene Transaktionen, zusammengesetzte Tenant-FKs, erzwungene RLS, Approval-Sperren, die append-only Audit-Hash-Kette sowie die Migration-Queue/Outbox werden über die API- und MCP-Servicegrenze genutzt. Enqueueing und Audit laufen in einer Tenant-Transaktion; eindeutige Datenbank-Constraints und ein Transaktions-Lock machen wiederholte Apply-Anfragen idempotent.

Das ist noch keine fertige Supabase-Parität oder BaaS-Produktion. Data Plane,
Table-REST, Project Auth und Object Storage sind ausführbare, standardmäßig
deaktivierte Alpha-Vertikalen; für Storage stehen ein echter ClamAV-Adapter und
ein MinIO-/ClamAV-Harness bereit, dessen Docker-Lauf noch archiviert werden muss.
Die Quota-/Completion-/Expiry-/Lifecycle-Races sind als Memory- und optionale
PostgreSQL-Matrix implementiert; der echte Dockerlauf bleibt zu archivieren.
Reale Mail-/OIDC- und Production-Provider-/Scanner-Zertifizierung bleibt offen.
Realtime bleibt eine lokale Alpha-Foundation. Project Queues besitzen jetzt einen
durable PostgreSQL-Adapter, dessen reale Multi-Instance-/Crash-/Lastzertifizierung
noch offen ist. SDK und CLI besitzen jetzt reproduzierbare Distribution-Builds;
die echte Windows-/macOS-CI-Evidenz sowie Publishing bleiben offen. Usage Metering
besitzt jetzt Ledger und Quota-Entscheidungen, aber noch keine automatischen
Produkt-Emitter, Tarife, Rechnungen oder Zahlungen. Functions, Cron, Webhooks und
weitere Managed Operations folgen in späteren Slices.
Provisioning-Control-
Plane und signierter Brokervertrag sind implementiert, aber noch nicht gegen einen
gewählten Cloud-/PostgreSQL-Provider, Live-Vault, Zertifikat-Rollover und reale
Crash-/Timeout-Races zertifiziert. Auch HA, Restore-Drills, Schweizer Datenresidenz
und alle Production-E2E-/Security-Gates aus `docs/QA.md` müssen vor einem Marktstart
nachgewiesen werden.
