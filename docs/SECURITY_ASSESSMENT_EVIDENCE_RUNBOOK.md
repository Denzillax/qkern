# Security-Assessment-Evidenz — Operator Runbook

## Zweck und Vertrauensgrenze

QKERN verifiziert einen extern erzeugten, Ed25519-signierten Nachweis für die
Security-Zertifizierung eines exakten Releases. QKERN führt weder Pentests noch
SAST/DAST aus, besitzt keinen privaten Signierschlüssel und kann keine positive
Evidence erzeugen. `verify:security-assessment` ist ausschließlich ein fail-closed
Verifier.

Prüfstelle, Detailberichte und Private Key müssen außerhalb der QKERN-Runtime liegen.
Signiert werden darf erst, wenn alle 14 Kontrollen bestanden, alle acht Eingaben
geprüft und keine Critical- oder High-Findings offen sind.

## Gepinnte Eingabeartefakte

Alle Pins sind SHA-256 in 64 Kleinbuchstaben-Hexzeichen. Die acht Artefaktpins und
der Digest des rohen 32-Byte-Public-Keys müssen paarweise verschieden sein.

| Variable | Geprüftes Artefakt |
|---|---|
| `QKERN_SECURITY_ASSESSMENT_RELEASE_ARTIFACT_SHA256` | exaktes Release-ZIP |
| `QKERN_SECURITY_ASSESSMENT_SBOM_SHA256` | vollständige Release-SBOM |
| `QKERN_SECURITY_ASSESSMENT_DEPENDENCY_AUDIT_SHA256` | Dependency-Audit-Bericht |
| `QKERN_SECURITY_ASSESSMENT_SAST_REPORT_SHA256` | SAST-Bericht |
| `QKERN_SECURITY_ASSESSMENT_DAST_REPORT_SHA256` | DAST-Bericht |
| `QKERN_SECURITY_ASSESSMENT_SECRET_SCAN_REPORT_SHA256` | Secret-Scan-Bericht |
| `QKERN_SECURITY_ASSESSMENT_CROSS_TENANT_REPORT_SHA256` | Cross-Tenant-Negativmatrix |
| `QKERN_SECURITY_ASSESSMENT_PENTEST_REPORT_SHA256` | unabhängiger Pentest-Bericht |

Wenn Production Apply aktiviert ist, muss der Release-Artefakt-Pin exakt mit
`QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256` übereinstimmen. Der spätere
`QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256` ist dagegen der Digest der
fertigen signierten Evidence-Datei.

## Pflichtkontrollen

Die unabhängige Prüfstelle bestätigt exakt:

1. Threat Model Review
2. Dependency Audit
3. SAST
4. DAST
5. Secret Scan
6. Cross-Tenant Isolation
7. REST-Autorisierung
8. MCP-Autorisierung
9. MCP-Prompt-Injection-Negativtests
10. SSRF-/Egress-Negativtests
11. Approval-/TOCTOU-Race-Tests
12. Backup-Isolation
13. Session-/Token-Sicherheit
14. Penetrationstest

Ein lokaler Unit-Test, manuell gesetzte Booleans oder ein Bericht ohne Bindung an
das exakte Release und die sieben weiteren Artefakte sind keine Production-Evidence.

## Signiertes Format

Die Envelope verwendet `qkern.security-assessment-evidence/v1`, Scope
`release_security`, exakt acht Digests, drei UTC-Zeitpunkte, die gemessene
Assessment-Dauer, `assessmentCount: 14`, null offene Critical-/High-Findings, exakt
14 positive Check-Felder und `result: "passed"`. Der Key-File-Vertrag verwendet
`qkern.security-assessment-verifier-key/v1`, dieselbe `keyId` und einen kanonischen
32-Byte-Ed25519-Public-Key als Base64url.

Der externe Assessor signiert exakt die UTF-8-Bytes aus
`canonicalSecurityAssessmentEvidencePayload()`. Zusätzliche, fehlende oder doppelte
JSON-Felder werden abgewiesen.

## Zeit- und Dateipolicy

- Assessment mindestens eine Stunde und höchstens 30 Tage
- Signatur höchstens 24 Stunden nach Assessment-Ende
- Zertifizierung höchstens sieben Tage alt
- maximal fünf Minuten Clock-Skew in die Zukunft
- Evidence und Public Key auf getrennten absoluten Pfaden
- keine Symlinks; in Production keine group-/world-writable Dateien
- keine Inline-Evidence, kein Inline-Key und keine wiederverwendeten Authority-Pfade

## Preflight

Alle Variablen stehen vollständig in `.env.example`.

```bash
npm run verify:security-assessment
```

Erfolg enthält nur feste Readiness-, Zeit-, Count- und Policy-Felder. Fehler liefern
nur `SECURITY_ASSESSMENT_EVIDENCE_NOT_READY`.

## Monitoring und Rücknahme

`QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED=true` verifiziert die Evidence bei
jedem authentifizierten Metrics-Scrape erneut. Ungültige oder veraltete Evidence
macht den gesamten Scrape `503`. Exportiert werden nur feste Readiness-, Count-,
Findings-, Dauer- und Timestamp-Metriken; Digests, IDs, Pfade, Signaturen und
Detailfindings werden nie projiziert.

Bei Kompromittierung:

1. Security-Evidence-Monitoring und Production Apply deaktivieren.
2. Key- und betroffene Artefaktpins rotieren.
3. Evidence und private Detailspur unveränderlich sichern.
4. alle 14 Kontrollen gegen ein neues Release wiederholen.
5. erst danach eine neue Evidence-ID und Signatur erzeugen.

