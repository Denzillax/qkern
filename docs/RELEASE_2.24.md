# Release 2.24.0 – Derselbe Fehler, zweiter Fall

Zum ersten Mal seit 2.6 war die Console im Browser zu sehen. Jede
Katalogansicht sagte "nicht verfuegbar", dahinter ein 500 ohne Code.

## Ursache eins, wie in 2.8

Der Data-Plane-Dienst ueberlebt im Dev-Modus das Neuladen der Module, die
Route nicht; `instanceof` erkennt den eigenen Fehler nicht mehr, und aus
503 wird 500. Jetzt zaehlt Name plus Code, und der 500-Zweig loggt.

## Ursache zwei

(Und eine dritte, die erst das neue Log zeigte: die gemerkte abgeschaltete
Instanz kannte die Methoden von 2.18 bis 2.20 nicht. Sie wird nicht mehr
gemerkt.)

Abgeschaltete Queues warfen schon beim Anlegen des Dienstes, in elf
Routen vor dem `try`. Jetzt wirft der Dienst erst beim Aufruf, und die
Route antwortet 503 "Project Queues are disabled".

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/identity-run1.manifest.json` |
| PostgreSQL 17 169/169, exit 0 | `docs/evidence/2026-09-25/identity-run2.manifest.json` |
| Mutation 1/2 faellt, exit 1 | `docs/evidence/2026-09-25/identity-mutation.manifest.json` |
| Vitest lokal 1152/1152, exit 0 | `docs/evidence/2026-09-25/identity-local-run1.manifest.json` |
| Vitest lokal 1152/1152, exit 0 | `docs/evidence/2026-09-25/identity-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Die Ansichten mit Daten sind weiter nicht gesehen.** Der Dev-Server
  hat keine Projektdatenbank; gesehen sind alle Zustaende ohne Dienste.
- **Die Zertifizierung lief vor der letzten Aenderung an `runtime.ts`**,
  die sie nicht beruehrt; die lokale Suite lief danach.
- **Ein dritter Fall dieser Klasse ist wahrscheinlich.** Jeder Dienst auf
  `globalThis` mit `instanceof` in einer Route hat dasselbe Loch.
