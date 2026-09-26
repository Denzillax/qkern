# Release 2.52.0 – Grenzen, Geheimnisse, alte Versprechen

Drei Slices: eine Bremse, die wirklich bremst, eine Vault-Übersicht ohne
einen einzigen Wert, und vier alte offene Punkte eingelöst.

## Drei Schwächen der Anmeldung, gefunden beim Bauen

- Die Bremse zählte **je Prozess**. Bei mehreren Instanzen war die wirkliche Grenze ein Vielfaches.
- Sie zählte nach einem Hash der **Client-Adresse**, ohne Proxy-Einstellung alle in einem Topf.
- Das **Auffrischen von Token** hatte gar keine Grenze.

## Was neu ist

- Ansicht Auth, Rate Limits: gezählt wird in der Datenbank, nach Identität oder Sitzungsfamilie.
- Ansicht Integrationen, Vault: jede Referenz mit Zustand, kein Wert, keine Auflistung des Vault.
- Zwei Beraterregeln, die nie liefen, laufen; die Gesundheit unterscheidet "eingerichtet" von "erreichbar".
- PostgreSQL-Zertifizierung von 191 auf 193, Vault von 7 auf 8 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 193/193, exit 0 | `docs/evidence/2026-09-26/welle4-run1.manifest.json` |
| PostgreSQL 17, 193/193, exit 0 | `docs/evidence/2026-09-26/welle4-run2.manifest.json` |
| Mutation Anweisungstext, exit 1 | `docs/evidence/2026-09-26/welle4-mutation-statements.manifest.json` |
| Mutation Zähler, exit 1 | `docs/evidence/2026-09-26/welle4-mutation-rate.manifest.json` |
| Vault 8/8, exit 0 | `docs/evidence/2026-09-26/vault-overview-run1.manifest.json` |
| Vault 8/8, exit 0 | `docs/evidence/2026-09-26/vault-overview-run2.manifest.json` |
| Mutation Vault, exit 1 | `docs/evidence/2026-09-26/vault-overview-mutation.manifest.json` |
| Vitest lokal 1774/1774, exit 0 | `docs/evidence/2026-09-26/welle4-local-run1.manifest.json` |
| Vitest lokal 1774/1774, exit 0 | `docs/evidence/2026-09-26/welle4-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Eine Grenze je Identität hält keinen verteilten Angriff auf.**
- **Mehrfaktor-Antwort und OIDC-Start** hängen weiter an der Bremse im Prozess, weil dort keine Identität feststeht.
- **`configured` lässt Projekte mit Realtime schlechter aussehen.** Das ist die Korrektur.
- **Ohne erweiterte Leserechte** fallen fremde Zeilen aus der Anweisungsstatistik.
- **Im Browser nicht gesehen.**
