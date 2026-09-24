# Release 1.95.0 — Menüs statt Attrappen

Drei Nutzerbefunde in Folge, dazu eine Frage: Wo sind die
Kontoeinstellungen? Die ehrliche Antwort: Es gibt sie noch nicht — jetzt
sagt die Console das selbst.

## Was sich ändert

- **Umgebungsmenü**: eigene Listbox statt nativem `select` — Status-Punkt,
  Name, Hinweistext je Umgebung, Häkchen auf der aktiven; Escape und Klick
  ausserhalb schliessen.
- **Sidebar**: der Aufklapp-Pfeil steht rechts neben dem Symbol; der
  Zustand bleibt in `localStorage` gemerkt und wird erst im Effekt gelesen,
  damit Server und Client gleich rendern. Der untere Bereich der
  eingeklappten Leiste hat einheitliche Kacheln, keine Scrollleistenpfeile.
- **Kontomenü**: das Konto unten in der Sidebar öffnet ein Menü mit
  E-Mail, Workspace, sichtbar abgeschalteten Konto- und
  Workspace-Einstellungen („Bald") und Abmelden.
- **Krume**: „Denis.mihaljevic Workspace" wird zu „Denis Mihaljevic" mit
  dem Etikett Workspace (`lib/console/workspace-name.ts`, drei Fälle).
- **Dev-Anzeige** von Next liegt unten rechts, nicht mehr über dem Konto.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/account-menu-local-run1.manifest.json` |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/account-menu-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Sichtprüfung steht aus**: Die Änderung an `next.config.ts` hat den
  Dev-Server neu gestartet, und der Memory-Auth-Adapter hat dabei alle
  Konten und Sessions verloren. Der untere Sidebar-Bereich und das
  Kontomenü sind aus dem CSS abgeleitet, nicht im Browser gemessen.
- **Konten vergessen bei Neustart**: ohne `.env.local` mit
  `QKERN_RUNTIME_MODE=postgres` lebt die Anmeldung im Speicher.
- **Konto- und Workspace-Einstellungen** bleiben zu bauen.
