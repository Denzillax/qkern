# Release 2.55.0 – Die eigene Sicht

Drei Flächen, die bisher Platzhalter waren, und ein Sammler, der jetzt von
selbst läuft. Dazu eine Darstellung, die der Person gehört und nicht dem
Browser.

## Was neu ist

- Ansicht Einstellungen, Darstellung: Sprache, Zahlenformat, Zeitzone, Startseite und Thema liegen je Person in der Datenbank und wirken in der ganzen Console.
- Ansicht Logs, Explorer: eine strukturierte Suche über die drei Quellen, für die es eine Leseroute gibt, mit einem ausdrücklichen Satz über die, für die es keine gibt.
- Der Sammler der Log-Drains läuft als Prozess und merkt sich seinen Stand in der Datenbank. Ein Neustart wiederholt höchstens eine Ladung; er verliert keine.
- PostgreSQL-Zertifizierung von 198 auf 201 Fälle, lokale Suite von 2013 auf 2088.

## Drei Befunde, die man wissen sollte

- **Der Explorer bekommt kein freies SQL, und das ist eine Entscheidung.** Alle log-artigen Zeilen von QKERN liegen in der Control Plane, wo die Zeilen aller Organisationen in denselben Tabellen stehen. Eine Abfragefläche darüber hinge mit jeder Zeile an einer einzigen Policy. Der SQL-Editor der Console läuft in der Projektdatenbank, und das bleibt so.
- **Ein Zeitpunkt aus Postgres war nicht der, für den ihn der Code hielt.** `timestamptz::text` schreibt den Versatz zweistellig, wenn er auf volle Stunden fällt. Der Explorer hielt `+00` für eine Zeit ohne Zone, hängte ein `Z` an und erzeugte ein ungültiges Datum. Die Quelle warf, der Fächer meldete sie als nicht erreichbar, und die gemischte Liste zeigte stumm die Hälfte.
- **Ein zertifizierter Fall kann seine eigene Kopie belegen.** Der Fall zum Explorer baute sich eigene Lesungen nach, weil er die Route ohne HTTP nicht betreten konnte. Der Filter `authStatus` stand damit zweimal da: einmal in der Route, einmal gar nicht. Beide waren grün. Die Lesungen liegen jetzt in einer Datei, und der Fall setzt nur noch die Tür ein.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 201/201, exit 0 | `docs/evidence/2026-09-27/welle7-run1.manifest.json` |
| PostgreSQL 17, 201/201, exit 0 | `docs/evidence/2026-09-27/welle7-run2.manifest.json` |
| Mutation Zeitpunkt des Explorers, exit 1 | `docs/evidence/2026-09-27/welle7-mutation-moment.manifest.json` |
| Mutation Stand des Sammlers, exit 1 | `docs/evidence/2026-09-27/welle7-mutation-cursor.manifest.json` |
| Mutation Darstellung, exit 1 | `docs/evidence/2026-09-27/welle7-mutation-display.manifest.json` |
| Vitest lokal 2088/2088, exit 0 | `docs/evidence/2026-09-27/welle7-local-run1.manifest.json` |
| Vitest lokal 2088/2088, exit 0 | `docs/evidence/2026-09-27/welle7-local-run2.manifest.json` |

## Nachtrag zum Verfahren

Ein Lauf der lokalen Suite ist rot geworden, und zwar durch die eigene
Maschine: Er lief gleichzeitig mit dem Docker-Stack, und zwei Vertragstests,
die jedes archivierte Manifest von der Platte lesen, sind in ihr Budget von
30 Sekunden gelaufen. Das Budget wurde nicht erhöht und keine Erwartung
abgeschwächt. Der Lauf wurde allein wiederholt und war grün, und das ist der
Lauf, der hier als Beleg steht. Die Lehre gehört ins Verfahren, nicht in den
Test: Zwei schwere Läufe nebeneinander messen nicht mehr das Produkt.

## Ehrlich offen

- **Der Drain liefert mindestens einmal, nicht genau einmal.** Ein Absturz zwischen Einreihen und Festschreiben wiederholt eine Ladung.
- **Der Puffer wird bei SIGTERM nicht geleert.** Was im Speicher liegt, geht beim Beenden verloren und wird beim nächsten Lauf neu gelesen.
- **Ein Objektname kann persönliche Angaben enthalten** und geht trotzdem über einen Drain hinaus, weil die Console ihn zeigt.
- **Gespeicherte Suchen des Explorers liegen nur im Browser.** Sie verlassen das Gerät nicht und werden mit niemandem geteilt, auch nicht mit dem zweiten Gerät derselben Person.
- **Vier Log-Seiten haben weiterhin kein Backend**: Postgres, Pooler, Realtime und API-Gateway. Der Explorer tut nicht so, als hätte er ihre Zeilen.
- **Im Browser nicht gesehen.** Die drei neuen Ansichten sind angemeldet nie betrachtet worden.
