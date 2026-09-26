# Release 2.44.0 – Was gerade läuft

Die Projekt-Gesundheit in der Konsole. Acht Teilsysteme, je ein Zustand und
ein Beleg. Nur lesend, ohne Knopf zum Reparieren.

## Was neu ist

- Ansicht Advisors, Gesundheit statt Platzhalter. Damit ist der Bereich vollständig.
- Acht nebenläufige Proben, jede fängt ihren eigenen Fehler.
- Eine fehlende Fähigkeit macht eine Probe unbekannt, nicht die Seite kaputt.
- Der Beleg kann strukturell kein Geheimnis tragen.
- PostgreSQL-Zertifizierung von 180 auf 181 Fälle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 181/181, exit 0 | `docs/evidence/2026-09-26/health-run1.manifest.json` |
| PostgreSQL 17, 181/181, exit 0 | `docs/evidence/2026-09-26/health-run2.manifest.json` |
| Mutation im Stack, 180/181, exit 1 | `docs/evidence/2026-09-26/health-mutation.manifest.json` |
| Mutation lokal, 10/13, exit 1 | `docs/evidence/2026-09-26/health-local-mutation.manifest.json` |
| Vitest lokal 1418/1418, exit 0 | `docs/evidence/2026-09-26/health-local-run1.manifest.json` |
| Vitest lokal 1418/1418, exit 0 | `docs/evidence/2026-09-26/health-local-run2.manifest.json` |

`next build` grün.

## Nachtrag zum Verfahren

Der Zertifizierungsfall fiel zuerst an seiner eigenen Probe gegen
Stapelspuren: Sie suchte "at " und traf das deutsche Wort "hat". Sie sucht
jetzt die Form einer Stapelzeile und prüft zusätzlich die Gestalt jedes
Belegs.

## Ehrlich offen

- **Gesund heisst erreichbar und eingerichtet**, nicht dass die Anwendung funktioniert.
- **Bei Realtime und Vault heisst grün nur, dass eine Adresse hinterlegt ist.** Der Dienst wird nicht gefragt.
- **Der Sandbox-Schalter ist prozessweit**, keine Aussage je Projekt.
- **Acht Proben je Aufruf, ohne Zwischenspeicher.** Die Datenbankprobe und die Data-API-Probe sind die teuersten.
- **Im Browser nicht gesehen.**
