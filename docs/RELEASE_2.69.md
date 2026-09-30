# Release 2.69.0 – Was unter Production wirklich läuft

Drei Schnitte an Zeilen der Leiter, die nach dem letzten Release noch etwas
hergaben. Zwei davon schliessen Befunde aus `2.68.0`, der dritte macht zwölf
Werkzeuge erreichbar, die es nicht waren.

## Was neu ist

- Postgres Changes laufen unter `production`, über einen vault-gestützten Katalog, Ende zu Ende belegt.
- Der Aufräumer nimmt die SAML-Assertionen mit. Die Tabelle wuchs bis jetzt unbegrenzt.
- QKERN hat SAML-Metadaten und kann seine `AuthnRequest` unterschreiben.
- Neun von zwölf MCP-Werkzeugen sind über OAuth erreichbar, mit sechs neuen Bereichen.
- PostgreSQL-Zertifizierung von 234 auf 236 Fälle, Auth von 10 auf 11, Realtime unter Production von 11 auf 17, lokale Suite von 2421 auf 2434.

## Zwei stille Fehler im Weg der Änderungen

`2.68.0` hat belegt, dass der Realtime-Prozess unter `production` anläuft, und
dabei gefunden, dass Postgres Changes dort trotzdem tot sind: Der Prozess baut
seinen Projektdatenbank-Katalog nur lokal auf, und die lokale Fabrik weist
`production` ab. Der Migrations-Prozess hatte den vault-gestützten Zweig, der
Realtime-Prozess nicht.

Jetzt hat ihn eine Fabrik, und **beide** rufen sie. Der Weg ist ganz belegt:
Trigger in der Projektdatenbank, Change Feed, Lesen der Zeile mit den
Ansprüchen des Abonnenten, Zustellung. Zugangsdaten aus einem echten Vault über
HTTPS mit geprüfter Kette, die Projektdatenbank zusätzlich am Blatt gepinnt,
und `pg_stat_ssl` meldet für die lesende Verbindung TLS 1.3. Die Zeile des
zweiten Nutzers kommt nicht an.

Auf dem Weg dorthin kamen **zwei stille Fehler** heraus, und beide sind vom
selben Schlag:

- **Changes an, Data API aus.** Der Prozess startete, Abonnements gelangen, und jeder Lesevorgang warf. Weil der Leser geschlossen fällt, kam kein Fehler zurück, sondern dauerhaft nichts. Jetzt fällt der Start und nennt die fehlende Bedingung.
- **Vault ohne Startgriff.** Ein vault-gestützter Katalog holt seine Zugangsdaten erst beim ersten Zugriff. Ein unerreichbarer Vault wäre erst am leeren Abonnement aufgefallen. Der Prozess greift jetzt vor dem Lauschen je Bindung bis zur Datenbank durch.

**Was weiterhin nicht geht**: Der Realtime-Prozess kann seine Bindungen nicht
aus der Control Plane lesen, weil die Tabelle der Worker-Rolle gehört. Es ist
kein Recht ausgeweitet worden; er verlangt eine statische Quelle und nennt die
fehlende beim Start.

## Das Leck in der Assertionstabelle

Jede angenommene SAML-Assertion legt eine Zeile ab, die den Replay verhindert.
Seit `2.68.0` verschwand keine davon je wieder. Der Aufräumer aus Migration
0063 kannte drei Tabellen, nicht vier.

Die Reparatur brauchte **keine Migration**: Das Löschrecht der Auth-Rolle und
der passende Index standen schon in 0070, es fehlte allein der Aufruf.

Die Frist ist an der Uhr begründet und nicht geraten. Geschnitten wird am
Ablauf, nie am Verbrauch, denn die Zeile entsteht erst durch das Annehmen. Eine
Assertion ist 60 Sekunden über ihr `NotOnOrAfter` hinaus noch annehmbar, also
ist die Untergrenze für die Gnadenfrist genau 60 Sekunden; schon die kürzeste
erlaubte Einstellung deckt das Fenster ab, und die Voreinstellung von 24
Stunden liegt weit darüber.

Dazu eine Metadaten-Route, damit ein Anbieter `entityID`,
`AssertionConsumerService` und das Zertifikat lesen kann statt abzutippen, und
eine signierte `AuthnRequest` je Anbieter, voreingestellt aus. Die Signatur
steht in der Abfragezeichenkette, weil das HTTP-Redirect-Binding sie dort
verlangt; die exklusive Kanonisierung bleibt darum an dieser Stelle ungenutzt,
und das steht so im Quelltext.

## Zwölf Werkzeuge, neun Bereiche

Seit `2.64.0` ist der Remote-MCP-Server über OAuth erreichbar, aber nur mit
vier Werkzeugen. Zwölf trugen `null` und wurden für eine solche Sitzung gar
nicht erst angemeldet. Sechs neue Bereiche ändern das, und drei Werkzeuge
bleiben mit Absicht draussen:

| Werkzeug | Bereich |
| --- | --- |
| Projekt und Automationsregel lesen | `project:read` |
| Buckets und Objekte auflisten | `storage:read` |
| Queues und ihr Zustand | `queues:read` |
| Nachricht einstellen | `queues:write` |
| Logsuche | `logs:read` |
| Migrationsvorschau | `migrations:propose` |

Die Begründungen stehen im Quelltext, und drei Entscheidungen weichen vom
naheliegenden Zuschnitt ab:

- **`logs:read` ist von `project:read` getrennt.** Ein Audit-Log sagt, wer wann was getan hat. Das ist eine Angabe über Personen; die Gestalt einer Umgebung ist keine.
- **Es gibt kein `storage:write`.** Kein schreibendes Storage-Werkzeug existiert, und keine HTTP-Tür nimmt ein OAuth-Token an. Ein Bereich, den nichts prüft, ist auf einer Zustimmungsseite schlimmer als ein fehlender Eintrag.
- **Das Anwenden einer Migration bleibt ohne Bereich.** Vorschlagen und Anwenden sind zwei Sätze, und ein Apply über eine fremde Anwendung umzudrehen wäre eine eigene Entscheidung mit eigener Widerrufsfläche.

Die freie Abfrage und die Schemaliste bleiben draussen, unverändert aus dem
Grund von `2.64.0`: Sie lesen an der Zeilensicherheit vorbei, während
`data:read` das Lesen unter ihr zusagt.

## Der dritte Besuch im Browser

Nach dem Thema und den deutschen Beschriftungen aus `2.68.0` kam ein dritter
Fund: **Es gab keine 404-Seite.** Next.js zeigte seine Vorgabe, ohne Kopf und
ohne einen einzigen Link, den Satz fest auf Englisch in allen vier Sprachen,
und im Tab den deutschen Titel der Startseite, während `lang` auf `en` stand.
Wer sich vertippte, stand ohne Weg zurück da.

Geprüft und in Ordnung befunden: alle 27 Glossar-Anker lösen auf, keine
öffentliche Seite zeigt ins Leere, und die Tastaturführung ist sichtbar. Beim
letzten Punkt sah es zunächst nach einem Fehler aus, weil programmatischer
Fokus `:focus-visible` gar nicht auslöst; mit echtem Tab greift die Regel.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 236/236, exit 0 | `docs/evidence/2026-09-30/welle21-run1.manifest.json` |
| PostgreSQL 17, 236/236, exit 0 | `docs/evidence/2026-09-30/welle21-run2.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-09-30/welle21-auth.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL und Vault, 17/17, exit 0 | `docs/evidence/2026-09-30/welle21-realtime.manifest.json` |
| versitygw und ClamAV, 11/11, exit 0 | `docs/evidence/2026-09-30/welle21-storage.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 32/32, exit 0 | `docs/evidence/2026-09-30/welle21-functions.manifest.json` |
| Mutation ein Werkzeug ohne Bereich wird geöffnet, exit 1 | `docs/evidence/2026-09-30/welle21-mutation-mcpscope.manifest.json` |
| Mutation der Aufräumer lässt die Assertionen liegen, exit 1 | `docs/evidence/2026-09-30/welle21-mutation-samlclean.manifest.json` |
| Mutation Changes an, Data API aus, der Start fällt nicht, exit 1 | `docs/evidence/2026-09-30/welle21-mutation-rtgate2.manifest.json` |
| Mutation die 404-Seite verliert ihren Kopf, exit 1 | `docs/evidence/2026-09-30/welle21-mutation-notfound.manifest.json` |
| Vitest lokal 2434/2434, exit 0 | `docs/evidence/2026-09-30/welle21-local-run1.manifest.json` |
| Vitest lokal 2434/2434, exit 0 | `docs/evidence/2026-09-30/welle21-local-run2.manifest.json` |

Die Läufe der drei Agenten auf ihren Zweigen liegen daneben.

## Nachtrag zum Verfahren

**Eine Reihenfolge ist keine Sperre.** Die Regel „warte, bis der andere Stack
weg ist" hat zwei Läufe gekostet, weil sie nicht greift, wenn zwei Agenten im
selben Moment starten: Für beide war der jeweils andere noch nicht da. Seither
gibt es eine Sperrdatei, atomar genommen mit `set -o noclobber`. Ein Agent hat
darin sofort die nächste Lücke gefunden: `rm -f` prüft nicht, wem die Sperre
gehört, also gibt sie nur frei, wer seinen eigenen Namen darin liest.

**Ein Nebenbefund über den Namen eines Prozesses.** Der vault-gestützte Katalog
trug `application_name` und `user-agent` des Migrations-Prozesses fest im
Quelltext, weil es lange nur einen Aufrufer gab. Seit der Realtime-Prozess
denselben Katalog benutzt, stand er in `pg_stat_activity` als Migrator, und wer
dort eine hängende Verbindung sucht, hätte am falschen Prozess gesucht.

**Zwei Verträge haben wieder Fehler gefunden, die niemand gesucht hatte**: die
undokumentierte Metadaten-Route und, zweimal, eine Fallzahl, die jeder Zweig
für sich richtig und zusammen falsch gesetzt hatte.

**Und ein Fall ist zweimal an der Datenbank gescheitert, beide Male zu Recht.**
Eine Queue-Nachricht lässt sich vor ihrer Aufbewahrungsfrist nicht löschen,
auch nicht als Eigentümer, und `project_queue_messages` liegt unter der
Mandanten-RLS, sodass eine Zählung mit der Laufzeitrolle ohne gesetzten
Mandanten stumm null liefert. Das zweite wäre ein Blindgänger geworden: Eine
Zählung, die immer null liefert, bestätigt „nichts entstanden" auch dann, wenn
etwas entstanden ist.

## Ehrlich offen

- **Storage und Queues laufen über MCP mit Betreiberrechten**, nicht unter der Zeilensicherheit des zustimmenden Nutzers. `storage:read` und `queues:read` sagen darum etwas über die Projektumgebung und nichts über die Daten eines Nutzers. Getragen wird das allein von der Decke, die ein Owner am Client schreibt.
- **Der Realtime-Prozess liest seine Bindungen nicht aus der Control Plane.** Presence und History liegen weiter im Prozessspeicher, und ein Lastprofil jenseits des Soak gibt es nicht.
- **Kein fremder IdP hat SAML gesehen**, auch die Metadaten und die signierte Anfrage nicht. Single Logout und die IdP-initiierte Anmeldung fehlen; bei letzterer steht im Quelltext, dass ohne `InResponseTo` genau die Bindung fehlt, die den Fälschungsschutz trägt.
- **Ein misskonfigurierter eigener SAML-Schlüssel antwortet 400.** Das ist kein Fehler des Aufrufers, und ein eigener Code wäre die richtige Reparatur.
- **Die Console selbst ist weiterhin ungesehen**, weil sie hinter der Anmeldung liegt.
