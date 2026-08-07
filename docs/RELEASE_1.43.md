# Release 1.43.0 — Bis ans andere Ende

## Was 1.42 offen liess

Release 1.42 hat dem Queue-Worker einen Wirt gegeben und in der „Ehrlich
offen"-Liste vermerkt:

> **Kein Lauf mit echtem Container.** Die drei Real-DB-Fälle prüfen den Weg von
> der Queue zur Function; die Sandbox dahinter ist eigens zertifiziert, aber die
> Kette Queue → Container in einem Lauf ist es nicht.

Dieses Release schliesst genau das.

## Die Kette

Im Functions-Stack ist seit `1.35.0` keine Stelle mehr ersetzt: Das Test-Image
wird gebaut, in eine echte Registry gepusht, lokal gelöscht und über seinen
Digest zurückgeholt. Dazu kommt jetzt die Queue.

```
enqueue  →  Wirt  →  Worker  →  Lease  →  Function aus der Datenbank
                                        →  Image aus der Registry
                                        →  echter Container
                                        →  Antwort entscheidet über die Nachricht
```

Kein Fall ruft `invoke` selbst. Was zwischen `enqueue` und dem Container liegt,
läuft wirklich.

## Zwei Fälle

**Ein echter Container für eine eingereihte Nachricht.** Nach dem Lauf steht die
Nachricht auf `completed`, und nichts liegt mehr in der Queue.

**Ein Nein aus dem Container.** Ein unbekannter Modus lässt die Testfunction mit
400 antworten — der Container läuft also wirklich, er sagt nur Nein. Die
Nachricht bleibt erhalten, statt still zu verschwinden.

## Mutationsproben

Beide am Handler, beide nur an einem Wert:

| Mutation | Ergebnis |
| --- | --- |
| Statuscode-Prüfung entschärft (`< 200 \|\| > 299` zu `< 0`) | 24 von 25 — genau der Fehlschlag-Fall |
| Wirt ruft `message.queue` statt `functionName` | 24 von 25 — genau der Erfolgsfall |

Beide Fälle sind einzeln getragen und nicht durch denselben Pfad.

## Belege

| Lauf | Manifest |
| --- | --- |
| Docker, Registry und PostgreSQL 25/25, exit 0 | `docs/evidence/2026-08-06/queue-container-run1.manifest.json` |
| Docker, Registry und PostgreSQL 25/25, exit 0 | `docs/evidence/2026-08-06/queue-container-run2.manifest.json` |
| Mutation Statuscode 24/25 | `docs/evidence/2026-08-06/queue-container-mutation.manifest.json` |
| Mutation Funktionsname 24/25 | `docs/evidence/2026-08-06/queue-container-mutation2.manifest.json` |

Lokal: 1001 bestanden, 0 fehlgeschlagen. Der PostgreSQL-Hauptlauf ist gegenüber
`1.42.0` unverändert, weil dieses Release keinen Produktcode ändert — nur
Zertifizierung hinzufügt.

## Ehrlich offen

- **Der Wirt läuft als Objekt, nicht als Prozess.** `npm run worker:queues`
  selbst hat weiterhin keinen archivierten Lauf; zertifiziert ist, was der
  Prozess aufruft, nicht sein Start.
- **Nebenläufigkeit mehrerer Wirte auf derselben Queue ist über die Lease
  belegt, nicht mit echten Containern.** Zwei Wirte, ein Container-Runtime: das
  hat kein Lauf hinter sich.
- **Der Retry-Fall belegt, dass die Nachricht bleibt** — nicht, dass ein
  späterer Versuch sie zustellt. Die Wiederholung selbst ist gegen echtes
  PostgreSQL zertifiziert, aber nicht in dieser Kette.
- **Ein Container pro Nachricht.** Was das unter Last kostet, ist nicht
  vermessen; es gibt keinen Soak-Lauf dieser Kette.
