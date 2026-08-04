# Provider-E2E-Evidenz — Operator Runbook

## Zweck und Vertrauensgrenze

QKERN verifiziert einen extern erzeugten, Ed25519-signierten Nachweis für einen
vollständigen Real-Service-Lauf gegen den freigegebenen Managed-PostgreSQL-Provider.
QKERN besitzt weder Provider-, Vault-, Cluster-, Pager- noch Signierzugriff und kann
keine positive Evidenz erzeugen. `verify:provider-e2e` ist ausschließlich ein
fail-closed Verifier.

Der Zertifizierungsrunner und der Ed25519-Private-Key müssen außerhalb der QKERN-
Runtime liegen. Der Runner darf erst signieren, wenn das private Detailprotokoll,
alle 15 Szenarien und alle sieben gepinnten Eingabeartefakte geprüft wurden.

## Gepinnte Eingabeartefakte

Alle Werte sind SHA-256 in 64 Kleinbuchstaben-Hexzeichen. Die sieben Artefakte und
der Digest des rohen 32-Byte-Public-Keys müssen paarweise verschieden sein.

| Variable | Geprüftes Artefakt |
|---|---|
| `QKERN_PROVIDER_E2E_PROVIDER_ID_SHA256` | freigegebene Provider-/Account-/Region-Identität |
| `QKERN_PROVIDER_E2E_PROVIDER_CONFIG_SHA256` | versionierte Provider-, ACL-, TLS- und Egress-Konfiguration |
| `QKERN_PROVIDER_E2E_BROKER_CONTRACT_SHA256` | implementierter Provisioning-/Apply-Brokervertrag |
| `QKERN_PROVIDER_E2E_VAULT_POLICY_SHA256` | Vault-Policy, Static Role und Rotationsvertrag |
| `QKERN_PROVIDER_E2E_PAGER_ROUTING_SHA256` | Pager-/Ticket-Routing, Eskalation und Receiver-Vertrag |
| `QKERN_PROVIDER_E2E_BACKUP_RESTORE_EVIDENCE_SHA256` | exakte signierte Restore-Evidenzdatei |
| `QKERN_PROVIDER_E2E_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256` | exakte signierte Live-Deployment-Evidenzdatei |

Der spätere Production-Apply-Pin
`QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256` ist der SHA-256-Digest der
fertigen signierten Provider-E2E-Evidenzdatei. Er ist nicht mit einem der internen
Eingabepins austauschbar.

## Pflichtszenarien

Der Runner muss Managed PostgreSQL 17 verwenden und alle folgenden Szenarien real
gegen freigegebene Services ausführen:

1. Provisioning bis zum geprüften Managed Binding
2. idempotente Wiederholung derselben Provisioning-Anforderung
3. Ablehnung einer ungültigen Broker-Signatur
4. Ausgabe kurzlebiger Vault-Datenbank-Credentials
5. kontrollierte Credential-Rotation
6. Widerruf des vorherigen Credentials
7. Prüfung des TLS-Zertifikatspins
8. vollständiger Enqueue→Claim→Apply→Ledger-Pfad
9. Crash nach Commit und sichere Ledger-Reconciliation
10. kontrollierte Stale-Worker-/Query-Cancellation nach Lease-Verlust
11. sicherer Rollback-Retry
12. Cross-Tenant-Negativmatrix
13. Apply-Broker-Zustellung mit exaktem Ack
14. Incident-Pager-Zustellung mit exaktem Ack
15. Metrik-Scrape sowie Fire-/Resolve-Lifecycle der verpflichtenden Alarme

Ein simulierter Provider, lokales Raw-URL-Catalog, Memory Mode, ein Mock-Pager oder
ein lediglich manuell gesetzter Boolean sind keine gültige Production-Evidenz.

## Signiertes Format

Die Envelope-Datei enthält exakt:

```json
{
  "schemaVersion": "qkern.provider-e2e-evidence/v1",
  "keyId": "release-lab-key-2026-07",
  "evidence": {
    "evidenceId": "00000000-0000-4000-8000-000000000000",
    "deployment": "production",
    "scope": "managed_postgresql_e2e",
    "providerIdentitySha256": "<sha256>",
    "providerConfigurationSha256": "<sha256>",
    "brokerContractSha256": "<sha256>",
    "vaultPolicySha256": "<sha256>",
    "pagerRoutingSha256": "<sha256>",
    "backupRestoreEvidenceSha256": "<sha256>",
    "runtimeDeploymentEvidenceSha256": "<sha256>",
    "testRunStartedAt": "2026-07-26T10:00:00.000Z",
    "testRunCompletedAt": "2026-07-26T11:00:00.000Z",
    "certifiedAt": "2026-07-26T11:05:00.000Z",
    "testRunDurationSeconds": 3600,
    "postgresMajorVersion": 17,
    "scenarioCount": 15,
    "scenarios": {
      "provisioningSucceeded": true,
      "provisioningIdempotencyVerified": true,
      "invalidBrokerSignatureRejected": true,
      "vaultCredentialIssued": true,
      "vaultRotationVerified": true,
      "previousVaultCredentialRevoked": true,
      "tlsCertificatePinVerified": true,
      "migrationApplyVerified": true,
      "crashAfterCommitReconciled": true,
      "leaseLossCancelled": true,
      "rollbackRetryVerified": true,
      "crossTenantIsolationVerified": true,
      "applyDeliveryVerified": true,
      "incidentPagerDeliveryVerified": true,
      "metricsAlertLifecycleVerified": true
    },
    "result": "passed"
  },
  "signature": "<base64url-ed25519-signature>"
}
```

Der Key-File-Vertrag ist:

```json
{
  "schemaVersion": "qkern.provider-e2e-verifier-key/v1",
  "keyId": "release-lab-key-2026-07",
  "publicKey": "<32-byte-ed25519-public-key-as-canonical-base64url>"
}
```

Der externe Runner signiert exakt die UTF-8-Bytes, die
`canonicalProviderE2EEvidencePayload()` erzeugt. Zusätzliche, fehlende oder doppelte
JSON-Felder werden abgewiesen.

## Zeit- und Dateipolicy

- Laufzeit mindestens 10 Minuten und höchstens 6 Stunden
- Signatur höchstens 30 Minuten nach Laufende
- Evidenz höchstens 24 Stunden alt
- maximal 5 Minuten Clock-Skew in die Zukunft
- Evidence und Public Key auf getrennten absoluten Pfaden
- keine Symlinks; in Production keine group-/world-writable Dateien
- keine Inline-Evidenz, kein Inline-Key und kein Wiederverwenden anderer
  Authority-Pfade

## Preflight

```bash
export QKERN_PROVIDER_E2E_EVIDENCE_FILE=/run/qkern/provider-e2e-evidence.json
export QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE=/run/qkern/provider-e2e-verifier-key.json
export QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256=<sha256>
export QKERN_PROVIDER_E2E_PROVIDER_ID_SHA256=<sha256>
export QKERN_PROVIDER_E2E_PROVIDER_CONFIG_SHA256=<sha256>
export QKERN_PROVIDER_E2E_BROKER_CONTRACT_SHA256=<sha256>
export QKERN_PROVIDER_E2E_VAULT_POLICY_SHA256=<sha256>
export QKERN_PROVIDER_E2E_PAGER_ROUTING_SHA256=<sha256>
export QKERN_PROVIDER_E2E_BACKUP_RESTORE_EVIDENCE_SHA256=<sha256>
export QKERN_PROVIDER_E2E_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256=<sha256>
npm run verify:provider-e2e
```

Erfolg projiziert ausschließlich feste Readiness-, Zeit-, PostgreSQL- und
Szenariofelder. Fehler liefern nur `PROVIDER_E2E_EVIDENCE_NOT_READY`.

## Monitoring

Mit `QKERN_PROVIDER_E2E_EVIDENCE_ENABLED=true` prüft der bereits authentifizierte,
tenantgebundene Metrics-Endpunkt die Evidenz bei jedem Scrape erneut. Ungültige oder
veraltete Evidenz macht den gesamten Scrape `503`. Exportiert werden nur feste
Metriken:

- `qkern_provider_e2e_readiness`
- `qkern_provider_e2e_scenario_count`
- `qkern_provider_e2e_run_duration_seconds`
- `qkern_provider_e2e_completed_timestamp_seconds`
- `qkern_provider_e2e_certified_timestamp_seconds`
- `qkern_provider_e2e_postgres_major_version`

Provideridentität, Digests, Key-ID, Pfade, Pagerziel, Tenant-/Projekt-IDs,
Credentials und Detaildiagnosen besitzen keinen Metrikslot.

## Rücknahme

1. `QKERN_PROVIDER_E2E_EVIDENCE_ENABLED=false` setzen.
2. `QKERN_PRODUCTION_APPLY_ENABLED=false` setzen.
3. kompromittierten Key-Pin und betroffene Artefaktpins rotieren.
4. Evidence und private Detailspur unveränderlich für das Incident Review sichern.
5. alle 15 Szenarien mit neuem Lauf und neuer Evidence-ID wiederholen.

Das Deaktivieren des Metrics-Exports erteilt keine Apply-Autorität. Production Apply
bleibt unabhängig durch die v0.30-Release-Autorisierung gesperrt.
