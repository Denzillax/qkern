# QKERN 1.1 Alpha 1 — Data Plane und einstellbare Agentenautonomie

1.1 Alpha 1 beginnt den Ausbau vom Control-Plane-MVP zur AI-nativen Backend-
Plattform. Der Release behauptet bewusst noch keine Supabase-Parität.

## Neu

- Echte PostgreSQL-Schema-Introspection für Projektumgebungen
- AST-validierte Read-only-Abfragen mit maximal 100 Zeilen und 256 KiB
- Erzwungene Read-only-Transaktion, `row_security=on`, Rollen-/Datenbankprüfung,
  Timeouts, Secret-Redaction und cause-freie Fehler
- REST- und MCP-Werkzeuge verwenden dieselbe Data-Plane-Grenze
- Persistente Automation Policies je Projekt und Environment
- Betriebsarten `manual`, `guarded` und `autonomous`
- Explizite maximale Auto-Risikostufe, optionales Auto-Queueing und Not-Aus
- System-attribuierte, unveränderliche Approval Decisions statt Bypass
- Approval-Center-Oberfläche und OpenAPI-Vertrag für die Policy

## Semantik der Autonomie

`manual` behält Freigaben pro riskanter Änderung. `guarded` genehmigt nur eine
kleine Allowlist nicht-produktiver, maximal mittelriskanter DDL-Klassen.
`autonomous` ist eine vom Owner oder Administrator gesetzte stehende Autorisierung:
Änderungen bis zur konfigurierten Risikogrenze benötigen keine menschliche
Freigabe pro Änderung. Jede Entscheidung erzeugt weiterhin einen Approval-
Datensatz, eine actor-attribuierte Decision und Audit Events.

Der Not-Aus übersteuert alle automatischen Entscheidungen. Production kann
automatisch genehmigt werden, wird aber nicht direkt von der Web-Control-Plane
eingereiht. Die bestehende separate, maschinell signierte Production-Apply-
Autorisierung muss weiterhin durch einen externen Release-Signer bereitgestellt
werden. Sie kann automatisiert sein, ist aber nicht umgehbar.

## Noch offen

Generated Table REST, Projekt-Auth, Storage, Realtime, Edge Functions, Webhooks,
Queues, SDK/CLI, Billing/Quotas und Managed-HA sind Roadmap. Die lokale Console
enthält in diesen Bereichen weiterhin klar markierte Product-Preview-Ansichten.
