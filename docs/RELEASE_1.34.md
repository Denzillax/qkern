# Release 1.34.0 — Änderungen zählen mit

> Datum: 6. August 2026 · Vorgänger: `1.33.0`

## Wofür dieses Release steht

Release 1.33 hat die letzte Metrik angeschlossen und zwei Punkte offen
ausgewiesen. Dieses Release schliesst beide.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **101 von 101 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Soak mit Emitter | Stillstandsschranken eingehalten, 5 Buchungen für 120 Nachrichten |
| Soak-Latenz | p95 zwischen 421 und 1846 ms über vier Läufe — Streuung überdeckt den Effekt |
| Mutationsprobe | Emitter aus dem Soak-Lauf, Zählung je Abonnent → je ein Fall fällt um |
| Vitest lokal | 976 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Der halbe Weg, der gemessen wurde

Bis 1.33 zählte nur `broadcast`. `deliverChanges` — der Weg, über den erfasste
Datenbankänderungen bei Abonnenten ankommen — zählte nicht.

Ein Projekt, das ausschliesslich `changes:`-Kanäle benutzt, hätte damit dauerhaft
null gezeigt. Das ist wieder dasselbe Muster wie in 1.29, nur eine Ebene tiefer:
nicht „niemand ruft es auf", sondern „es wird an einer von zwei Stellen
gerufen". Eine Metrik, die die Hälfte ihres Verkehrs nicht sieht, ist keine
Metrik.

Gezählt wird **einmal je zugestellter Änderung**, nicht je Abonnent — dieselbe
Regel wie beim Broadcast. Eine Änderung, die kein Abonnent sehen darf, und eine,
die niemand abonniert hat, zählen nicht: Es ist keine Nachricht entstanden, und
etwas zu berechnen, das nie ausgeliefert wurde, wäre die falsche Richtung.

## Gemessen statt angenommen

Release 1.33 hat die Bündelung mit der Latenz des Realtime-Pfades begründet und
im selben Atemzug eingeräumt, dass der Soak-Lauf ohne Emitter lief. Die
Begründung stand also da, ohne belegt zu sein.

Jetzt läuft der Soak mit eingeschaltetem Emitter, und der Flush-Schwellwert ist
mit 25 klein genug, dass während der Messung mehrfach wirklich in die Control
Plane geschrieben wird. Ein Lauf mit einem Schwellwert von 500 hätte bei 120
Nachrichten nie geschrieben und über genau die Frage nichts ausgesagt.

Vier Läufe auf derselben Maschine, im Abstand von Minuten:

| Lauf | Emitter | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| erster Lauf | ein | 359 ms | 421 ms | 456 ms |
| Basislinie | aus | 400 ms | 528 ms | 547 ms |
| run1 | ein | 1237 ms | 1846 ms | 1947 ms |
| run2 | ein | 1241 ms | 1716 ms | 1836 ms |

Nach den ersten beiden Läufen stand hier bereits der Satz „der Emitter ist nicht
messbar langsamer". Die beiden Wiederholungen haben ihn widerlegt — nicht, weil
der Emitter teuer wäre, sondern weil **zwei Läufe derselben Konfiguration
zwischen 421 und 1846 ms liegen**. Die Streuung ist rund viermal so gross wie
jeder Unterschied zwischen den Konfigurationen.

**Diese Messreihe kann die Kosten des Emitters also nicht isolieren, und das ist
das ehrliche Ergebnis.** Aus zwei Stichproben eine Aussage zu bauen, die drei
Stichproben umwerfen, wäre genau der Fehler, gegen den dieser Sprint seine
Mutationsproben fährt: eine Zahl, die überzeugend aussieht und nichts trägt.

Was der Lauf belegt: Der Soak hält seine Stillstandsschranken **mit**
eingeschaltetem Emitter ein, der Zählerstand entspricht exakt der Zahl
zugestellter Nachrichten, und fünf Buchungen für 120 Nachrichten zeigen, dass
wirklich gebündelt wurde.

Die früher dokumentierten 198 bis 333 ms stammen von einem anderen Tag und sind
mit diesen Zahlen ohnehin nicht vergleichbar.

## Eine Datei, zwei Aufgaben

Der Basislinien-Lauf ist zugleich die Mutationsprobe: Ohne Emitter im Soak fällt
genau die Zählerprüfung um, alles andere bleibt grün. Ein Lauf, der beides
belegt, ist ehrlicher als zwei, die dasselbe zweimal behaupten — er liegt als
`usage-changes-baseline.log` in der Evidenz.

## Ehrlich offen

- **Die Kosten des Emitters bleiben unbekannt.** Die Streuung zwischen Läufen
  überdeckt sie. Wer sie messen will, braucht eine ruhige Maschine und viele
  Wiederholungen je Konfiguration
- Die Messung gilt für 120 Änderungen auf einem Entwicklungsrechner. Sie zeigt
  Stillstandsfreiheit, **nicht** Verhalten unter Last
- Ein Lauf, der den Pufferverlust unter echtem Prozessabbruch zeigt, fehlt
  weiterhin
- `control_plane`, `project_auth` und `mcp` dürfen `api_requests` schreiben, tun
  es aber nicht
- Kein Abgleich mit Providerwerten
- Weder Preise noch Tarife noch Rechnungen
- Kein Deployment-Weg für Function-Images
- SDK und CLI sind nur auf Linux belegt
