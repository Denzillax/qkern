# QKERN BaaS Roadmap

Zielbild: QKERN deckt die Kernbreite einer modernen Backend-as-a-Service-
Plattform ab. Die Differenzierung bleibt eine providerunabhängige, kontrollierte
AI-Schicht mit Schweizer Betriebsoptionen, nicht eine blinde Kopie eines anderen
Produkts.

| Release | Vertikaler Slice | Fertig, wenn |
| --- | --- | --- |
| 1.1 | Data Plane + Autonomie | Echte Introspection/Read-only Queries, RLS-Grenze, REST/MCP-Parität, `manual`/`guarded`/`autonomous` |
| 1.2 | Generated Data API · Alpha fertig | CRUD/Table REST, Filter/Pagination, Projekt-Keys, OpenAPI aus Schema, RLS Claims |
| 1.3 | Project Auth · Alpha in Arbeit | App-User, Email/OIDC, Magic Link, MFA, Admin API, JWT/JWKS und RLS implementiert; Delivery-/Provider-E2E offen |
| 1.4 | Storage · Alpha in Arbeit | Buckets, signed URLs, Policies, Quotas, Quarantäne, ClamAV- und Concurrency-Harnesses implementiert; archivierte Läufe, Multipart und Transforms offen |
| 1.5 | Realtime · Alpha in Arbeit | lokaler WebSocket, Broadcast, Presence, Ordering, Cursor und Backpressure implementiert; persistente CDC, Fan-out und Lasttests offen |
| 1.6 | Compute + Messaging · Alpha-Checkpoint | Queue-/Jobs plus PostgreSQL, Worker/DLQ und sichere interne Function-/Cron-/Webhook-Ports; Production-Adapter/E2E offen |
| 1.7 | Developer Experience · Alpha-Checkpoint | typed SDK/CLI, Type-Generator, Migration-/Seed-Check, Paketbuild und Linux-Fresh-Smoke implementiert; echte Drei-OS-/Upgrade-Evidenz und Publishing offen |
| 1.8 | Platform Operations · Alpha in Arbeit | Usage-Ledger, harte/observierende Quotas und read-only Projektion implementiert; Produkt-Emitter, Billing, Teams, Logs/Monitoring, PITR, Restore und Status offen |
| 2.0 | Managed Platform | HA, Skalierung, Upgradepfad, Schweizer Datenflussnachweis, externe Security- und DR-Zertifizierung |

Beedaro-spezifische Domänen wie Listings, Suche, Orders, Zahlungen, Moderation,
Messaging und Marketplace-Workflows werden auf diesen Plattformdiensten gebaut;
sie gehören nicht als Sonderlogik in den QKERN-Kern.
