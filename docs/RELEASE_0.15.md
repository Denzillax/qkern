# Release 0.15 — Rotatable Incident Webhook Signing

## Ergebnis

QKERN 0.15 erweitert den signierten Incident-Webhook um einen pro Zustellung aufgelösten Signing-Key-Provider und eine explizite Key-ID. Damit kann ein Deployment HMAC-Schlüssel mit kontrollierter Überlappung rotieren, ohne den Event-, Ack- oder Outbox-Vertrag zu ändern. Die Control-Plane-Datenbank bleibt gegenüber 0.14 unverändert; es gibt keine neue SQL-Migration.

## Enthalten

- `IncidentWebhookSigningKeyProvider` als injizierbare Runtime-Grenze für statische oder Vault-backed Schlüsselquellen.
- Erneute Key-Auflösung vor jeder Zustellung statt eines beim Prozessstart fixierten Sink-Secrets.
- Atomare Übertragung von `X-QKERN-Signature-Key-ID` und `X-QKERN-Signature: v1=<HMAC>` für dasselbe validierte Schlüsselpaar.
- Strikte Key-ID-Syntax sowie Secret-Grenzen von 32 bis 4096 Bytes.
- Gemeinsames Abbruch-/Timeoutfenster für Key-Auflösung und Netzwerkzugriff.
- Stabiler Fehlercode `SIGNING_KEY_UNAVAILABLE`; Provider-, Secret- und Vault-Diagnosen werden nicht weitergegeben.
- Fail-closed Ablehnung einer gemischten Autorität aus injiziertem Provider und Environment-Schlüssel.
- Statischer Environment-Adapter mit `QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID` und `QKERN_INCIDENT_WEBHOOK_HMAC_SECRET`.
- Aktualisierte Runtime-Komposition, Beispielkonfiguration, Architektur-, Security- und Runbook-Verträge.

## Empfängervertrag und Rotation

Der Receiver wählt den Verifikationsschlüssel über `X-QKERN-Signature-Key-ID` und prüft HMAC-SHA-256 über `<unix-seconds>.<raw-json-body>`. Während einer Rotation darf er den bisherigen Schlüssel nur in einem eng begrenzten Überlappungsfenster zusätzlich akzeptieren. Timestamp-/Replay-Schutz und idempotente Verarbeitung der Event-ID bleiben verpflichtend. Erst das exakt zweifeldrige Ack mit derselben Event-ID gilt als Zustellbestätigung.

## Sicherheitsgrenze

Ungültige oder nicht verfügbare Signing Keys verhindern den Netzwerkzugriff vollständig. Der rotierende Provider erhält ein Abort-Signal; auch ein Provider, der dieses ignoriert, wird durch die Sink-Grenze zeitlich begrenzt. Key-ID und Secret werden gemeinsam validiert und für die einzelne Zustellung kopiert. Fehler enthalten weder Key-ID, Secret, Endpoint, Providerantwort noch Transportdiagnosen.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 304 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

## Weiterhin offene Production-Gates

- Konkrete Vault-/KMS-Implementierung des Signing-Key-Providers und auditierter Rotation-Runbook-Drill
- Live-Verifikation des Receiver-Überlappungsfensters, Replay-Schutzes und der Key-Rücknahme
- Provider-Onboarding, DNS-/Egress-Policy, Zertifikatsüberwachung und synthetische Zustellchecks
- Externes Scraping, Alarmrouting und On-call-Eskalation für Delivery-SLOs
- Real-PostgreSQL-RLS-/Interleavingtests für Dead-Letter-/Recovery- und Outbox-Races
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink sowie verifizierter Incident-Resolution-Workflow
