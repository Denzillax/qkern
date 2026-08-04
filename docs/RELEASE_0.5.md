# QKERN 0.5 – Opt-in Migration Runtime

Version 0.5 verdrahtet die in 0.4 vorbereitete Apply-Sicherheitsdomäne zu einer explizit aktivierbaren lokalen/E2E-Runtime. Der normale Web- und MCP-Prozess führt weiterhin kein Projekt-SQL aus. Production-Apply bleibt gesperrt, bis Vault-Katalog, Provisioner, Target-Fencing, Broker-Sink und echte PostgreSQL-E2E nachgewiesen sind.

## Neu in 0.5

- Dedizierte, beim ersten Zugriff verifizierte Control-Plane-Rolle `qkern_worker`; Web- und Auth-Rollen dürfen keine Worker-Zustände fortschreiben.
- Serieller und abbrechbarer `MigrationWorkerRuntime` mit begrenztem Backoff und sauberem Shutdown.
- `TrustedProjectDatabaseConnectionCatalog` als Exact-Match-Allowlist für opaque `managed:*`-Referenzen, getrennte Pools und erwartete Datenbank-/Login-/Ledger-Owner-Bindungen.
- Lokaler Raw-URL-Katalog und ausführbarer Worker-Host nur nach explizitem Opt-in; `NODE_ENV=production` wird unabhängig von der Konfiguration abgewiesen.
- Dependency-injizierter At-least-once-Outbox-Publisher mit referenzbasierten Nachrichten, Event-ID-Acknowledgement, Lease-Fencing und Backoff.
- Exakte Bindung jedes Migration Jobs an den beim Enqueue geprüften Approval Request über `approval_request_id` und einen zusammengesetzten Tenant-Fremdschlüssel.
- Sicheres Retry für Resolver-/Connect-Fehler nur dann, wenn die Zielausführung nachweislich nicht begonnen hat.

## Reclaim- und Crash-Sicherheit

Ein zurückeroberter Job liest vor jeder Artefaktentscheidung zuerst das Ziel-Ledger. Ein passender Eintrag schließt den Control-Plane-Zustand idempotent als applied. Ist der Ledger-Eintrag nicht vorhanden, darf nur eine weiterhin gültige und vollständig geprüfte Approval einen Ausführungsversuch auslösen.

Lease-Ablauf beweist nicht, dass der vorherige Worker beendet wurde. Deshalb schreibt ein zurückeroberter Claim ohne bestätigten Ledger-Commit weder einen terminalen Fehler noch einen Retry: Artefaktfehler, abgelaufene Approvals, bekannte Rollbacks und nicht gestartete Ausführungen bleiben `completion_deferred`. Das verhindert den falschen Zustand „Control Plane failed, Ziel später applied“. Automatisches Production-Recovery erfordert zusätzlich ein persistentes Target-Fencing-Protokoll und einen Operator-Workflow.

## Datenbankupgrade

`db/migrations/0006_worker_runtime_boundary.sql` legt `qkern_worker` an, entzieht `qkern_runtime` Queue-/Outbox-Updates und ergänzt `migration_jobs.approval_request_id`. Das Upgrade bindet Altjobs an die jüngste zeitlich vor dem Job liegende genehmigte Approval und setzt danach `NOT NULL` plus den vollständigen Tenant-/Projekt-/Environment-/Change-Set-Fremdschlüssel. Inkonsistente Altbestände führen bewusst zum Abbruch und müssen vor dem erneuten Lauf kontrolliert bereinigt werden.

## Noch kein Production-Go

Nicht enthalten sind ein Vault-backed Katalog mit Credential-Rotation und Server-/Cluster-Fingerprint-Bindung, echte Projekt-Datenbank-Provisionierung, persistentes Target-Fencing, ein produktiver Broker-Sink/Publisher-Host, Dead-Letter-/Operator-Automation und Real-PostgreSQL-Worker-E2E. Auch Storage/Backups, verteiltes Rate Limiting, Remote-MCP-OAuth, HA- und Schweizer Datenresidenz-Nachweise bleiben Release-Gates.
