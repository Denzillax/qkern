# Release 0.13 — Incident Delivery Health

## Ergebnis

QKERN 0.13 macht den internen Zustand der Incident-Zustellung tenantgebunden und alert-ready sichtbar, ohne der Web-Runtime Outbox-Tabellenrechte zu geben. Die API liefert ausschließlich Aggregate und klassifiziert den Queue-Zustand deterministisch als `healthy`, `degraded` oder `critical`.

## Enthalten

- Migration `0013_migration_incident_delivery_health.sql` mit einer tenantgebundenen `SECURITY DEFINER`-Funktion.
- `qkern_runtime` erhält nur `EXECUTE` auf diese Funktion und weiterhin kein `SELECT` auf `migration_incident_outbox`.
- Aggregate für Pending-, überfällige, in-flight-, abgelaufene Lease-, Recovery-, Dead-Letter- und ausgeschöpfte Recovery-Zustände.
- Ausschließlich ältester Pending-, letzter Dead-Letter- und Messzeitpunkt; keine Event-/Incident-/Actor-IDs.
- Fester Pending-SLO von fünf Minuten.
- `critical` bei mindestens einem Dead Letter, `degraded` bei überfälligem Pending-Event oder abgelaufenem Lease, sonst `healthy`.
- Read-only `GET /api/v1/migrations/incidents/delivery/health` für Rollen mit Incident-Lesecapability.
- Antwort mit `Cache-Control: private, no-store`.
- Nichtnegative Safe-Integer- und ISO-Zeitvalidierung an der Repository-Grenze.
- OpenAPI-, SQL-, Repository-, Service-, Route- und Redaction-Verträge wurden erweitert.

## Sicherheitsgrenze

Der Health-Vertrag enthält keine Organisation-, Incident- oder Event-ID, keine Failure-Codes oder Recovery-Gründe, keine Providerantworten, Endpoints, Rohdiagnosen oder Credentials. Er schreibt keinen Zustand. `healthy` beschreibt nur die persistente interne Queue zum Messzeitpunkt und ist kein DNS-, TLS- oder Provider-Liveness-Nachweis.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 301 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die Funktion und ihre Rechte werden statisch geprüft; die Service-/API-Verträge laufen isoliert. Dies ersetzt weder Real-PostgreSQL-RLS-/Race-Tests noch externes Monitoring.

## Weiterhin offene Production-Gates

- Real-PostgreSQL-RLS-/Interleavingtests für Health, Dead-Letter und Recovery
- Externes Scraping, Alarmrouting, On-call-Eskalation und synthetische Provider-Checks
- Provider-Onboarding und Live-E2E des Pager-/Ticket-Gateways einschließlich DNS-/Egress-Policy
- HMAC-Rotation und Zertifikatsüberwachung
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink und verifizierter Incident-Resolution-Workflow
