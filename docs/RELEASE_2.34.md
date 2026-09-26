# Release 2.34.0 – Sitzungen sehen und beenden

Administratoren sehen in der Konsole die aktiven Sitzungen eines
App-Nutzers und beenden eine oder alle. Der Widerruf trifft die ganze
Refresh-Familie, und kein Token verlässt den Server.

## Was neu ist

- Ansicht Auth, Sitzungen: Nutzer wählen, Sitzungen mit Anlage, Ablauf,
  Sicherungsstufe und Familie, Knöpfe für eine und für alle, mit Rückfrage.
- Routen `GET` und `DELETE .../auth/admin/users/{userId}/sessions` und
  `DELETE .../sessions/{sessionId}`, in der OpenAPI und im Handbuch.
- Ein PostgreSQL-Fall, der Widerruf und Isolation je Familie und je Nutzer
  belegt: 173 von 173.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 173/173, exit 0 | `docs/evidence/2026-09-26/auth-sessions-run1.manifest.json` |
| PostgreSQL 17 173/173, exit 0 | `docs/evidence/2026-09-26/auth-sessions-run2.manifest.json` |
| Mutation 172/173, exit 1 | `docs/evidence/2026-09-26/auth-sessions-mutation.manifest.json` |
| Vitest lokal 1279/1279, exit 0 | `docs/evidence/2026-09-26/auth-sessions-local-run1.manifest.json` |
| Vitest lokal 1279/1279, exit 0 | `docs/evidence/2026-09-26/auth-sessions-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Kein Audit-Ereignis für den Widerruf.** Project Auth schreibt heute
  keine; das ist ein eigener Schritt.
- **Ein Refresh nach dem Widerruf gilt als Replay**, nicht als "widerrufen".
  Auf dem Draht kein Unterschied, in der Datenbank eine Markierung mehr.
- **Die Ansicht ist im Browser nicht gesehen**, nur durch Tests belegt.
