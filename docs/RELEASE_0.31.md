# Release 0.31 — Real-Service Evidence Chain

## Ergebnis

QKERN 0.31 implementiert den fehlenden strikten Nachweisvertrag für reale Provider-,
Vault-, PostgreSQL-, Broker-, Pager- und Monitoring-E2E-Läufe. Eine unabhängige
Zertifizierungsinstanz muss 15 feste Szenarien gegen Managed PostgreSQL 17 bestehen
und das Ergebnis mit Ed25519 signieren. QKERN kann die Evidence nur verifizieren,
nicht erzeugen.

## Gebundene Beweiskette

Die signierte Evidence bindet sieben paarweise verschiedene SHA-256-Artefakte:
Provideridentität, Providerkonfiguration, Brokervertrag, Vault-Policy, Pager-Routing,
die exakte Backup-/Restore-Evidence und die exakte Live-Deployment-Evidence. Der
Public-Key-Digest muss von allen sieben Pins verschieden sein.

Damit werden Restore, Runtime, Provider, Vault, Pager und Alerting nicht nur als
freie positive Behauptung geführt. Sie gehören zu einem frischen, zeitlich
begrenzten, extern signierten Real-Service-Lauf. Der Digest dieser fertigen Evidence
ist wiederum der bereits in v0.30 vorgesehene Provider-E2E-Pin der exakten
Production-Apply-Autorisierung.

## Pflichtszenarien

- Provisioning und idempotente Wiederholung
- Ablehnung ungültiger Broker-Signaturen
- Vault-Ausgabe, Rotation und Widerruf
- TLS-Zertifikatspin
- Apply bis zum Target-Ledger
- Crash-after-Commit-Reconciliation
- Stale-Worker-/Query-Cancellation
- sicherer Rollback-Retry
- Cross-Tenant-Negativmatrix
- Apply-Broker-Ack
- Incident-Pager-Ack
- vollständiger Metrics-Alarm-Fire-/Resolve-Lifecycle

## Sicherheitsgrenzen

- disabled by default; keine Inline-Autorität
- exakter Feldvertrag und Ablehnung doppelter JSON-Schlüssel
- Ed25519 mit separatem Public-Key-File und SHA-256-Key-Pin
- No-follow, begrenzte Dateien und Production-Mode-Prüfung
- mindestens zehn Minuten und höchstens sechs Stunden Laufzeit
- höchstens 30 Minuten Zertifizierungslatenz und 24 Stunden Evidenzalter
- cause-freies CLI und fail-closed Metrics-Scrape
- keine Providerantworten, IDs, Digests, Pfade, Ziele oder Credentials in Readiness
  und OpenMetrics
- bidirektionale Authority-Pfad-Trennung zu Restore, Deployment, Production Apply,
  Vault, Metrics und Brokern

## Operator-Vertrag

`docs/PROVIDER_E2E_EVIDENCE_RUNBOOK.md` enthält Payload, Pins, Szenarien, Zeitpolicy,
Preflight, Monitoring und Rücknahme. `npm run verify:provider-e2e` ist der
maschinenlesbare Offline-Preflight.

## Validierung

- Strict TypeScript Typecheck
- 492 erfolgreiche Tests in 76 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests in zwei weiteren Dateien
- erfolgreicher Next.js-16.2.12-Production-Build mit allen Routen
- Signatur-, Tamper-, Public-Key-, Key-ID-, Pin-, Zeit-, Scenario-, Extra-Field-,
  Duplicate-Key-, Inline-, File-Mode-, Symlink- und Authority-Reuse-Negativtests
- redigierter CLI-Erfolg/-Fehler und fail-closed OpenMetrics-Integration
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der bekannten
  MCP-SDK→`@hono/node-server`-Transitivkette; kein kompatibler Fix verfügbar, der
  betroffene Windows-`serve-static`-Helper wird im Linux-Production-Host nicht genutzt

## Keine vorgetäuschte Live-Evidenz

Die Tests erzeugen ausschließlich flüchtige Testschlüssel und synthetische Fixtures,
um Parser, Signaturprüfung, Policy und Redaction zu prüfen. Die Lieferung enthält
keinen privaten Production-Key, keine positive Evidence, keine Provider-Credentials
und kein erfolgreiches Live-Protokoll. Production Apply bleibt deshalb technisch
gesperrt, bis die externen Läufe tatsächlich ausgeführt, archiviert und unabhängig
signiert wurden.
