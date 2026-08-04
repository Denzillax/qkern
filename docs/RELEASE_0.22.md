# Release 0.22 — Signierter Apply-Broker und Delivery Recovery

## Ergebnis

QKERN 0.22 liefert den startbaren Production-Adapter für die Apply-Outbox. `npm run publisher:apply` sendet ausschließlich `eventId`, `eventType`, `organizationId` und `migrationJobId` an einen exakt erlaubten Broker-Endpunkt. SQL, Projekt-Datenbankverbindungen, Credentials und Rohdiagnosen besitzen keinen Message-, Persistenz- oder Log-Slot.

## Brokervertrag

- HMAC-SHA-256 über `<unix-seconds>.<raw-json-body>` mit versionierter Key-ID
- Production ausschließlich über HTTPS/443 an einen exakten DNS-Host; keine URL-Credentials, Query-Parameter, Fragmente oder Redirects
- private JSON-Schlüsseldatei oder injizierter Provider, pro Zustellung neu gelesen und deshalb rotationsfähig; Environment-Secrets sind in Production verboten
- gemeinsames Abbruch-/Timeoutfenster für Schlüsselauflösung und Transport mit mindestens 1000 ms Lease-Abschlussreserve
- maximal 4096 Bytes großes JSON-Ack mit exakt `status: ack` und derselben Event-ID
- at-least-once; der Broker-Consumer muss Event-IDs idempotent verarbeiten und Tenant-/Topic-ACLs erzwingen

## Persistente Delivery-Grenze

Migration `0019_migration_apply_delivery_resilience.sql` ergänzt feste Fehlercodes, acht Zustellfehler bis `dead_lettered` und höchstens drei Recovery-Zyklen. Recovery-Commands werden datenbankseitig an Tenant, Actor, kompatiblen Grund, beobachteten Fehlercode und Retry-Generation gebunden. Der Publisher prüft denselben Snapshot vor dem Requeue erneut. Veraltete, fremde und ABA-wiederkehrende Commands scheitern geschlossen.

Die Web-Runtime verliert direkte `SELECT`-Rechte auf `migration_outbox`. Sie erhält nur:

- `GET /api/v1/migrations/{jobId}/delivery` für eine redigierte Job-Sicht
- `GET /api/v1/migrations/delivery/health` für tenantweite, disjunkte Aggregate
- `POST /api/v1/migrations/{jobId}/delivery/retry` für ein referenzbasiertes, SQL-freies Recovery-Command

Owner und Administratoren dürfen Recovery anfordern; Deployer und Support dürfen Delivery lesen. Antworten enthalten weder Lease-Inhaber/-Token noch Actor-, Broker-, Provider- oder Credential-Daten und sind `private, no-store`.

## Verifikation dieses Artefakts

- TypeScript Strict Typecheck: erfolgreich
- lokale Vitest-Suite: 388 bestanden; 9 optionale Real-PostgreSQL-Tests in 2 Dateien mangels Datenbankvoraussetzungen übersprungen
- gezielte Broker-, Publisher-, Repository-, Migration-, Service-, Route-, Rollen- und OpenAPI-Tests: erfolgreich
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine Critical-/High-Findings; zwei moderate PostCSS-Findings ohne verfügbaren Fix in der fest gebundenen Next.js-Auflösung

## Upgrade

Bestehende 0.21-Installationen müssen Migration `0019` unter dem Control-Plane-Migrationseigentümer einmalig und geordnet ausführen. Danach startet der Apply-Publisher nur mit eigenem `qkern_worker`-Login, einem festen Tenant, explizitem Enable-Flag, exakter Broker-Allowlist und Rotationsschlüssel. Der Receiver muss vor Aktivierung Signatur, Timestamp, Event-ID-Idempotenz und Tenant-/Topic-ACLs durchsetzen.

## Offene Production-Gates

- echter Projekt-Datenbank-Provisioner und kontrollierter Zertifikat-Rollover
- archivierte Live-Tests von Vault-Policy, Agent-Token- und Static-Credential-Rotation
- Broker-/Pager-Onboarding, Netzwerk-Egress, Tenant-/Topic-ACLs und überwachte Delivery-SLOs
- Target-Database-Crash-, Reclaim-, Heartbeat-, Fence- und beide Outbox-Recovery-Interleavings

Bis diese Gates bestanden sind, bleibt Production-Apply nicht freigegeben.
