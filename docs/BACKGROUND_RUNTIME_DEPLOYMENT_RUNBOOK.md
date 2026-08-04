# Background Runtime Deployment Runbook

## Zweck

QKERN 0.28 erzeugt und verifiziert einen engen Kubernetes-Basisvertrag für genau vier getrennte Hintergrundprozesse:

- Projekt-Datenbank-Provisioner
- Migration Worker
- Apply-Publisher
- Incident-Publisher

Der Vertrag setzt die v0.27-Loopback-Probes in gehärtete Workloads um. Er ist kein automatisches Deployment, keine Cluster-Attestierung und keine Production-Apply-Freigabe.

## Voraussetzungen

Das Container-Image muss unveränderlich über `@sha256:<64 lowercase hex>` gepinnt sein. Tags, `.invalid`-Platzhalter und der Null-Digest werden abgewiesen. Das Image muss die gesperrten Production-Abhängigkeiten, `tsx` und die vier TypeScript-Worker-Einstiegspunkte enthalten.

Vier Konfigurationswerte bestimmen den deterministischen Vertrag:

```bash
export QKERN_RUNTIME_DEPLOYMENT_NAMESPACE=qkern
export QKERN_RUNTIME_IMAGE='registry.example.com/qkern/platform@sha256:<real-digest>'
export QKERN_RUNTIME_CONFIG_MAP=qkern-runtime-config
export QKERN_RUNTIME_SECRET=qkern-runtime-secrets
```

ConfigMap und Secret müssen getrennte DNS-kompatible Namen besitzen. Der Generator enthält weder ConfigMap-/Secret-Werte noch eine Secret-Ressource.

## Erzeugen und prüfen

```bash
npm run render:runtime-deployments > /secure/qkern-runtime-deployments.json
chmod 0600 /secure/qkern-runtime-deployments.json

export QKERN_RUNTIME_DEPLOYMENT_FILE=/secure/qkern-runtime-deployments.json
npm run verify:runtime-deployments
```

Erfolg liefert nur eine feste Readiness-Projektion mit den vier Komponentennamen und positiven Policy-Flags. Datei-, Namespace-, Registry-, Image-, ConfigMap-, Secret-, Endpoint- und Credential-Werte werden nicht ausgegeben. Fehler liefern ausschließlich `RUNTIME_DEPLOYMENT_NOT_READY`.

Das Gate verlangt byteinhaltlich denselben JSON-Vertrag, den der Generator für die vier erwarteten Parameter erzeugt. Zusätzliche Felder, Ressourcen, Container oder Environment-Werte sowie doppelte JSON-Schlüssel scheitern geschlossen.

## Erzeugte Ressourcen

Der Bundle enthält vier ServiceAccounts und vier Deployments. Jeder Workload besitzt:

- genau eine Replica und Strategie `Recreate`
- genau einen Container und einen komponentenspezifischen Node-/`tsx`-Entrypoint
- ein digest-gepinntes Image
- `runAsNonRoot`, feste UID/GID `10001` und `seccompProfile: RuntimeDefault`
- `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `privileged: false`
- vollständiges `capabilities.drop: [ALL]`
- `automountServiceAccountToken: false` und keine RBAC-Bindung
- deaktivierte Host-Netzwerk-, Host-PID- und Host-IPC-Nutzung
- feste CPU-/Memory-Requests und -Limits
- ausschließlich ein begrenztes Memory-`emptyDir` für `/tmp`
- private Authority-Dateien als read-only Secret-Volume oder einzelne Secret-Key-Referenzen
- die v0.27-`exec`-Probes gegen `127.0.0.1:9464`
- keine Container-Ports, Services oder Ingress-Ressourcen
- 90 Sekunden geordnete Terminierungszeit

`metadata.name` liefert die jeweilige Worker-/Publisher-/Provisioner-ID. Organisations- und Endpoint-Konfiguration kommt ausschließlich aus der angegebenen ConfigMap; Datenbank-URLs, Statement-Key und HMAC-Secret kommen aus einzelnen Secret-Key-Referenzen.

## Benötigte ConfigMap-Schlüssel

| Schlüssel | Consumer |
| --- | --- |
| `organization-id` | alle vier Prozesse |
| `provisioning-broker-url` | Provisioner |
| `provisioning-broker-allowed-hosts` | Provisioner |
| `vault-database-url` | Migration Worker |
| `production-apply-enabled` | Migration Worker |
| `production-apply-verifier-key-sha256` | Migration Worker |
| `production-apply-release-artifact-sha256` | Migration Worker |
| `production-apply-backup-restore-evidence-sha256` | Migration Worker |
| `production-apply-runtime-deployment-evidence-sha256` | Migration Worker |
| `production-apply-provider-e2e-evidence-sha256` | Migration Worker |
| `production-apply-security-assessment-sha256` | Migration Worker |
| `apply-broker-url` | Apply-Publisher |
| `apply-broker-allowed-hosts` | Apply-Publisher |
| `incident-webhook-url` | Incident-Publisher |
| `incident-webhook-allowed-hosts` | Incident-Publisher |
| `incident-webhook-hmac-key-id` | Incident-Publisher |

## Benötigte Secret-Schlüssel

| Schlüssel | Verwendung |
| --- | --- |
| `provisioner-database-url` | separater `qkern_provisioner`-Login |
| `worker-database-url` | separater `qkern_worker`-Login |
| `statement-encryption-key` | Migration Worker |
| `provisioning-broker-key.json` | private Provisioner-Signaturdatei |
| `vault-token` | private Vault-Agent-Token-Datei |
| `production-apply-authorization.json` | exakt Change-Set-gebundene Release-Autorisierung |
| `production-apply-verifier-key.json` | separater Ed25519-Public-Key |
| `apply-broker-key.json` | private Apply-Signaturdatei |
| `incident-webhook-hmac-secret` | Incident-Publisher |

Die beiden Production-Apply-Schlüssel sind im Migration-Worker-Bundle als eigene
optionale read-only Projektion modelliert, damit `production-apply-enabled=false`
ohne Platzhalterdateien sicher startet. Bei `true` müssen beide Schlüssel vorhanden
und gültig sein; sonst bleibt jeder Production-Claim geschlossen. Die übrigen
Secret-Inhalte dürfen nicht aus dem Generator, aus versionierten Dateien oder aus
Shell-History stammen. Production-File-Authorities müssen zusätzlich die bereits
dokumentierten Format-, Mode-, Rotation- und No-follow-Verträge erfüllen.

Die Web-Control-Plane gehört nicht zu den vier Background-Workloads. Für Production
Apply muss ihr Deployment dieselben sieben `production-apply-*`-Config-Werte und die
beiden getrennten read-only Dateien erhalten. Eine Abweichung zwischen Web und Worker
bleibt fail-closed; sie erzeugt niemals eine Teilfreigabe.

## Bewusst externe Grenzen

Der Basisvertrag erzeugt keine Namespace-, ConfigMap-, Secret-, NetworkPolicy-, PodDisruptionBudget-, Registry-, Vault-, Datenbank-, Broker-, Pager- oder Monitoring-Ressource. Die konkrete Plattform muss vor Go-Live zusätzlich:

1. Namespace-default-deny und komponentenspezifisch enge DNS-/PostgreSQL-/HTTPS-Egress-Regeln installieren.
2. Image-SBOM, Signatur/Provenance, Malware-Scan und Digest-Freigabe prüfen.
3. ConfigMap-/Secret-Key-Vollständigkeit und externe Authority-Dateimodi prüfen.
4. Scheduling, Eviction, Node-Ausfall, `SIGTERM`, Probe, Restart und Rollout live zertifizieren.
5. Logs, v0.25-Metriken und Provider-SLOs an reales Alert-Routing anbinden.
6. Nachweisen, dass kein separater Service oder Ingress die Runtime-Pods selektiert.

Der Verifier prüft nur den erzeugten QKERN-Bundle vor dem Deployment. Er liest keinen Cluster und beweist nicht, dass später keine zusätzliche Ressource angelegt wurde.
