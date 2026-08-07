# Release 1.39.0 — Zahlen prüfen sich

> Datum: 6. August 2026 · Vorgänger: `1.38.0`

## Wofür dieses Release steht

`STATUS.md` nennt sich selbst „Teil der Definition of Done". Der bestehende
Doku-Vertrag prüft dort Zeichenketten und abgeleitete Dateinamen — aber **keine
einzige Zahl**.

Aufgefallen ist das an der eigenen Zeile. Über ein Dutzend Releases hinweg stand
dort:

> Vitest (Windows) | 951 bestanden, 138 übersprungen, 0 fehlgeschlagen

Zu diesem Zeitpunkt waren es 987 und 173. Nichts hat angeschlagen.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Neue Fälle | 2 lokal, beide Vertragstests |
| Mutationsprobe | Behauptung verfälscht und alte Zeile zurückgeholt → beide Fälle fallen um |
| Vitest lokal | 989 bestanden, 0 fehlgeschlagen |
| Zertifizierungsläufe | **nicht wiederholt** — siehe unten |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Dieselbe Lücke, eine Ebene höher

Neunzehn Releases lang hat dieser Sprint eine Frage gestellt: *Ist diese Zusage
wirklich belegt, oder sieht sie nur so aus?* Sechsmal war die Antwort „gebaut,
zertifiziert und trotzdem wirkungslos".

Der Doku-Vertrag ist genau derselbe Fall. Er existiert, er ist grün, und er
prüft nicht, was zählt. Ein Test, der die Anwesenheit einer Zeichenkette
bestätigt, sagt nichts über die Wahrheit der Zahl in derselben Zeile.

## Was jetzt geprüft wird

**Jede Zertifizierungszahl muss durch ein archiviertes Manifest gedeckt sein.**
Der Vertrag vergleicht mit dem **Maximum der grünen Läufe** eines Stacks. Die
Suiten wachsen; das Maximum ist damit der jüngste Stand. Schrumpft eine Suite
wirklich einmal, verlangt der Vertrag eine bewusste Bearbeitung — und das ist
richtig so.

Zusätzlich muss „X von Y" mit X gleich Y stehen. Ein roter Lauf, als grün
ausgegeben, fällt damit ebenfalls auf.

**Keine Zahl ohne möglichen Beleg.** Die lokale Vitest-Zeile trägt keine
absoluten Werte mehr, sondern verweist auf die Checkpoints in `docs/QA.md`. Eine
Zahl, die niemand prüfen kann, ist schlechter als keine: Sie sieht aus wie eine
Messung.

## Zum ersten Mal kein Zertifizierungslauf

Seit Release 1.20 gilt hier: zweimal grün gegen echte Dienste, **vor** dem
Commit. Dieses Release weicht davon ab, und das gehört ausgesprochen.

Es ändert keine einzige Zeile Produktcode — nur zwei Testdateien und
Dokumentation. Ein Container-Stack würde exakt dieselben Zahlen liefern wie in
`1.38.0`, und genau diese Zahlen prüft der neue Vertrag jetzt gegen die
archivierten Manifeste. Ein Lauf zur Zeremonie hätte nichts belegt, was nicht
schon belegt ist.

Die Regel bleibt für jede Änderung an Produktcode oder Adaptern bestehen.

## Ein Test, der selbst kaputt war

Der erste Entwurf baute den Suchausdruck aus einer Vorlage zusammen — mit
Escapes, die beim Schreiben der Datei verloren gingen. Der Test lief grün gegen
ein Muster, das nichts fand, und rot gegen das nächste.

Er sucht jetzt zeilenweise und benutzt ein festes Regex-Literal. Ein Ausdruck,
den erst eine Vorlage erzeugt, ist eine Fehlerquelle mehr in einem Test, der
Fehler finden soll.

## Ehrlich offen

- **Der Vertrag prüft die Zahl, nicht die Aktualität.** Ein grünes Manifest von
  gestern deckt eine Behauptung von heute, solange die Zahl stimmt; der Commit
  im Manifest wird nicht gegen den aktuellen Stand geprüft
- Die Zuordnung von Behauptung zu Stack steht als Liste im Test und ist damit
  selbst handgepflegt. Sie fällt aber **laut** aus, wenn ein Stack fehlt — anders
  als vorher, wo gar nichts auffiel
- Die übrigen Zahlen in `STATUS.md` bleiben ungeprüft: die Real-DB-Fälle je
  Modul und die Zahl der übersprungenen Fälle
- Kein Export- oder Archivweg für `usage_events`
- Kein Deployment-Weg für Function-Images, keine authentifizierte Registry
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
