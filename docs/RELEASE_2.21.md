# Release 2.21.0 – Drei, die es schon gab

Cron, API-Keys und Anmeldeverfahren sind eigene Menuepunkte, wie bei
Supabase. Das Backend gab es schon; neu sind nur die Ansichten.

## Was es tut

Cron: anlegen, pausieren, loeschen, wie unter Functions & Jobs. API-Keys:
Public und Service Keys anlegen und widerrufen, das Geheimnis nur einmal.
Anmeldeverfahren: die vier zertifizierten Verfahren und die konfigurierten
OIDC-Provider, nur lesend.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/three-views-local-run1.manifest.json` |
| Vitest lokal 1147/1147, exit 0 | `docs/evidence/2026-09-25/three-views-local-run2.manifest.json` |

`next build` gruen. Kein Server-Code, Stacks unveraendert.

## Ehrlich offen

- **Im Browser nicht gesehen.** Das Console-Konto fehlt seit dem Neustart
  des Dev-Servers.
- **Doppelt statt verschoben.** Die alten Stellen zeigen dasselbe weiter.
- **Ein Verfahren ein- oder auszuschalten** geht weiterhin nicht ueber die
  Console.
