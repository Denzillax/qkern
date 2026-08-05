# Release 1.17.0 — Queues über mehrere Instanzen

> Datum: 5. August 2026 · Vorgänger: `1.16.0`

## Wofür dieses Release steht

`STATUS.md` führte für Project Queues seit Release 1.6 denselben Vorbehalt:
„Multi-Instance und Last nein". Die vorhandene Zertifizierung fuhr fünf Fälle
über **eine** Service-Instanz — genug für Persistenz und Lease-Fencing im
Einzelbetrieb, nicht genug für die Aussage, dass mehrere Instanzen sich korrekt
koordinieren.

Dieses Release erbringt den Nachweis.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **52 von 52 bestanden**, exit 0, 12 Testdateien |
| davon Queues über mehrere Instanzen | 6 Fälle |
| Vitest lokal | 779 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Die sechs Fälle

Jede Instanz bekommt einen eigenen Verbindungspool, ein eigenes Repository und
einen eigenen Service. Koordination kann ausschließlich über PostgreSQL laufen;
es gibt keinen gemeinsamen Speicher, über den ein Claim sonst abgestimmt werden
könnte.

- **Claim-Disjunktheit unter Last**: 180 Nachrichten, sechs gleichzeitig
  claimende Instanzen. Keine Nachricht gehört zwei Workern, und die Zahl der
  `in_flight`-Zeilen entspricht exakt der Zahl der Claims.
- **Genau ein Gewinner**: acht Instanzen greifen im selben Moment nach einer
  einzigen Nachricht.
- **Fencing eines verschwundenen Workers**: Solange die Lease läuft, übernimmt
  niemand. Nach echtem Ablauf übernimmt der Nachfolger, und das alte Token ist
  tot, auch wenn der Verschwundene zurückkehrt.
- **Retry-Autorität beim Server**: vier Instanzen lassen ihre Claims gleichzeitig
  scheitern; der Versuchszähler kommt aus der Datenbank, nicht vom Worker.
- **Kapazitätsgrenze unter Nebenläufigkeit**: fünf Instanzen versuchen 50
  Nachrichten in eine Queue mit Grenze 20; die Grenze hält, und der
  Datenbankstand entspricht genau den angenommenen Nachrichten.
- **Dedupe über Instanzgrenzen**: sechs Instanzen mit demselben
  Idempotenzschlüssel gleichzeitig; genau eine Nachricht entsteht.

## Kein Produktfehler

Anders als bei Realtime in den Releases 1.9 bis 1.13 hat dieser Slice **keinen
einzigen Produktfehler** offengelegt. Alle drei Fehlschläge lagen in meinen
Testparametern: ein Claim-Stapel über der erlaubten Grenze von zehn, ein
Umgehungsversuch am Trigger vorbei, und ein Timeout unter der benötigten
Wartezeit.

Der durable Queue-Adapter wurde in Release 1.9 einmal gründlich repariert —
fehlendes `UPDATE`-Recht und fehlende UPDATE-Policy für
`SELECT … FOR UPDATE` — und hält seitdem.

## Eine bestätigte Zusicherung

Der zweite Fehlschlag ist erwähnenswert: Ich wollte die Lease per direktem
`UPDATE` vorzeitig ablaufen lassen, um sechs Sekunden Wartezeit zu sparen. Der
Trigger `project_queue_messages_update_guard` hat das abgewiesen — **auch für
den Owner-Zugang**.

Zustandsübergänge sind damit auf Datenbankebene gesichert, nicht nur in der
Anwendungslogik. `STATUS.md` behauptete „Trigger-gesicherte Übergänge" seit
Release 1.6; jetzt ist belegt, dass die Zusicherung auch gegen einen
privilegierten Zugang hält. Der Test beugt sich ihr und wartet die echte Zeit ab,
statt sie zu umgehen.

## Stufenwirkung

**Stufe 1.6 bleibt offen.** Ihr Austrittskriterium verlangt Egress-Policy,
Ressourcenlimits, Idempotenz, Dead Letters, Retry und Secret-Canary-Tests ohne
gemeinsame Ausführungsautorität — also auch Functions-Sandbox, Cron und
Webhook-Zustellung. Diese sind weiterhin nur interne Vertragsports ohne
Laufzeit.

Erbracht sind jetzt Idempotenz, Dead Letters und Retry über mehrere Instanzen.
Der Rest fehlt.

## Ehrlich offen

- Functions-Sandbox, Cron-Scheduler und Webhook-Zustellung: nur Vertragsports
- Kein startbarer Handler-Host; der Worker bleibt ein injizierbarer
  Ausführungsport
- Kein externer Queue-Metrics-Export
- Alle Instanzen dieses Nachweises laufen im selben Betriebssystemprozess; ein
  echter Prozessabsturz ist nicht geprüft
- Kein Scheduler für die beiden Realtime-`prune`-Pfade
