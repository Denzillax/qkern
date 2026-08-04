# QKERN 1.0 Release Candidate 1 — Controlled Rollout Gate

## Ergebnis

RC1 ergänzt den letzten maschinenlesbaren Dry-run zwischen dem technisch fertigen
v0.32-Evidence-Vertrag und einem realen Production-Rollout. Der neue Preflight
akzeptiert nur die Kombination aus gehärtetem Vier-Workload-Bundle, vollständiger
signierter Evidence-Kette und enger Production-Konfiguration.

## Zusätzliche Invarianten

- Production, PostgreSQL und TLS sind zwingend.
- Provisioner, Worker und Metrics sind an exakt dieselbe Organisation gebunden.
- Runtime-Probes, Metrics und alle vier Evidence-Gates müssen aktiv sein.
- nur HTTPS-Ursprünge und ein expliziter Reverse-Proxy-Vertrauensrand sind erlaubt.
- lokale/statische Kataloge und Inline-Authorities sind ausgeschlossen.
- Production Apply muss während des Preflights ausdrücklich deaktiviert bleiben.
- aufgelöste, aber inhaltlich manipulierte Teil-Readiness wird erneut geprüft.
- Ausgabe und Fehler bleiben vollständig redigiert und cause-frei.

## Kein automatischer Rollout

RC1 besitzt keine Cluster-, Provider-, Vault-, Pager-, Audit- oder Signierautorität.
Es enthält keine echte positive Evidence und keine Production-Apply-Autorisierung.
Der Status `ready_for_controlled_rollout` ist nur nach realen externen Nachweisen
erreichbar und führt selbst keinerlei Deployment oder Apply aus.

## Operator-Vertrag

- `docs/PRODUCTION_READINESS_RUNBOOK.md`
- `npm run verify:production-readiness`
- danach weiterhin `docs/PRODUCTION_APPLY_AUTHORIZATION_RUNBOOK.md`

## Validierung

- Strict Typecheck: erfolgreich
- Vitest: 513 bestanden, 9 Real-PostgreSQL-Tests mangels bereitgestelltem Dienst übersprungen
- Testdateien: 79 bestanden, 2 übersprungen
- Next.js Production Build: erfolgreich
- NPM-Paketprüfung: 318 Dateien, 445.153 Bytes gepackt, 2.097.341 Bytes entpackt
- Dependency Audit: 0 Critical, 0 High; 2 bekannte Moderate-Findings in der MCP-SDK-Transitivkette ohne verfügbaren kompatiblen Fix
