# Release 0.9 — Migration Incident Escalation

## Ergebnis

QKERN 0.9 ergänzt nach ausgeschöpften Review-Zyklen eine automatische, persistente Incident-Eskalation. Sie macht ungeklärte Migrationsergebnisse sichtbar und quittierbar, ohne den Job zu verändern, SQL erneut auszuführen oder eine technische Auflösung vorzutäuschen.

## Enthalten

- Migration `0010_migration_incident_escalations.sql` mit erzwungener RLS, genau einem Incident pro Tenant/Job und unveränderlicher Evidenz.
- Nur `qkern_worker` darf aus `review_required` plus ausgeschöpftem Review-Limit einen Incident erzeugen.
- `GET /api/v1/migrations/incidents` liefert redigierte, referenzbasierte Incident-Daten; Owner, Administratoren und Support dürfen lesen.
- `POST /api/v1/migrations/incidents/{incidentId}/acknowledgement` erlaubt Ownern und Administratoren eine einmalige Quittierung mit festem Code.
- Support besitzt keine Quittierungs-Capability; Deployer, Developer, Analysten und Read-only-Mitglieder erhalten keinen Incident-Zugriff.
- Die Runtime darf nur Status und festen Code setzen; der Datenbank-Trigger leitet Actor und Zeitpunkt selbst aus dem serverseitigen Transaktionskontext ab und verhindert Evidenzänderungen oder eine zweite Transition.
- `open` und `acknowledged` sind die einzigen Incident-Zustände. Es gibt bewusst kein `resolved` und keine API zur Job-, Change-Set-, Ledger- oder SQL-Mutation.
- Worker-Eröffnung und Operator-Quittierung werden mit festen, redigierten Metadaten auditiert.
- OpenAPI-Vertrag, Runtime-Auswahl, Repository-, Worker-, Rollen-, Route-, Idempotenz-, Redaction- und Schema-Tests wurden ergänzt.
- `docs/MIGRATION_INCIDENT_RUNBOOK.md` definiert sichere Triage und klare Eskalationsgrenzen.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 254 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die übersprungenen Tests benötigen getrennte reale Owner-, Runtime- und Auth-PostgreSQL-URLs. Der grüne Standardlauf ist daher kein Nachweis für echte Worker-/Crash-/Fence-/Incident-Races.

## Weiterhin offene Production-Gates

- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Real-PostgreSQL-Worker-E2E einschließlich Crash-, Reclaim-, Heartbeat-, Target-Fence- und Incident-Interleavings
- Externe Pager-/Ticket-Zustellung und ein verifizierter Incident-Resolution-Workflow
- Überwachte Worker-/Publisher-Hosts und produktiver Broker-Sink
- Stale-Worker-Cancellation, Restore-Drills, HA, OAuth/OIDC für Remote MCP und die weiteren Gates aus `docs/QA.md`
