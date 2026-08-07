# Release 1.41.0 — Belege gehen raus

## Warum diese Scheibe

Release 1.38 hat begründet, warum `usage_events` als einzige Tabelle **keine**
Aufbewahrung bekommt: Ihr Trigger weist UPDATE und DELETE ab, weil sie zugleich
der Beleg hinter jedem Zählerstand und der Idempotenz-Speicher ist. Ein
gelöschtes Ereignis heisst, dass derselbe Schlüssel später erneut zählt.

Damit ist sie die einzige Tabelle, die absichtlich wächst — und die Antwort auf
ihr Wachstum ist Export, nicht Löschen. `docs/USAGE_METERING.md` führte
„Retention/Export" seit Alpha 1 als fehlend.

## Was jetzt geht

```bash
npm run usage:export -- --organization <uuid> --project <uuid> --environment development --period 2026-08 --operator alice
```

NDJSON nach stdout, eine Zeile je Ereignis, die Anzahl auf stderr. Seitenweise
über einen Keyset-Cursor auf `(recorded_at, id)`, nicht über OFFSET: In diese
Tabelle wird laufend geschrieben, und ein Offset verschiebt sich dabei.

Das Skript ist der **Aufrufweg**, nicht ein Beispiel. Ein Export ohne Aufrufer
wäre genau das Muster, das dieser Sprint sechsmal gefunden hat: gebaut,
zertifiziert und trotzdem wirkungslos, weil niemand es ruft.

Ausgeliefert wird die Entscheidung, nicht ihre Herkunft: keine Verifier, keine
Rohschlüssel. Beide tragen für einen Abgleich nichts bei. Mengen sind
Dezimalstrings, damit JavaScript nichts abschneidet.

`exportEvents` ist Operator-Sache. Der Browser bekommt die Projektion, nicht die
Einzelbelege.

## Der Defekt, den der erste Lauf gefunden hat

Sieben Ereignisse kamen als dreizehn zurück.

Der Cursor wurde als `Date.toISOString()` gereicht — Millisekunden. `recorded_at`
speichert Mikrosekunden. Der abgeschnittene Wert liess die letzte Zeile jeder
Seite erneut durch; die Seiten überlappten sich, statt aneinanderzustossen.

Der Cursor trägt jetzt die Textform der Datenbank und wird als `$7::timestamptz`
zurückgegeben — nicht umgerechnet, sondern durchgereicht.

## Mutationsprobe

Zweimal, beide nach der Regel aus 1.38 nur am Prädikat, nie an der Parameterzahl:

| Mutation | Ergebnis |
| --- | --- |
| `>` zu `>=` im Keyset | 113 von 114 — genau der Seitenfall, mit denselben dreizehn Zeilen wie der echte Defekt |
| `project_id=$2` zu `(project_id=$2 OR $2 IS NOT NULL)` | 112 von 114 — die beiden Fälle, die die Projektgrenze tragen |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 114/114, exit 0 | `docs/evidence/2026-08-06/usage-export-run1.manifest.json` |
| PostgreSQL 114/114, exit 0 | `docs/evidence/2026-08-06/usage-export-run2.manifest.json` |
| Mutation Keyset 113/114 | `docs/evidence/2026-08-06/usage-export-mutation.manifest.json` |
| Mutation Projektgrenze 112/114 | `docs/evidence/2026-08-06/usage-export-mutation2.manifest.json` |

Lokal: 990 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Export nimmt der Tabelle das Wachstum nicht.** Er macht es tragbar. Wer
  `usage_events` kleiner haben will, braucht ausserdem eine Entscheidung
  darüber, wie lange Idempotenz gelten soll. Die ist nicht getroffen, und ohne
  sie wäre jedes Löschen ein Wiedermitzählen.
- **Keine Route, keine Console-Fläche.** Nur das Skript. Wer exportieren will,
  braucht Zugriff auf die Runtime-Datenbank.
- **Stabilität einer Seite unter gleichzeitigem Schreiben ist unbelegt.** Die
  Fenstergrenze `window_start` ist unveränderlich, ein Ereignis wandert also
  nicht aus einem Monat heraus. Aber ein Export, der über Stunden läuft, hat
  keinen Lauf hinter sich.
- **Kein Format-Vertrag.** NDJSON ist geliefert; ob ein Abnehmer die Felder
  erwartet, die dort stehen, hat niemand gegengeprüft.
- **Der Zeilen-Cursor ist nicht signiert.** Wer ihn manipuliert, überspringt
  Zeilen im eigenen Export. Das schadet niemand anderem — die Tenantgrenze hängt
  nicht am Cursor —, fällt aber auch nicht auf.
