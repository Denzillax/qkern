# Release 2.73.0 – Ein Teil aus einem Objekt, ein Anschluss nach draussen, und ein Backup, das es nie gab

Drei Schnitte, und einer davon schliesst die Zusage, die Supabase-Kunden
eigentlich kaufen: dass ihre Datenbank gesichert ist. Bei uns war bisher nur die
Steuerungsdatenbank gesichert, und das stand nirgends klar.

## Was neu ist

- Eine Projektdatenbank wird gesichert, verschlüsselt im Objektspeicher abgelegt und in eine **neue** Datenbank zurückgeholt, mit einer Probe, die Schema, Zeilen, Policies und die Mandantengrenze nachrechnet.
- `traceparent` geht jetzt in beide Richtungen: der Claim gibt ihn dem Worker, der Webhook trägt ihn hinaus.
- Der S3-Endpunkt kopiert ein Teil aus einem vorhandenen Objekt und listet wieder in der alten Form mit `marker`.
- Backup-Stack von 1 auf 2 Fälle, Empfänger von 16 auf 17, Storage von 11 auf 12, PostgreSQL von 253 auf 254, lokale Suite von 2513 auf 2549.

## Das Backup, das es für Projektdaten nie gab

Seit `2.29.0` gibt es ein Backup mit Wiederherstellung, zertifiziert, mit
WAL-Archiv und Zeitpunkt. Es sichert die **Steuerungsdatenbank**. Eine
Projektdatenbank eines Mandanten ist nie gesichert und nie wiederhergestellt
worden, und die Console behauptete dazu „kein Produktweg" und „kein Katalog".

Jetzt gibt es beides, und der Weg ist an mehreren Stellen bewusst eng:

**Gefahren wird es vom vorhandenen Provisioner**, nicht von einem neunten
Prozess. Er ist der einzige Prozess mit einem privilegierten Weg zu einer
Projektdatenbank, und das Ziel einer Wiederherstellung ist eine **neue**
Datenbank. Ein neunter Prozess wäre eine zweite Stelle mit `CREATEDB` im
Cluster. Ein wartender Projektauftrag geht immer vor, weil dort ein Kunde
wartet.

**Die Rolle ist eine eigene**, und der Fall belegt, warum: Unter der Rolle der
Data API sieht ein Mandant 6 von 10 Zeilen, der Backup-Weg sichert 10. Ein
Backup, das unter der Lesebrille der Anwendung läuft, ist kein Backup. Das
Passwort kommt aus dem Vault und geht an `pg_dump` über die Umgebung, nie in
`argv`.

**Der Dump ist logisch, nicht physisch**, und das ist keine Bequemlichkeit:
`pg_basebackup` zieht den ganzen Cluster und damit fremde Mandanten mit.

**Wiederhergestellt wird nie über die lebende Datenbank.** In diesem Weg steht
kein `DROP DATABASE` und kein `TRUNCATE`, und ein Vertrag prüft das.

**Der Betreiber kann ein Backup lesen.** Verschlüsselt ist es zweistufig, mit
einem Datenschlüssel je Backup und einem Mandanten-Schlüssel aus dem Vault,
beide binden Organisation, Projekt, Umgebung und Backup-Id. Aber kundengehaltene
Schlüssel gibt es nicht. Das steht im Quelltext, im Dokument und hier, weil es
eine Aussage über das Produkt ist und nicht ein Detail.

**Sechs echte Fehler hat dieser Schnitt gefunden**, und fünf davon hat erst der
Lauf gegen echte Dienste gezeigt:

- Eine Regex-Wiederholung über 255 ist in PostgreSQL ungültig. Das `CREATE TABLE` nimmt sie an und sie fällt erst beim **ersten Schreiben**. Dump, Manifest, Verschlüsselung und Upload liefen durch, und die Zeile kam nicht zustande.
- `ORDER BY <alias> COLLATE "C"` verweist nicht auf die Ausgabespalte. Sobald eine Klausel dazukommt, ist es ein Ausdruck über die Eingabespalten, und den Alias gibt es dort nicht.
- Eine Zieldatenbank, die der Wiederherstellende selbst besitzt, lässt `ALTER … OWNER TO` scheitern: PostgreSQL verlangt, dass der **neue** Eigentümer `CREATE` auf dem Schema hat. Die Wiederherstellung brach nach dem halben Dump ab.
- Die einspeisbare Uhr des Dienstes darf nicht die Uhr des SigV4-Signierers sein. Mit der um 31 Tage vorgestellten Uhr des Aufbewahrungsfalls antwortete der Objektspeicher mit `RequestTimeTooSkewed`. Geschäftszeit und Protokollzeit sind getrennt.
- Der Healthcheck des Stacks hing an einem Passwort, das der Vault beim Anlegen der Rolle dreht, und erklärte den Container danach dauerhaft für krank.
- Ein unquotiertes Heredoc mit Backticks im Kommentar führt Kommandos aus.

## Der Anschluss hört nicht mehr an der Grenze auf

`2.72.0` hat eine Spur je Queue-Nachricht gebracht und dabei selbst notiert, dass
QKERN den Anschluss nicht weitergibt. Jetzt erzeugt QKERN **eigene Span-Ids**,
eine je Station, der Claim gibt dem Worker einen gültigen `traceparent`, und eine
Webhook-Zustellung trägt ihn hinaus.

Drei Entscheidungen, die den Ausschlag gaben:

- **Ohne Kopf von draussen erfindet QKERN keine Spur-Id.** Eine erfundene hätte draussen genau einen Teilnehmer und wäre in der Trace-Route von einem echten Anschluss nicht unterscheidbar.
- **`tracestate` geht nicht mit.** Ein durchkopierter Blob wäre eine Nutzlast auf einer Logfläche, und genau die Stelle, an der ein Geheimnis in einer Kopfzeile hinausreist.
- **Die Kopfzeile nach draussen wird nicht signiert.** Ein Proxy, der Tracing-Köpfe anfasst, liesse ein echtes Ereignis sonst mit 401 abweisen.

Die Span-Id liesse sich auch aus Nachrichten-Id und Stationsnummer ableiten, und
das wäre falsch: QKERN gibt die Nachrichten-Id in der Quittung heraus, die Span
wäre damit nachrechenbar und als Kind in eine fremde Spur hängbar. Dazu kann eine
Stationsnummer nach einem Schnitt des Aufräumers wiederkehren.

**Ein ausgelieferter Fall hat einen Entwurf umgeworfen.** Der erste Versuch liess
eine wiedereingereihte Nachricht an der letzten Station ihrer Quelle hängen, mit
dem Argument, verursacht habe das Wiedereinreihen das Dead Letter und nicht der
Aufruf von vorletzter Woche. `(2.121)` prüft aber, dass der Eltern-Span der von
draussen bleibt. Zeigt er bei einem Replay auf eine Station von QKERN, hat eine
Spalte zwei Bedeutungen. Der Entwurf wurde zurückgenommen, nicht der Fall.

**Und `2.72.0` hat einen Formatierer ohne einen einzigen Aufrufer im Produkt
ausgeliefert.** `formatProjectQueueTraceparent` wurde nur von einem Unit-Test
gerufen. Das ist dasselbe Muster wie das Aufrufprotokoll aus `2.67.0` und der
Realtime-Start aus `2.68.0`: grün geprüft und auf keinem Weg. Jetzt hat sie zwei
Aufrufer.

## Ein Teil kopieren, und die alte Liste

`UploadPartCopy` nimmt den Leseweg von `CopyObject` und den Schreibweg von
`UploadPart`, beide Teile-Operationen teilen jetzt eine Methode, damit es keine
zweite Tür an Buchung, Quota und Vermerk vorbei gibt. `ListObjects` Version 1
läuft durch denselben Durchlauf wie Version 2, damit Delimiter und Gruppen nicht
in zwei Formen auseinanderlaufen.

Die Prüfsumme rechnet QKERN aus den Bytes, die vom Anbieter zurückkommen. Eine
mitgeschickte Prüfsumme des Clients wird **abgewiesen** statt ignoriert, weil der
Client die Bytes nie gesehen hat. Gefahren hat beides das AWS SDK gegen echtes
versitygw und echtes ClamAV.

## Was der Prüfaufbau über sich verriet

Der S3-Schnitt fand, dass `scripts/storage-certification.mjs` die Variable
ignorierte, mit der ein paralleler Schnitt seinen Stack benennt. Zwei Schnitte am
selben Stack bekommen damit dieselben Containernamen, und das Aufräumen des einen
reisst den Lauf des anderen ab. Der Fehlschlag sieht dann wie ein Befund des
Produkts aus.

Nachgesehen, ob das ein Einzelfall war: **drei weitere Läufer** trugen einen
festen Projektnamen im Quelltext, Backup, Empfänger und Vault, also genau die
Stacks, die zwei der drei Schnitte dieser Welle brauchten. Ein Vertrag hält es
jetzt für alle acht Läufer, mit der Zusage, dass die Variable je Datei **genau
einmal** gelesen wird, weil zwei Lesungen auseinanderlaufen und `down` dann einen
anderen Stack abräumt als `up` gestartet hat.

Dazu eine Zahl, die niemand nachrechnen konnte: `STATUS.md` behauptete 14
Empfänger-Fälle für die Compute Contracts. Nachgezählt sind es 13, acht am
Zustellweg und fünf am Egress; die übrigen vier des Laufs gehören zum Control
Plane. Die Aufteilung steht jetzt in der Zelle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 254/254, exit 0 | `docs/evidence/2026-10-02/welle25-run1.manifest.json` |
| PostgreSQL 17, 254/254, exit 0 | `docs/evidence/2026-10-02/welle25-run2.manifest.json` |
| versitygw und ClamAV, 12/12, exit 0 | `docs/evidence/2026-10-02/welle25-storage.manifest.json` |
| Echter HTTPS-Empfänger, 17/17, exit 0 | `docs/evidence/2026-10-02/welle25-receiver.manifest.json` |
| Backup und Restore gegen TLS-PostgreSQL, 2/2, exit 0 | `docs/evidence/2026-10-02/welle25-backup.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL, 19/19, exit 0 | `docs/evidence/2026-10-02/welle25-realtime.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 33/33, exit 0 | `docs/evidence/2026-10-02/welle25-functions.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-10-02/welle25-auth.manifest.json` |
| Webhook-Signatur gegen echten Vault, 8/8, exit 0 | `docs/evidence/2026-10-02/welle25-vault.manifest.json` |
| Mutation der Claim nennt eine fremde Span, 253/254, exit 1 | `docs/evidence/2026-10-02/welle25-mutation-claimspan.manifest.json` |
| Mutation die Zustellung lässt `traceparent` weg, 16/17, exit 1 | `docs/evidence/2026-10-02/welle25-mutation-noheader.manifest.json` |
| Mutation die Teilkopie ignoriert den Bytebereich, 11/12, exit 1 | `docs/evidence/2026-10-02/welle25-mutation-copyrange.manifest.json` |
| Mutation die Backup-Policy liest ohne Mandantengrenze, 1/2, exit 1 | `docs/evidence/2026-10-02/welle25-mutation-backuptenant.manifest.json` |
| Vitest lokal 2549/2549, exit 0 | `docs/evidence/2026-10-02/welle25-local-run1.manifest.json` |
| Vitest lokal 2549/2549, exit 0 | `docs/evidence/2026-10-02/welle25-local-run2.manifest.json` |

## Ehrlich offen

- **Das Backup geht durch den Speicher**, mit Obergrenze 256 MiB. Für eine echte Mandantendatenbank ist das zu klein, und ein stückweiser Weg fehlt. Der Dump im Fall ist 14 kB, also ist die Grenze selbst durch keinen Lauf geprüft.
- **Kein Zeitpunkt für Projektdaten.** Ein logischer Dump ist ein Zeitpunkt; eine Wiederherstellung auf eine beliebige Sekunde bräuchte ein WAL-Archiv je Projektdatenbank.
- **Keine Route und kein Knopf für ein Backup.** Ein Auftrag entsteht über den Dienst, und die Console liest den Katalog nicht. Es gibt auch keinen Zeitplan, der Aufträge einstellt.
- **Der Backup-Prozess ist als laufender Prozess nicht belegt.** Der Fall ruft die Runde direkt; kein Stacklauf startet den Provisioner mit eingeschalteter Backup-Pflicht. Das ist die schwächere Aussage, und sie steht so da.
- **Kundengehaltene Schlüssel fehlen**, und die Rotation eines Mandanten-Schlüssels ist durch keinen Fall belegt.
- **Kein Sammler setzt den Anschluss von sich aus.** Change Feed, Audit-Kette und Log-Protokoll tragen keinen `traceparent`; in `(2.125)` kommt er aus einer echten Queue-Nachricht über ihren Claim. QKERN spricht kein OTLP und exportiert keine Spans.
- **Keine Suche nach einer Spur-Id**, unverändert offen seit `2.72.0` und jetzt wahrscheinlicher gefragt, weil QKERN in fremden Spuren drinsteht.
- **Die AWS CLI und rclone haben den S3-Endpunkt nie gesehen.** Beide brauchen einen laufenden Next-Server im Stack, und den gibt es dort nicht. `max-keys=0` antwortet bei uns mit einem Fehler, wo S3 eine leere Liste gibt, und ein Aufrufer kann dieselbe Gruppe über zwei Seiten zweimal sehen.
- **Die Console ist weiterhin ungesehen.** Sie liegt hinter der Anmeldung, und ein Konto anlegen darf nur Denzil selbst.
