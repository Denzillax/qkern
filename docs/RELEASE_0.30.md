# Release 0.30 — Cryptographic Production Apply Lock

## Ergebnis

QKERN 0.30 macht aus dem bisher dokumentierten Production-Verbot eine serverseitig
erzwungene Sicherheitsgrenze. Ohne eine frische, extern signierte und auf genau ein
Change Set gebundene Release-Autorisierung kann Production weder über REST/MCP
eingereiht noch durch einen Worker ausgeführt werden.

Die Autorisierung bindet Tenant, Projekt, Change Set, Approval, Hash der opaque
Zielreferenz, Statement-Hash und Approval-Action-Hash. Zusätzlich bindet sie fünf
unabhängig konfigurierte SHA-256-Pins für Release, Restore-Drill, Live-Deployment,
Provider-E2E und Security Assessment. Alle elf positiven Release-Assertions müssen im
signierten Payload vorhanden sein.

## Zwei unabhängige Prüfstellen

- Der gemeinsame PostgreSQL-Apply-Service prüft nach Approval- und Target-Validierung,
  aber vor dem atomaren Enqueue. Damit sind REST und MCP gemeinsam abgedeckt.
- Der Migration Worker prüft denselben unveränderlichen Subject-Snapshot nach
  Artefaktprüfung und unmittelbar vor dem Executor. Bereits vorhandene oder direkt
  injizierte Queue-Jobs können die Grenze nicht umgehen.
- Memory Mode verweigert Production immer.
- Development und Staging behalten den bisherigen Ablauf.

## Sicherheitsgrenzen

- disabled by default; ein Enable-Flag allein erteilt keine Autorität
- Ed25519 mit separat gelieferter Key-Datei und SHA-256-Pin des rohen Public Keys
- exakt ein Change Set/Approval/Ziel pro Autorisierung
- höchstens vier Stunden Gültigkeit und Alter, fünf Minuten Clock-Skew
- exakter Feldvertrag, kanonische Signaturbytes und Ablehnung doppelter JSON-Schlüssel
- absolute No-follow-Dateien, Production-Mode-Prüfung und Authority-Pfad-Trennung
- cause-freier API-, Worker- und CLI-Fehler `PRODUCTION_APPLY_BLOCKED`
- kein privater Schlüssel, keine positive Evidenzerzeugung und kein Operator-Bypass in QKERN

## Operator-Vertrag

Der vollständige Payload-, Pin-, Preflight- und Rücknahmevertrag steht in
`docs/PRODUCTION_APPLY_AUTHORIZATION_RUNBOOK.md`. `npm run verify:production-apply`
prüft ein exaktes Subject vorab und gibt weder IDs noch Digests, Key- oder Dateidaten
aus. API und Worker prüfen trotzdem bei jeder autoritätsrelevanten Aktion erneut.

## Validierung

- Strict TypeScript Typecheck
- Signatur-, Pin-, Subject-, Zeit-, Duplicate-Key-, Inline- und Authority-Reuse-Negativtests
- Service-Negativtest: kein Production-Enqueue ohne Freigabe
- Worker-Negativtest: kein Executor-Aufruf ohne Freigabe
- OpenAPI- und redigierter HTTP-Fehlervertrag
- 483 erfolgreiche automatisierte Tests in 75 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests in zwei weiteren Dateien
- erfolgreicher Next.js-Production-Build
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der
  MCP-SDK→`@hono/node-server`-Transitivkette; der betroffene Windows-
  `serve-static`-Helper wird im Linux-Production-Host nicht verwendet

## Keine eigenmächtige Production-Freigabe

Die Implementierung kann jetzt echte externe Release-Nachweise technisch erzwingen,
erzeugt diese Nachweise aber nicht. Im gelieferten Artefakt fehlen bewusst
Autorisierungsdatei, Private Key und reale positive Evidenz. Production Apply bleibt
daher nach Installation gesperrt, bis Provider-/Vault-/PostgreSQL-/Broker-/Pager-E2E,
Restore, Cluster, Cross-Tenant-Security, Stale-Worker-Cancellation und Pentest real
bestanden, archiviert und durch die unabhängige Release-Autorität signiert wurden.
