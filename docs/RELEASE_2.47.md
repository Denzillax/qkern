# Release 2.47.0 – Grenzen und Rechte von Realtime

Die Grenzen sichtbar, die Rechte benannt. Beides nur lesend, und beides so,
wie der Code es wirklich hält.

## Was neu ist

- Ansichten Realtime, Einstellungen und Realtime, Policies statt Platzhalter.
- Jede Grenze mit Wert, Einheit und Herkunft: Umgebung, Voreinstellung oder Code.
- Die Rechtematrix, Feld für Feld gegen die echte Prüfklasse abgeglichen.
- Betriebszahlen werden nicht erfunden: sie liegen in einem anderen Prozess.

## Zwei Befunde beim Bauen

- **Die Nachrichtengrenze lässt sich nicht einstellen.** Sie steht im Code, und der Server reicht die Einstellung nie durch.
- **Kanalrechte gibt es**, anders als die alte Notiz nahelegte. Sie stehen im Code, nicht in einer Tabelle.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1476/1476, exit 0 | `docs/evidence/2026-09-26/realtime-local-run1.manifest.json` |
| Vitest lokal 1476/1476, exit 0 | `docs/evidence/2026-09-26/realtime-local-run2.manifest.json` |
| Mutation lokal, 5/6, exit 1 | `docs/evidence/2026-09-26/realtime-local-mutation.manifest.json` |

`next build` grün. Keine Datenänderung, deshalb keine Docker-Zertifizierung.

## Ehrlich offen

- **Die Route liest die Umgebung ihres eigenen Prozesses.** In einer geteilten Installation kann sie abweichen.
- **Ändern lässt sich nichts hier**: Grenzen in der Umgebung, Rechte im Code.
- **Keine Betriebszahlen**, weil sie in einem anderen Prozess liegen.
- **Im Browser nicht gesehen.**
