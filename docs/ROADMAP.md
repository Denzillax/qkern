# MVP und Roadmap

> Historische Detailplanung bis RC1. Der aktuelle stufenweise Produktplan wird in
> [STUFENPLAN.md](STUFENPLAN.md) und [BAAS_ROADMAP.md](BAAS_ROADMAP.md) gepflegt;
> der reale Releasezustand steht in [../STATUS.md](../STATUS.md).

## In dieser Lieferung

- QKERN Branding, Designsystem, Marketingseite und interaktive Console
- Control-Plane-API-Vertical-Slice mit Tenant-Grenze
- Database-/Table-/Auth-/Storage-/API-Produktflächen mit klaren MVP-Daten
- echter Change-Set-/Approval-/Audit-Workflow
- lokaler MCP Server über STDIO und Streamable HTTP; Remote-Production bleibt bis OAuth deaktiviert
- Read-only-MCP-Tools, Migration Preview und separate Apply-Queue ohne SQL-Ausführung im MCP-Request
- Control-Plane-SQL-Schema, RLS, Tests und lokale Infrastruktur
- Account-, Session-, Workspace- und Rollenfluss mit Argon2id und gehärteten Cookies
- PostgreSQL-Repositories mit tenantgebundenen Transaktionen, Replay-Schutz und append-only Audit-Hash-Kette
- SQL-AST-Validierung und Approval-Artefakte mit Action Hash, TTL und Einmaligkeit
- Laufzeitwählbarer, tatsächlich verdrahteter PostgreSQL-Pfad für Auth, Memberships und Control Plane
- Getrennte, beim Verbindungsaufbau verifizierte Auth-/Runtime-Rollen sowie AES-GCM-verschlüsselte Change-Set-Statements
- Vierte, beim Verbindungsaufbau verifizierte `qkern_provisioner`-Rolle ohne Überschneidung mit Web, Auth oder Migration Worker
- Tenantgebundene, idempotente Projekt-Datenbank-Provisioning-API mit fünf gefencten Versuchen pro Zyklus und höchstens drei Recovery-Zyklen
- Startbarer Provisioner-Host mit signiertem reference-only Brokervertrag, privater rotierbarer Schlüsseldatei, exakter Host-Allowlist und festem Bootstrap-Hash
- Unveränderliches secret-freies Binding-Ledger und persistierter Vault-Katalog als Production-Resolver für den Migration Worker
- Persistente self-bound Provisioner-Heartbeats und tenantisolierte aggregate Health-API mit festen Queue-/Liveness-SLOs, disjunkten Fehlerursachen und fail-closed Konsistenzprüfung
- Disabled-by-default OpenMetrics-Scrape-Grenze mit festem Tenant, eigenem rotierbarem Private-File-Bearer und ausschließlich festen redigierten Metriklabels
- Explizite, autorisierte Apply-Queue-API nach der Approval; der HTTP-Request führt niemals SQL aus
- Tenantgebundene PostgreSQL-Migration-Jobs und referenzbasierte Outbox mit Idempotenz-Constraints, geleasten Claims, Ablauf-Recovery und Lease-Fencing
- Worker-Sicherheitsdomäne mit erneuter Prüfung von Approval, Action Hash, Tenant-/Environment-Bindung, Lease, SQL-AST und entschlüsseltem Statement-Hash unmittelbar vor der Executor-Grenze
- Transaktionaler PostgreSQL-Projekt-Datenbank-Executor mit exakter Least-Privilege-Rollenbindung, lokalen Timeouts, Change-Set-Lock und atomarem, separat besessenem Ziel-Datenbank-Ledger
- Automatische SQL-Retries ausschließlich für vom Executor ausdrücklich als retrybar und vollständig zurückgerollt gemeldete Transaktionen; unbekannte Ergebnisse wechseln gefenct in eine persistente Reconciliation-only-Spur
- Getrennter, auf drei Versuche begrenzter Reconciliation-Zähler; leere Ledger-Ergebnisse dürfen niemals erneut SQL ausführen und enden auditiert in `review_required`
- Owner-/Administrator-autorisierte, referenzbasierte Review-Commands mit festen Reason-Codes; nur der Worker darf daraus bis zu drei weitere SQL-freie Reconciliation-Zyklen starten
- Automatische Worker-only-Incident-Eröffnung nach ausgeschöpften Review-Zyklen, feste Critical-Klassifizierung, Support-Lesezugriff und einmalige Owner-/Administrator-Quittierung ohne technische Auflösungsbehauptung
- Höchstens drei Owner-/Administrator-autorisierte, SQL-freie Resolution-Verifications; nur ein Worker-bestätigter exakter Target-Ledger-Treffer kann Job, Change Set und Incident atomar abschließen
- Atomare, referenzbasierte Incident-Notification-Outbox mit Upgrade-Backfill sowie eigenständig aktivierbarem, dependency-injiziertem At-least-once-Publisher, exaktem Ack, Lease-Fencing und Backoff
- Ausführbarer Incident-Publisher-Host mit HMAC-authentifiziertem HTTPS-Webhook, pro Zustellung aufgelöstem Rotationsschlüssel, versionierter Key-ID, exakter Host-Allowlist, No-Redirect, begrenztem Ack und Lease-/Timeout-Reserve
- Persistente Incident-Delivery-Dead-Letter-Policy nach acht bestätigten Fehlern sowie Owner-/Administrator-autorisierte Recovery-Commands, die erwarteten Fehlercode, erwartete Retry-Generation und ursachenkompatiblen festen Grund binden und höchstens drei weitere Zustellzyklen öffnen
- Isolierter, portloser PostgreSQL-17-Zertifizierungsstack für Upgrade 0017→0018, Rollen/RLS, NULL-Constraints, ABA-Replay, Generation-Retry, Command-first-Interleaving und Worker-only-Resolution
- Redigierter Delivery-Zustand pro Incident, feste persistente Ursachen-Codes und tenantgebundene Health-Aggregation mit disjunkten aktiven Fehler-Counts über schmale Datenbankfunktionen ohne direkte Outbox-Tabellenrechte
- Opt-in Worker-Runtime mit dedizierter `qkern_worker`-Datenbankrolle, serieller Loop-Steuerung und lokalem/E2E-Host
- Lease-Heartbeat für Ausführung und Reconciliation sowie monotone `claim_sequence` als vom Retry-Zähler getrennte Fence-Epoche
- Ownergeschütztes persistentes Target-Fence in der Projekt-Datenbank; Reclaim-Retries nur nach bestätigter aktueller Fence-Epoche
- Serverseitig injizierbarer `TrustedProjectDatabaseConnectionCatalog`; Raw-URL-Auflösung ausschließlich lokal und in Production technisch gesperrt
- Eigenständig aktivierbarer, dependency-injizierter referenzbasierter Outbox-Publisher mit Ack, Lease-Fencing und Backoff
- Lokales MCP-Queue-Tool als destruktiver, idempotenter Write; der Client muss vor dem Aufruf eine Nutzerbestätigung einholen
- Signiertes Backup-/Restore-Evidenzgate mit externem Ed25519-Signer, gepinntem Public Key, fester Frische-/RPO-/RTO-Policy, cause-freiem CLI und optionalen redigierten OpenMetrics
- Fail-closed Loopback-Liveness/-Readiness für Provisioner, Migration Worker und beide Publisher; Ready erst nach aktuellem erfolgreichem Poll, ohne Identitäts-, Fehlerursachen- oder Secret-Ausgabe
- Gehärteter Pre-Deployment-Generator und exakter Drift-Verifier für vier getrennte Kubernetes-Workloads mit digest-gepinntem Image, tokenlosen ServiceAccounts, Non-root/read-only/seccomp, privaten Authority-Referenzen und ohne Service-/Ingress-Exposition
- Signiertes Live-Deployment-Evidenzgate mit externem Ed25519-Signer, Public-Key-/Cluster-/NetworkPolicy-/Provenance-Pins, exakter Bundle-/Image-Bindung, 24-Stunden-Frische, cause-freiem CLI und optionalen redigierten OpenMetrics
- Signiertes Provider-/Pager-E2E-Evidenzgate mit 15 festen Managed-PostgreSQL-17-Szenarien, sieben getrennten Provider-/Vault-/Broker-/Pager-/Restore-/Runtime-Pins, 24-Stunden-Frische, cause-freiem CLI und optionalen redigierten fail-closed OpenMetrics
- Signiertes Security-Assessment-Evidenzgate mit 14 festen Kontrollen, acht getrennten Release-/SBOM-/Scan-/Pentest-Pins, null Critical-/High-Findings, sieben Tagen Frische, cause-freiem CLI und optionalen redigierten fail-closed OpenMetrics
- Gemeinsamer Release-Evidence-Preflight, der alle vier Signaturen und die fünf tatsächlich gelesenen Release-/Envelope-Dateien gegen die Production-Apply-Pins prüft
- Finaler RC1-Production-Readiness-Preflight für gehärteten Vier-Workload-Bundle, vollständige Evidence-Kette, PostgreSQL/TLS, eine Tenant-Bindung, HTTPS-Origins und weiterhin deaktiviertes Production Apply
- Kryptografische, standardmäßig geschlossene Production-Apply-Autorisierung mit exakter Change-Set-/Approval-/Target-Bindung, fünf unabhängigen Release-Evidenz-Pins und doppelter Prüfung vor Queue und Executor

Die Lieferung enthält eine vollständig verdrahtete, aber noch nicht live freigegebene Apply-Runtime. Die Provisioning-Control-Plane erzeugt gefencte Jobs, der separate Host spricht ausschließlich über einen signierten Referenzvertrag mit dem externen Infrastruktur-Broker, persistiert seine tenant-/actor-gebundene Liveness und stellt redigierte SLO-Aggregate samt sicherer OpenMetrics-Scrape-Grenze bereit; Production löst das unveränderliche Binding über Vault auf. Vier separate Gates können extern signierte Backup-/Restore-Drill-, Live-Deployment-, Provider-/Pager-E2E- und Security-Assessment-Evidenz verifizieren, führen die zugrunde liegenden Prüfungen aber nicht selbst aus. Der gemeinsame Preflight bindet deren Dateien und das Release-ZIP an die fünf Production-Apply-Pins. Alle vier Hintergrund-Hosts besitzen einen lokalen Orchestrator-Probevertrag, einen deterministischen gehärteten Kubernetes-Basisvertrag und einen streng gepinnten Live-Nachweisvertrag. Eine weitere Signaturgrenze autorisiert genau ein Production-Change-Set erst nach Bindung dieser Nachweise; Apply-Service und Worker prüfen unabhängig. Raw-URL- und statischer Environment-Katalog bleiben explizite Development/E2E- beziehungsweise Compatibility-Pfade. Persistentes Target-Fencing, Reconciliation-Quarantäne, autorisierte Operator-Rechecks, Incident-Eröffnung und worker-verifizierte Target-Ledger-Auflösung sind implementiert. Es fehlen weiterhin Provider-Onboarding und die tatsächliche archivierte Live-Zertifizierung einschließlich unabhängigem Security Assessment/Pentest. Ohne diese Nachweise kann keine gültige Production-Autorisierung entstehen; das ausgelieferte System bleibt technisch gesperrt.

## Nächste produktive Phase

1. Den implementierten Provisioner-Brokervertrag an einen gewählten PostgreSQL-/Cloud-Provider anbinden und Bootstrap, idempotente Wiederholung, Vault-Static-Role, Zertifikat-Rollover, Egress-/ACL-Policy sowie Crash-/Timeout-Races live zertifizieren.
2. Den v0.23-PostgreSQL-Harness in einer freigegebenen CI-/Lab-Umgebung ausführen und das grüne Upgrade-/Recovery-/Resolution-/Provisioning-Protokoll archivieren. Anschließend Target-Fencing, Lease-Heartbeat, Reconciliation-Quarantäne und beide Outbox-Publisher in den noch fehlenden Crash-, Reclaim-, Target-Lock-, Publish- und Shutdown-Races zertifizieren. Für vollständige Stale-Worker-Cancellation eine widerrufbare Ausführungsberechtigung oder kontrollierte Query-Cancellation ergänzen. Den v0.28-Basisvertrag mit Namespace-default-deny, enger Egress-Policy, signierter Image-Provenance, Secret-Projektion und realem SLO-Alarmrouting als überwachte Production-Prozesse zertifizieren und die daraus erzeugte v0.29-Evidenz samt privater Detailspur archivieren.
3. Real-PostgreSQL-/Worker-E2E für Enqueue, Claim, Apply, Crash nach Commit, Lease-Verlust, sicheren Rollback-Retry und Cross-Tenant-Negativfälle ausführen; anschließend alle 15 v0.31-Szenarien gemeinsam signieren und die Provider-E2E-Evidence archivieren.
4. Alle 14 v0.32-Security-Kontrollen durch eine unabhängige Prüfstelle gegen das exakte Release ausführen, Berichte/SBOM archivieren, null Critical/High bestätigen und die Security-Evidence signieren.
5. Den gemeinsamen Release-Evidence-Preflight grün ausführen und erst danach den kontrollierten v1.0-Production-Rollout autorisieren.
6. Redis-basiertes verteiltes Rate Limiting und Session-Bereinigung anbinden.
7. Katalog-Introspection, Table Editor und REST-API gegen reale Projekt-PostgreSQL-Daten verdrahten.
8. S3-Storage und Backup Worker anbinden, den isolierten Restore-Preview/-Drill real ausführen und dessen signierte v0.26-Evidenz samt privatem Detailprotokoll archivieren.
9. OAuth/OIDC für Remote MCP, Token-Rotation und Revocation umsetzen.
10. Billing, Limits, E-Mail- und Support-Prozesse nach Produktvalidierung.

## Post-MVP

- Realtime mit RLS pro Event
- isolierte Function Runtime
- komplexe Webhooks/Cron
- Enterprise SSO, private Netzwerke und dedizierte Infrastruktur
- mehrere Regionen, Replikation und High Availability

Preise, Limits, RPO/RTO, Retention, Schweizer Region/Provider und juristische Texte sind offene Product Decisions. Sie erscheinen nicht als bestätigte Marktversprechen.
