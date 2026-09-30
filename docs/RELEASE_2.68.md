# Release 2.68.0 – Der Start, den es nie gab, und der letzte Anmeldeweg

Drei Schnitte parallel, und die letzte Sprosse der Leiter, die auf dieser
Maschine zu bauen war, ist gebaut. Der schwerste Fund ist wieder keiner der
drei: Ein Prozess konnte unter Production seit `1.11.0` gar nicht anlaufen,
und niemand hatte es je versucht.

## Was neu ist

- Realtime läuft unter `production` gegen ein echtes TLS-PostgreSQL, und die Verbindung ist in der Datenbank als `verify-full` nachgelesen.
- SAML 2.0 als Anmeldeweg, ohne fremde Bibliothek, mit vierzehn einzeln belegten Fälschungsversuchen.
- Multipart am S3-Endpunkt, und das AWS SDK hat von sich aus geteilt.
- Die Console war zum ersten Mal in einem Browser, und das hat zwei Fehler gezeigt.
- PostgreSQL-Zertifizierung von 232 auf 234 Fälle, Auth von 7 auf 10, Storage von 10 auf 11, lokale Suite von 2383 auf 2421.

## Der Start, den es nie gab

Seit `1.73.0` steht vor dem Production-Start von Realtime ein Tor mit benannten
Bedingungen statt eines Verbots. Belegt war der Start trotzdem nie, und der
Grund lag tiefer als das Tor.

`workers/realtime-runtime.mts` baute die `LISTEN`-Verbindung des Fan-outs mit
`new Client({ connectionString })` auf, **ohne jede TLS-Angabe**. Sie las die
Adresse selbst und liess `DATABASE_SSL` liegen. Gegen ein PostgreSQL, das
Klartext abweist, scheiterte sie; und weil `eventBus.subscribe()` vor
`runtime.listen()` läuft und der dauerhafte Log unter Production Pflicht ist,
kam der Prozess dort gar nicht hoch. Der Fehler steht seit `1.11.0` im Code und
war unsichtbar, solange niemand ein TLS-PostgreSQL davorstellte.

Der neue Stack stellt eins davor, mit einer **eigenen CA** statt eines
selbstsignierten Blattes: Node verlangt für `NODE_EXTRA_CA_CERTS` einen Anker
mit `CA:true`, libpq nimmt das Blatt, Node nicht, und der Realtime-Prozess
spricht Node. Der Server trägt `postgres.qkern.test` als Alias und als SAN, der
Dienstname `postgres` nicht; damit ist die Hostnamensprüfung gegenprüfbar. Elf
Fälle lesen in `pg_stat_ssl`, dass jede Verbindung wirklich TLS 1.3 fährt, und
fünf davon nehmen dem Tor je eine Bedingung weg und verlangen, dass der Start
fällt statt in einen schwächeren Modus zu rutschen.

**Was weiterhin nicht geht**: Postgres Changes sind unter `production`
unerreichbar. Der Katalog verlangt dort eine vault-gestützte Einspeisung, die
der Migrations-Prozess hat und der Realtime-Prozess nicht. Das Tor nennt diese
Bedingung nicht, weil sie nicht im Tor steht. Es ist niemand hingegangen und hat
Rechte ausgeweitet, um einen grünen Lauf zu bekommen; der Punkt steht offen.

## SAML, und was eine Signatur alles nicht beweist

Der Weg ist SP-initiiert, HTTP-POST für die Antwort, ohne fremde
SAML-Bibliothek, mit eigener exklusiver Kanonisierung. Vierzehn Fälschungen
fallen einzeln durch die echte Route, und der Fall prüft am Ende die **Menge
der Audit-Gründe**, damit keine Ablehnung aus dem falschen Grund kommt:

- Signatur fehlt, und der schwierigere Fall: Signatur deckt **nur die Hülle**, ist echt und prüft durch, aber die Assertion ist ungedeckt.
- XML Signature Wrapping: eine zweite, unsignierte Assertion daneben.
- `NotBefore`, `NotOnOrAfter`, `SubjectConfirmationData` abgelaufen oder zu früh.
- `Destination`, `Recipient`, `Audience`, `InResponseTo` zeigen woandershin.
- Fremdes Zertifikat, mit und ohne `KeyInfo`.
- Nach der Signatur geänderte Assertion.
- Replay derselben Assertion, gehalten von einer Eindeutigkeitsbedingung in Migration 0070.

Angenommen wird ein enger Ausschnitt von XML, und was abgelehnt wird, steht im
Handbuch: keine Kommentare, kein `DOCTYPE`, keine Entity-Deklaration, kein
CDATA, keine Verarbeitungsanweisungen, nur exc-C14N, nur sha256, nur rsa-sha256
und ecdsa-sha256, genau eine Referenz.

**Der IdP ist selbst gebaut.** Eigenes RSA-Paar, echtes X.509, echte Signatur,
kryptografisch eine echte Gegenstelle, aber kein SimpleSAMLphp und kein
Keycloak. Interoperabilität ist damit **nicht** belegt, und das ist der
Unterschied zu OIDC, wo seit `1.76.0` zwei echte Dex-Instanzen mitspielen.

## Multipart, und zwei Fehler, die nur die echte Datenbank zeigt

`CreateMultipartUpload`, `UploadPart`, `ListParts`, `ListMultipartUploads`,
`CompleteMultipartUpload`, `AbortMultipartUpload`. Der harte Punkt: Der
fortsetzbare Upload über REST verlangt Grösse und Prüfsumme **vorher**, ein
S3-Client nennt beides bei `CreateMultipartUpload` nicht. Also gibt es eine
zweite Sorte Reservierung, die bei null Bytes beginnt und mit jedem Teil
wächst, jedes Teil unter derselben Quota.

Der erste Lauf im PostgreSQL-Stack fiel mit **sieben roten Fällen**, fünf davon
bestehende:

- **Die neue Teiletabelle hatte keine Rechte für `qkern_runtime`** und keine Zeilensicherheit. Weil der Abschluss jetzt Teile wegräumt, brach damit der bestehende Upload-Weg unter echten Rechten.
- **Der Wächter aus 0025 hält Grösse und Prüfsumme einer Reservierung fest**, genau die zwei Spalten, die dieser Weg bewegen muss.

Die Lockerung ist eng: `parts_declared` steht selbst in der unveränderlichen
Liste, lässt sich also nachträglich nicht setzen; die Grösse bewegt sich nur
dort, die Prüfsumme genau einmal von NULL weg, und eine abgeschlossene Zeile
muss beides tragen. Für den REST-Weg bleibt alles unbeweglich.

**Das AWS SDK hat von sich aus geteilt**: 12 MiB in drei Teilen, und der Fall
liest am Server mit, dass genau ein `POST ?uploads`, drei `PUT ?partNumber` und
ein Abschluss ankamen, jedes Teil mit der CRC32, die der Client selbst
gerechnet hat.

## Die Console, zum ersten Mal in einem Browser

Seit rund zwanzig Ausgaben endet jede Release Note mit "im Browser nicht
gesehen". Diesmal war jemand dort, ohne sich anzumelden, und hat zwei Fehler
gefunden, die kein Test sehen konnte:

- **Das Thema blitzte falsch auf.** Der Umschalter speicherte die Wahl seit Langem, gesetzt hat sie erst ein Effekt nach der Hydration; das ausgelieferte HTML trug kein `data-theme`. Wer Hell wählte und ein dunkles System hat, sah auf jeder Seite zuerst Dunkel.
- **Die englische Seite sprach Deutsch, wo niemand hinsieht.** Der Themenknopf hiess "Dark Mode aktivieren", beide Navigationen trugen `aria-label="Hauptnavigation"`. Sichtbar war nichts davon; ein Screenreader liest es vor.

Zwei weitere Verdachtsmomente haben sich bei der Prüfung erledigt: Die
StableLabel-Knöpfe setzen `aria-hidden` auf ihre Geisterbeschriftungen korrekt,
und der Sprachwechsel wirkt sofort. Die Console selbst liegt hinter der
Anmeldung und bleibt ungesehen.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 234/234, exit 0 | `docs/evidence/2026-09-30/welle20-run1.manifest.json` |
| PostgreSQL 17, 234/234, exit 0 | `docs/evidence/2026-09-30/welle20-run2.manifest.json` |
| Mailpit und Dex, 10/10, exit 0 | `docs/evidence/2026-09-30/welle20-auth.manifest.json` |
| versitygw und ClamAV, 11/11, exit 0 | `docs/evidence/2026-09-30/welle20-storage.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL, 11/11, exit 0 | `docs/evidence/2026-09-30/welle20-realtime.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 32/32, exit 0 | `docs/evidence/2026-09-30/welle20-functions.manifest.json` |
| Mutation die SAML-Signatur wird nicht geprüft, exit 1 | `docs/evidence/2026-09-30/welle20-mutation-samlsig.manifest.json` |
| Mutation der Abschluss nimmt eine fehlende Prüfsumme hin, exit 1 | `docs/evidence/2026-09-30/welle20-mutation-mpchecksum.manifest.json` |
| Mutation das Tor prüft die Aufbewahrung nicht, exit 1 | `docs/evidence/2026-09-30/welle20-mutation-rtgate.manifest.json` |
| Mutation das Themenskript läuft mit `defer`, exit 1 | `docs/evidence/2026-09-30/welle20-mutation-theme.manifest.json` |
| Mutation deutsche Beschriftung in einem Website-Baustein, exit 1 | `docs/evidence/2026-09-30/welle20-mutation-sitelabels.manifest.json` |
| Vitest lokal 2421/2421, exit 0 | `docs/evidence/2026-09-30/welle20-local-run1.manifest.json` |
| Vitest lokal 2421/2421, exit 0 | `docs/evidence/2026-09-30/welle20-local-run2.manifest.json` |

Die Läufe der drei Agenten auf ihren Zweigen liegen daneben.

## Nachtrag zum Verfahren

**Drei Anläufe für eine Probe, und am Ende war sie doch ein Befund.** Die
Multipart-Probe brauchte vier Versuche, und die ersten drei waren meine Fehler:
erst der falsche Stack (der Fall `(2.101)` liegt im PostgreSQL-Stack, nicht im
Storage-Stack), dann ein Lauf unter Speicherdruck mit zwölf Zeitfällen, dann
ein Schnitt im Dienst statt an der Sperre, die die Zusage wirklich hält.

Der vierte Versuch sass richtig, an der CHECK-Bedingung aus 0071, **und der
Fall blieb trotzdem grün**. Das war der Befund: Die Zusage "abgeschlossen
heisst, die Prüfsumme steht" wurde von zwei Sperren gehalten, und die Erwartung
war eine Alternative aus drei Mustern. Fällt der CHECK weg, springt der Wächter
aus 0025 ein und wirft `immutable`, also merkt niemand etwas. Der Fall nennt
jetzt beide Sperren einzeln, jede an einer Zeile, die nur sie halten kann.
Dieselbe Mutation lässt ihn seither fallen.

Dieselbe Klasse wie `(2.60)`, wo ein `not.toContain("4711")` eine zufällige
UUID traf: eine Erwartung, die aus dem falschen Grund erfüllt werden kann.

**Ein Exit-Code allein widerlegt auch nichts.** Die erste SAML-Probe scheiterte
am `npm ci` im Container mit `ECONNRESET`, also am Netz, und meldete `exit 1`
ohne einen einzigen Test. Die zweite Fassung mutierte eine Vorbelegung, die im
`try` sowieso überschrieben wird, und war damit wirkungslos. Erst die dritte
sitzt am Urteil selbst und lässt genau einen Fall fallen.

**Ein Vertrag, der zu breit filtert, verdeckt mehr als er erlaubt.** Der
Versionsvertrag aus `2.67.0` übersprang ganze Zeilen, die ein Fremdwort wie
"Image" enthalten, und hat damit sofort einen echten Fehler durchgelassen: "bis
`2.97.0` gab es die Ausgabe nicht, das Image schon". Er sieht jetzt nur noch
vierundzwanzig Zeichen vor der Zahl nach einem fremden Namen.

**Die Sperrdatei hinkte der Version hinterher.** Der Versionssprung am
Release-Schnitt fasst `package.json` an, nicht `package-lock.json`; sie stand
auf `2.66.0`, während das Paket `2.67.0` sagte, und ein Agent ist beim
Installieren darüber gestolpert. Der Versionsvertrag prüft jetzt beide Zahlen
gegeneinander.

**Die Worktrees teilen ihre `node_modules` nicht.** Zum zweiten Mal war `tsc`
nach einem Merge rot, weil eine neue devDependency in `node_modules` von main
fehlte.

## Ehrlich offen

- **Postgres Changes unter `production` sind unerreichbar.** Der Realtime-Prozess hat keinen vault-gestützten Katalog.
- **Kein fremder IdP hat SAML gesehen.** Keine signierte `AuthnRequest`, kein Single Logout, keine Metadaten-Route, keine IdP-initiierte Anmeldung, keine verschlüsselten Assertions. Der Aufräumer aus 0063 nimmt die Assertionstabelle noch nicht, sie wächst.
- **Ein vorhandener Schlüssel wird beim Anfang eines Multipart-Uploads gelöscht**, weil die Reservierung ihn exklusiv hält. Bricht der Upload ab, ist das alte Objekt weg und kein neues da. Bei einem Upload in einem Stück ist dasselbe Fenster Millisekunden lang, hier so lang wie der Upload.
- **`UploadPartCopy` fehlt.** Die AWS CLI und rclone haben den Endpunkt weiterhin nicht gesehen; gespielt hat nur das SDK.
- **Die Console selbst ist weiterhin ungesehen**, weil sie hinter der Anmeldung liegt.
- **Damit ist die Abbauliste leer.** Was bleibt, braucht Infrastruktur ausserhalb dieser Maschine: ein Broker, der wirklich Datenbanken einrichtet, ein Backup einer Projektdatenbank mit Restore-Drill, Registry-Publishing des SDK, kommerzielle Auth-Provider mit echten Konten, CDN und Bildtransformation, und die Zahlungsanbindung.
