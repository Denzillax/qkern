# Release 0.25 — Secure Provisioning Metrics Export

## Ergebnis

QKERN 0.25 macht die in 0.24 eingeführte persistente Provisioning-Health-Projektion sicher scrape-fähig. Der neue interne Endpunkt liefert OpenMetrics 1.0 mit ausschließlich festen Zustands-, SLO-, Fehlerursachen- und Provisioner-Counts. Es existieren keine dynamischen Tenant-, Projekt-, Environment-, Job-, Provisioner-, Host-, Vault- oder Credential-Labels.

Der Exporter ist standardmäßig deaktiviert. Aktiviert verlangt er PostgreSQL-Modus, eine serverseitig fest konfigurierte Organisations-UUID und einen eigenen rotierbaren Bearer aus einer privaten Datei. Browser-Sessions, Memberships und `X-QKERN-Organization` besitzen keinen Autoritätspfad.

## Sicherheitsänderungen

- `GET /api/internal/v1/projects/provisioning/metrics`
- Eigene OpenAPI-Security-Scheme `metricsBearer`, getrennt vom Session-Cookie
- Production-Token-Datei: absoluter Pfad, No-follow, reguläre Datei, Mode `0600`, 32–256 Zeichen und enge ASCII-Allowlist
- Token wird pro Scrape neu gelesen, über feste SHA-256-Digests zeitkonstant verglichen und danach im Puffer nullgesetzt
- Inline-Token sowie Wiederverwendung von Vault-, Broker- oder Webhook-Secret-Dateien werden abgewiesen
- Fehlende Authentisierung liefert 401; deaktivierter Export 404; Konfigurations-, Token- und Projektionsfehler liefern cause-freies 503
- Alle Antworten sind `no-store` und `nosniff`
- Feste OpenMetrics-Namen und ausschließlich feste `status`-, `state`-, `kind`- und `code`-Labels

## Konfiguration

- `QKERN_PROVISIONING_METRICS_ENABLED=true`
- `QKERN_PROVISIONING_METRICS_ORGANIZATION_ID=<uuid>`
- `QKERN_PROVISIONING_METRICS_TOKEN_FILE=<absolute-private-path>`

Ein Scraper sendet `Authorization: Bearer <token>`. Ein Session-Cookie allein wird ausdrücklich nicht akzeptiert.

## Validierung

- Strict TypeScript Typecheck
- 437 erfolgreiche automatisierte Tests in 70 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- Erfolgreicher Next.js-Production-Build einschließlich der internen dynamischen Metrics-Route
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette

## Keine Production-Freigabe

0.25 stellt die technische Scrape-Grenze bereit, betreibt aber keinen realen Prometheus-/OTel-Collector und kein Alarmrouting. Provider-Onboarding, echte PostgreSQL-/Vault-/Zertifikat-Rotation, Crash-/Timeout-Interleavings, Scrape-TLS/mTLS beziehungsweise Netzwerk-ACLs, Alertmanager-/Pager-Eskalation, Deployment-/Pod-Readiness, Runbook-Drills und alle übrigen Gates aus `docs/QA.md` bleiben offen. Production-Apply bleibt bis zu deren Nachweis deaktiviert.
