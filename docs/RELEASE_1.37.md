# Release 1.37.0 — Aufräumen läuft

> Datum: 6. August 2026 · Vorgänger: `1.36.0`

## Wofür dieses Release steht

Drei `prune`-Pfade gab es seit Release 1.11 beziehungsweise 1.13. **Keiner hatte
einen Aufrufer.** Event-Log und Change-Feed wuchsen unbegrenzt.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **108 von 108 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 2 gegen echtes PostgreSQL, 6 lokal |
| Mutationsprobe | Aufbewahrungsfenster ignoriert → genau 1 Fall fällt um |
| Vitest lokal | 982 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Zum sechsten Mal dasselbe Muster

Realtime-Poller, dauerhafter Event-Log, Webhook-Outbox, Functions-Sandbox,
Usage-Emitter — und jetzt die Aufbewahrung. Gebaut, zertifiziert und trotzdem
wirkungslos, weil niemand es aufruft.

Diesmal war es besonders gut versteckt. Der Change-Poller lehnt das Aufräumen
ausdrücklich ab, und ein Test hält das seit Release 1.13 fest:

> „never prunes: retention is an operational task" — *die Instanz weiss nicht,
> was andere Instanzen noch brauchen.*

Die Begründung ist richtig. Nur hatte die benannte Betriebsaufgabe nie einen
Betrieb. Ein Test, der belegt, dass etwas **nicht** geschieht, ist kein Beleg
dafür, dass es woanders geschieht.

## Ein eigener Besitzer

`RealtimeRetentionRuntime` hat dieselbe Form wie `WebhookDeliveryRuntime`:
`runOnce`, `run`, `stop`. Sie räumt beide Speicher auf und ist bewusst kein Teil
des Pollers — der Grund gegen das Aufräumen *im* Poller bleibt bestehen.

Welche Projekte aufgeräumt werden, steht **ausdrücklich** in
`QKERN_REALTIME_RETENTION_SCOPES_JSON`. Dieselbe Entscheidung wie bei
`QKERN_COMPUTE_SCOPES_JSON` und aus demselben Grund: Die Runtime-Rolle sieht
durch RLS nur die eigene Organisation.

Die Abonnements einer Instanz wären der falsche Massstab gewesen — gerade das
Projekt, dem niemand zuhört, wächst unbeobachtet. Eine leere Liste schaltet die
Aufbewahrung ab und sagt das; eine unlesbare Liste ist ein Startfehler und wird
nicht stillschweigend zu „keine Scopes".

## Nach Alter, nicht nach Position

Eine positionsbasierte Aufbewahrung müsste wissen, wie weit jeder Leser gekommen
ist — über Instanzgrenzen hinweg und auch über die, die gerade nicht laufen.

Der Preis ist ehrlich zu nennen: Ein Poller, der länger als das Fenster
ausgefallen war, verliert Änderungen. Das Fenster ist deshalb grosszügig
(Standard: sieben Tage für Ereignisse, ein Tag für Änderungen), und die
Cursor-Prüfung meldet die Lücke, statt sie zu verschweigen.

Ein Fehler bei einem Projekt hält die übrigen nicht auf. Sonst wüchse der ganze
Rest, weil einer klemmt.

## Ehrlich offen

- **Die Tenant-Grenze trägt RLS, nicht der Aufräumer.** Der zugehörige Fall
  lässt sich vom Adapter aus nicht brechen und ist deshalb auch nicht durch eine
  Mutation belegt
- Ein Lauf, der einen zu lange ausgefallenen Poller und die dabei entstehende
  Lücke zeigt, fehlt
- Der Memory-Log kennt keine Aufbewahrung — er verliert ohnehin alles beim
  Neustart, und die Runtime wird dort gar nicht erst gebaut
- Ein Aufräumer für Usage-Events und Webhook-Zustellungen fehlt weiterhin; beide
  wachsen ebenfalls
- Kein Deployment-Weg für Function-Images, keine authentifizierte Registry
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
