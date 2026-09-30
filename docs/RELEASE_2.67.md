# Release 2.67.0 – Geschrieben, gedruckt, und ein Protokoll, das es nie gab

Drei Schnitte parallel, alle drei an Sprossen der Leiter. Der schwerste Fund
hat mit keinem davon zu tun: Ein Protokoll, das QKERN seit acht Ausgaben
führt, wurde im Betrieb nie geschrieben.

## Was neu ist

- GraphQL schreibt: Einfügen, Ändern und Löschen über denselben Weg wie REST, in einer Transaktion.
- Der S3-Endpunkt nimmt echte Clients an: `aws-chunked`, Range, CopyObject, DeleteObjects und Presigned URLs. Das AWS SDK hat ihn gesehen.
- Function-Container haben ein Inhaltslog: jede Zeile auf `stdout` und `stderr`, mit Zeitpunkt und Strom.
- **Der letzte Platzhalter der Console ist weg.** Von sechsundzwanzig sind null übrig.
- PostgreSQL-Zertifizierung von 230 auf 232 Fälle, Storage von 9 auf 10, Functions von 27 auf 32, lokale Suite von 2335 auf 2383.

## Das Protokoll, das nie geschrieben wurde

Seit `1.89.0` führt QKERN ein Aufrufprotokoll je Function: Beginn, Dauer,
Ausgang, Code. Es gibt eine Route dafür, eine Ansicht, eine Tabelle und einen
Zertifizierungsfall.

`createFunctionInvocationServiceFromEnv` hat den Logger nie mitgegeben. Web-Route,
Queue-Wirt und Auth-Hooks holen den Aufrufdienst alle aus dieser Fabrik, also
**hat im Betrieb seit `1.89.0` kein einziger Aufruf eine Zeile geschrieben**.
Grün war der Fall trotzdem, weil der Kettenfall der Zertifizierung den Logger
von Hand verdrahtet. Der Fall prüfte die Tabelle, nicht den Weg dorthin.

Jetzt gibt die Fabrik das Repository mit, und ein Vertrag liest die Verdrahtung
statt des Ergebnisses. Gefunden hat es der Agent, der die Inhaltslogs baute,
beim Lesen des Startwegs, nicht durch einen roten Test.

## GraphQL schreibt

Drei Formen, benannt wie bei pg_graphql, mit `affectedCount` und `records` in
der Antwort. Der Weg ist **derselbe** wie bei REST: Einfügen, Ändern und Löschen
liegen in gemeinsamen Helfern, die REST über den Primärschlüssel und GraphQL
über denselben Filterbau erreichen. Eine Anfrage ist eine Transaktion, und eine
abgewiesene Zeile rollt alles davor mit zurück.

Grenzen in `lib/data-api-limits.ts`: 25 Zeilen je Mutation, 5 Mutationen je
Anfrage. Die REST-Fläche liest jetzt dieselbe Zahl, statt eine eigene zu führen.
Ändern und Löschen ohne Filter werden abgewiesen.

**Ein Fund an der REST-Fläche**: Eine von `WITH CHECK` abgewiesene Zeile fiel
bisher unter `UNAVAILABLE` mit 503. Der Aufrufer konnte eine Policy-Ablehnung
nicht von einem Ausfall unterscheiden, und ein Wiederholen hätte nie geholfen.
Beide Flächen antworten jetzt mit `POLICY_REJECTED` und 403.

## Der S3-Endpunkt und ein echter Client

Die fünf Lücken, die 2.66 mit 501 benannt hatte, sind gebaut:

- **`aws-chunked`** in allen drei Formen, die AWS-Werkzeuge über HTTP wählen, mit verketteter Blocksignatur, Trailer-Signatur und Nachrechnen jeder `x-amz-checksum-*`. CRC32C und CRC64NVME rechnet QKERN selbst, geprüft gegen die bekannten Werte.
- **Range** bei GetObject, mit 206 und 416. Ignoriert der Anbieter den Range, wird im Strom geschnitten statt gepuffert.
- **CopyObject** im Bucket-Satz über denselben Dienst, mit Scan.
- **DeleteObjects** bis 1000 Schlüssel, je Schlüssel ein eigenes Ergebnis.
- **Presigned URLs** als Query-Signatur, `X-Amz-Expires` hart auf 900 Sekunden.

**Ein echter Client hat den Endpunkt gesehen**: das AWS SDK für JavaScript, über
eine HTTP-Brücke aus `node:http` gegen den Handler, im Storage-Stack. Das SDK
wählt selbst, und der Fall liest am Server mit, was es gewählt hat. Die AWS CLI
und rclone haben ihn nicht gesehen: beide bräuchten einen laufenden Next-Server
im Stack, und der fährt nur versitygw, ClamAV und einen Node-Container.

## Inhaltslogs, und warum QKERN nichts streicht

Jede Zeile auf `stderr` und jede Zeile auf `stdout`, die keine Leitungsnachricht
ist, liegt je Aufruf in einer eigenen Tabelle, mit Zeitpunkt und Strom, begrenzt
auf 500 Zeilen und 64 KiB je Aufruf. Was darüber liegt, wird abgeschnitten, und
das Log sagt es. Eine Nicht-JSON-Zeile auf `stdout` beendet den Aufruf nicht
mehr; ein `console.log("start")` war bis `2.66.0` ein Fehler mit festem Code.

**QKERN streicht keine Geheimnisse aus den Zeilen**, und das ist eine
Entscheidung, keine Auslassung. Der Prozess, der den Container startet, kennt
keinen Geheimniswert: Die Definition trägt nur Referenzen, der Container bekommt
sie über `stdin`, `--env` wird nie gesetzt, und aus der Prozessumgebung kommt
nur `PATH`. Ein Filter hätte nichts, wogegen er streichen könnte, und würde eine
Zusage vortäuschen. Was eine Function aus vermittelten Antworten selbst
ausgibt, verantwortet sie. Ein Kanarienvogel-Fall belegt über das Log, dass
nichts durchsickert, was QKERN setzt.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 232/232, exit 0 | `docs/evidence/2026-09-29/welle19-run1.manifest.json` |
| PostgreSQL 17, 232/232, exit 0 | `docs/evidence/2026-09-29/welle19-run2.manifest.json` |
| versitygw und ClamAV, 10/10, exit 0 | `docs/evidence/2026-09-29/welle19-storage.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 32/32, exit 0 | `docs/evidence/2026-09-29/welle19-functions.manifest.json` |
| Mutation das Zurückrollen der Anfrage entfällt, exit 1 | `docs/evidence/2026-09-29/welle19-mutation-gqlrollback.manifest.json` |
| Mutation stderr wird als stdout geführt, exit 1 | `docs/evidence/2026-09-29/welle19-mutation-stderr.manifest.json` |
| Mutation die Blocksignatur wird nicht geprüft, exit 1 | `docs/evidence/2026-09-29/welle19-mutation-chunksig.manifest.json` |
| Mutation ein Text nennt eine Ausgabe, die es nicht gibt, exit 1 | `docs/evidence/2026-09-29/welle19-mutation-versionref.manifest.json` |
| Vitest lokal 2383/2383, exit 0 | `docs/evidence/2026-09-29/welle19-local-run1.manifest.json` |
| Vitest lokal 2383/2383, exit 0 | `docs/evidence/2026-09-29/welle19-local-run2.manifest.json` |

Die Läufe der drei Agenten auf ihren Zweigen liegen daneben als
`graphqlwrite-*`, `slice-s3c-*` und `fnlogs-*`.

## Nachtrag zum Verfahren

**Fünfzehn Textstellen behaupteten eine Ausgabe, die es nicht gibt.** Drei
Agenten haben unabhängig voneinander ihre eigene Fallnummer in der Form einer
Ausgabe geschrieben, `2.96.0`, `2.97.0`, `2.98.0`, `2.99.0`, darunter die
OpenAPI-Beschreibung, der Compute-Vertrag und das Handbuch. Ein Leser hätte
nach Release Notes gesucht, die es nicht gibt.

Hier gehört eine Berichtigung meiner eigenen ersten Lesart dazu. In diesem
Projekt bedeutet die **zweistellige** Form `2.98` durchgehend die Fallnummer
und wird als Zeitmarke benutzt, "seit der Welle, die Fall 2.92 brachte". Das
steht so in Dutzenden Kommentaren aus früheren Ausgaben und ist keine
Verwechslung. Falsch ist nur die dreistellige Form. Ich habe zunächst beide
angefasst, 41 Stellen; die 26 zweistelligen waren nach Hausbrauch richtig. Sie
stehen jetzt trotzdem als Ausgabe da, und für die sichtbaren Texte ist das der
bessere Stand: Ein Nutzer, der "Seit 2.98" auf einer Konsolenseite liest, kann
mit der Zahl nichts anfangen, weil Fallnummern nur intern existieren. In den
Kommentaren ist es Rauschen, das ich nicht zurückgedreht habe.

Der neue Vertrag `version-reference-contract` prüft darum genau die
dreistellige Form und nur die eine Richtung, die immer falsch ist: grösser als
die ausgelieferte Version. Er hat beim ersten Lauf vier weitere Stellen
gefunden, die ich von Hand übersehen hatte, darunter zwei aus älteren
Ausgaben. Die Mutationsprobe fiel mit `2.99.0`.

**Zwei Schnitte vergaben dieselbe Fallnummer, wieder.** Diesmal waren die
Nummern vorab verteilt, und trotzdem musste die Zahl in `STATUS.md` beim Merge
korrigiert werden: Jeder Zweig setzte sie für sich auf 64, richtig ist 65. Der
Vertrag `status-module-counts` hat es gefangen. Die Migrationsnummern 0067 und
0068 blieben unbenutzt, weil zwei Schnitte keine Migration brauchten; die Lücke
bleibt, weil 23 Stellen auf `0069` verweisen und Lücken die Reihenfolge nicht
brechen.

**Ein Agent hat einen parallelen Lauf selbst für ungültig erklärt.** Seine
Prüfung auf fremde Stacks stand in derselben Befehlskette wie der Start und
konnte ihn nicht mehr stoppen. Er hat es gemeldet, den Lauf nicht gewertet, das
Log nicht archiviert und ihn allein auf der Maschine wiederholt. Der andere
Agent hat seine eigenen Läufe geprüft und begründet als gültig behalten.

**Die Worktrees teilen ihre `node_modules` nicht.** Nach dem Merge war `tsc` rot,
weil die neue devDependency des S3-Schnitts in `node_modules` von main fehlte.

## Ehrlich offen

- **Im Browser nicht gesehen**, weiterhin. Keine der drei neuen Ansichten ist angeklickt worden.
- **Die AWS CLI und rclone haben den Endpunkt nicht gesehen.** Multipart bleibt 501, und die CLI teilt ab 8 MiB von sich aus; darum steht `multipart_threshold` in den Texten.
- **Inhaltslogs erreichen keinen Log-Drain.** Der Zeitpunkt je Zeile ist der Eingang beim Host, nicht die Schreibzeit im Container.
- **GraphQL kennt kein Upsert**, keine Beziehungen in Mutationen und keine tiefen Joins. Constraint-Verletzungen laufen weiter als 503.
- **Es gibt keine Metrik für Schreibzeilen.** Schreiben zählt nur als `api_requests`. Ob QKERN eine eigene Schreibmetrik braucht, ist offen.
- **Eine reine Schreibspalte nimmt REST an, GraphQL weist sie ab.** Die Eingabetypen nennen nur Spalten mit Leserecht.
