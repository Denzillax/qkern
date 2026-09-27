# Release 2.57.0 – Was nicht da ist, steht auch da

Drei weitere Platzhalter sind weg. Jede der drei Seiten sagt zuerst, was sie
nicht hat, und zeigt dann, was wirklich da ist.

## Was neu ist

- Ansicht Logs, Postgres-Zustand: kein Serverlog, sondern die Zähler aus den Statistiksichten der Projektdatenbank.
- Ansicht Authentication, Auth-Leistung: was scheitert, je Handlungsart und seit wann. Keine Antwortzeit.
- Ansicht Integrationen, Wrappers: fremde Datenquellen, lesend und ohne die Zugangsdaten zu ihnen.
- PostgreSQL-Zertifizierung von 204 auf 207 Fälle, lokale Suite von 2130 auf 2141.

## Vier Befunde, die man wissen sollte

- **Eine Zahl war längst da und wurde weggeworfen.** Die Aggregation der Audit-Kette zählt seit `2.47.0` die gescheiterten Handlungen je Zeitfenster **und je Art**. Beim Aufbau der Reihe fiel das zu einer Summe je Fenster zusammen. Die Auth-Leistung zeigt es jetzt, ohne eine einzige zusätzliche Abfrage.
- **Eine Antwortzeit misst QKERN nicht.** Ein Eintrag der Audit-Kette trägt einen Zeitpunkt, eine Art, einen Ausgang und eine Referenz. Der zweite Zeitpunkt derselben Handlung wird nirgends geschrieben, also gibt es keine Dauer. Der Platzhalter versprach sie; die Seite sagt stattdessen, dass es sie nicht gibt.
- **Die Optionen eines Fremdservers darf jede Rolle lesen, die den Katalog liest.** In ihnen kann ein Passwort stehen. Die Seite zeigt den Wert nur bei Schlüsseln auf einer Positivliste; jede andere Option steht mit Namen da und ohne Wert. Eine Sperrliste wäre bei `pwd` oder `api_key` blind gewesen.
- **Ein fehlender Zähler ist nicht Null.** Ohne Datenprüfsummen meldet PostgreSQL keine Zahl der Prüfsummenfehler. Eine Null an dieser Stelle wäre die Behauptung, es sei nachgesehen worden. Die Antwort trägt dort `null`, und die Mutationsprobe dreht genau das um.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 207/207, exit 0 | `docs/evidence/2026-09-27/welle9-run1.manifest.json` |
| PostgreSQL 17, 207/207, exit 0 | `docs/evidence/2026-09-27/welle9-run2.manifest.json` |
| Mutation fehlende Prüfsumme wird Null, exit 1 | `docs/evidence/2026-09-27/welle9-mutation-pglog.manifest.json` |
| Mutation alle Handlungen gelten als gescheitert, exit 1 | `docs/evidence/2026-09-27/welle9-mutation-authperf.manifest.json` |
| Mutation jede Serveroption zeigt ihren Wert, exit 1 | `docs/evidence/2026-09-27/welle9-mutation-wrappers.manifest.json` |
| Vitest lokal 2141/2141, exit 0 | `docs/evidence/2026-09-27/welle9-local-run1.manifest.json` |
| Vitest lokal 2141/2141, exit 0 | `docs/evidence/2026-09-27/welle9-local-run2.manifest.json` |

## Nachtrag zum Verfahren

Ein Release 2.57.0 gab es schon einmal, auf dem Papier. Eine Datei
`docs/RELEASE_2.57.md` trug die Fallnummern eines Schnitts als Versionsnummer;
ausgeliefert wurde er in `2.52.0`. Sie heisst jetzt
`docs/SLICE_BERATERREGELN.md` und trägt einen Nachtrag, der den Irrtum
benennt. Ihr Text ist unverändert.

Zwei weitere Dinge aus dem Parallelbetrieb, beide im Verfahren. Das
Scratchpad-Verzeichnis ist zwischen den Agenten geteilt, und zwei haben
dieselbe Datei unter demselben Namen gesichert; eine Rückstellung hat kurz die
fremde Fassung geschrieben, wurde bemerkt und behoben. Und beim
Zusammenführen hängen zwei Zweige ihren neuen Fall an dieselbe Stelle der
Testdatei: Beide Seiten zu behalten schiebt die Fälle ineinander, statt sie
nebeneinanderzustellen.

Und ein Lauf ist an Docker Desktop gescheitert, nicht an einem Test: Die
Engine antwortete auf eine Abfrage zum Containerzustand mit einem
Serverfehler, bevor ein einziger Fall lief. Der Lauf wurde wiederholt und war
grün, und das ist der Lauf, der hier als Beleg steht. Vorher liefen drei
Zertifizierungsstacks gleichzeitig für die Mutationsproben; das ist der
wahrscheinliche Anlass.

## Ehrlich offen

- **Vier neue Routen stehen nicht in der OpenAPI-Beschreibung**: Statements, Runtime, Health und der Abfrageplan. Kein Vertrag verlangt Vollständigkeit, aber die Lücke wächst mit jeder Welle.
- **Postgres-Zustand und Berichte, Datenbank überschneiden sich.** Beide lesen aus `pg_stat_database`. Die neue Seite verweist auf die alte, statt sie zu wiederholen. Ob es zwei Seiten bleiben sollen, ist eine offene Produktfrage.
- **Die Zähler haben keinen Zeitpunkt.** Sie zählen seit der letzten Rücksetzung der Statistik. Eine Deadlock-Zahl sagt nicht, wann.
- **Eine gescheiterte Anmeldung ist kein Angriff.** Die Auth-Leistung zeigt, was scheitert, und kann über die Ursache nichts sagen.
- **Im Browser nicht gesehen.** Die drei neuen Ansichten sind angemeldet nie betrachtet worden.
