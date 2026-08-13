# Release 1.52.0 — Wer meldet, was er tut

## Was 1.51 offen liess

> **Dass der Worker-Logger fehlte, hat niemand geprüft.** Es gibt keinen
> Vertrag, der verlangt, dass ein Prozess die Logger setzt, die seine
> Komposition anbietet. Das wäre die nächste Scheibe.

## Die Lücke war grösser

Beim Messen zeigte sich: Zwei Kompositionen boten **gar keine** Naht — der
Queue-Wirt und der Compute-Prozess.

`ProjectQueueWorker` führt seit Alpha 1 Ereignisse je Nachricht: Queue,
Message-Id, Attempt, feste Outcomes und feste Failure Codes — niemals Payload,
Worker-Id oder Lease-Geheimnis. `docs/PROJECT_QUEUES.md` beschreibt das seit
jeher. Durchgereicht hat sie für den Prozess niemand: **Der Wirt verarbeitete
Nachrichten und schwieg darüber.**

Seit diesem Release reicht er den Logger durch, und `npm run worker:queues`
setzt ihn.

## Der Vertrag

`tests/worker-logger-contract.test.ts` verlangt von jedem Prozess, dass er jeden
`…Logger` setzt, den seine Fabriken anbieten.

Die Erwartung wird **abgeleitet**, nicht gepflegt: Der Test liest die
Abhängigkeitsliste der aufgerufenen Fabrik — inline oder als benannter Typ — und
sucht die Namen im Prozess. Eine handgepflegte Liste wäre die nächste Stelle, an
der etwas vergessen wird; das ist die Lektion aus Release 1.40.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Dem Migrations-Prozess wird der Worker-Logger genommen | Der Vertrag nennt Datei, Fabrik und Logger |
| Der Wirt reicht den Logger nicht mehr durch | 25 von 26 — genau der Prozess-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-08/host-logger-run1.manifest.json` |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-08/host-logger-run2.manifest.json` |
| Mutation Durchreichung 25/26 | `docs/evidence/2026-08-08/host-logger-mutation.manifest.json` |
| PostgreSQL 123/123, exit 0 | `docs/evidence/2026-08-08/host-logger-postgres.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Compute-Prozess hat weiterhin keine Logger-Naht.** Seine Komposition
  bietet keine an, und der Vertrag kann nur einfordern, was angeboten wird. Was
  Cron und Webhook-Zustellung je Vorgang tun, meldet niemand — belegt ist nur die
  Probe aus 1.46, die sagt, *dass* es klemmt, nicht *was* geschah.
- **Der Vertrag prüft den Quelltext.** Ein Logger, der gesetzt, aber mit einer
  leeren Funktion belegt wird, fällt nicht auf.
- **Er liest die Abhängigkeitsliste per Textsuche.** Eine Fabrik, die ihre
  Optionen anders schreibt als die heutigen sieben, entgeht ihm.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
