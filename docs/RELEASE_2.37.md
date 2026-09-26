# Release 2.37.0 – Was es kostet

Die Abrechnung in der Konsole: Preisblatt, laufender Monat, Rechnungen.
Nur lesend, aus dem Nutzungsledger, und mit dem Satz, der stimmt: es gibt
keine Zahlungsanbindung.

## Was neu ist

- Ansicht Einstellungen, Abrechnung statt Platzhalter.
- Geldformat aus einer Quelle, rundet ab wie der Rechnungslauf.
- Die Rechnungskarte wird von Nutzung & Limits und Abrechnung geteilt.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1302/1302, exit 0 | `docs/evidence/2026-09-26/billing-view-local-run1.manifest.json` |
| Vitest lokal 1302/1302, exit 0 | `docs/evidence/2026-09-26/billing-view-local-run2.manifest.json` |
| Mutation 2/1302 fallen, exit 1 | `docs/evidence/2026-09-26/billing-view-mutation.manifest.json` |

`next build` grün. Keine Serveränderung, keine Docker-Zertifizierung.

## Ehrlich offen

- **Keine Zahlungsanbindung, kein Versand.**
- **Im Browser nur der Aus-Zustand gesehen.**
- **Kein "gültig ab" je Preis**, weil kein Endpunkt es liefert.
