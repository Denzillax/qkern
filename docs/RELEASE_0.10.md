# Release 0.10 — Incident Notification Outbox

## Ergebnis

QKERN 0.10 ergänzt die Incident-Eskalation um eine persistente, gefencte Zustellgrenze. Incident und Notification-Event entstehen atomar; ein eigenständig konfigurierbarer Publisher liefert ausschließlich feste Referenzdaten an einen injizierten Pager-/Ticket-Sink.

## Enthalten

- Migration `0011_migration_incident_outbox.sql` mit erzwungener RLS, genau einem `migration.incident.opened`-Event pro Incident und idempotentem Backfill vorhandener v0.9-Incidents.
- Die Incident-Outbox speichert nur Tenant- und Incident-Referenz, keine SQL-Artefakte, Datenbankreferenzen, Credentials, Acknowledgement-Actors oder Rohdiagnosen.
- Incident-Eröffnung, Outbox-Event und Audit bleiben in derselben Worker-/Tenant-Transaktion.
- Die Web-Runtime besitzt keine SELECT-, INSERT- oder UPDATE-Rechte auf die Notification-Outbox.
- `PostgresMigrationIncidentOutboxLeasePort` bindet Claim, Publish und Backoff an genau einen Tenant und Publisher-Actor.
- `MigrationIncidentOutboxPublisher` arbeitet seriell at-least-once mit `FOR UPDATE SKIP LOCKED`, zufälligem Lease-Token, Ablaufprüfung, exponentiellem Backoff und abbrechbarem Loop.
- Nur ein Sink-Ack mit exakt passender Event-ID darf `markPublished` auslösen; falsche Acks und Publish-Fehler werden gefenct erneut eingeplant.
- Der Message-Typ enthält ausschliesslich Event-, Tenant-, Incident-, Job-, Projekt- und Change-Set-Referenzen sowie feste Environment-/Kind-/Severity-Werte und den Incident-Zeitpunkt.
- Der Incident-Publisher ist unabhängig von Migration Worker und Apply-Outbox-Publisher aktivierbar und nutzt dieselbe startgeprüfte `qkern_worker`-Datenbankgrenze.
- Neue Umgebungsvariablen konfigurieren Enablement, Publisher-ID, Lease, Retry und Idle-Wait unabhängig.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 269 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die übersprungenen Tests benötigen getrennte reale Owner-, Runtime- und Auth-PostgreSQL-URLs. Der grüne Standardlauf ist daher kein Nachweis für echte Worker-/Crash-/Fence-/Outbox-Races.

## Weiterhin offene Production-Gates

- Konkreter authentifizierter Pager-/Ticket-Sink und überwachter Publisher-Host
- Dead-Letter-Policy, Delivery-SLOs, Alarmtests und Recovery-Telemetrie
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Real-PostgreSQL-Worker-E2E einschließlich Crash-, Reclaim-, Heartbeat-, Target-Fence- und Outbox-Interleavings
- Verifizierter Incident-Resolution-Workflow, Stale-Worker-Cancellation und die weiteren Gates aus `docs/QA.md`
