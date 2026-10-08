# Release 2.83.0 – Kein Upload lässt mehr eine Datei liegen

2.82.0 hatte eine Lücke offen gelassen, die älter war als das Löschen von
Projekten: Ein einfacher Upload, dessen signierte Anfrage ausgeführt, aber nie
abgeschlossen wurde, verfiel nur im Katalog. Die Datei blieb beim Anbieter
liegen, und niemand kannte sie mehr. Für Multipart gab es seit 1.78 ein Netz
für Waisen, für einfache Uploads keines; der Anbieter kann sie nicht
auflisten, ohne den ganzen Bucket zu lesen.

## Was neu ist

- **Ein Vermerk an jedem nicht abgeschlossenen Upload (2.178).** Ist ein Upload verfallen oder abgebrochen, löscht die Lifecycle-Runde seine Datei beim Anbieter (bei Multipart: bricht den Upload ab) und setzt danach `provider_released_at`. Fällt der Anbieter aus, bleibt der Vermerk leer, und der nächste Lauf versucht es wieder. `POST .../storage/lifecycle` meldet die Zahl als `releasedUploads`. Migration `0092`.
- **Der Vermerk ist geschützt.** Der Trigger aus 0071 lässt genau seinen einmaligen Wechsel an einem verfallenen oder abgebrochenen Upload zu; jede andere Änderung mit ihm zusammen fällt.
- **Der Abräumer nimmt diese Uploads mit.** Die Buckets eines gelöschten Projekts gehen erst, wenn keiner mehr ohne Vermerk ist.
- Lokale Suite von 2739 auf 2740 bestandene Fälle; PostgreSQL 17 von 265 auf 266.

Ein Löschen trifft nie ein abgeschlossenes Objekt: Der Schlüssel einer
Reservierung enthält ihre eigene Kennung.

## Zwei Tests, die nebenbei auffielen

- **(2.67) Abfragekosten** zählte seine Vergleichszahl als Eigentümer der Datenbank. Der Dienst liest aber als App-Rolle, und die sieht bei fremden Statements keine Kennung. Der Fall war nur grün, solange keine andere Testdatei unter fremder Rolle in dieselbe Projektdatenbank schrieb. Mit zwei Workern tat das eine. Er zählt jetzt mit der Rolle des Dienstes; die Prüfung ist dieselbe. Am Produkt war nichts falsch.
- **(2.49) Migrationsweg** fiel in vier Läufen einmal mit `failed`, ohne dass das Log den Grund nannte. Er trägt jetzt eine Diagnose mit dem Fehlercode des Auftrags und war in den folgenden Läufen grün. Die Ursache des einen Fehlschlags ist nicht gefunden.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 266/266, exit 0, zwei Worker | `docs/evidence/2026-10-08/upload-release-postgres-run1.manifest.json` |
| PostgreSQL 17, 266/266, exit 0, Reproduktion | `docs/evidence/2026-10-08/upload-release-postgres-run2.manifest.json` |
| PostgreSQL 17, Mutation: Abräumer übergeht verfallene Uploads, 265/266 | `docs/evidence/2026-10-08/upload-release-mutation-purge-list.manifest.json` |
| versitygw und ClamAV, 15/15, exit 0 | `docs/evidence/2026-10-08/upload-release-s3-run1.manifest.json` |
| versitygw und ClamAV, 15/15, exit 0, Reproduktion | `docs/evidence/2026-10-08/upload-release-s3-run2.manifest.json` |
| Vitest lokal 2740/2740, exit 0 | `docs/evidence/2026-10-08/welle35-local-run1.manifest.json` |
| Vitest lokal 2740/2740, exit 0 | `docs/evidence/2026-10-08/welle35-local-run2.manifest.json` |

Die gescheiterten Läufe auf dem Weg dahin liegen mit ihrer Erklärung bei
(`docs/evidence/README.md`).

## Ehrlich offen

- **Der Broker kennt den Abbau-Vertrag aus 2.82.0 noch nicht.** Ohne ihn bleibt ein abgelaufenes Projekt mit Datenbank als „wird abgeräumt“ stehen.
- **Ein Screenreader hat die Console nicht gelesen**, und die Console ist nicht mit einem echten Projekt angesehen.
- Tarif binden und Abfrageverlauf bleiben Neins, wie in 2.78.0 begründet.
