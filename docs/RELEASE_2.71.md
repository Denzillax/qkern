# Release 2.71.0 – Nachbarn, Anwesenheit und ein Abonnement, das aufsetzen kann

Drei Schnitte, und wieder wiegen die Funde schwerer als die Funktionen. Einer
davon betrifft eine Fähigkeit, die seit Langem als fertig galt und im Betrieb
nie funktioniert hat.

## Was neu ist

- Eine GraphQL-Mutation gibt die Nachbarzeilen ihrer Zeilen zurück, zwei Ebenen tief, unter der Policy der Nachbartabelle.
- Presence überlebt einen Neustart und einen Instanzwechsel, mit einer Pacht statt eines Eintrags, der ewig bleibt.
- Ein abgerissenes Abonnement kann wieder aufsetzen und bekommt nachgereicht, was es verpasst hat.
- MCP und das SDK können upserten, und `storage:write` hat ein Werkzeug, das ihn braucht.
- PostgreSQL-Zertifizierung von 241 auf 249 Fälle, Realtime unter Production von 17 auf 19, lokale Suite von 2468 auf 2490.

## Ein Abonnement, das nie aufsetzen konnte

Der Change Feed gilt seit `1.57.0` als fertig und ist seit `2.69.0` auch unter
Production belegt. Ein abgerissenes `changes:`-Abonnement konnte trotzdem nie
wieder aufsetzen, aus zwei Gründen, die sich gegenseitig verdeckt haben:

- **Sein Cursor kam aus einer Tabelle, in die dieser Weg nie schreibt.** Er stand also immer auf null.
- **Eine Änderungsnachricht trug gar keinen signierten Cursor**, mit dem ein Client einen hätte bauen können.

Dazu zwei weitere Fehler aus derselben Ecke: Verliess der letzte Abonnent
einen Bereich, stoppte der Poller, und der nächste begann bei null und stellte
jede noch aufbewahrte Zeile des Feeds als lebend zu. Und zwischen Nachreichen
und Livebetrieb gab es keine Ordnungszusage, weil das Nachreichen ohne
Kanalsperre lief.

Jetzt reicht ein Abonnement ab seiner Position nach, mit harten Grenzen an
Zeilen und Alter, die geschlossen fallen. **Jede nachgereichte Zeile geht durch
dieselbe Lesung wie im Livebetrieb**, mit den Ansprüchen dieses Abonnenten.
Der Feed hält ohnehin nur Primärschlüssel, also gibt es gar keinen zweiten Weg.
Die Mutationsprobe, die diese Lesung übergeht, lässt prompt die Zeile eines
anderen Nutzers durch.

## Anwesenheit mit Ablauf

Presence lag im Prozessspeicher und verliess ihn nie. Jetzt liegt sie in einer
Tabelle, der Schnappschuss beim Abonnieren ist instanzübergreifend, und eine
Änderung meldet derselbe Kanal ohne Inhalt, worauf die empfangende Instanz
frisch liest.

Die unangenehme Frage war die nach der Verbindung, die ohne Abmeldung
verschwindet. Die Antwort ist eine Pacht in zwei Stufen. Der Prozess mit der
Verbindung erneuert sie alle 15 Sekunden, eine fremde Instanz darf das nicht.
Nach 90 Sekunden endet die **Sichtbarkeit**, und derselbe Takt stellt das als
Austritt zu, auch in einem Kanal, in dem sonst nichts mehr passiert. Ohne
diesen Teil wäre eine Waise dort für immer sichtbar geblieben. Zehn Minuten
später fällt die **Zeile**, häppchenweise, wie die anderen Aufräumer.

## Nachbarn, und eine Zahl, die gegen die zweite Ebene spricht

Nach einem Einfügen, Ändern oder Upsert trägt `records` dieselben Einbettungen
wie eine Lesung, in derselben Transaktion und mit denselben Ansprüchen.
Geschrieben wird über keine Beziehung.

Die zweite Ebene gibt es nur in Richtung `one`, und das ist gerechnet, nicht
geschätzt:

| | Abfragen | Zeilen je Anfrage |
| --- | --- | --- |
| eine Ebene | 4 | 6100 |
| zweite Ebene als `one` | 7 | 12 100 |
| zweite Ebene als `many` | 7 | **120 000** |
| dritte Ebene als `many` | 10 | 8000 je Wurzelzeile |

120 000 Zeilen aus einer achtwortigen Anfrage sind das Zwanzigfache der
heutigen Obergrenze, also wird `many` auf der zweiten Ebene abgewiesen.

Über Schemagrenzen geht es, aber die Nachbartabelle muss durch dieselbe Tür wie
eine Basistabelle: Zeilensicherheit, kein Besitz ohne `FORCE`, Leserecht. Die
Probe, die diese Tür entfernt, holt prompt eine Zeile aus einer Tabelle ohne
Zeilensicherheit im Nachbarschema.

**Ein Fehler, den der Kommentar seit `2.66.0` falsch beschrieb**: Eine Tabelle,
die auf sich selbst zeigt, sollte als mehrdeutig fallen. Sie fiel nicht,
sondern lief still als Einzelbeziehung, obwohl nicht entscheidbar ist, ob der
Elternknoten oder die Kinder gemeint sind.

## MCP, SDK und ein Werkzeug für `storage:write`

Upsert geht jetzt auch über MCP und das SDK, über denselben Dienst und ohne
zweite Prüfung des Konfliktschlüssels. **Ein echter Fehler dabei**: Der
Fehlercode für einen unbekannten Konfliktschlüssel war am MCP-Werkzeug nicht
bekannt, und ein unbekannter Code wird dort zu „die Data API ist nicht
verfügbar". Ein Agent hätte einen Fehler seiner eigenen Anfrage als Ausfall
gelesen und wiederholt.

`2.69.0` hatte `storage:write` bewusst weggelassen, weil kein Werkzeug ihn
geprüft hätte. Jetzt gibt es eines, und es ist ein **Löschen**, kein Hochladen:
Ein Upload ist Reservierung, Bytes beim Anbieter, Abschluss mit Prüfsumme und
Scan; ein Werkzeug, das die Bytes annimmt, schiebt bis zu fünf Gigabyte durch
den Modellkontext und lässt das Modell die Prüfsumme beglaubigen, die der
Abschluss vergleicht.

Und die offene Sorge aus `2.69.0` ist beantwortet: Das Löschwerkzeug läuft über
OAuth als der **zustimmende Nutzer**, nicht als Betreiber, damit greift die
Schreibregel des Buckets je Objekt. Die lesenden Werkzeuge bleiben beim
Betreiber, und das steht weiter als offen.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 249/249, exit 0 | `docs/evidence/2026-10-01/welle23-run2.manifest.json` |
| PostgreSQL 17, 249/249, exit 0 | `docs/evidence/2026-10-01/welle23-run3.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL, 19/19, exit 0 | `docs/evidence/2026-10-01/welle23-realtime.manifest.json` |
| versitygw und ClamAV, 11/11, exit 0 | `docs/evidence/2026-10-01/welle23-storage.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 33/33, exit 0 | `docs/evidence/2026-10-01/welle23-functions.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-10-01/welle23-auth.manifest.json` |
| Mutation der Aufräumer lässt verwaiste Presence stehen, exit 1 | `docs/evidence/2026-10-01/welle23-mutation-presenceprune.manifest.json` |
| Mutation die Tiefengrenze steht auf drei, exit 1 | `docs/evidence/2026-10-01/welle23-mutation-embeddepth.manifest.json` |
| Mutation das Nachreichen prüft die Zeilensicherheit nicht erneut, exit 1 | `docs/evidence/2026-10-01/welle23-mutation-replayrls.manifest.json` |
| Vitest lokal 2490/2490, exit 0 | `docs/evidence/2026-10-01/welle23-local-run1.manifest.json` |
| Vitest lokal 2490/2490, exit 0 | `docs/evidence/2026-10-01/welle23-local-run2.manifest.json` |

## Nachtrag zum Verfahren

**Eine Probe fiel nicht, und das war der Fund.** Die Tiefengrenze der
Einbettungen von zwei auf drei zu setzen änderte an 249 Fällen nichts. Sie wird
an fünf Stellen im Quelltext durchgesetzt und war von keinem Fall gehalten;
„höchstens zwei Ebenen" war eine Behauptung.

**Und beim Schliessen dieser Lücke habe ich zweimal denselben Fehler gemacht,
den ich sonst bei anderen finde.** Der erste Entwurf der fehlenden Zusage
benutzte eine Spalte, die es im Testschema gar nicht gibt; die Anfrage wäre
gefallen, aber wegen einer unbekannten Beziehung statt wegen der Tiefe. Der
zweite erwartete den falschen Mechanismus: Abgewiesen wird die dritte Ebene von
der GraphQL-Grammatik, nicht von der Data API, weil beide Grenzen sich aus
derselben Zahl ableiten und das Dokument zuerst geschnitten wird. Er fiel
darum auch auf dem gesunden Stand. Der Fall nennt jetzt die Sperre, die
wirklich greift, und begründet, warum die andere nicht gefragt wird.

## Ehrlich offen

- **Die Beziehungen stehen nicht im SDL.** Ein Client-Codegenerator sieht sie nicht, weil sie zu nennen hiesse, eine Beziehung zu behaupten, deren Nachbartabelle der Aufrufer vielleicht nicht lesen darf.
- **Beziehungen in GraphQL-Abfragen gibt es weiterhin nicht**, nur in `records` von Mutationen. REST-Mutationen nehmen keine Einbettungen.
- **Presence zählt nicht unter den Nutzungsmetriken**, und eine Verbindung steht in keiner Tabelle. Kein Soak mit Presence, keine Messung der zusätzlichen Kosten.
- **Der Presence-Aufräumer läuft nur mit konfigurierter Aufbewahrung.** Ohne sie sammeln sich Waisen: unsichtbar, aber vorhanden.
- **Die lesenden Storage- und Queue-Werkzeuge laufen über MCP weiter als Betreiber.** Die HTTP-Türen von Storage nehmen kein OAuth-Token an.
- **Die Console ist weiterhin ungesehen**, weil sie hinter der Anmeldung liegt.
