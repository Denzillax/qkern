# Release 1.6 Alpha 1 — Queues & Jobs Foundation

Release: `1.6.0-alpha.1` · Datum: 4. August 2026

## Ergebnis

QKERN ergänzt einen ersten ausführbaren Compute-/Messaging-Durchstich: exakt
gescopte Project Queues mit verzögerten Nachrichten, verifier-only Dedupe,
atomaren Claims, workergebundenen Leases, Renewal, serverberechnetem exponentiellem
Retry und Dead Letters. Das ist eine lokale Alpha-Foundation, keine Production-
Queue und noch keine Functions-/Cron-/Webhook-Plattform.

## Enthalten

- modularer `lib/server/project-queues`-Port mit Fachmodell, Service, Repository,
  Runtime-, Auth-, CORS- und Fehlergrenze;
- Queue-Policies für `authenticated` oder `service`, harte Konfigurations- und
  Payload-Grenzen sowie maximal sieben Tage verzögerte Ausführung;
- konkurrierendes Dedupe-Enqueue mit SHA-256-Verifier statt Rohschlüssel;
- claimbarer Zustandsautomat `available → in_flight → completed/dead_lettered`;
- 256-Bit-Lease-Tokens mit nur einmaliger Ausgabe, gespeichertem SHA-256-Verifier,
  Worker-Bindung, Ablauf-Fencing und monotoner Claim-Generation;
- feste Fehlercodes, begrenztes exponentielles Backoff und sofortiges Dead Letter
  für `INVALID_PAYLOAD`;
- REST-Endpunkte für Verwaltung, Enqueue, Claim, Ack, Fail, Renewal und redigierten
  Status, inklusive Same-Origin/CORS-/No-store-Grenzen;
- OpenAPI-3.1-Vertrag und drei scoped MCP-Werkzeuge für Liste, Status und Enqueue;
- Owner-/Administrator-Capability `project_queues_admin`; Worker-Operationen sind
  ausschließlich mit `service_role` zulässig;
- technische Production-Sperre für den `ephemeral` Memory-Adapter.

## Sicherheitsentscheidungen

Queue- und Statusantworten enthalten keine Payloads, Dedupe-Verifier, Worker-IDs
oder Lease-Daten. Nur ein Service-Worker erhält beim Claim Payload und einmaligen
Lease-Token. MCP exponiert keine Worker- oder Settlement-Funktion. Retry-Zeitpunkt,
Attempt-Grenze und Dead-Letter-Entscheidung bleiben Serverautorität. Wildcard-CORS,
Client-Tenant-Claims und ein Memory-Adapter in Production werden abgewiesen.

## Verifikation

Am 4. August 2026 wurden Strict TypeScript, **627 Vitest-Tests**, der Next.js-
Production-Build und `npm audit --omit=dev --audit-level=moderate` grün ausgeführt;
der Audit meldete 0 bekannte Schwachstellen. **21** optionale Real-Service-Tests
blieben übersprungen. Docker, Podman, `postgres` und `psql` waren in dieser
Arbeitsumgebung nicht verfügbar; PostgreSQL-17- und MinIO-/ClamAV-Zertifizierung
wurden deshalb nicht ausgeführt und bleiben offen.

Die neue Queue-Matrix prüft Tenant-/Policy-Isolation, Parallel-Dedupe, Scheduling,
Claim-Ordering, Lease-Fencing/Renewal, Retry/Dead Letter, Payloadgrenzen,
Runtime-Production-Deny, CORS/CSRF, Rollen, OpenAPI und MCP-Annotationen.

## Offene Grenzen

Der Adapter ist prozesslokal und verliert alle Daten beim Neustart. Es gibt keine
neue Datenbankmigration, keinen realen Broker, keine horizontalen Worker, keine
Dead-Letter-Wiederanstellung, keine Queue-Metriken und keine Last-/Soak-/Crash-
Zertifizierung. Functions, Cron, Webhooks, Vault-Secrets und isolierte Compute-
Ausführung bleiben spätere 1.6-Slices. Auch die offenen Live-Gates aus Project
Auth, Storage und Realtime bleiben unverändert offen.

Der nächste bounded Slice ist `1.6.0-alpha.2`: ein tenantisolierter PostgreSQL-
Queue-Adapter mit `FOR UPDATE SKIP LOCKED`, persistentem Lease-Fencing,
Retention/Cleanup und demselben Conformance-Vertrag wie der Memory-Adapter. Erst
danach folgen ein separater Worker-Host und Dead-Letter-Operatorpfade; Functions
oder Webhooks werden nicht in den Webprozess eingebettet.
