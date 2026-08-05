# QKERN Dokumentation

| Dokument | Zweck |
| --- | --- |
| [STATUS.md](../STATUS.md) | Aktueller, ehrlicher Produkt- und Releasezustand |
| [HANDBUCH.md](HANDBUCH.md) | Installation, Bedienung, Tests, Automation und MCP |
| [STUFENPLAN.md](STUFENPLAN.md) | Alle Ausbaustufen mit Ein- und Austrittskriterien |
| [MODULES.md](MODULES.md) | Modulgrenzen, Abhängigkeiten und Erweiterungsregeln |
| [BAAS_ROADMAP.md](BAAS_ROADMAP.md) | Produkt-Roadmap bis QKERN 2.0 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technische Systemarchitektur und Zustandsautomaten |
| [SECURITY.md](SECURITY.md) | Trust Boundaries, Sicherheitsannahmen und Go-live-Gates |
| [QA.md](QA.md) | Testabdeckung, Qualitätsziele und Release Gates |
| [DOCS_MAINTENANCE.md](DOCS_MAINTENANCE.md) | Verbindliche Dokumentationspflege bei jeder Änderung |
| [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) | Chatunabhängiger Übergabestand und nächste Arbeit für Coding-Agenten |
| [REALTIME_PROTOCOL.md](REALTIME_PROTOCOL.md) | WebSocket-Protokoll, Channel-Policy, Replay, Presence und Grenzen |
| [PROJECT_QUEUES.md](PROJECT_QUEUES.md) | Queue-Policies, Dedupe, Claims, Lease-Fencing, Retry und Alpha-Grenzen |
| [USAGE_METERING.md](USAGE_METERING.md) | Monatsledger, Idempotenz, Quota-Modi, Tenant-Grenzen und Billing-Nichtziele |
| [COMPUTE_CONTRACTS.md](COMPUTE_CONTRACTS.md) | Function-, Cron- und Webhook-Sicherheitsverträge |
| [SDK_TYPESCRIPT.md](SDK_TYPESCRIPT.md) | TypeScript SDK, Typed Clients und Sicherheitsverträge |
| [CLI.md](CLI.md) | CLI, Type-Generator, Migration Plan und Seed-Check |
| [DEVELOPER_EXPERIENCE.md](DEVELOPER_EXPERIENCE.md) | Paketbuilds, Fresh-Project-Smoke und OS-Matrix |
| [RELEASE_1.17.md](RELEASE_1.17.md) | Aktueller Release: Queues ueber mehrere Instanzen |
| [RELEASE_1.16.md](RELEASE_1.16.md) | Historischer Release: Postgres Changes in Betrieb |
| [RELEASE_1.15.md](RELEASE_1.15.md) | Historischer Release: Realtime in Betrieb |
| [RELEASE_1.14.md](RELEASE_1.14.md) | Historischer Release: Change Delivery End to End |
| [RELEASE_1.13.md](RELEASE_1.13.md) | Historischer Release: Postgres Changes |
| [RELEASE_1.12.md](RELEASE_1.12.md) | Historischer Release: Change Capture Foundation |
| [RELEASE_1.11.md](RELEASE_1.11.md) | Historischer Release: Realtime Durability and Fan-out |
| [RELEASE_1.10.md](RELEASE_1.10.md) | Historischer Release: Project Auth Provider Certification |
| [RELEASE_1.9.md](RELEASE_1.9.md) | Historischer Release: Real-Service Certification |
| [RELEASE_1.8_ALPHA1.md](RELEASE_1.8_ALPHA1.md) | Historischer Release: Usage Metering & Quotas |
| [RELEASE_1.7_ALPHA3.md](RELEASE_1.7_ALPHA3.md) | Historischer Release: Packages & Cross-Platform Contracts |
| [RELEASE_1.7_ALPHA2.md](RELEASE_1.7_ALPHA2.md) | Historischer Release: CLI & Local Workflow |
| [RELEASE_1.7_ALPHA1.md](RELEASE_1.7_ALPHA1.md) | Historischer Release: TypeScript SDK |
| [RELEASE_1.6_ALPHA4.md](RELEASE_1.6_ALPHA4.md) | Historischer Release: Compute Contracts |
| [RELEASE_1.6_ALPHA3.md](RELEASE_1.6_ALPHA3.md) | Historischer Release: Queue Worker & Dead Letters |
| [RELEASE_1.6_ALPHA2.md](RELEASE_1.6_ALPHA2.md) | Historischer Release: Durable Project Queues |
| [RELEASE_1.6_ALPHA1.md](RELEASE_1.6_ALPHA1.md) | Historischer Release: Queue-/Jobs-Foundation |
| [RELEASE_1.5_ALPHA1.md](RELEASE_1.5_ALPHA1.md) | Historischer Release: Realtime Foundation |
| [RELEASE_1.4_ALPHA3.md](RELEASE_1.4_ALPHA3.md) | Historischer Release: Storage-Concurrency-Härtung |
| [RELEASE_1.4_ALPHA2.md](RELEASE_1.4_ALPHA2.md) | Historischer Release: ClamAV und Real-Service-Harness |
| [RELEASE_1.4_ALPHA1.md](RELEASE_1.4_ALPHA1.md) | Historischer Release: erster Object-Storage-Durchstich |
| [RELEASE_1.3_ALPHA1.md](RELEASE_1.3_ALPHA1.md) | Historischer Release: Project Auth |
| [RELEASE_1.2_ALPHA1.md](RELEASE_1.2_ALPHA1.md) | Historischer Release: Generated Data API |
| [RELEASE_1.1_ALPHA1.md](RELEASE_1.1_ALPHA1.md) | Historischer Release: Data Plane und Autonomie |

Zertifizierungsevidenz liegt unter `docs/evidence/<datum>/`: ungefilterte Rohlogs
jedes Laufs samt generiertem Manifest mit Commit, Exit-Code, Testzahlen,
Migrationszahl und Image-Tags.

Runbooks für Production Apply, Provisioning, Background Runtimes, Incidents,
Backups und signierte Evidenz liegen ebenfalls in diesem Ordner. Historische
`RELEASE_*`-Dateien bleiben unverändert und dienen als nachvollziehbare Chronik.
