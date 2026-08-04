# Release 0.14 — Incident Delivery Operations

## Ergebnis

QKERN 0.14 konsolidiert die v0.13-SLO-Health mit einer autorisierten Detailprojektion pro Incident. Die Migrationslinie bleibt upgrade-sicher: `0013` bleibt unverändert erhalten, `0014` erweitert den Vertrag transaktional.

## Enthalten

- Additive Migration `0014_migration_incident_delivery_visibility.sql` nach der unveränderten v0.13-Migration.
- Detailprojektion für höchstens 100 bereits tenantautorisiert gelistete Incident-IDs.
- Event-ID, fester Zustand/Fehlercode, Attempt-/Failure-/Recovery-Zähler und Zeitpunkte pro Incident.
- Erweiterte Health-Counts für Total, Ready, Scheduled, Published und pendente Recovery-Commands.
- Erhaltene SLO-Signale für Overdue-Pending, abgelaufene Leases, Recovery-Pending und Recovery-Exhaustion.
- Erhaltene kompatible Health-Antwort unter `data.deliveryHealth` mit `healthy`, `degraded` und `critical`.
- Redigierter Delivery-Zustand in `GET /api/v1/migrations/incidents`.
- Strikte Safe-Integer-, Zeit- und Count-Invarianten; inkonsistente Snapshots scheitern fail-closed.
- `private, no-store` für Health und Incident-Liste.
- Aktualisierte OpenAPI-, Repository-, Service-, Route-, Security- und Runbook-Verträge.

## Sicherheitsgrenze

`qkern_runtime` erhält weiterhin kein `SELECT` auf Incident-Outbox oder Delivery-Commands, sondern nur `EXECUTE` auf tenantgebundene Projektionen. Die Health-Antwort enthält keine Identifikatoren. Die Incident-Detailansicht wird ausschließlich für bereits durch die Incident-Leserolle autorisierte Fälle erzeugt. Lease-Owner/-Token, Actoren, Providerantworten, URLs, SQL, Credentials und Rohdiagnosen besitzen keinen Ausgabeslot.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 301 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

## Weiterhin offene Production-Gates

- Real-PostgreSQL-RLS-/Interleavingtests für beide Projektionen und Dead-Letter-/Recovery-Races
- Externes Scraping, Alarmrouting, On-call-Eskalation und synthetische Provider-Checks
- Provider-Onboarding, DNS-/Egress-Policy, HMAC-Rotation und Zertifikatsüberwachung
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink samt eigener Delivery-/Dead-Letter-Policy
- Verifizierter Incident-Resolution-Workflow und vollständige Real-PostgreSQL-Worker-E2E
