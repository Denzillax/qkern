# Release 1.6 Alpha 2 — Durable Project Queues

Release: `1.6.0-alpha.2` · Datum: 4. August 2026

## Ergebnis

Project Queues besitzen jetzt neben dem deterministischen Memory-Port einen
dauerhaften tenantisolierten PostgreSQL-17-Adapter. Die Runtime wählt ihn bei
`QKERN_RUNTIME_MODE=postgres` automatisch. Queue-Definitionen, Nachrichten,
Dedupe-Verifier, Claim-Generationen und aktive Leases überleben Prozessneustarts.

## Enthalten

- Migration `0026_project_queues.sql` mit zusammengesetzten Tenant-FKs, RLS,
  engen Runtime-Grants und unveränderlichen Queue-/Message-Identitäten;
- atomare konkurrierende Claims über `FOR UPDATE SKIP LOCKED`;
- ausschließlich gehashte Dedupe- und Lease-Secrets;
- persistentes Worker-/Token-/Ablauf-/Generations-Fencing;
- serverseitige Lease-Recovery, Retry, Dead Letter und Completed-Cleanup;
- Datenbank-Constraints und Trigger für legale Zustandsübergänge;
- automatische Memory-/PostgreSQL-Runtime-Komposition;
- vier optionale PostgreSQL-Szenarien für Dedupe, parallele Claims, Restart-
  Fencing und Cross-Tenant-RLS sowie lokale SQL-/Grant-Vertragstests;
- korrigierte Memory-Retention: ein Completed Record bleibt bis zum Ende seines
  längeren Dedupe-Fensters erhalten.

## Sicherheitsentscheidungen

Die Runtime-Rolle darf Queue-Definitionen nicht löschen oder ändern und Payloads
nach dem Insert nicht fortschreiben. RLS bindet jede Operation an den serverseitig
gesetzten Tenant. Ein roher Lease-Token erscheint nur in der Claim-Antwort; die
Datenbank kennt ausschließlich seinen SHA-256-Verifier. Öffentliche Status- und
MCP-Pfade bleiben payload- und leasefrei.

## Verifikation

Strict TypeScript, **631 lokale Vitest-Tests**, der Next.js-Production-Build und
der Production-Dependency-Audit wurden grün ausgeführt; **25** optionale
Real-Service-Tests blieben mangels Dienste übersprungen. Der Audit meldete 0
bekannte Schwachstellen. Docker, Podman, `postgres` und `psql` waren nicht
verfügbar; die neue PostgreSQL-Queue-Matrix ist deshalb implementiert, aber nicht
als real ausgeführt zu werten.

## Offene Grenzen

Es gibt noch keinen separaten Consumer-Host, Dead-Letter-Operatorpfad, Queue-
Metrics-/Alerting-Vertrag oder archivierte Multi-Instance-/Crash-/Load-Evidenz.
Functions, Cron, Webhooks und Vault-Secrets bleiben offen. Der nächste bounded
Slice ist `1.6.0-alpha.3`: Worker-Host, kontrolliertes DLQ-Replay und redigierte
Observability.
