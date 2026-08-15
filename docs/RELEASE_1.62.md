# Release 1.62.0 — Der siebte Prozess

Seit Release 1.44 stand in jeder „Ehrlich offen"-Liste, dass Prozesse ohne
Arbeitsnachweis bleiben. Diese Liste ist jetzt leer: **Alle sieben Prozesse
sind bei der Arbeit belegt.**

## Was der Provisioner jetzt kann

Aus einem wartenden Auftrag wird eine Bindung in der Datenbank und ein Projekt
im Zustand `ready` — ausgeführt von `npm run worker:provisioning`, gegen einen
echten HTTPS-Broker mit nachgerechneter Signatur, mit der echten
Provisioner-Rolle.

Der Broker ist derselbe Empfänger wie beim Apply-Publisher, mit einem eigenen
Pfad. Er antwortet mit **genau** den Feldern, die der Adapter erwartet, und
bekommt den Vertragshash gesagt statt ihn zu erfinden: Ein Empfänger, der ihn
selbst wählen dürfte, würde die Zusage aushebeln, die er belegen soll.

## Zwei weitere Produktfehler auf demselben Weg

Der Weg zum ersten grünen Lauf führte durch zwei Fehler, die beide nur unter
einer echten Datenbank auftreten.

**`column reference "id" is ambiguous`.** Die Abfrage in `complete()` bringt
über `FROM inserted_binding, bound_environment` zwei weitere Relationen in
denselben Namensraum, und beide führen ein `id`. Das unqualifizierte
`RETURNING id, …` ist damit mehrdeutig, und PostgreSQL weist die ganze
Anweisung ab. Es ist derselbe Fehler, den Release 1.48 auf dem Migrationsweg
gefunden hat — ein zweites Mal, an einer anderen Stelle. Die Qualifikation
steht deshalb jetzt an einer Stelle statt in jeder Abfrage neu.

**`permission denied for table project_database_bindings`.** `complete()`
schreibt mit `INSERT … RETURNING`, und `RETURNING` verlangt SELECT-Recht auf
den zurückgegebenen Spalten. Migration 0020 hat nur `INSERT` erteilt.

Der zweite ist die **dritte** Ausprägung desselben Musters innerhalb von zwei
Releases: ein Recht, das nicht die Operation verlangt, sondern eine ihrer
Klauseln — `ON CONFLICT` beim Heartbeat, `RETURNING` bei der Bindung. Beide
Male hat kein Test es gefunden, weil kein Test die Operation je mit der echten
Rolle ausgeführt hat.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| `RETURNING` wieder unqualifiziert | **14 von 15** — genau der Provisionierungsfall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 15/15, exit 0 | `docs/evidence/2026-08-15/provisioner-process-run1.manifest.json` |
| Empfänger 15/15, exit 0 | `docs/evidence/2026-08-15/provisioner-process-run2.manifest.json` |
| Mutation 14/15 | `docs/evidence/2026-08-15/provisioner-process-mutation.manifest.json` |
| PostgreSQL 129/129, exit 0 | `docs/evidence/2026-08-15/provisioner-process-postgres-run1.manifest.json` |
| PostgreSQL 129/129, exit 0 | `docs/evidence/2026-08-15/provisioner-process-postgres-run2.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. 37 Migrationen.

## Ehrlich offen

- **Der Broker ist eine Gegenstelle im eigenen Netz.** Sie rechnet die Signatur
  nach und prüft die Auftragskennung, aber sie richtet keine Datenbank ein. Was
  belegt ist, endet an der Bindung — nicht an einer laufenden Kundendatenbank.
- **Nur der glückliche Weg ist als Prozess belegt.** Ablehnung, Zeitablauf,
  verlorene Lease und Wiederholung sind als Bibliothek zertifiziert, nicht als
  Prozess.
- **Der `catch` verschluckt die Ursache immer noch.** Beide Fehler dieses
  Releases waren nur über eine lokale Diagnose sichtbar, weil der Prozess selbst
  nur `claim_failed` beziehungsweise `INVALID_BINDING` meldet.
- **Andere `RETURNING`- und `ON CONFLICT`-Pfade sind nicht durchgesehen.** Drei
  Treffer desselben Musters in zwei Releases sind kein Zufall.
