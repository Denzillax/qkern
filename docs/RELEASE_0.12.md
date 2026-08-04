# Release 0.12 — Incident Delivery Dead Letters

## Ergebnis

QKERN 0.12 begrenzt dauerhaft fehlschlagende Incident-Zustellungen. Acht bestätigte Publish-/Ack-Fehler führen atomar in einen persistenten Dead-Letter-Zustand; nach behobener Ursache kann ein autorisierter Operator höchstens drei weitere Zustellzyklen anfordern.

## Enthalten

- Migration `0012_migration_incident_dead_letters.sql` mit persistentem Failure-Zähler, festen Fehlercodes, `dead_lettered`-Zeitpunkt und begrenztem Recovery-Zähler.
- Gefencter Failure-Übergang: Event-ID, Publisher-ID, Lease-Token und noch gültiges Lease müssen exakt übereinstimmen.
- Prozessabbruch, Crash-/Lease-Recovery und Lease-Verlust werden nicht als Providerfehler gezählt.
- Owner-/Administrator-Capability und CSRF-geschützte Route `POST /api/v1/migrations/incidents/{incidentId}/delivery/retry`.
- Ausschließlich feste Reason-Codes: `destination_recovered`, `credentials_rotated` und `provider_incident_resolved`.
- Actor-Bindung im Datenbank-Trigger; die Web-Runtime besitzt weiterhin kein UPDATE-Recht auf der Outbox.
- Der Publisher-Worker konsumiert Commands vor neuen Claims, validiert den Dead-Letter-Zustand erneut und öffnet maximal drei Recovery-Zyklen.
- Idempotentes pendentes Command pro Incident und tenantgebundene Nicht-Existenz-Semantik.
- Redigierte Telemetrie für angewendete/abgewiesene Commands, Dead-Lettering und Queue-Fehler ohne Providerantworten oder Rohdiagnosen.
- OpenAPI-, Repository-, Service-, Route-, Runtime-, Publisher- und Security-Verträge wurden erweitert.

## Sicherheitsgrenze

Ein Delivery-Retry sendet nicht im HTTP-Request. Er führt kein SQL aus, verändert keinen Migration-Job oder Change Set und löst den Incident nicht. Nur `qkern_worker` darf das referenzbasierte Command konsumieren und die Zustell-Outbox gefenct erneut öffnen.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 291 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die automatisierten Tests belegen die SQL-/Rollenverträge statisch und die Anwendungszustände mit isolierten Ports. Sie ersetzen keine Real-PostgreSQL-Interleavings oder echte Pager-/Ticket-Zustellung.

## Weiterhin offene Production-Gates

- Real-PostgreSQL-Race-Tests für Failure-Grenze, Dead-Letter-Transition und konkurrierende Recovery-Commands
- Provider-Onboarding und Live-E2E des gewählten Pager-/Ticket-Gateways
- DNS-/Egress-Policy, HMAC-Rotation, Zertifikatsüberwachung, Delivery-SLOs und Alarmtests
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink samt eigener Delivery-/Dead-Letter-Policy
- Verifizierter Incident-Resolution-Workflow und vollständige Real-PostgreSQL-Worker-E2E
