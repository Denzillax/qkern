# Release 1.15.0 — Realtime in Betrieb

> Datum: 5. August 2026 · Vorgänger: `1.14.0`

## Wofür dieses Release steht

Release 1.14 hat die Änderungskette zertifiziert, aber den Lasttest offen
gelassen und einen Betriebsbefund benannt: Der Poller existierte, niemand rief
ihn auf.

Dieses Release liefert den Soak-Lauf, die Dauerschleife und die Vermittlung je
Projekt — und deckt dabei einen weiteren Fall derselben Art auf.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **46 von 46 bestanden**, exit 0, 11 Testdateien |
| Soak mit laufendem Poller | 120 Änderungen, p50 179 ms, **p95 224 ms**, max 233 ms (Wiederholung: p95 333 ms) |
| Vitest lokal | 770 bestanden, 70 übersprungen, 0 fehlgeschlagen, dreimal stabil |
| Strict TypeScript | grün |

## Der Soak-Lauf

Alle bisherigen Kettenfälle rufen `drain` explizit auf und messen deshalb keine
Zustelllatenz: Diese wird vom Pollintervall dominiert, das der Aufrufer
bestimmt. Der Soak-Lauf betreibt stattdessen `RealtimeChangePollerRuntime` mit
einem echten 100-ms-Intervall, während ein Schreiber über mehrere Sekunden 120
Zeilen anlegt. Gemessen wird von der bestätigten `INSERT`-Anweisung bis zur
Zustellung.

Hart geprüft werden Vollständigkeit, Reihenfolge und die Abwesenheit von
Rückstau und Fehlern. Die Latenzschranken (p95 unter 5 s, Maximum unter 15 s)
prüfen **Stillstandsfreiheit**, kein Leistungsversprechen: Die NFR-Zielwerte aus
`docs/QA.md` gelten für Broadcast in einer definierten Region, nicht für
CDC-Polling in einem Container auf einem Entwicklungsrechner. Die gemessenen
224 ms p95 sind ein Messwert dieser Umgebung, keine Zusage.

## Betrieb

`RealtimeChangePollerRuntime` betreibt einen Poller als Dauerschleife. Sie
wartet nur, wenn nichts zu tun war: Findet ein Lauf Änderungen, folgt der
nächste sofort, damit ein Rückstand nicht im Takt des Intervalls abgearbeitet
wird. Ein Fehler beendet die Schleife nicht, verlängert aber die Pause — die
Position wurde nicht fortgeschrieben, der nächste Lauf liest denselben Bereich
erneut. Ein Shutdown weckt eine laufende Wartezeit sofort, statt sie
auszusitzen.

`RealtimeChangePollerRegistry` startet je beobachtetem Projekt einen Poller und
beendet ihn wieder. Ohne diese Vermittlung müsste der Betrieb entweder **alle**
Projekte pollen oder **keines**. Ersteres belastet jede Projektdatenbank ohne
Anlass, auch die, in der niemand zuhört. Letzteres liefert Abonnenten stumm
nichts aus — der schlimmere Fall, weil die Funktion vorhanden aussähe.

`reconcile` ist idempotent und ereignisfrei gebaut: Ein verpasster Rückruf
ließe sonst einen Poller ewig laufen oder nie starten. Wird die Scope-Grenze
überschritten, scheitert es laut, statt einen Teil der Projekte stillschweigend
unbeliefert zu lassen.

## Ein weiterer Fall von „gebaut, nicht angeschlossen"

`workers/realtime-runtime.ts` verwendete weiterhin `MemoryRealtimeEventLog` —
obwohl der dauerhafte Adapter und der Fan-out-Bus seit Release 1.11 existieren
und zertifiziert sind. Ereignisse gingen bei jedem Neustart verloren und
erreichten keine zweite Instanz.

Der dauerhafte Log ist jetzt der Default; der Memory-Log nur noch hinter
`QKERN_REALTIME_EPHEMERAL_LOG=true`. Der Bus wird verbunden und beim Shutdown
geschlossen. Zwei Vertragstests halten fest, dass der Memory-Log nie stiller
Rückfall wird.

Damit sind in diesem und dem vorigen Release **zwei** zertifizierte Bausteine
gefunden worden, die nie in Betrieb genommen wurden. Das ist ein eigenes Muster
neben „nie gegen echte Dienste ausgeführt": etwas ist gebaut, belegt — und
trotzdem wirkungslos, weil niemand es aufruft.

## Ein flaky Test

Unter voller Suite fiel `project-queue-worker` einmal aus, isoliert dreimal
grün. Der Fall schlief 35 ms bei 10 ms Heartbeat und erwartete mindestens zwei
Lease-Erneuerungen — unter Last feuern Timer zu spät. Statt die Schranke zu
senken wartet der Handler jetzt, *bis* zweimal erneuert wurde. Die geprüfte
Aussage bleibt dieselbe und hängt nicht mehr an der Pünktlichkeit von Timern.

In einem Projekt, dessen ganze Aussage „grün heißt grün" ist, ist ein flaky Test
kein Schönheitsfehler.

## Stufenwirkung

**Stufe 1.5 Realtime ist abgeschlossen.**

Das Austrittskriterium verlangt Tenant-, Ordering-, Drop- und Lasttests gegen
echte Infrastruktur. Alle vier sind erbracht und archiviert.

Ausdrücklich festgehalten, ohne die Stufe offen zu halten: `changes:`-Kanäle
sind in der Realtime-Runtime **noch nicht betriebsbereit**. Registry, Quelle und
Reader existieren und sind zertifiziert, aber die Runtime besitzt keinen Port,
der je Scope eine Projektdatenbank auflöst. Ein `changes:`-Abonnement bleibt dort
leer. Bewusst wurde kein Platzhalter eingebaut, der beim ersten Gebrauch wirft:
Eine Verdrahtung, die vorhanden aussieht und abstürzt, ist schlechter als eine
fehlende.

## Ehrlich offen

- Projekt-Datenbank-Port in der Realtime-Runtime; erst damit sind `changes:`
  im Betrieb nutzbar. Zu verbinden sind `ControlPlaneDataTargetResolver` und der
  Katalog aus `migrations/connection-catalog-env`
- Kein Scheduler für die beiden `prune`-Pfade
- Realtime verweigert weiterhin technisch den Start bei `NODE_ENV=production`;
  das ist ein Go-live-Gate der Stufe 2.0, kein Stufenkriterium
- Löschungen erreichen nur `service_role` (siehe Release 1.12)
- Production-TLS/Proxy, Telemetrie, Browser-SDK
