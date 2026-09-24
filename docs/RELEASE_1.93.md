# Release 1.93.0 — Die Console sagt, was sie nicht kann

Nutzerbefund nach dem Redesign, in der Console auf Desktop: unschöne
Scrollleiste, uneinheitliche Buttons, der Kicker in Monospace-Versalien,
eine Kopfleiste, die beim Scrollen springt, und Buttons und Tabs, die sich
nicht klicken lassen.

## Fünf Ursachen, fünf Korrekturen

- **Kopfleiste**: seit `1.92` eine transparente Kapsel, unter der der Inhalt
  durchscrollte — jetzt wieder eine volle, geblurrte Leiste.
- **Kicker**: Sans in Satzschreibung, „First Project · Development".
- **Scrollleisten**: schmal und rund, aus den Tokens.
- **Buttons**: eine Höhe in der ganzen Console (40 px, vollrund).
- **Das Springen**: `.console-root` war ein Grid mit `auto 1fr`, die Sidebar
  aber `position: fixed` und damit kein Grid-Item. Der Arbeitsbereich lag im
  `auto`-Track, der sich nach dem Inhalt bemisst — bei 1440 px blieben 837
  von 1208 px, und jede Ansicht mit anderer Inhaltsbreite verschob die
  Kopfleiste. Das Grid ist weg.

## Die Attrappen

Die nicht klickbaren Elemente waren nie verbunden: Backups zeigte erfundene
Wiederherstellungspunkte vom Juli, Settings ein erfundenes Projekt „Nova
Market", dazu Team, Glocke, Filter und Beispiel-Endpunkte ohne Funktion.
Statt sie klickbar zu machen, ohne dass dahinter etwas wäre, sind sie jetzt
sichtbar abgeschaltet und sagen im Tooltip, dass sie noch nicht verbunden
sind. Settings liest den echten Projektnamen und die echte ID; Backups
erklärt, dass es ein WAL-Archiv braucht — Sprosse 10 der Paritätsleiter.

## Ehrlich

Der Grid-Fund wurde zwischendurch für falsch gehalten und der Block
entfernt; erst die Messung im Browser (Breite des Arbeitsbereichs bei
1440 px) hat ihn bestätigt. Ein Screenshot bei 1000 px hatte die Lücke
kaschiert — messen statt schauen.

Lokal 1093/1093, zweimal; Stacks unverändert.

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/console-fixes-local-run1.manifest.json` |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/console-fixes-local-run2.manifest.json` |

## Ehrlich offen

- **Die abgeschalteten Flächen sind ehrlich, aber leer** — Team,
  Benachrichtigungen, Filter und Projekt-Einstellungen bleiben zu bauen.
