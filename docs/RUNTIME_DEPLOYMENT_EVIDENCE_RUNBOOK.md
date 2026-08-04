# Runtime Deployment Evidence Runbook

## Zweck und Autoritätsgrenze

QKERN verifiziert die Live-Zertifizierung des vom aktuell ausgerollten Release erzeugten, ursprünglich in v0.28 eingeführten Background-Runtime-Bundles. QKERN verbindet sich dabei nicht mit Kubernetes und besitzt weder Kubeconfig noch Service-Account-Token oder privaten Signierschlüssel. Ein getrennter vertrauenswürdiger Runner führt die echten Cluster-, Rollout-, Runtime-, Supply-Chain- und Monitoring-Prüfungen aus, archiviert deren private Detailspur und signiert nur den hier definierten secretfreien Vertrag.

Eine grüne Verifikation ist ein Release-Nachweis. Sie aktiviert keinen Apply-Pfad.

## Verifier-Key

Der Ed25519-Private-Key bleibt ausschließlich im externen Runner. QKERN liest eine separate Public-Key-Datei:

```json
{
  "schemaVersion": "qkern.runtime-deployment-verifier-key/v1",
  "keyId": "runtime-deployment-verifier-2026-07",
  "publicKey": "<32-byte Ed25519 public key as canonical base64url>"
}
```

`QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256` ist der lowercase SHA-256 des dekodierten rohen 32-Byte-Public-Keys, nicht der JSON-Datei.

## Unabhängige Policy-Pins

| Variable | Bindung |
| --- | --- |
| `QKERN_RUNTIME_DEPLOYMENT_CLUSTER_ID_SHA256` | SHA-256 einer stabilen, freigegebenen Cluster-Identität |
| `QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256` | SHA-256 des geprüften kanonischen NetworkPolicy-Satzes |
| `QKERN_RUNTIME_IMAGE_PROVENANCE_SHA256` | SHA-256 der freigegebenen unveränderlichen Image-Provenance |

Die drei Werte müssen lowercase 64-Hex-SHA-256 und untereinander verschieden sein. Der Bundle-Hash wird von QKERN selbst als SHA-256 der exakt durch `npm run render:runtime-deployments` im selben Release erzeugten UTF-8-Datei berechnet. Der Image-Digest und Namespace stammen ebenfalls aus diesem Release-Vertrag.

## Evidenzvertrag

Die Datei enthält exakt:

```json
{
  "schemaVersion": "qkern.runtime-deployment-evidence/v1",
  "keyId": "runtime-deployment-verifier-2026-07",
  "evidence": {
    "evidenceId": "84a3af22-1955-4a6f-9930-9fe516b943f2",
    "deployment": "production",
    "scope": "background_runtimes",
    "namespace": "qkern",
    "clusterIdentitySha256": "<cluster pin>",
    "deploymentBundleSha256": "<canonical current-release bundle digest>",
    "networkPolicySha256": "<network policy pin>",
    "imageProvenanceSha256": "<provenance pin>",
    "imageDigestSha256": "<digest from QKERN_RUNTIME_IMAGE>",
    "observationStartedAt": "2026-07-26T10:00:00.000Z",
    "observationCompletedAt": "2026-07-26T11:00:00.000Z",
    "certifiedAt": "2026-07-26T11:05:00.000Z",
    "observationDurationSeconds": 3600,
    "componentCount": 4,
    "components": [
      {
        "name": "project-provisioner",
        "desiredReplicas": 1,
        "readyReplicas": 1,
        "updatedReplicas": 1,
        "availableReplicas": 1,
        "imageDigestSha256": "<same image digest>",
        "rolloutVerified": true,
        "livenessProbeVerified": true,
        "readinessProbeVerified": true,
        "sigtermShutdownVerified": true,
        "restartRecoveryVerified": true,
        "serviceAccountTokenAbsent": true,
        "securityContextVerified": true,
        "secretProjectionVerified": true
      }
    ],
    "networkPolicy": {
      "defaultDenyIngressVerified": true,
      "defaultDenyEgressVerified": true,
      "componentEgressAllowlistVerified": true,
      "externalServiceSelectorsAbsent": true,
      "ingressResourcesAbsent": true
    },
    "supplyChain": {
      "imageSignatureVerified": true,
      "sbomVerified": true,
      "vulnerabilityPolicyPassed": true,
      "provenanceVerified": true
    },
    "monitoring": {
      "metricsScrapeVerified": true,
      "probeAlertsVerified": true,
      "crashLoopAlertsVerified": true
    },
    "result": "passed"
  },
  "signature": "<64-byte Ed25519 signature as canonical base64url>"
}
```

`components` muss in dieser exakten Reihenfolge vier vollständige Objekte enthalten:

1. `project-provisioner`
2. `migration-worker`
3. `apply-publisher`
4. `incident-publisher`

Das gekürzte Beispiel zeigt nur das erste Objekt; eine reale Evidenz mit weniger als vier vollständigen Komponenten wird abgewiesen.

## Kanonische Signatur

Der Runner signiert die UTF-8-Bytes des durch `canonicalRuntimeDeploymentEvidencePayload()` in `lib/server/operations/runtime-deployment-evidence.ts` definierten JSON-Arrays. Es enthält Schema, Key-ID, alle skalaren Bindungen, jede Komponente als positionsgebundenes Array, danach NetworkPolicy-, Supply-Chain- und Monitoring-Assertions sowie `result`. Objekt-Serialisierungsreihenfolge ist damit keine verdeckte Signaturabhängigkeit.

Der externe Runner muss diese Kanonisierung unabhängig implementieren und gegen einen bekannten QKERN-Testvektor prüfen. QKERN besitzt keinen Signierbefehl.

## Zeitpolicy

- Evidenzalter ab `certifiedAt`: höchstens 24 Stunden
- Beobachtungsdauer: mindestens 30 Minuten, höchstens zwei Stunden und exakt aus Start/Ende abgeleitet
- Zeit zwischen Beobachtungsende und Signatur: höchstens 15 Minuten
- akzeptierte zukünftige Clock-Abweichung: höchstens fünf Minuten
- alle Zeitpunkte: kanonisches UTC-Format mit Millisekunden

## Echte Runner-Prüfungen

Der Runner muss mindestens:

1. Den vom aktuellen Release generierten Bundle-Hash, Namespace und Image-Digest gegen den freigegebenen Rollout prüfen.
2. Cluster-Identität und den kanonischen NetworkPolicy-Satz gegen die serverseitigen Pins prüfen.
3. Für alle vier Deployments gewünschte, aktualisierte, verfügbare und bereite Replica `1` beobachten.
4. Pod-Security-Context, Token-Abwesenheit, Secret-Projektionen und exakten Image-Digest live prüfen.
5. Liveness, Readiness, kontrolliertes `SIGTERM` und Restart-Recovery tatsächlich auslösen und beobachten.
6. Default-deny Ingress/Egress, schmale Komponenten-Egress-Regeln und Abwesenheit externer Service-/Ingress-Selektoren nachweisen.
7. Image-Signatur, SBOM, Vulnerability-Policy und die gepinnte Provenance prüfen.
8. Reales Metrics-Scraping sowie Probe- und CrashLoop-Alarmzustellung bis zum freigegebenen Empfänger prüfen.
9. Die detaillierte, zugriffsgeschützte Rohspur archivieren und erst danach den engen Vertrag signieren.

## QKERN-Konfiguration und Gate

```bash
export QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE="/run/qkern/runtime-deployment-evidence.json"
export QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE="/run/qkern/runtime-deployment-verifier-key.json"
export QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256="<public-key-pin>"
export QKERN_RUNTIME_DEPLOYMENT_CLUSTER_ID_SHA256="<cluster-pin>"
export QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256="<network-policy-pin>"
export QKERN_RUNTIME_IMAGE_PROVENANCE_SHA256="<provenance-pin>"

npm run verify:runtime-deployment-evidence
```

Zusätzlich müssen die vier Runtime-Deployment-Variablen für Namespace, Image, ConfigMap und Secret aus demselben Release gesetzt sein. Erfolg liefert nur Status, Scope, Beobachtungs-/Signierzeit, Dauer, Komponentenanzahl und feste Policy. Fehler liefern ausschließlich `RUNTIME_DEPLOYMENT_EVIDENCE_NOT_READY`.

## Datei- und Rotationsregeln

- Evidence- und Public-Key-Datei müssen verschieden und absolut sein.
- Symlinks werden nicht verfolgt.
- Evidence ist auf 32 KiB, Key-Datei auf 1 KiB begrenzt.
- Production verweigert group-/world-writable Dateien.
- Inline-Evidenz und Inline-Key sind verboten.
- Deployment-Bundle, Backup-/Restore-Evidenz, Metrics-Token, Vault-, Broker- und Webhook-Authorities dürfen keinen Pfad wiederverwenden.
- Bei Key-Rotation zuerst neuen Public Key und Pin kontrolliert verteilen, anschließend mit neuer Key-ID signieren und erst nach erfolgreicher Prüfung den alten Key entfernen.

## OpenMetrics

`QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED=true` bindet den Verifier optional an den bereits authentisierten internen Metrics-Scrape. Exportiert werden ausschließlich feste Readiness-, Komponentenanzahl-, Beobachtungsdauer- und Timestamp-Metriken. Jede ungültige oder veraltete aktivierte Evidenz macht den gesamten Scrape `503`.

Diese Projektion beweist nur, dass der signierte Vertrag aktuell die feste QKERN-Policy erfüllt. Die private Detailspur, Clusterzugriffe und externe Alarmzustellung bleiben außerhalb von QKERN.
