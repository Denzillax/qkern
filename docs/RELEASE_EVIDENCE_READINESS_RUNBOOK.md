# Release-Evidence-Readiness — Operator Runbook

## Zweck

`npm run verify:release-evidence` ist der gemeinsame letzte Evidence-Preflight vor
der separat signierten Production-Apply-Autorisierung. Er verifiziert in einem
fail-closed Lauf:

1. signierte Backup-/Restore-Evidence,
2. signierte Live-Deployment-Evidence,
3. signierte Provider-/Pager-E2E-Evidence,
4. signierte Security-Assessment-Evidence,
5. die exakten SHA-256-Digests des Release-ZIP und aller vier Evidence-Envelopes.

Der Preflight führt keine externen Tests aus und erzeugt weder Evidence noch
Production-Apply-Autorität.

## Dateibindung

`QKERN_RELEASE_ARTIFACT_FILE` bezeichnet das exakte, unveränderte Release-ZIP.
Die vier Evidence-Pfade und vier Public-Key-Pfade kommen aus den jeweiligen
Runbooks. Release, Evidence, Public Keys, Production-Apply-Autorisierung,
Production-Apply-Key, Vault-, Metrics- und Broker-Authority-Dateien müssen
verschiedene Pfade besitzen.

Die tatsächlich gelesenen fünf Dateien werden gegen dieselben serverseitigen Pins
gehasht, die später die Production-Apply-Autorisierung bindet:

| Datei | Erwarteter Pin |
|---|---|
| Release-ZIP | `QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256` |
| Restore-Envelope | `QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256` |
| Deployment-Envelope | `QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256` |
| Provider-E2E-Envelope | `QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256` |
| Security-Envelope | `QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256` |

Alle fünf Pins müssen gültig und paarweise verschieden sein. Dateien werden
no-follow, begrenzt und in Production ohne group-/world-writable Bits gelesen.

## Ablauf

1. Alle vier externen Läufe vollständig ausführen und ihre privaten Detailspuren
   unveränderlich archivieren.
2. Vier dedizierte Ed25519-Public-Key-Dateien und deren Raw-Key-Pins bereitstellen.
3. Alle internen Artefaktpins der vier Evidence-Verträge setzen.
4. Release-ZIP und vier signierte Envelopes hashen und die fünf
   `QKERN_PRODUCTION_APPLY_*_SHA256`-Pins setzen.
5. `QKERN_RELEASE_ARTIFACT_FILE` auf genau dieses ZIP setzen.
6. Preflight ausführen:

```bash
npm run verify:release-evidence
```

Erfolg ist bewusst klein:

```json
{
  "data": {
    "releaseEvidenceReadiness": {
      "status": "ready",
      "deployment": "production",
      "scope": "release_evidence",
      "evidenceCount": 4,
      "artifactCount": 5
    }
  }
}
```

Jeder Fehler liefert nur `RELEASE_EVIDENCE_NOT_READY`. Pfade, Pins, Key-IDs,
Signaturen und Ursachen werden nicht ausgegeben.

## Reihenfolge zur Freigabe

Der grüne Preflight ist notwendig, aber nicht hinreichend. Erst danach darf das
externe Release-System für genau ein freigegebenes Production-Change-Set eine
kurzlebige v0.30-Production-Apply-Autorisierung signieren. REST/MCP und Worker
prüfen diese Autorisierung unabhängig erneut. Fehlt ein realer Nachweis, bleibt
`QKERN_PRODUCTION_APPLY_ENABLED=false`.

