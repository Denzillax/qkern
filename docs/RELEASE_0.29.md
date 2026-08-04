# Release 0.29 — Signed Live Deployment Evidence Gate

## Ergebnis

QKERN 0.29 ergänzt den v0.28-Pre-Deployment-Vertrag um ein kryptografisches Live-Zertifizierungsgate. Ein externer Runner mit eigener Cluster-Autorität beobachtet die real ausgerollten vier Background-Runtimes und signiert anschließend einen festen, secretfreien Nachweis mit Ed25519. QKERN besitzt weder Kubeconfig noch privaten Signierschlüssel und führt selbst keinen Rollout oder Test aus.

Der Verifier bindet die Evidenz an den kanonischen v0.28-Bundle-Hash, Namespace, Image-Digest und drei unabhängige serverseitige Pins für Cluster-Identität, NetworkPolicy-Satz und Image-Provenance. Public Key und Evidenz werden aus getrennten integritätsgeschützten Dateien gelesen; der rohe Public Key ist zusätzlich per SHA-256 gepinnt.

## Verlangte Live-Nachweise

- exakt vier bekannte Komponenten in fester Reihenfolge
- je eine gewünschte, aktualisierte, verfügbare und bereite Replica
- unveränderter Image-Digest und erfolgreicher Rollout
- erfolgreiche Liveness-/Readiness-, SIGTERM- und Restart-Recovery-Prüfung
- fehlender Service-Account-Token, verifizierter Security Context und Secret-Projektion
- Default-deny Ingress/Egress und komponentenspezifische Egress-Allowlist
- keine externen Service-Selektoren und keine Ingress-Ressourcen
- Image-Signatur, SBOM, Vulnerability-Policy und Provenance
- echtes Metrics-Scraping, Probe- und CrashLoop-Alarmrouting

## Sicherheitsgrenzen

- Ed25519-Signatur mit separatem gepinntem Public Key
- exakter Feldvertrag und Ablehnung doppelter JSON-Schlüssel
- maximal 24 Stunden alte Evidenz
- mindestens 30 Minuten und höchstens zwei Stunden Beobachtungsdauer sowie 15 Minuten Signierverzug
- absolute No-follow-Dateien; Production verweigert group-/world-writable Modi
- Inline-Evidenz, Inline-Key und Authority-Pfad-Wiederverwendung verboten
- CLI- und Metrics-Ausgabe ohne Evidenz-ID, Namespace, Cluster, Digests, Registry, Key- oder Dateidaten
- kein Apply-, Cluster-, Backup-, Restore- oder Secret-Autoritätspfad

## Befehle

- `npm run render:runtime-deployments`
- `npm run verify:runtime-deployments`
- `npm run verify:runtime-deployment-evidence`

## Validierung

- Strict TypeScript Typecheck
- 470 erfolgreiche automatisierte Tests in 74 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- erfolgreicher Next.js-Production-Build
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette

## Keine Production-Freigabe

0.29 stellt den prüfbaren Nachweisvertrag bereit, erzeugt aber keine echte Evidenz. Erst ein unabhängiger Live-Runner muss NetworkPolicies, Registry-Provenance, Secret-Bereitstellung, Rollout, Probes, Shutdown/Restart, Scraping und Alarmzustellung ausführen, die private Detailspur archivieren und den engen Vertrag signieren. Provider-/Vault-/PostgreSQL-/Broker-/Pager-E2E und der Backup-/Restore-Drill bleiben separate Gates. Production-Apply bleibt gesperrt.
