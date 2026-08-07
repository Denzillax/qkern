# Release 1.38.0 — Was noch wächst

> Datum: 6. August 2026 · Vorgänger: `1.37.0`

## Wofür dieses Release steht

Release 1.37 schloss mit dem Satz, dass `usage_events` und
`project_webhook_deliveries` weiterhin ohne Aufräumer wachsen — und dass beides
der naheliegende nächste Schnitt sei.

Der Blick auf beide hat **zwei verschiedene Antworten** ergeben. Das ist das
eigentliche Ergebnis dieses Slices, und es korrigiert meinen eigenen
Schlusssatz.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **110 von 110 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 2 gegen echtes PostgreSQL, 5 lokal |
| Mutationsprobe 1 | Status und Zeitstempel ignoriert → genau 1 Fall fällt um |
| Mutationsprobe 2 | ein Fenster für beide Zustände → genau 1 Fall fällt um |
| Vitest lokal | 987 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Zustellungen: aufräumen, aber vorsichtig

Zugestellte und tote Zeilen haben **getrennte** Fenster — sieben beziehungsweise
dreissig Tage. Eine tote Zustellung ist der Grund, warum ein Betreiber überhaupt
in diese Tabelle schaut; sie darf nicht mit dem Alltagsrauschen verschwinden.

**Wartende und laufende Zustellungen bleiben unberührt**, unabhängig von ihrem
Alter. Eine ausstehende Zustellung ist keine Altlast; sie zu löschen wäre der
stille Verlust genau der Nachricht, die noch ankommen soll.

Der Aufräumer läuft in der Compute-Runtime — sie kennt die Scopes ohnehin und
ist derselbe Prozess, der die Zeilen erzeugt.

## Usage-Events: absichtlich nicht

Der Trigger aus Migration 0028 weist UPDATE **und DELETE** ab, und die
Runtime-Rolle hat kein DELETE-Recht. Beides ist Absicht, und beim Hinsehen wird
klar, warum ein Aufräumer hier falsch wäre.

`usage_events` ist zweierlei zugleich: der Beleg hinter jedem Zählerstand und
der Idempotenz-Speicher. Ein gelöschtes Ereignis heisst, dass derselbe
Schlüssel später **erneut zählt** — die Zusage aus Release 1.29, dass ein Retry
dauerhaft dasselbe Ergebnis bekommt, hinge dann am Aufbewahrungsfenster.

Die Antwort auf ihr Wachstum ist **Export**, nicht Löschen. Der fehlt, und die
Tabelle bleibt damit die einzige, die absichtlich wächst — das steht jetzt in
`docs/USAGE_METERING.md`, statt als Versäumnis auszusehen.

## Eine Lehre, die ich dreimal bezahlt habe

Die zweite Mutationswelle brauchte drei Anläufe. Die ersten beiden warfen den
falschen Fall um, und zwar aus demselben Grund wie schon in Release 1.36:

- `$5 IS NOT NULL` — PostgreSQL kann den Typ nicht bestimmen
- ein Parameter, der im Text nicht mehr vorkommt — die Bind-Nachricht passt
  nicht mehr zur Anweisung

In beiden Fällen wirft der Adapter, `pruneDeliveries` scheitert geschlossen, und
die Probe misst das Werkzeug statt der Zusage.

Daraus eine Regel, die jetzt in `docs/QA.md` steht: **Eine Mutationsprobe an
einer SQL-Abfrage ändert einen Wert oder ein Prädikat — nie die Parameterzahl
und nie eine untypisierte Referenz.** Fällt mehr um als vorhergesagt, ist zuerst
die Probe verdächtig, nicht die Zusage.

## Ein Gate, das zufällig rot wurde

Ein Nebenläufigkeitsfall aus Release 1.17 riss unter Last die vitest-Vorgabe von
fünf Sekunden. Er läuft normalerweise in einer Sekunde, unter mehreren
parallelen Container-Stacks in knapp drei — und einmal in über fünf.

Die Zusage bleibt unverändert (genau einmal je Nachricht); nur die Wartezeit
passt jetzt zur Streuung. Ein Gate, das zufällig rot wird, entwertet jedes
andere: Wer einmal gelernt hat, einen roten Lauf zu wiederholen statt ihn zu
lesen, liest auch den nächsten nicht.

## Ehrlich offen

- **Kein Export- oder Archivweg für `usage_events`.** Damit bleibt eine Tabelle,
  die absichtlich wächst
- `usage_counters`, `project_function_slots` und `audit_logs` haben ebenfalls
  keinen Aufräumer. Die ersten beiden sind klein und beschränkt, das dritte ist
  absichtlich unveränderlich — genannt sei es trotzdem
- Der Aufräumer läuft nur für die Scopes in `QKERN_COMPUTE_SCOPES_JSON`
- Kein Deployment-Weg für Function-Images, keine authentifizierte Registry
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
