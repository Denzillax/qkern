# Release 1.46.0 — Wer merkt, dass es klemmt?

## Der Anlass

Release 1.45 hat eine Stunde gekostet, weil eine Schleife, die jede Sekunde
scheitert, von einer untätigen nicht zu unterscheiden war. Der Prozess meldete
seinen Start und schwieg danach. Sichtbar wurde der Fehler erst, als ich
`onError: () => undefined` von Hand gegen eine Ausgabe getauscht habe.

Die „Ehrlich offen"-Liste von 1.45 sagte dazu:

> Eine Cron-Schleife, die jede Sekunde scheitert, sagt es niemandem. […] Das ist
> eine eigene Scheibe und keine Nebenbei-Änderung an einem Sicherheitsvertrag.

Dies ist die Scheibe.

## Der achte Fund

Beim Nachsehen stand die Antwort schon im Baum. `RuntimeProbeState` und
`LoopbackRuntimeProbeServer` mit `/live` und `/ready` gibt es seit Alpha 1, vier
Kompositionen reichen einen `probe` durch — und
`createLoopbackRuntimeProbeFromEnv` rief **kein einziger Prozess** auf.

Derselbe Fund wie siebenmal zuvor, an einer Stelle, die der
Erreichbarkeitsvertrag aus 1.42 **nicht sehen kann**: Das Modul war importiert,
denn `safeRuntimeProbe` und die Typen kommen von dort. Nur die Fabrik rief
niemand. Der Vertrag misst Erreichbarkeit, nicht Ausführung — hier zeigt sich,
was das kostet.

## Was jetzt geht

```bash
QKERN_RUNTIME_PROBE_ENABLED=true npm run worker:compute
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9464/ready
```

Der Compute-Prozess startet die Probe und speist sie aus beiden Schleifen. Zwei
Details entscheiden über die Aussage.

**Der Scheduler fängt Fehler selbst ab.** `scheduler.run` kehrt normal zurück,
auch wenn jede Definition gescheitert ist. Eine Erfolgsmeldung am Rundenende
hätte den eben gesetzten Fehlschlag wieder gelöscht — die Runde hätte gelungen
ausgesehen. Ein Zähler entscheidet deshalb, ob die Runde sauber war; nur dann
gilt sie als gelungen.

**Die Antwort sagt, dass es klemmt — nicht woran.** `/ready` liefert 503 mit
`not ready`. Kein Ausdruck, kein Projekt, keine Datenbankmeldung. Die Redaktion
bleibt, was sie war; sie gilt jetzt nur nicht mehr für die Tatsache selbst.

## Zwei Fälle gegen echtes PostgreSQL

| Fall | Zusage |
| --- | --- |
| Gültige Definition | `/ready` meldet 200 und `ready` |
| Unspielbare Definition per direktem INSERT | `/ready` meldet 503 und `not ready`, und die Ausgabe nennt weder Projekt noch Passwort noch Ausdruck |

Der erste Anlauf des positiven Falls war rot, und der Fehler war meiner: Beide
Fälle teilten sich ein Projekt, und der Prozess bedient einen ganzen Scope — er
sah die Definitionen der früheren Fälle mit. Dieselbe Regel wie in 1.29, jeder
Fall bekommt sein eigenes Projekt, und dieselbe Lektion zum zweiten Mal.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| `onError` meldet nichts mehr | 119 von 120 — genau der negative Fall; der positive bleibt grün |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 120/120, exit 0 | `docs/evidence/2026-08-08/probe-run1.manifest.json` |
| PostgreSQL 120/120, exit 0 | `docs/evidence/2026-08-08/probe-run2.manifest.json` |
| Mutation `onError` 119/120 | `docs/evidence/2026-08-08/probe-mutation.manifest.json` |

Lokal: 1009 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Sechs der sieben Prozesse starten die Probe weiterhin nicht.** Realtime,
  Migrationen, beide Publisher, Provisioner und der Queue-Wirt melden nichts.
- **Nur der Cron-Zweig ist zertifiziert.** Dass der Webhook-Zweig seinen
  Fehlschlag meldet, ist verdrahtet und nicht belegt.
- **`/ready` sagt nicht, seit wann und wie oft.** Wer den Verlauf sehen will,
  braucht einen Exporter, den es nicht gibt.
- **Ein Zähler über alle Scopes.** Scheitert eine Definition in einem Projekt,
  meldet der Prozess für alle Projekte `not ready`. Das ist die konservative
  Richtung und trotzdem grob: Ein Betreiber erfährt, dass etwas klemmt, nicht wo.
- **Die Probe hat keinen Vertrag, der ihren Start erzwingt.** Genau daran ist sie
  acht Releases lang gescheitert. Ein Test, der prüft, dass jeder Prozess sie
  startet, wäre die nächste Scheibe.
