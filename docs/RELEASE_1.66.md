# Release 1.66.0 — Der Schritt bekommt einen Namen

## Warum

`claim_failed` hat drei Releases gekostet. Release 1.59 hat die falsche Stelle
vermutet, 1.60 sie ausgeschlossen, und erst 1.61 fand den Heartbeat — für eine
Frage, die eine Zeile im Log beantwortet hätte. Der `catch` des Provisioners
verschluckte die Ursache, und das stand seither in jeder „Ehrlich offen"-Liste.

## Was sich ändert

`claim_failed` nennt jetzt zweierlei:

- **`step`** — welcher der drei Aufrufe der Runde gescheitert ist:
  `heartbeat`, `quarantine` oder `claim`. Sie standen in zwei Blöcken, deren
  `catch` nichts über die Stelle sagte; jetzt hat jeder Aufruf seinen eigenen.
- **`reason`** — die Fehlerklasse, nicht die Fehlermeldung: die festen Codes
  aus `RepositoryError`, sonst `UNKNOWN`. Eine Datenbankmeldung gehört nicht in
  ein Prozesslog — sie kann Tabellen- und Spaltennamen fremder Mandanten tragen.

## Der Beleg

Der Fehler aus 1.61 wird **absichtlich wiederhergestellt**: Das Leserecht auf
den Arbiter-Spalten des Heartbeats wird für die Dauer des Falls entzogen, der
ausgelieferte Prozess gestartet. Er muss melden: `step: "heartbeat"`,
`reason: "PERSISTENCE_ERROR"` — und darf dabei weder `permission denied` noch
einen Tabellen- oder Spaltennamen ausgeben.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Das `step`-Feld wird nicht mehr gesetzt | **15 von 16** — genau der neue Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 16/16, exit 0 | `docs/evidence/2026-08-16/provisioner-step-run1.manifest.json` |
| Empfänger 16/16, exit 0 | `docs/evidence/2026-08-16/provisioner-step-run2.manifest.json` |
| Mutation 15/16 | `docs/evidence/2026-08-16/provisioner-step-mutation.manifest.json` |

Lokal: 1042 bestanden, 0 fehlgeschlagen.

## Ausserdem in diesem Release

`docs/PARITAET.md` — die vermessene Lücke zwischen QKERN und Supabase, Fähigkeit
für Fähigkeit, mit dem Stand beider Achsen und dem jeweils nächsten belastbaren
Slice. Sie beantwortet die Frage „was fehlt bis Supabase-Niveau" fortan
versioniert statt aus dem Gedächtnis.

## Ehrlich offen

- **`reason` ist grob.** `PERSISTENCE_ERROR` deckt viele Ursachen; die Codes
  sind so fein wie `RepositoryError`, nicht feiner.
- **Nur der Heartbeat-Schritt ist rot belegt.** `quarantine` und `claim` tragen
  dieselbe Mechanik, aber kein Fall zwingt sie einzeln zum Scheitern.
- **Der PostgreSQL-Stack wurde für dieses Release nicht neu gefahren.** Die
  Änderung liegt im Prozesslog des Provisioners, und der Empfängerstack führt
  genau diesen Prozess; die 135 aus `1.65.0` bleiben die gültige Referenz.
