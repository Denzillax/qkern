# Backup/Restore Evidence Runbook

## Zweck und Grenze

QKERN 0.26 führt keine Backups oder Restores aus. Ein getrennt betriebener, vertrauenswürdiger Drill-Runner muss eine echte Control-Plane-Sicherung in eine isolierte Zielumgebung wiederherstellen, Schema und Daten vergleichen und danach eine kleine Evidenz mit seinem Ed25519-Private-Key signieren. Der Private Key bleibt außerhalb von QKERN.

QKERN verifiziert diese Evidenz fail-closed. Eine erfolgreiche Prüfung bedeutet nur: Der vorgelegte, frische Drill-Nachweis ist authentisch, intern konsistent und erfüllt die fest codierte Mindestpolicy. Sie ersetzt weder den realen Drill noch Provider-, Storage-, Retention-, Zugriffsschutz- oder Disaster-Recovery-Zertifizierung. Sie kann Production-Apply nicht freischalten.

## Verifier-Key-Datei

QKERN liest ausschließlich einen öffentlichen Ed25519-Key:

```json
{
  "schemaVersion": "qkern.backup-restore-verifier-key/v1",
  "keyId": "restore-verifier-2026-07",
  "publicKey": "<32-byte-ed25519-public-key-as-unpadded-base64url>"
}
```

`QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256` ist der kleingeschriebene SHA-256 über die 32 decodierten Public-Key-Bytes. Damit ist nicht nur der Dateipfad, sondern der erwartete Schlüssel selbst gepinnt. Die Key-ID ist begrenzt und muss mit der signierten Evidenz übereinstimmen.

Der Public Key ist kein Geheimnis, aber eine Autorität. In Production muss seine Datei regulär, ohne Symlink sowie nicht group-/world-writable sein. Sie darf weder mit der Evidenzdatei noch mit Vault-, Broker-, Webhook- oder Metrics-Token-Dateien identisch sein. Rotation bedeutet: neuen externen Signierschlüssel bereitstellen, Public-Key-Datei atomar ersetzen, Pin kontrolliert aktualisieren und danach einen neuen Drill signieren. Alte Evidenz mit abweichender Key-ID wird nicht akzeptiert.

## Evidenzvertrag

Die Evidenzdatei besitzt exakt diese Felder; zusätzliche oder fehlende Felder werden abgewiesen:

```json
{
  "schemaVersion": "qkern.backup-restore-evidence/v1",
  "keyId": "restore-verifier-2026-07",
  "evidence": {
    "evidenceId": "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
    "deployment": "production",
    "scope": "control_plane",
    "backupSnapshotAt": "2026-07-26T10:00:00.000Z",
    "backupCompletedAt": "2026-07-26T10:05:00.000Z",
    "restoreStartedAt": "2026-07-26T10:10:00.000Z",
    "restoreCompletedAt": "2026-07-26T10:30:00.000Z",
    "verifiedAt": "2026-07-26T10:40:00.000Z",
    "recoveryPointLagSeconds": 300,
    "restoreDurationSeconds": 1200,
    "backupArtifactSha256": "<64-lowercase-hex>",
    "sourceDataManifestSha256": "<64-lowercase-hex>",
    "restoredDataManifestSha256": "<same-64-lowercase-hex>",
    "encrypted": true,
    "checksumVerified": true,
    "schemaVerified": true,
    "rowCountsVerified": true,
    "auditChainVerified": true,
    "result": "passed"
  },
  "signature": "<64-byte-ed25519-signature-as-unpadded-base64url>"
}
```

Der Drill-Runner muss mindestens Folgendes wirklich prüfen:

- Backup-Artefakt vollständig, verschlüsselt und gegen seinen SHA-256 verifiziert
- Restore in eine neue isolierte Zielinstanz, niemals über das Quellsystem
- erwarteter Migration-Head und vollständiges Schema
- Rowcounts beziehungsweise ein gleichwertiges deterministisches Datenmanifest
- Hash-Kette des QKERN-Audit-Logs
- keine produktiven Credentials, Connection Strings, Providerantworten oder Rohdiagnosen in der Evidenz

`sourceDataManifestSha256` und `restoredDataManifestSha256` müssen identisch sein. Die Zeitpunkte müssen streng vorwärts geordnet sein; die beiden Sekundenwerte müssen exakt den Zeitdifferenzen entsprechen.

## Signaturpayload

Signiert wird nicht das frei formatierte JSON-Dokument, sondern die UTF-8-Codierung eines kompakten JSON-Arrays in exakt dieser Reihenfolge:

1. `schemaVersion`
2. `keyId`
3. `evidenceId`
4. `deployment`
5. `scope`
6. `backupSnapshotAt`
7. `backupCompletedAt`
8. `restoreStartedAt`
9. `restoreCompletedAt`
10. `verifiedAt`
11. `recoveryPointLagSeconds`
12. `restoreDurationSeconds`
13. `backupArtifactSha256`
14. `sourceDataManifestSha256`
15. `restoredDataManifestSha256`
16. `encrypted`
17. `checksumVerified`
18. `schemaVerified`
19. `rowCountsVerified`
20. `auditChainVerified`
21. `result`

Der QKERN-Referenzcode dafür ist `canonicalBackupRestoreEvidencePayload()` in `lib/server/backup/restore-evidence.ts`. Der externe Signer muss diesen Vertrag unabhängig implementieren und die resultierenden Bytes mit Ed25519 signieren.

## Feste Readiness-Policy

Eine gültige Signatur allein reicht nicht. QKERN verlangt zusätzlich:

- Evidenz höchstens sieben Tage alt
- höchstens fünf Minuten positive Clock-Skew
- verwendeter Backup-Snapshot bei Abschluss der Verifikation höchstens 24 Stunden alt
- Recovery-Point-Lag höchstens 24 Stunden
- Restore-Dauer höchstens vier Stunden
- `production` und `control_plane` als feste Scope-Bindung
- alle fünf Prüfassertionen exakt `true`
- Ergebnis exakt `passed`

Diese Werte sind Quellcode-Policy, keine vom Request oder Evidenzautor frei wählbaren Schwellen.

## Konfiguration und Ausführung

```bash
export QKERN_BACKUP_RESTORE_EVIDENCE_FILE="/run/qkern/backup-restore-evidence.json"
export QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE="/run/qkern/backup-restore-verifier-key.json"
export QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256="<64-lowercase-hex>"
npm run verify:backup-restore
```

Erfolg liefert genau eine begrenzte JSON-Projektion auf stdout und Exit-Code `0`. Fehler liefern nur `BACKUP_RESTORE_EVIDENCE_NOT_READY` auf stderr und Exit-Code `1`; Signatur, Hashes, Pfade und interne Ursachen werden nicht ausgegeben. Inline-Evidenz und Inline-Public-Keys sind verboten.

## Monitoring

Für die optionale Einbindung in den vorhandenen, separat authentisierten OpenMetrics-Endpunkt:

```bash
export QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED=true
```

Nach erfolgreicher Verifikation werden ausschließlich feste Metriken ausgegeben:

- `qkern_backup_restore_readiness`
- `qkern_backup_restore_recovery_point_lag_seconds`
- `qkern_backup_restore_duration_seconds`
- `qkern_backup_restore_snapshot_timestamp_seconds`
- `qkern_backup_restore_verified_timestamp_seconds`

Evidenz-ID, Key-ID, Digests, Dateipfade, Provider, Organisation, Projekte und Credentials sind weder Labels noch Werte. Ist die explizit aktivierte Evidenz ungültig, veraltet, unlesbar oder falsch signiert, liefert der gesamte authentisierte Scrape `503`; ein Collector muss Scrape-Ausfall und veralteten Verified-Timestamp als Critical alarmieren.

## Drill- und Archivierungsablauf

1. Neuen produktionsnahen Control-Plane-Backup-Snapshot erzeugen und verschlüsselte Ablage prüfen.
2. In eine neue isolierte Datenbankinstanz restoren.
3. Migration-Head, Schema, Rowcounts/Datenmanifest und Audit-Hash-Kette vergleichen.
4. Messwerte aus dem realen Lauf in den strikten Vertrag übernehmen.
5. Kanonisches Payload mit dem extern verwahrten Ed25519-Key signieren.
6. Evidenzdatei atomar und nicht group-/world-writable bereitstellen.
7. `npm run verify:backup-restore` ausführen und den grünen, cause-freien Nachweis zusammen mit den privaten Drill-Protokollen in der Release-Evidenz archivieren.
8. Metrics-Scrape und Alert-Routing prüfen.
9. Isolierte Restore-Instanz und temporäre Credentials kontrolliert entfernen.

Production bleibt gesperrt, bis dieser Ablauf gegen die echte Infrastruktur wiederholt erfolgreich, überwacht und archiviert wurde.
