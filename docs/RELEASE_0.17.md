# Release 0.17 — Failure-Bound Incident Delivery Recovery

## Ergebnis

QKERN 0.17 bindet jedes Incident-Delivery-Recovery-Command an den festen Fehlercode, den der Operator unmittelbar vor der Anfrage gelesen hat. API, Datenbank-Trigger und Publisher-Worker erzwingen denselben Snapshot und eine ursachenkompatible Begründung. Ein veraltetes oder ursachenfremdes Command kann deshalb keine Dead-Letter-Zustellung erneut öffnen.

## Enthalten

- Pflichtfeld `expectedFailureCode` in Request, Service, Audit-Metadaten und redigiertem API-Ergebnis.
- Exakte Idempotenz: Nur ein bereits pendentes Command mit identischem Fehlercode und identischem Reason-Code gilt als Wiederholung.
- Additive Migration `0016_migration_incident_delivery_recovery_binding.sql` mit stabilem, gesperrtem Upgrade-Snapshot.
- Atomare Datenbankbindung von Tenant, Actor, Dead-Letter-Zustand, Retry-Kapazität, erwartetem Fehlercode und kompatiblem festen Grund.
- Erneute Fehlercode-Prüfung in der gefencten Worker-Update-Query unmittelbar vor der Zustandsänderung.
- Fail-closed-Backfill: Kompatible pendente Alt-Commands werden gebunden; inkompatible oder nicht bindbare Alt-Commands werden verworfen.
- Feste, gemeinsam in TypeScript, OpenAPI und SQL abgebildete Code-/Reason-Matrix.
- Redigierte Publisher-Telemetrie mit dem festen Fehlercode bei angewendeten oder verworfenen Recovery-Commands.
- Aktualisierte Security-, Architektur-, Roadmap- und Incident-Runbook-Verträge.

## Kompatibilitätsmatrix

| Beobachteter Fehler | Zulässige Recovery-Gründe |
| --- | --- |
| `SIGNING_KEY_UNAVAILABLE` | `credentials_rotated` |
| `DESTINATION_REJECTED` | `destination_recovered`, `credentials_rotated`, `provider_incident_resolved` |
| `PUBLISH_FAILED` | `destination_recovered`, `provider_incident_resolved` |
| `INVALID_ACK` | `destination_recovered`, `provider_incident_resolved` |
| `DELIVERY_TIMEOUT` | `destination_recovered`, `provider_incident_resolved` |

## Persistenz- und API-Vertrag

`POST /api/v1/migrations/incidents/{incidentId}/delivery/retry` akzeptiert ausschließlich `reasonCode` und `expectedFailureCode`; zusätzliche Felder und inkompatible Paare liefern `400`. Hat sich der persistierte Fehlerzustand geändert, ist die Zustellung nicht mehr dead-lettered, liegt ein abweichendes Command vor oder ist das Recovery-Limit ausgeschöpft, liefert der Pfad `409`. Die Route publiziert nicht, löst keinen Incident und verändert weder Migration-Job noch Change Set oder SQL.

Der Trigger sperrt den exakten Outbox-Datensatz und vergleicht den erwarteten Code mit `last_failure_code`. Beim späteren Verbrauch enthält die Worker-Query denselben Code in der `WHERE`-Bedingung. Erst wenn beide Bindungen erfolgreich sind, werden Failure-Code und Dead-Letter-Zustand gelöscht und der auf drei begrenzte Recovery-Zähler erhöht. Providerantworten, URLs, Lease-Daten, Rohdiagnosen und Credentials besitzen weiterhin keinen Command-, API- oder Log-Slot.

## Upgrade

Bestehende 0.16-Installationen führen `0016_migration_incident_delivery_recovery_binding.sql` nach Migration 0015 in der normalen nummerierten Reihenfolge aus. Die Migration erweitert nur `migration_incident_delivery_commands`, ersetzt die bestehende Triggerfunktion und gewährt `qkern_runtime` ausschließlich das zusätzliche spaltenbezogene `INSERT`-Recht. Historische verarbeitete Commands bleiben mit `NULL` im neuen Feld gültig. Für ein bestehendes Volume ist weiterhin ein kontrollierter Migrationslauf erforderlich; ein erneutes `docker compose up` aktualisiert das Schema nicht.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 318 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings ohne verfügbaren Fix bleiben offen

## Weiterhin offene Production-Gates

- Real-PostgreSQL-Upgrade-, RLS- und Interleavingtests für Migration 0016 sowie parallele Recovery-/Publisher-Races
- Konkrete Vault-/KMS-Implementierung des Signing-Key-Providers und auditierter Rotation-Drill
- Pager-/Ticket-Provider-Onboarding, DNS-/Egress-Policy, Zertifikatsüberwachung und synthetische Zustellchecks
- Externe Delivery-SLO-Alarme und On-call-Eskalation für die klassifizierten Health-Signale
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink, verifizierter Incident-Resolution-Workflow und vollständige Real-Service-E2E
