# Release 1.91.0 — Die Seite liest, statt abzuschreiben

Beim ersten Start von QKERN nach dem Umzug fiel es auf: Die Landingpage
zeigte „Prüflauf 6. August 2026 — Control Plane 85 von 85, Object Storage 2
von 2, Project Auth 5 von 5, Functions 22 von 22", während längst 160, 8, 7
und 27 galten. `STATUS.md` war seit `1.39` durch einen Vertrag an die
Manifeste gebunden — die Seite, die Kunden sehen, nicht.

## Die Quelle

Die Seite liest ihre Zahlen jetzt zur Laufzeit aus `docs/evidence/`:
je Stack der **beste grüne Lauf** (dieselbe Messvorschrift wie der
Zahlen-Vertrag), das Datum des jüngsten grünen Laufs, und die archivierten
Mutationsläufe als Gegenproben. Ein Vertrag verbietet literale Zählwerte
und Daten in `app/page.tsx` und prüft, dass die gerenderten Zahlen je Stack
denen in `STATUS.md` gleichen. Die Listen `modules` und `gaps` nannten
Lücken, die seit `1.27`, `1.33` und `1.36` geschlossen sind — sie stehen
jetzt auf dem Stand der Paritätsleiter.

Belegt am laufenden Dev-Server: 160 / 8 / 7 / 27 / 6 / 14, „24. September
2026", 77 Gegenproben.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Seite nimmt den schlechtesten statt den besten grünen Lauf (85 statt 160) | **2 von 1093** — genau der Zusammenfassungs-Fall und der Landingpage-Vertrag |

## Belege

Dieser Slice ändert keinen Dienst-Code; die lokale Suite ist die tragende
Evidenz:

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/landing-numbers-local-run1.manifest.json` |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/landing-numbers-local-run2.manifest.json` |
| Mutation 1091/1093 | `docs/evidence/2026-09-24/landing-numbers-local-mutation.manifest.json` |

Stacks unverändert: PostgreSQL 160, MinIO/ClamAV 8, Mailpit/Dex 7,
Functions 27. 45 Migrationen.

## Ehrlich offen

- **`modules` und `gaps` bleiben handgepflegter Text** — korrekt zum Stand
  `1.91`, aber ohne Vertrag, der sie an die Leiter bindet.
- **Die Seite liest die Manifeste bei jeder Anfrage** — kein Cache; bei ~90
  kleinen Dateien vertretbar, bei tausenden nicht mehr.
