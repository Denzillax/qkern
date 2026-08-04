# Release 0.24 — Provisioner Health and Liveness

## Ergebnis

QKERN 0.24 macht den in 0.23 eingeführten Projekt-Datenbank-Provisioner innerhalb der persistenten Control Plane messbar. Jeder Poll persistiert zuerst einen tenant- und self-bound Heartbeat. Kann dieser Sicherheitsnachweis nicht geschrieben werden, claimt der Prozess keinen Auftrag.

Eine neue aggregate Datenbankfunktion und `GET /api/v1/projects/provisioning/health` liefern feste Queue-, Fehler-, Recovery- und Provisioner-Liveness-Kennzahlen. Die Web-Runtime erhält weiterhin keine direkte Sicht auf Provisioning-Jobs, Bindings oder Heartbeats. Der öffentliche Vertrag enthält weder Tenant-/Projekt-/Job-/Provisioner-Identitäten noch Lease-, Broker-, Host-, Vault- oder Credential-Daten.

## Sicherheitsänderungen

- Neue RLS-erzwungene Tabelle `project_database_provisioner_heartbeats`
- Jeder Heartbeat-Write ist an `qkern_current_organization_id()` und den serverseitigen `qkern.actor_ref` gebunden
- `qkern_provisioner` erhält nur spaltenbegrenzte INSERT-/UPDATE-Rechte für den eigenen Heartbeat und kein Heartbeat-SELECT
- `qkern_runtime` erhält nur `EXECUTE` auf `qkern_project_database_provisioning_health()`, keine Tabellenrechte
- Feste SLOs: fünf Minuten bis Pending-Overdue, zwei Minuten bis Heartbeat-Stale, 24 Stunden Beobachtungsfenster
- Disjunkte aktive Fehlercounts für die fünf persistierbaren Provisioning-Ursachen
- Fail-closed Serviceprüfung für Zustands-, Fehler- und Provisioner-Summen
- `critical` bei ausgeschöpfter Recovery, abgelaufener Lease, aktiver Arbeit ohne Provisioner oder Bindungs-/Bootstrap-Verifikationsfehler
- Private No-store-API und bestehende non-enumerating Rollen-/Fehlergrenze
- Next.js 16.2.12 sowie gepinnte gepatchte Overrides für `fast-uri` 4.1.1, PostCSS 8.5.19 und `sharp` 0.35.3

## Öffentliche Verträge

- `GET /api/v1/projects/provisioning/health`
- Migration `db/migrations/0021_project_database_provisioning_health.sql`
- OpenAPI 3.1 auf Version 0.24.0

Der Health-Endpunkt verwendet weiterhin die Capability `project_provisioning_read`. Er ist für Owner, Administrator, Deployer und Support lesbar; Developer, Analyst und Read-only erhalten wie beim redigierten Einzelstatus keinen zusätzlichen Zugriff.

## Validierung

- Strict TypeScript Typecheck
- 425 erfolgreiche automatisierte Tests in 69 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- Erfolgreicher Next.js-Production-Build einschließlich der statischen Provisioning-Health-Route
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette; npm bietet nur ein erzwungenes MCP-SDK-Downgrade

## Keine Production-Freigabe

0.24 liefert persistente interne Liveness- und SLO-Evidenz, aber keinen extern überwachten Production-Prozess. Provider-Onboarding, echte PostgreSQL-/Vault-/Zertifikat-Rotation, Crash-/Timeout-Interleavings, externes Scraping und Alarmrouting, Deployment-/Pod-Readiness, Runbook-Drills, Restore-/Compliance-Evidenz und alle übrigen Gates aus `docs/QA.md` bleiben offen. Production-Apply bleibt bis zu deren Nachweis deaktiviert.
