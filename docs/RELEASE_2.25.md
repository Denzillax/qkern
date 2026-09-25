# Release 2.25.0 – Alle Faelle dieser Klasse

Dreimal an einem Tag derselbe Fehler, drei Flicken. Jetzt eine Loesung
fuer alle 76 Fehlerklassen des Servers.

## Was es tut

`recognisedByName` gibt jeder Fehlerklasse ein `Symbol.hasInstance`, das
neben der Prototypkette jeden Error mit demselben Namen akzeptiert. Damit
ist `instanceof` auch dann richtig, wenn der Dienst das Neuladen der
Module ueberlebt hat und die Route eine andere Kopie der Klasse haelt.
Basisklassen erkennen ihre Unterklassen. Ein Vertrag scannt den Server
nach Klassen ohne Registrierung.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/sweep-run1.manifest.json` |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/sweep-run2.manifest.json` |
| Mutation 2/3 faellt, exit 1 | `docs/evidence/2026-09-25/sweep-mutation.manifest.json` |
| Vitest lokal 1155/1155, exit 0 | `docs/evidence/2026-09-25/sweep-local-run1.manifest.json` |
| Vitest lokal 1155/1155, exit 0 | `docs/evidence/2026-09-25/sweep-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Das Neuladen selbst ist nicht nachgestellt**, nur die fremde Kopie der
  Klasse.
- **Die drei Helfer aus 2.8 und 2.24 bleiben.** Sie schaden nicht.
