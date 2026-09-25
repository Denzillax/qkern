# Release 2.22.0 – Die Schluessel zum Token

Die JWT-Schluessel des Projekts als eigene Ansicht, gelesen aus dem JWKS,
das auch jede App zum Pruefen liest. Nur lesend.

## Was es tut

Jeder Schluessel mit kid, Typ, Kurve, Verfahren und Verwendung; die
absolute JWKS-Adresse zum Kopieren. Welcher Schluessel gerade signiert,
steht im Token-Header, und die Ansicht sagt das.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/jwt-keys-local-run1.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/jwt-keys-local-run2.manifest.json` |

`next build` gruen. Kein Server-Code, Stacks unveraendert.

## Ehrlich offen

- **Keine Rotation** ueber die Console.
- **Im Browser nicht gesehen.** Das Console-Konto fehlt seit dem Neustart
  des Dev-Servers.
