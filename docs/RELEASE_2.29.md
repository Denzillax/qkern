# Release 2.29.0 – Backup und Restore, lokal bewiesen

Sprosse 10 ohne Hoster: ein Wegwerfstack mit PostgreSQL 17 unter
TLS-Pflicht und WAL-Archiv, ein verschluesseltes Basisbackup, eine
Wiederherstellung bis zu einem Zeitpunkt, und ein Beleg, den der
Produkt-Verifier annimmt.

## Was neu ist

- `npm run test:backup:docker`: Zertifikat, Quellserver, Drill. Der Drill
  belegt TLS-Pflicht, Basisbackup ueber `verify-full`, AES-256, PITR aus dem
  Archiv, Schema, Zeilen, Audit-Kette, Manifest, Ed25519-Signatur.
- CI-Job "Backup und Restore" mit Verifier-Lauf auf Ubuntu.
- Neuer Claim "Backup und Restore" in Zusammenfassung, STATUS und
  Landing-Namen (vier Sprachen).
- Vorarbeit fuer die Doku: der Dev-Compose legt `project_database` an, und
  `npm run dev:bind-project-database` bindet eine wartende Umgebung lokal.

## Belege

| Lauf | Manifest |
| --- | --- |
| Backup und Restore 1/1, exit 0 | `docs/evidence/2026-09-25/backup-run1.manifest.json` |
| Backup und Restore 1/1, exit 0 | `docs/evidence/2026-09-25/backup-run2.manifest.json` |
| Mutation 0/1, exit 1 | `docs/evidence/2026-09-25/backup-mutation.manifest.json` |
| Vitest lokal 1171/1171, exit 0 | `docs/evidence/2026-09-25/backup-local-run1.manifest.json` |
| Vitest lokal 1171/1171, exit 0 | `docs/evidence/2026-09-25/backup-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Kein Hoster, kein externes Archiv, kein fremd verwahrter Schluessel.**
  Der Stack beweist die Technik, nicht den Betrieb.
- **Der Verifier laeuft auf dem Host nicht unter Windows**, weil er absolute
  POSIX-Pfade verlangt; im CI-Job auf Ubuntu laeuft er.
- **Die Konsole zeigt unter Backups weiter den Platzhalter.**
- **Das Bindungsskript macht nur das eine UPDATE**, keinen Auftrag, keine
  Bindungszeile, keinen Projektstatus.

## Nachtrag

Der erste CI-Lauf des Jobs "Backup und Restore" fiel im Verifier-Schritt:
der Pin `QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256` ist der SHA-256 des rohen
32-Byte-Schluessels, nicht der Schluesseldatei. Das Drill-Skript schreibt den
Pin jetzt als `drill.verifier-key.sha256` neben den Schluessel, der Job liest
ihn von dort; mit der Evidenz des lokalen Laufs in einem Linux-Container
belegt (`status: ready`). Der Drill selbst war im CI gruen.
