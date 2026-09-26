# Release 2.35.0 – Was die Anmeldung tat

Project Auth schreibt seine Ereignisse in die Audit-Kette der Plattform,
und die Konsole zeigt den Auszug je Projekt. Kein Token und keine E-Mail
kommt ins Audit.

## Was neu ist

- Ereignisse für Registrierung, Anmeldung, Abmeldung, MFA und die
  Admin-Aktionen an Nutzern und Sitzungen; ein Fehler beim Schreiben bricht
  die Anmeldung nicht.
- Migration 0046: der Auth-Login darf an die Kette anhängen, sonst nichts.
- Route `GET .../auth/admin/audit` mit Cursor, in OpenAPI und Handbuch;
  Ansicht Auth, Audit-Log statt Platzhalter.
- Ein PostgreSQL-Fall, der die Ereignisse, die intakte Kette und die
  Mandantengrenze belegt: 174 von 174.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 174/174, exit 0 | `docs/evidence/2026-09-26/auth-audit-run1.manifest.json` |
| PostgreSQL 17 174/174, exit 0 | `docs/evidence/2026-09-26/auth-audit-run2.manifest.json` |
| Mutation 173/174, exit 1 | `docs/evidence/2026-09-26/auth-audit-mutation.manifest.json` |
| Vitest lokal 1289/1289, exit 0 | `docs/evidence/2026-09-26/auth-audit-local-run1.manifest.json` |
| Vitest lokal 1289/1289, exit 0 | `docs/evidence/2026-09-26/auth-audit-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Der Auth-Login liest alle Audit-Zeilen seiner Organisation**, nicht nur
  die der Anmeldung; die Einschränkung steht in der Abfrage, nicht in der
  Datenbank.
- **Jeder Fehlversuch ist eine Kettenzeile.** Begrenzt nur durch das
  Passwortlimit; eine eigene Obergrenze fehlt.
- **Die Ansicht ist im Browser nur im Zustand "nicht aktiviert" gesehen.**
