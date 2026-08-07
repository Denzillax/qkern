# Release 1.40.0 — Die letzte ungeprüfte Zahl

> Datum: 7. August 2026 · Vorgänger: `1.39.0`

## Wofür dieses Release steht

Release 1.39 hat die Zertifizierungszahlen an die archivierten Manifeste
gebunden — und im Abschnitt „Ehrlich offen" notiert, dass die Zahlen der
Fortschrittstabelle weiter ungeprüft bleiben.

Dieses Release zählt nach. Fünf von sechs stimmten. Die sechste war falsch, und
zwar genau die, die niemand rekonstruieren konnte.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Neue Fälle | 1 lokal, ein Vertragstest über sechs Module |
| Mutationsprobe | 40 auf 41 verfälscht → der Fall fällt um |
| Vitest lokal | 990 bestanden, 0 fehlgeschlagen |
| Zertifizierungsläufe | nicht wiederholt — kein Produktcode geändert |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## 116 gegen 73

Die Zeile lautete:

> Compute Contracts | … | ja — **116 Fälle**, Kette in einem Lauf …

Zählbar sind: 40 Real-DB-Fälle in den fünf Compute-Testdateien, 23 im
Functions-Lauf gegen Docker und Registry, 10 gegen den echten HTTPS-Empfänger.
Zusammen 73.

Die 116 stammen aus keiner Quelle. Sie sind über viele Releases von Hand
fortgeschrieben worden — jedes Mal ein paar dazu, nie nachgezählt. **Eine Zahl,
die nur durch Fortschreiben entsteht, ist keine Messung**, auch wenn sie in
einer Tabelle mit lauter geprüften Werten steht.

Die Zeile nennt die drei Bestandteile jetzt getrennt. Was aus verschiedenen
Läufen stammt, wird nicht mehr zu einer Summe verrührt, die niemand prüfen kann.

## Was der Vertrag prüft — und was nicht

Er zählt die `it(…)`-Fälle der zugeordneten Testdateien und vergleicht mit der
Zahl vor „Real-DB-Fälle". Übersprungene Fälle zählen nicht mit: Ein `it.skip`
ist keine Zusage.

Gezählt wird der **Quelltext**, nicht ein Lauf. Das ist bewusst die schwächere
Aussage: Behauptet wird ja die *Anzahl* der Fälle, nicht ihr Ergebnis. Ob sie
bestehen, sagt der Vertrag aus Release 1.39 gegen die Manifeste.

Zwei Verträge, zwei Fragen — und beide beantworten sie an der Quelle statt aus
dem Gedächtnis.

## Ehrlich offen

- **Die Zuordnung Modul → Testdateien steht als Liste im Test.** Wer eine neue
  Real-DB-Datei anlegt und sie dort vergisst, fällt nicht auf. Der Vertrag
  schützt vor Drift in den Zahlen, nicht vor Vergesslichkeit beim Erweitern
- Die Zahl der übersprungenen Fälle in `STATUS.md` bleibt ungeprüft
- Die Zahlen in `docs/QA.md` selbst — die Checkpoints je Release — sind ebenfalls
  handgepflegt. Sie sind historisch und werden nicht fortgeschrieben, was das
  Risiko kleiner macht, aber nicht null
- Kein Export- oder Archivweg für `usage_events`
- Kein Deployment-Weg für Function-Images, keine authentifizierte Registry
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
