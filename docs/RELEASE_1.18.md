# Release 1.18.0 — Cron mit Persistenz und Scheduler

> Datum: 5. August 2026 · Vorgänger: `1.17.0`

## Wofür dieses Release steht

`CronDispatcher` existiert seit Release 1.6 Alpha 4, aber seine Definitionen
kamen aus dem Nichts: Es gab keinen Ort, an dem ein Betreiber einen Zeitplan
hinterlegen konnte, und keinen Fortschritt, an dem ein Scheduler ansetzen
könnte. Cron war ein Vertragsport ohne Betrieb.

Dieses Release ergänzt Persistenz und Scheduler — und deckt dabei auf, dass das
Nachholen verpasster Vorkommen nie funktionieren konnte.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **57 von 57 bestanden**, exit 0, 13 Testdateien, 31 Migrationen |
| Reproduzierbarkeit | zweimal grün — erst nach einer Korrektur, siehe unten |
| davon Cron gegen echtes PostgreSQL | 5 Fälle |
| Vitest lokal | 792 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Der Produktfehler

`CronDispatcher` reichte den Vorkommenszeitpunkt als **Zustellzeit** an die
Queue weiter. Die Queue akzeptiert höchstens fünf Minuten Rückdatierung — ein
nachzuholendes Vorkommen nach einem Ausfall ist älter und wurde ausnahmslos mit
`QUEUE_INVALID_INPUT` abgewiesen.

Damit konnte Catch-up nie funktionieren. Im Normalbetrieb fiel das nicht auf:
Ein Scheduler, der alle 30 Sekunden läuft, bemerkt ein Vorkommen wenige
Sekunden nach der Grenze und bleibt im Fenster. Erst der Ausfall — also genau
der Fall, für den Catch-up existiert — fällt.

Der Fix ist eine Auslassung: Der Dispatcher reicht **kein** `scheduledAt` mehr
weiter. Ein Vorkommen ist fällig, wenn es ausgelöst wird; die Nachricht soll
sofort verfügbar sein. Die Identität des Vorkommens steckt im Dedupe-Key, nicht
in der Verfügbarkeit.

Der vorhandene Test hielt das fehlerhafte Verhalten per Assertion fest — dieselbe
Situation wie beim Harness-Test in Release 1.9. Er prüft jetzt ausdrücklich,
dass **kein** `scheduledAt` gesetzt wird.

## Bewusst ohne Lease

Der Dispatcher enqueuet mit dem Dedupe-Key `cron:<id>:<zeitpunkt>`. Zwei
Instanzen, die dasselbe Vorkommen auslösen, erzeugen genau eine Nachricht. Die
Queue ist bereits die Autorität für Einmaligkeit, und die ist seit Release 1.17
über sechs konkurrierende Instanzen zertifiziert.

Eine zweite Autorität daneben wäre eine zusätzliche Fehlerquelle ohne
zusätzliche Garantie. `last_dispatched_at` ist deshalb **Fortschritt, keine
Sperre**. Ein Zertifizierungsfall fährt genau das: vier Scheduler lösen
gleichzeitig dasselbe Vorkommen aus, und es entsteht exakt eine Nachricht.

## Begrenztes Nachholen

Ohne Grenze würde ein Scheduler nach einem Tag Ausfall bei Minutentakt über 1400
Nachrichten auf einmal auslösen. Ein Betreiber will fast nie den vollständigen
Rückstand — er will, dass es wieder läuft. Der Standard sind fünf Vorkommen je
Durchlauf.

Eine frisch angelegte Definition arbeitet die Vergangenheit nicht auf, sondern
läuft ab dem nächsten Grenzzeitpunkt.

## Invarianten in der Datenbank

Zwei Zusicherungen liegen im Trigger, nicht im Code, damit auch ein zweiter
Schreiber sie nicht umgehen kann: Der Fortschritt darf nicht zurückspringen —
ein Rücksprung würde vergangene Vorkommen erneut auslösen, und das
Dedupe-Fenster der Queue ist endlich. Und die Identität einer Definition ist
unveränderlich.

Ausdruck, Queue und Payload sind nicht einmal per Grant änderbar. Eine Änderung
läuft über Löschen und Neuanlegen und damit über den Audit-Weg.

## Stufenwirkung

**Stufe 1.6 bleibt offen.** Das Austrittskriterium verlangt Egress-Policy,
Ressourcenlimits, Idempotenz, Dead Letters, Retry und Secret-Canary-Tests ohne
gemeinsame Ausführungsautorität.

Erbracht sind jetzt Idempotenz, Dead Letters, Retry über mehrere Instanzen und
ein betriebsfähiger Cron. Es fehlen Functions-Sandbox und Webhook-Zustellung —
beide weiterhin nur interne Vertragsports ohne Laufzeit.

## Eine falsche Behauptung im ersten Commit

Der Release-Commit behauptete „zweimal reproduziert", während der
Bestätigungslauf noch lief. Er fiel dann rot aus: Der Nebenläufigkeitsfall aus
Release 1.14 mit zwölf Abonnenten und 432 einzeln RLS-geprüften Lesevorgängen
überschritt unter voller Parallelität Vitests Standardgrenze von fünf Sekunden.

Kein Produktfehler — die Laufzeit dieses Falls skaliert naturgemäß mit
Abonnenten mal Änderungen, und er hatte nie eine eigene Grenze bekommen. Er hat
jetzt eine. Danach zwei grüne Läufe in Folge.

Die Lehre ist unangenehm und gehört hierher: Ein Release zu schneiden, während
der Bestätigungslauf noch läuft, heißt eine Aussage zu treffen, die man nicht
belegt hat. Genau das kritisiert dieser Sprint seit Release 1.9 an anderer
Stelle.

## Ehrlich offen

- Functions-Sandbox und Webhook-Outbox: nur Vertragsports
- Kein Prozess ruft den `CronScheduler` auf; er ist eine Bibliothek, keine
  `workers/`-Runtime
- Keine API und keine Console-Fläche zum Anlegen von Cron-Definitionen; sie
  entstehen derzeit nur über direkten Datenbankzugriff
- Kein startbarer Handler-Host für Queues
- Kein Scheduler für die beiden Realtime-`prune`-Pfade
