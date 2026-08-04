# Release 0.11 — Signed Incident Webhook Runtime

## Ergebnis

QKERN 0.11 operationalisiert die persistente Incident-Notification-Outbox. Ein eigener, sauber abbrechbarer Host liefert den festen referenzbasierten Incident-Vertrag an einen HMAC-authentifizierten HTTPS-Gateway für Pager-/Ticket-Systeme.

## Enthalten

- `SignedIncidentWebhookSink` mit HMAC-SHA-256 über `<unix-seconds>.<raw-json-body>`.
- Event-ID als Idempotency-Key sowie separate Timestamp-, Signatur- und Event-Headers.
- Exakte Host-Allowlist ohne Wildcards; Production akzeptiert nur HTTPS auf Port 443 mit öffentlichem FQDN.
- URL-Credentials, Query-Parameter, Fragmente, lokale/literale Ziele und HTTP-Redirects werden fail-closed abgewiesen.
- Antwortstatus, JSON-Content-Type, maximale Antwortgröße und exakt zweifeldriges Ack mit derselben Event-ID werden geprüft.
- Timeout, Transport-, Endpoint- und Response-Details werden auf feste Fehlercodes redigiert.
- Der Webhook-Timeout muss mindestens 1000 ms Abschlussreserve innerhalb der Outbox-Lease lassen.
- Der Host `npm run publisher:incidents` ist unabhängig vom Migration Worker und Apply-Outbox-Publisher, reagiert auf SIGINT/SIGTERM und schließt den Worker-Pool geordnet.
- Endpoint, Allowlist, Secret und Timeout werden ausschließlich über fail-closed Runtime-Konfiguration gebunden.

## Receiver-Vertrag

Der Gateway muss den unveränderten Request-Body verwenden, die HMAC-Signatur konstantzeitlich prüfen, nur einen engen Timestamp-Zeitraum akzeptieren, Replays verhindern und Event-IDs idempotent verarbeiten. Erfolgreiche Übernahme wird ausschließlich mit `{"status":"ack","eventId":"<Event-ID>"}` und `Content-Type: application/json` bestätigt.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 277 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die Tests verwenden einen injizierten Fetch-Transport. Sie belegen Signatur, Request-Vertrag, Timeout, Abbruch, Response-Limit, Redaction und Konfigurationsgrenzen, aber keine reale DNS-, TLS-, Firewall-, Provider- oder PostgreSQL-Interaktion.

## Weiterhin offene Production-Gates

- Provider-Onboarding und Live-E2E des gewählten Pager-/Ticket-Gateways
- DNS-Rebinding-Schutz und ausgehende Firewall-/Proxy-Allowlist im Deployment
- HMAC-Secret-Rotation, Zertifikatsüberwachung, Delivery-SLOs und Alarmtests
- Persistente Dead-Letter-Policy und Recovery-Telemetrie
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Real-PostgreSQL-Worker-E2E und verifizierter Incident-Resolution-Workflow
