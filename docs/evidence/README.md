# Zertifizierungsevidenz

Je Lauf liegen hier zwei Dateien: das **ungefilterte Rohlog** und ein
**generiertes Manifest**. Das Manifest wird von
`scripts/certification-manifest.mjs` aus dem Log und aus git erzeugt, nicht von
Hand gepflegt. Ein unvollständiges Log wird abgelehnt, statt eine Teilaussage
als Evidenz abzulegen.

Kein Eintrag hier trägt eine Signatur. Das Ed25519-Verfahren aus
`PRODUCTION_APPLY_AUTHORIZATION_RUNBOOK.md` bindet externe Autoritäten; eine
lokal selbst erzeugte Signatur auf die eigene Aussage wäre Zeremonie ohne
Beweiswert. Die Evidenz belegt, dass ein Lauf stattgefunden hat und mit welchem
Ergebnis — nicht, dass eine unabhängige Stelle ihn bestätigt hat.

## Feldbedeutungen

| Feld | Bedeutung |
| --- | --- |
| `commit` | HEAD zum Zeitpunkt des Laufs |
| `workingTreeClean` | ob der Arbeitsbaum beim Lauf unverändert war |
| `exitCode` | Exit-Code des Runners; nur `0` ist ein bestandener Lauf |
| `migrationsApplied` | vom Init-Script tatsächlich angewandte Migrationen |
| `passed` / `failed` / `skipped` | aus der Vitest-Zusammenfassung gelesen |
| `images` | Image-Tags aus der zugehörigen Compose-Datei |

`workingTreeClean` steht bei den Läufen zu Release 1.9 auf `false`. Das ist
erwartbar und kein Mangel: Das Rohlog entsteht während des Laufs im
Arbeitsverzeichnis und ist zu diesem Zeitpunkt zwangsläufig unversioniert. Der
Stand des Produktcodes ist über `commit` eindeutig belegt.

## Läufe zu Release 1.9 und 1.10 (4. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `postgres-certification-release.log` | PostgreSQL 17 | 28 von 28, exit 0, 29 Migrationen |
| `storage-certification-release.log` | MinIO und ClamAV | 2 von 2, exit 0 |
| `auth-certification-release.log` | Mailpit und Dex | 5 von 5, exit 0 |

Die durchnummerierten Läufe sind die Diagnose- und Fix-Wellen, die zu diesem
Ergebnis geführt haben. Sie bleiben absichtlich erhalten:
`postgres-certification-run4` ist der erste echte Lauf überhaupt und
dokumentiert, dass zu diesem Zeitpunkt keine einzige der sieben
Real-DB-Testdateien bestand. `auth-certification-run1` dokumentiert entsprechend
den Ausgangszustand des Provider-Nachweises.
