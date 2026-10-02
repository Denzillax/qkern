# Release 2.74.0 – Fremde Clients, eine Spur mit Suche, und ein Backup ohne Deckel

Drei Schnitte, und bei allen dreien hat erst ein Lauf gegen echte Dienste
gezeigt, was eine Behauptung wert war. Zwei Abweichungen von S3 fand nicht
unser Test, sondern die AWS CLI. Zwei Fehler im Backup fand nicht die lokale
Suite, sondern der erste Stacklauf.

## Was neu ist

- Die AWS CLI und rclone fahren den S3-Endpunkt, mit eigenen Implementierungen statt mit dem SDK desselben Herstellers.
- Eine Spur lässt sich nach ihrer Spur-Id durchsuchen, und eine Anwendung darf die Spur ihrer **eigenen** Nachricht lesen.
- Das Backup einer Projektdatenbank geht stückweise, ist über eine Route bestellbar und läuft nach einem Takt. Die Obergrenze steigt von 256 MiB auf 625 GiB.
- PostgreSQL von 254 auf 256 Fälle, Storage von 12 auf 14, Backup von 2 auf 3, lokale Suite von 2549 auf 2604.

## Was ein fremder Client findet

Den S3-Endpunkt hat immer nur das AWS SDK für JavaScript gefahren. Ein SDK vom
selben Hersteller wie die Signaturspezifikation ist ein schwacher Zeuge: Es
macht dieselben Annahmen wie die Spezifikation, aus der wir gebaut haben.

Jetzt fahren ihn die **AWS CLI** und **rclone** im Zertifizierungsstack. Der
naheliegende Weg dorthin wäre ein Next-Dienst im Compose gewesen, und er wurde
verworfen, mit Begründung: Er hätte PostgreSQL, Migrationen und Provisionierung
in den Storage-Stack gebracht und den Lauf von 62 Sekunden auf ein Vielfaches
gezogen. Ein Stack, der fünfzehn Minuten braucht, wird nicht mehr gefahren.
Stattdessen laufen die Clients als Kindprozesse gegen die HTTP-Brücke, die der
Fall selbst öffnet. Gemessen: 62 Sekunden vorher, 134 nachher, davon 18 für das
Nachinstallieren der Werkzeuge.

**Beide in `2.73.0` benannten Abweichungen sind echt**, und beide sind behoben:
`max-keys=0` gab einen Fehler, wo S3 eine leere Liste gibt, und
`aws s3api list-objects --max-keys 0` brach damit ab. Und derselbe
Gruppeneintrag stand auf zwei Seiten, was `aws s3 ls --page-size 2` sofort
zeigte. Ein Schlüssel in einer bereits genannten Gruppe zählt jetzt nicht gegen
`max-keys` und schneidet darum nicht ab.

**Was die CLI anders macht als das SDK**, und warum sie den Aufwand wert war:
Sie bringt eine eigene Implementierung in C mit, puffert die Datei, signiert die
Nutzlast als Ganzes und legt die Prüfsumme in eine **Kopfzeile** statt als
Trailer hinter `aws-chunked`. Ihr Standard ist CRC64NVME, nicht CRC32, und sie
fragt mit `Expect: 100-continue` nach. Dieser Weg war von keinem echten Client
gefahren. Dass ihre CRC64NVME Byte für Byte mit unserer stimmt, sind zwei
unabhängige Implementierungen desselben Polynoms, die sich einig sind.

**Ein Fehler, den der Schnitt fand und liegenliess**, weil er nicht zu ihm
gehörte, und der danach behoben wurde: Im Modus `memory` bauten sich der
Storage-Dienst und der S3-Schlüsseldienst je ihre eigene Bucket-Ablage. Die Maps
liegen in der Instanz, also sah der Schlüsseldienst keinen Bucket des anderen,
und ein Schlüsselpaar liess sich gar nicht ausstellen. Der S3-Endpunkt war im
Modus der Entwicklungsumgebung unbenutzbar.

## Eine Spur, die man suchen kann

`2.72.0` brachte die Spur je Nachricht, `2.73.0` die Span-Ids und den Anschluss
nach draussen. Seitdem steht QKERN in fremden Spuren drin, und damit wird die
Frage „welche Nachrichten gehören zu dieser Spur" wirklich gestellt.

Der Index trägt den Scope vorn, und das ist nicht Geschmack: Eine Spur-Id
entsteht in einem fremden Dienst, und zwei Organisationen hinter demselben
Gateway können dieselbe tragen. `queue_id` steht bewusst nicht drin, weil eine
fremde Spur durch die **Umgebung** läuft und nicht durch eine Queue. Er ist ein
Teilindex, weil der Anschluss nur auf der ersten Station liegt, und genau das
ist zugleich die Zusage, die die Antwort braucht: höchstens eine Zeile je
Nachricht, ohne `DISTINCT`.

**Die Grenze zwischen Anwendung und Betreiber** ist die interessantere Hälfte.
Die Nachrichten-Id ist nur die halbe Bedingung, denn QKERN gibt sie in der
Quittung heraus; die andere Hälfte ist der Besitzer aus Migration `0026`. Den
Wirt einer Nachricht sieht eine Anwendung **strukturell** nicht: Der Typ hat das
Feld nicht. Der Preis steht im Quelltext: Ist die Nachricht weggeräumt, gibt es
keinen Besitzer mehr zum Vergleichen, und ein Endnutzer bekommt nichts.

Das MCP-Werkzeug hängt an `queues:read`, nicht an einem neuen Bereich.
`project:read` sagt etwas über die Gestalt der Umgebung, `logs:read` etwas über
Personen, und eine Spur nennt keinen Akteur. Es läuft über OAuth als der
zustimmende Nutzer.

**Zum Verfahren:** Der erste Versuch der Mutationsprobe liess die Abfrage mit
einem Datenbankfehler scheitern. Der Fall fiel zwar, belegte damit aber nur,
dass er diese Abfrage überhaupt anfasst, nicht die Grenze. Die Probe wurde
semantisch wiederholt.

## Ein Backup ohne Deckel

Die Grenze von 256 MiB fällt auf **625 GiB**, und die Zahl ist gerechnet statt
gesetzt: nutzbare Bytes je Teil mal Teilegrenze des S3-Protokolls. Geprüft wird
dieselbe Rechnung mit 5 MiB mal 2 gegen einen Dump von 12,6 MB, also ohne
Gigabytes durch die Maschine zu schieben.

**Strom statt Datei**, und zwar nicht wegen Platz: Eine Datei auf der Platte
wäre ein **entschlüsselter** Dump einer Mandantendatenbank auf einem Wirt des
Betreibers.

**Ein Siegel je Teil**, dessen AAD Nummer, ein Endezeichen und das Tag des
Vorgängers bindet. Damit hält es gegen Vertauschen, Weglassen in der Mitte,
Abschneiden am Ende und Einfügen. Die Gesamtzahl steht bewusst **nicht** in der
AAD: Beim Siegeln des ersten Teils ist sie unbekannt, und sie zu kennen hiesse,
den ganzen Dump vorher zu puffern.

Der Preis steht ausgeschrieben im Quelltext: Der SHA-256 über das ganze Artefakt
ist nicht mehr der Riegel **vor** dem Lesen, sondern fällt am Ende. An seine
Stelle tritt das GCM-Tag je Teil, eine geschlüsselte Prüfung und damit die
schärfere. Tragbar ist das nur, weil eine Wiederherstellung in eine **neue**
Datenbank geht.

**Zwei echte Fehler, beide vom Stacklauf gefunden und nicht von der lokalen
Suite.** Der Takt hielt einen fremden Auftrag für seinen eigenen, weil er „der
vorige läuft noch" aus drei Anzeichen rekonstruierte; ein Auftrag, den die Route
zwischen zwei Takten einstellt, trägt keines davon. Ausgefallen ist dadurch
genau die Zahl, an der ein Betreiber sieht, dass sein Takt kürzer ist als ein
Dump dauert. Und eine Wiederherstellung liess sich nach einem Fehlschlag nicht
neu bestellen, weil eine Zusicherung verlangte, dass ein Fehlercode genau dann
dasteht, wenn der Zustand `failed` ist.

**Und eine Probe, die zu viel traf.** Der erste Entwurf liess den **letzten**
Teil weg und riss damit auch den alten Fall `(2.126)` mit, weil der ein Backup
mit einem einzigen Teil fährt. Die Kette wirkt erst ab dem zweiten Teil. Die
Probe wurde umgebaut, nicht das Ergebnis genommen.

## Was der Prüfaufbau über sich verriet

**Vier Läufe der Kette zu `2.73.0` fütterten die Startseite nicht.** Die
Beschriftung eines Laufs kommt vom Aufrufer des Manifest-Skripts und nicht vom
Läufer, die Seite sucht aber exakte Zeichenketten. Eine, die nicht in ihrer
Liste steht, fällt still durch: Das Manifest liegt im Archiv, der Lauf war grün,
und die Seite zeigt weiter die Zahl eines älteren Laufs. Für den
HTTPS-Empfänger stand dort 16 statt 17, für Backup 1 statt 2.

**Und Realtime fehlte auf der Startseite überhaupt.** Der Stack läuft seit
Releases, hat 19 Fälle und steht in `STATUS.md`, war aber in der Liste der
Ansprüche nie eingetragen. Die Seite nannte sieben Prüfstände, die Doku schrieb
die Sieben aus derselben Quelle. Es sind acht.

Ein Vertrag hält das jetzt: Jede Beschriftung im neuesten Evidenzordner muss
einem Anspruch zugeordnet sein, und eine Mutationsprobe muss **rot** sein. Eine
Probe, die nicht fällt, ist der Befund und keine Evidenz; ohne diese Bedingung
liesse sich jede unbequeme Beschriftung mit dem Wort „Mutationsprobe" am Vertrag
vorbeischreiben.

Dazu zwei kleinere Korrekturen. Die Startseite zählt 758 archivierte Prüfläufe,
auf der Platte liegen 759 Manifeste; die Differenz ist richtig, es ist ein
Schnellstart-Durchlauf, der Schritte zählt und keine Fälle. Aber der Leser
verwarf ihn **still**, und auf demselben Weg verschwände auch ein kaputtes
Manifest. Und `docs/HANDBUCH.md` sagte seit `2.64.0`, es gelte für `2.64.0`: Der
Vertrag prüfte nur, ob die laufende Version irgendwo in der Datei vorkommt, und
sie kam vor, an einer anderen Stelle. Er bindet jetzt die Kopfzeile selbst.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 256/256, exit 0 | `docs/evidence/2026-10-02/welle26-run1.manifest.json` |
| PostgreSQL 17, 256/256, exit 0 | `docs/evidence/2026-10-02/welle26-run2.manifest.json` |
| versitygw und ClamAV, 14/14, exit 0 | `docs/evidence/2026-10-02/welle26-storage.manifest.json` |
| Echter HTTPS-Empfänger, 17/17, exit 0 | `docs/evidence/2026-10-02/welle26-receiver.manifest.json` |
| Backup und Restore, 3/3, exit 0 | `docs/evidence/2026-10-02/welle26-backup.manifest.json` |
| Realtime unter Production, 19/19, exit 0 | `docs/evidence/2026-10-02/welle26-realtime.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 33/33, exit 0 | `docs/evidence/2026-10-02/welle26-functions.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-10-02/welle26-auth.manifest.json` |
| Webhook-Signatur gegen echten Vault, 8/8, exit 0 | `docs/evidence/2026-10-02/welle26-vault.manifest.json` |
| Mutation `max-keys=0` gibt wieder einen Fehler, 13/14, exit 1 | `docs/evidence/2026-10-02/welle26-mutation-maxkeyszero.manifest.json` |
| Mutation die Spursuche prüft die Umgebung nicht, 255/256, exit 1 | `docs/evidence/2026-10-02/welle26-mutation-tracescope.manifest.json` |
| Mutation die Siegelkette wird nicht fortgeschrieben, 2/3, exit 1 | `docs/evidence/2026-10-02/welle26-mutation-sealchain.manifest.json` |
| Vitest lokal 2604/2604, exit 0 | `docs/evidence/2026-10-02/welle26-local-run1.manifest.json` |
| Vitest lokal 2604/2604, exit 0 | `docs/evidence/2026-10-02/welle26-local-run2.manifest.json` |

## Ehrlich offen

- **Dass 625 GiB wirklich durchgehen, belegt kein Lauf.** Geprüft ist die Rechnung mit 5 MiB mal 2, und der grösste Dump, der je durch diesen Weg lief, ist 12,6 MB gross. Teile über 5 MiB hat versitygw in keinem Lauf gesehen.
- **Der Backup-Prozess ist als laufender Prozess weiterhin nicht belegt.** Der Fall ruft die Runde direkt; kein Stacklauf startet den Provisioner mit eingeschalteter Backup-Pflicht.
- **Die Console liest den Backup-Katalog nicht und hat keinen Knopf.** Die Route gibt es, die Verdrahtung der Seite fehlt. Keine Route ändert den Takt.
- **Keine Wiederherstellung auf einen Zeitpunkt für Projektdaten**, keine kundengehaltenen Schlüssel, und die Rotation eines Mandanten-Schlüssels ist durch keinen Fall belegt.
- **Keine Suche nach einer Span-Id**, und die Trefferzeile nennt die erste Station und nicht den Ausgang: Wer von zwanzig Treffern wissen will, welche im Dead Letter endeten, liest zwanzig Spuren.
- **Die lesenden Queue-Werkzeuge laufen über MCP weiter als Betreiber.** Eine Definition und ein Zähler haben keinen Besitzer je Zeile, an dem eine engere Rolle entscheiden könnte.
- **Die neuen HTTP-Routen sind nicht über echtes HTTP aufgerufen worden.** Belegt ist die Dienstschicht; in diesen Stacks läuft kein Next-Server.
- **Die AWS CLI hat Presigned URLs, `CopyObject`, `UploadPartCopy` und EICAR nicht gefahren**, nur das SDK. Virtuell gehostete Adressen gibt es weiterhin nicht.
- **Die Console ist weiterhin ungesehen.** Sie liegt hinter der Anmeldung, und ein Konto anlegen darf nur Denzil selbst.
