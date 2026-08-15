# Release 1.64.0 — Der Pool war leer, nicht die Warteschlange

Release 1.63 hat einen Lastfall offen gelassen: einmal in drei Läufen
gescheitert, mit einem `PersistenceError` beim Einreihen, nicht erklärt. Er ist
jetzt erklärt, reproduziert und behoben — und dabei kam ein zweiter Fehler
heraus.

## Die Ursache

Keine Datenbank. `pg` meldet den Zeitablauf beim **Holen** einer Verbindung
ohne SQLSTATE; er fiel deshalb in den Sammelzweig von `mapPostgresError` und
wurde zu `PERSISTENCE_ERROR`. Der Queue-Dienst machte daraus ein
`QUEUE_CONFLICT`, die HTTP-Grenze eine **409 „Queue conflict"**.

Ein Aufrufer las damit: *jemand anderes war schneller*. Tatsächlich war die
Warteschlange in Ordnung, die Abfrage nie gelaufen, und der Prozess hatte mehr
gleichzeitige Arbeit angenommen, als sein Pool tragen kann.

Reproduziert mit einem Pool aus zwei Verbindungen und 100 ms Wartezeit:
165 von 180 Einreihungen abgewiesen, jede als `QUEUE_CONFLICT`.

## Der zweite Fehler

Beim Schreiben des Falls kam heraus, dass die Suche am Anfang fast jeder
Methode **ausserhalb** der Fehlerabbildung lag. Ein Infrastrukturfehler dort
verliess den Dienst als roher `RepositoryError`, obwohl sein Vertrag
`ProjectQueueError` zusagt.

Genau daran ist der neue Fall zuerst gescheitert: Der Fehler kam aus der Suche,
nicht aus dem Einreihen, und ging an `mapError` vorbei. Ein Fall, der die
Zusage prüft, hat die Lücke in derselben Zusage gefunden.

## Was jetzt gilt

- `ConnectionUnavailableError` mit Code `CONNECTION_UNAVAILABLE`, als
  wiederholbar gekennzeichnet. Klassifiziert wird beim Holen der Verbindung —
  dort ist eindeutig, was gescheitert ist, und nur dort geht es ohne
  Textvergleich am Treiberfehler.
- `QUEUE_UNAVAILABLE` im Queue-Dienst und **503** an der HTTP-Grenze.
- Suche und Auflistung laufen durch dieselbe Abbildung wie alles andere.

## Der Fall

Der Druck wird hergestellt, nicht abgewartet: ein Pool mit einer Verbindung und
50 ms Wartezeit. Vorher der Gegenbeweis — mit genug Verbindungen läuft derselbe
Aufruf durch —, sonst könnte der Fall auch einen kaputten Aufbau belegen.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Fehler beim Verbindungsholen wird wieder durchgereicht statt klassifiziert | **134 von 135** — genau der neue Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 135/135, exit 0 | `docs/evidence/2026-08-15/connection-pressure-run1.manifest.json` |
| PostgreSQL 135/135, exit 0 | `docs/evidence/2026-08-15/connection-pressure-run2.manifest.json` |
| Mutation 134/135 | `docs/evidence/2026-08-15/connection-pressure-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. 38 Migrationen.

## Ehrlich offen

- **Nur Project Queues meldet es truthgemäß nach aussen.** Storage, Generated
  Data API und Project Auth laufen durch dieselbe Transaktion und bekommen
  dieselbe Klassifikation, übersetzen sie aber noch nicht in eine eigene
  Antwort.
- **Der direkte `pool.query()`-Weg ist nicht erfasst.** Klassifiziert wird das
  Holen der Verbindung in der Tenant-Transaktion; wer den Pool ohne
  Transaktion benutzt, bekommt weiterhin den rohen Treiberfehler.
- **Wiederholt wird nichts von selbst.** Der Fehler ist als wiederholbar
  gekennzeichnet, aber kein Aufrufer wertet das aus.
- **Die Poolgrösse bleibt unverändert.** Dieses Release macht die Erschöpfung
  sichtbar, es verhindert sie nicht.
