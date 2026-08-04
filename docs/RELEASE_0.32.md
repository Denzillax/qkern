# Release 0.32 — Security Certification Gate

## Ergebnis

QKERN 0.32 implementiert den zuvor nur als Production-Apply-Digest vorgesehenen
Security-Assessment-Nachweisvertrag. Eine unabhängige Prüfstelle muss 14 feste
Security-Kontrollen für das exakte Release bestehen, acht Eingabeartefakte binden,
null offene Critical-/High-Findings bestätigen und das Ergebnis mit Ed25519
signieren. QKERN kann diese Evidence nur verifizieren, nicht erzeugen.

## Gemeinsamer Release-Preflight

Der neue `verify:release-evidence`-Befehl verifiziert alle vier signierten Gates und
hasht Release-ZIP sowie vier Evidence-Envelopes gegen die fünf serverseitigen
Production-Apply-Pins. Dadurch verweist eine spätere kurzlebige Apply-Autorisierung
nicht nur auf behauptete Digests: Der Operator kann die wirklich vorliegenden
Dateien und ihre jeweiligen Signatur-/Zeit-/Policy-Verträge gemeinsam fail-closed
prüfen.

## Sicherheitsgrenzen

- disabled by default; keine Inline-Autorität
- exakter Feldvertrag mit Duplicate-Key-Ablehnung
- Ed25519, dedizierter Public-Key-File und Raw-Key-SHA-256-Pin
- acht paarweise verschiedene Artefaktpins plus separater Key-Pin
- mindestens eine Stunde Assessment, maximal 30 Tage Laufzeit
- höchstens 24 Stunden Zertifizierungslatenz, sieben Tage Evidenzalter
- 14 feste positive Kontrollen; Critical und High zwingend null
- no-follow, Größenlimits und Production-Dateimodusprüfung
- bidirektionale Authority-Pfad-Trennung
- cause-freie CLI-Ausgaben und fail-closed Metrics-Projektion

## Operator-Verträge

- `docs/SECURITY_ASSESSMENT_EVIDENCE_RUNBOOK.md`
- `docs/RELEASE_EVIDENCE_READINESS_RUNBOOK.md`
- `npm run verify:security-assessment`
- `npm run verify:release-evidence`

## Validierung

- Strict TypeScript Typecheck
- 507 erfolgreiche Tests in 78 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests in zwei weiteren Dateien
- erfolgreicher Next.js-16.2.12-Production-Build mit allen Routen
- Signatur-, Tamper-, Key-, Pin-, Zeit-, Findings-, Check-, Extra-Field-,
  Duplicate-Key-, Dateimodus-, Symlink-, Größen-, Abbruch- und
  Authority-Reuse-Negativtests
- redigierte CLI-Erfolg/-Fehler und fail-closed OpenMetrics-Integration
- kombinierte Prüfung von vier Evidence-Verifiern und fünf exakten Dateidigests
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der bekannten
  MCP-SDK→`@hono/node-server`-Transitivkette; kein kompatibler Fix verfügbar und
  der betroffene Windows-`serve-static`-Helper wird im Linux-Host nicht genutzt
- `npm pack --dry-run`: 312 Dateien, 438,8 kB komprimiert

## Keine vorgetäuschte Zertifizierung

Unit-Tests verwenden ausschließlich flüchtige Testschlüssel und synthetische
Fixtures. Die Lieferung enthält keinen privaten Production-Key, keine positive
Security-Evidence, keinen Pentest-Bericht und keine Production-Apply-Autorisierung.
Bis alle realen externen Läufe ausgeführt, archiviert und unabhängig signiert sind,
bleibt Production Apply technisch gesperrt.
