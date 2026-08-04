# Release 0.16 — Incident Delivery Failure Classification

## Ergebnis

QKERN 0.16 transportiert die bereits redigierten Webhook-Fehler sicher durch die generische Publisher-Grenze bis in Outbox, Dead Letter, Incident-Detail und tenantgebundene Health-Sicht. Operatoren können Signing-Key-Ausfall, Timeout, Zielablehnung und ungültiges Ack unterscheiden, ohne Endpoint, Secret, Providerantwort oder Rohdiagnose zu erhalten.

## Enthalten

- `MigrationIncidentOutboxSinkError` als vertrauenswürdige, typisierte Klassifikationsgrenze für injizierte Incident-Sinks.
- Fallback auf `PUBLISH_FAILED` für unbekannte oder nicht klassifizierte Sink-Fehler.
- Persistente feste Ursachen `SIGNING_KEY_UNAVAILABLE`, `DELIVERY_TIMEOUT` und `DESTINATION_REJECTED` zusätzlich zu `PUBLISH_FAILED` und `INVALID_ACK`.
- Abbildung der Webhook-Codes: Key-Auflösung, Timeout, abgelehnte Zielantwort sowie ungültiges/zu großes Ack.
- Additive Migration `0015_migration_incident_delivery_failure_classification.sql` nach der unveränderten v0.14-Sichtmigration.
- Disjunkte aktive Ursachen-Counts; bereits erfolgreich publizierte Events verschlechtern den aktuellen Health-Status nicht.
- Sofort `critical` bei aktivem Signing-Key-Ausfall, `degraded` bei anderen aktiven Zustellfehlern und weiterhin `critical` bei Dead Letters.
- Strikte Service-Invarianten: Die Summe aller aktiven Ursachencounts muss exakt dem aktiven Failure-Count entsprechen.
- Erweiterte OpenAPI-, Repository-, Runtime-, Security- und Runbook-Verträge.

## Persistenz- und API-Vertrag

`lastFailureCode` enthält ausschließlich einen der fünf festen Codes. Die Health-Antwort liefert `activeFailureCount` sowie je einen disjunkten Count pro Code. `qkern_runtime` erhält weiterhin kein direktes Tabellenrecht auf Outbox oder Recovery-Commands, sondern nur `EXECUTE` auf die tenantgebundenen Projektionen. Providerantworten, URLs, Lease-Inhaber/-Token, Actoren, SQL und Credentials besitzen keinen Ausgabeslot.

## Upgrade

Bestehende 0.15-Installationen führen `0015_migration_incident_delivery_failure_classification.sql` in der normalen nummerierten Reihenfolge aus. Die Migration erweitert den bestehenden Check-Constraint und ersetzt die Health-Funktion transaktional durch den 0.16-Superset-Vertrag. Die Detailfunktion aus 0.14 und alle bestehenden Daten bleiben erhalten.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 314 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

## Weiterhin offene Production-Gates

- Real-PostgreSQL-Upgrade-, RLS- und Interleavingtests für Migration 0015 sowie Dead-Letter-/Recovery-Races
- Konkrete Vault-/KMS-Implementierung des Signing-Key-Providers und auditierter Rotation-Drill
- Pager-/Ticket-Provider-Onboarding, DNS-/Egress-Policy, Zertifikatsüberwachung und synthetische Zustellchecks
- Externes Scraping, Alert-Routing und On-call-Eskalation für die klassifizierten Health-Signale
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink, verifizierter Incident-Resolution-Workflow und vollständige Real-Service-E2E
