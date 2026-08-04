# Production-Apply-Autorisierung

## Zweck

Production Apply ist standardmäßig technisch gesperrt. `QKERN_PRODUCTION_APPLY_ENABLED=true`
öffnet die Grenze nicht allein: API/MCP-Enqueue und Migration Worker verlangen unabhängig
voneinander dieselbe frische, Ed25519-signierte Autorisierung für genau ein Change Set.
Development und Staging bleiben von diesem Release-Gate unberührt.

QKERN besitzt keinen privaten Release-Schlüssel und erzeugt keine positive Autorisierung.
Der unabhängige Release-Prozess darf erst signieren, nachdem alle in der Autorisierung
fest vorgeschriebenen externen Prüfungen wirklich bestanden und deren Detailprotokolle
unveränderlich archiviert wurden.

## Exakter Vertrag

```json
{
  "schemaVersion": "qkern.production-apply-authorization/v1",
  "keyId": "release-authority-2026-07",
  "authorization": {
    "authorizationId": "6376892b-044b-4bda-a44b-8ec12d372608",
    "deployment": "production",
    "scope": "migration_apply",
    "organizationId": "0d9423d9-7437-4f66-898a-86275e6598fb",
    "projectId": "9730b448-7fd0-4c4f-9553-33220752bdf6",
    "changeSetId": "9a973ec8-a409-4706-ad1d-ef6360ea430d",
    "approvalId": "940cb242-32d6-41fd-b244-67d4913f7b91",
    "databaseInstanceRefSha256": "<64 lowercase hex>",
    "statementSha256": "<64 lowercase hex>",
    "approvalActionHash": "<64 lowercase hex>",
    "releaseArtifactSha256": "<64 lowercase hex>",
    "backupRestoreEvidenceSha256": "<64 lowercase hex>",
    "runtimeDeploymentEvidenceSha256": "<64 lowercase hex>",
    "providerE2EEvidenceSha256": "<64 lowercase hex>",
    "securityAssessmentSha256": "<64 lowercase hex>",
    "issuedAt": "2026-07-26T11:55:00.000Z",
    "expiresAt": "2026-07-26T13:00:00.000Z",
    "assertions": {
      "backupRestoreVerified": true,
      "runtimeDeploymentVerified": true,
      "realPostgresVerified": true,
      "providerProvisioningVerified": true,
      "vaultRotationVerified": true,
      "applyBrokerDeliveryVerified": true,
      "incidentPagerDeliveryVerified": true,
      "crossTenantIsolationVerified": true,
      "staleWorkerCancellationVerified": true,
      "vulnerabilityPolicyPassed": true,
      "penetrationTestPassed": true
    },
    "result": "passed"
  },
  "signature": "<Ed25519 signature as canonical base64url>"
}
```

Die Zielreferenz wird nicht in das Dokument übernommen. Der Release-Prozess hasht die
exakte UTF-8-Referenz mit SHA-256. Der unabhängige Signer signiert die UTF-8-Bytes des
positionsgebundenen JSON-Arrays aus
`canonicalProductionApplyAuthorizationPayload()` in
`lib/server/migrations/production-apply-authorization.ts`. Objekt-Reihenfolge ist damit
keine verdeckte Signaturabhängigkeit.

## Verlangte Nachweise

Die fünf externen Artefakte werden zusätzlich zur Signatur separat in der Runtime per
SHA-256 gepinnt und müssen voneinander sowie vom Public-Key-Pin verschieden sein:

1. das exakt ausgerollte Release-Artefakt,
2. der erfolgreiche Backup-/Restore-Drill,
3. die erfolgreiche Live-Deployment-Zertifizierung,
4. exakte signierte v0.31-Provider-E2E-Envelope nach
   `docs/PROVIDER_E2E_EVIDENCE_RUNBOOK.md`,
5. exakte signierte v0.32-Security-Assessment-Envelope nach
   `docs/SECURITY_ASSESSMENT_EVIDENCE_RUNBOOK.md`.

Der Signer muss alle elf Assertions aus realen, archivierten Ergebnissen ableiten. Eine
manuell gesetzte positive Behauptung ohne diese Nachweise verletzt den Release-Vertrag.
Vor dem Signieren muss `npm run verify:release-evidence` gemäß
`docs/RELEASE_EVIDENCE_READINESS_RUNBOOK.md` alle vier Signaturen und fünf
tatsächlich gelesenen Release-Dateien gemeinsam bestätigt haben.

## Laufzeitgrenzen

- Die maximale Gültigkeit und das maximale Alter betragen je vier Stunden.
- Mehr als fünf Minuten zukünftige Ausstellungszeit, Ablauf oder längere Gültigkeit
  scheitern geschlossen.
- Organisation, Projekt, Change Set, Approval, Zielreferenz-Hash, Statement-Hash und
  Approval-Action-Hash müssen exakt übereinstimmen.
- API/MCP prüfen vor dem atomaren Enqueue. Der Worker prüft den unveränderlichen Claim
  erneut unmittelbar vor `execute()`.
- Ein blockierter Worker führt kein SQL aus. Er persistiert ausschließlich
  `PRODUCTION_APPLY_BLOCKED` mit redigierter Meldung und nutzt den vorhandenen begrenzten
  Retry-Vertrag.
- Memory Mode kann Production nie autorisieren.

## Dateien und Schlüssel

Autorisierung und Public Key müssen getrennte absolute Dateien sein. Beide werden mit
`O_NOFOLLOW`, Dateityp- und Größenlimit gelesen; Production verweigert group-/world-
writable Dateien. Inline-Autorität sowie Wiederverwendung einer Deployment-, Backup-,
Metrics-, Vault-, Broker- oder Webhook-Datei sind verboten. Der rohe 32-Byte-Public-Key
ist zusätzlich per SHA-256 gepinnt. Der private Ed25519-Schlüssel bleibt ausschließlich
im externen Release-System.

## Preflight

Nach dem Setzen der Werte aus `.env.example` und der sieben exakten Subject-Werte:

```bash
npm run verify:production-apply
```

Erfolg liefert nur Status, Deployment und Scope. Fehler liefern ausschließlich
`PRODUCTION_APPLY_BLOCKED`; IDs, Digests, Key-ID, Dateipfade und Prüfursachen werden
nicht ausgegeben. Der Preflight ersetzt nicht die beiden Laufzeitprüfungen.

## Rücknahme

`QKERN_PRODUCTION_APPLY_ENABLED=false` sperrt neue Production-Enqueues und jede noch
nicht gestartete Production-Ausführung. Zusätzlich kann die Autorisierungsdatei
entfernt, der gepinnte Public Key rotiert oder das vierstündige Fenster ablaufen
gelassen werden. Bereits im Ziel committedes SQL wird dadurch nicht zurückgerollt.
