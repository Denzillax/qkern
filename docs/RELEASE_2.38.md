# Release 2.38.0 – Secrets, ohne Werte

Die Secrets der Functions in der Konsole: je Referenz, ob der Vault sie
auflöst. Vorhanden, fehlt oder kein Zugriff. Einen Wert zeigt QKERN nie,
und der Datenendpunkt des Vault wird nie angefragt.

## Was neu ist

- Ansicht Functions & Jobs, Secrets statt Platzhalter.
- Route `GET .../compute/functions/{functionId}/secrets`, nur Referenz und Status.
- Eine Pfadregel für Signatur-Resolver und Inspektor.
- Vault-Zertifizierung von 6 auf 7 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| HashiCorp Vault 1.18, 7/7, exit 0 | `docs/evidence/2026-09-26/function-secrets-vault-run1.manifest.json` |
| HashiCorp Vault 1.18, 7/7, exit 0 | `docs/evidence/2026-09-26/function-secrets-vault-run2.manifest.json` |
| Mutation Vault 6/7 fallen 1, exit 1 | `docs/evidence/2026-09-26/function-secrets-vault-mutation.manifest.json` |
| Mutation lokal 9/10, exit 1 | `docs/evidence/2026-09-26/function-secrets-local-mutation.manifest.json` |
| Vitest lokal 1319/1319, exit 0 | `docs/evidence/2026-09-26/function-secrets-local-run1.manifest.json` |
| Vitest lokal 1319/1319, exit 0 | `docs/evidence/2026-09-26/function-secrets-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Anlegen und Ändern bleibt im Vault.**
- **Eine Referenz ohne `vault:` erscheint als kein Zugriff**, obwohl eine Definition sie erlaubt.
- **Die Metadaten laufen durch den Serverprozess**, auch wenn nur ein Wort zurückkommt.
- **Ein fremdes Projekt bekommt im Speichermodus 500 statt 404**, wie bei allen Compute-Routen.
- **Im Browser nicht gesehen.**
