# Release 1.30.0 — Transaktionale Messung

> Datum: 6. August 2026 · Vorgänger: `1.29.0`

## Wofür dieses Release steht

Release 1.29 hat die Usage-Emitter angebunden und dabei selbst notiert, was noch
fehlte: Das Ereignis entstand in einer **eigenen** Transaktion, nicht in der der
Operation. Zwischen Zählung und Schreiben lag ein Fenster, in dem ein Absturz
eine Nachricht zählte, die es nie gab.

Ab jetzt gilt beides zusammen oder keines von beidem.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **95 von 95 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 3 gegen echtes PostgreSQL |
| Mutationsprobe Welle 1 | zurück auf 1.29 (messen davor) → genau 2 Fälle fallen um |
| Mutationsprobe Welle 2 | Zeilensperre des Monatszählers entfernt → 1 Fall fällt um |
| Vitest lokal | 960 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Eine Transaktion, zwei Schreibvorgänge

`consume`, `record` und `admit` nehmen jetzt eine laufende Transaktion entgegen.
`ProjectQueueRepository.enqueue` erhält dafür einen `ProjectQueueMeter`, den der
PostgreSQL-Adapter **innerhalb** seiner Transaktion ruft: nach dem Schreiben der
Nachricht, vor dem Festschreiben.

Lehnt die Messung ab, rollt die bereits geschriebene Nachricht mit zurück.

Dass das überhaupt geht, hängt an einer Eigenschaft, die das Ledger schon hatte:
Alle seine Sperren sind transaktionsgebunden — `pg_advisory_xact_lock` und
`FOR UPDATE`. Sie enden mit der Transaktion, in der sie genommen wurden, der
eigenen wie der fremden. Ein Ledger mit Session-Sperren hätte diese Änderung
nicht zugelassen.

Die Messung steht dabei **hinter** den Konflikten der Operation. Eine wegen
voller Warteschlange abgewiesene Nachricht verbraucht kein Kontingent — bis 1.29
zählte sie trotzdem.

## Der Function-Aufruf bleibt, wie er war

Er schreibt nichts in die Control Plane, mit dem er atomar sein könnte. Ein
Container startet oder startet nicht; es gibt keine zweite Zeile, die mit der
Zählung gemeinsam stehen oder fallen müsste. Dort bleibt es bei der Reihenfolge:
erst messen, dann starten.

Das ist keine Lücke, sondern die richtige Antwort auf eine andere Frage.

## Der Fall, der grün war, ohne etwas zu tragen

Der lehrreichste Teil dieses Releases steht in der Mutationsprobe.

Die zweite Welle entfernte die Zeilensperre auf dem Monatszähler — die Zeile,
die verhindert, dass zwei gleichzeitige Buchungen denselben Stand lesen und ihn
absolut zurückschreiben. Erwartet war, dass der neue Nebenläufigkeitsfall
umfällt.

**Es fiel nichts um.**

Der Fall hiess „acht gleichzeitige Enqueues" und benutzte eine einzige Queue.
Enqueues derselben Queue serialisieren aber ohnehin auf deren Zeile
(`lockQueue` nimmt sie `FOR UPDATE`) und erreichen den Monatszähler nie
gleichzeitig. Der Fall war grün — und wäre es auch ohne die Zusage geblieben,
die er zu belegen schien.

Mit vier Queues statt einer treffen vier Transaktionen wirklich auf denselben
Zähler, und ohne die Sperre fällt der Fall sofort um.

Dabei kam ein zweiter, unbequemer Befund heraus: Auch der ältere Fall
„serializes concurrent hard-quota decisions" aus `usage-metering-postgres`
bleibt ohne die Zeilensperre grün. Er trägt seine Aussage nicht selbst. Die
beiden gleichzeitigen Buchungen laufen dort in ein frisches Projekt, und der
`ON CONFLICT DO NOTHING`-Einschub in `usage_counters` serialisiert sie über den
Unique-Index — ein Nebeneffekt der ersten Einfügung, nicht die geprüfte Sperre.

Die Sperre ist im Betrieb nötig. Belegt hat sie erst der neue Fall.

Das ist genau der Grund, warum die Mutationsprobe seit Release 1.20 zu jedem
Slice gehört: Ein grüner Fall beweist nichts, solange nicht gezeigt ist, dass er
auch rot werden kann. Diesmal hat die Probe nicht das Produkt korrigiert,
sondern den Test.

## Ehrlich offen

- **Kein Crash-Lauf.** Die Atomarität ist über einen Rollback belegt, nicht über
  einen echten Prozessabbruch mitten in der Transaktion
- Der ältere Concurrency-Fall in `usage-metering-postgres` bleibt so stehen, wie
  er ist. Er ist nicht falsch, er trägt nur weniger, als sein Name verspricht —
  wer ihn schärft, sollte den Zähler vorher anlegen
- Generated Data API, Storage und Realtime melden weiterhin nicht
- Kein Abgleich mit Providerwerten, keine Last-Läufe des Messpfads
- Weder Preise noch Tarife noch Rechnungen
- Kein Deployment-Weg für Function-Images
- Die Nebenläufigkeitsgrenze der Functions ist prozesslokal, nicht clusterweit
- SDK und CLI sind nur auf Linux belegt
