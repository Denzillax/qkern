# Release 0.28 — Hardened Background Runtime Deployment Gate

## Ergebnis

QKERN 0.28 überführt die vier v0.27-probe-fähigen Hintergrundprozesse in einen deterministischen Kubernetes-Basisvertrag. Ein neuer Generator erzeugt vier getrennte ServiceAccounts und Deployments; ein unabhängiges, cause-freies CLI-Gate akzeptiert ausschließlich den exakt erwarteten Vertrag für Namespace, ConfigMap, Secret und digest-gepinntes Container-Image.

Der Vertrag erzwingt Non-root, schreibgeschütztes Root-Dateisystem, entfernte Linux-Capabilities, deaktivierte Privilege-Escalation, deaktivierte Service-Account-Tokens, getrennte Host-Namespaces, einen Container und eine Replica pro Workload, feste Ressourcenlimits, ein begrenztes Memory-`/tmp`, private Authority-Mounts und ausschließlich Loopback-Exec-Probes. Services, Ingress, zusätzliche Container, Tags, Placeholder-Digests, Inline-Secrets und jede Vertragsdrift werden abgewiesen.

`tsx` ist jetzt eine gesperrte Production-Abhängigkeit. Dadurch bleiben die bereits vorhandenen TypeScript-Worker-Entrypoints auch in einem `npm ci --omit=dev`-Image startbar.

## Neue Befehle

- `npm run render:runtime-deployments`
- `npm run verify:runtime-deployments`

Die Variablen und benötigten ConfigMap-/Secret-Schlüssel sind in `docs/BACKGROUND_RUNTIME_DEPLOYMENT_RUNBOOK.md` dokumentiert.

## Sicherheitsgrenzen

- exakt vier bekannte Workloads und vier tokenlose ServiceAccounts
- identisches digest-gepinntes Image für alle Komponenten
- feste Node-/`tsx`-Entrypoints ohne Shell
- keine Service-, Ingress- oder Container-Port-Ressource
- keine breite `envFrom`-Autorität und keine Secret-Werte im Bundle
- Authority-Dateien read-only mit File-Mode `0400`
- JSON-Datei maximal 1 MiB, absolut, no-follow und in Production nicht group-/world-writable
- doppelte JSON-Schlüssel, Zusatzfelder und jede Abweichung scheitern fail-closed
- Readiness-Ausgabe enthält keine Infrastruktur- oder Authority-Werte

## Validierung

- Strict TypeScript Typecheck
- 460 erfolgreiche automatisierte Tests in 73 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- erfolgreicher Next.js-Production-Build
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette
- neue Negativmatrix für Image-Drift, Host-Namespace, Service-Account-Token, Root-Dateisystem, Capabilities, Probe, Zusatzcontainer, Replica, Shell-Command, HostPath, Inline-Secret, Service-Ressource, Zusatzfeld und doppelte JSON-Schlüssel

## Keine Production-Freigabe

0.28 ist ein sicherer Quell- und Pre-Deployment-Vertrag, keine Cluster-Attestierung. Namespace-/Egress-NetworkPolicies, Registry-Provenance, Secret-Bereitstellung, Live-Rollout, Restart-/Shutdown-Tests, SLO-Alarmrouting und Provider-/Vault-/PostgreSQL-/Broker-/Pager-E2E bleiben externe Gates. Production-Apply bleibt gesperrt.
