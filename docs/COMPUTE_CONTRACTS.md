# Compute Contracts Alpha 4

Dieses Dokument beschreibt den internen ausführbaren Vertrag von
`1.6.0-alpha.4`. Er definiert sichere Ports für Functions, Cron und Webhooks,
stellt aber noch keinen allgemein verfügbaren Serverless-Host oder öffentliche
Management-API dar.

## Functions

Eine Function-Definition referenziert ausschließlich ein Image mit festem
`sha256`-Digest, `nodejs24`, einen begrenzten Entrypoint sowie feste Timeout-,
Memory- und Concurrency-Werte. Seit Migration 0034 darf der Bezug eine Registry
mit Port tragen; bis dahin war jede Registry mit Port ausgeschlossen, und das
fiel erst auf, als der Zertifizierungslauf eine echte benutzte. Die bindende
Stelle bleibt der Digest — was vor dem `@` steht, ist die Adresse. Egress ist standardmäßig leer und ansonsten eine
Liste exakter öffentlicher HTTPS-Origins. Localhost, IP-Literale, `.local`,
`.internal`, Credentials, andere Ports und ungenaue Origins werden abgewiesen.

Secrets erscheinen nur als Referenzen. Der Sandbox-Port erhält keine von QKERN
aufgelösten Secret-Werte. Seit `2.38.0` prüft die Console je Referenz nur, ob
der Vault sie auflöst, über den Metadaten-Endpunkt von KV Version 2 und nie
über den Datenendpunkt; die Antwort trägt genau eines von drei Wörtern. Input ist auf 64 KiB, Output auf 256 KiB sowie Tiefe und
Knoten begrenzt. Response-Header sind klein, CRLF-frei und schließen Cookie- und
Hop-by-Hop-Header aus. Timeout und Abort werden außerhalb der Sandbox erzwungen.

Seit `1.22.0` gibt es mit `DockerFunctionSandbox` einen Adapter. Er setzt
`--network none`, `--read-only` mit einem `noexec`-tmpfs, einen Nicht-root-
Benutzer, `--cap-drop ALL`, `no-new-privileges`, `--memory` gleich
`--memory-swap`, eine CPU- und eine PID-Grenze — und **kein** `--env`, damit die
Umgebung dieser Runtime den Container nicht erreicht.

Seit `1.26.0` sind erlaubte Egress-Origins **benutzbar** — ohne dass der
Container ein Netz bekommt. Er bittet über stdio um jede Ausgangsverbindung; die
Runtime prüft die exakte Origin, die Methode, die Header, die Grössen und die
Anzahl je Aufruf und führt die Anfrage dann selbst aus. Weiterleitungen sind
ausgeschlossen, und von der Antwort kehren nur vier feste Header zurück.

Der Preis: Eine Function benutzt nicht direkt `fetch`, sondern den vermittelten
Kanal ihrer Laufzeit. Ein Egress-Proxy in einem eigenen Netz wäre der übliche
Weg gewesen, hätte aber `--network none` gekostet — die stärkste Zusage der
Sandbox — um dieselbe Frage zu beantworten.

Ohne Vermittler wird eine Definition mit erlaubten Origins weiterhin abgewiesen:
Eine Liste, die niemand bedient, wäre ein stiller Bruch der Zusage.

Ein überzogener Timeout beendet den Container hart. Den Docker-Client zu töten
genügt nicht — das war der Produktfehler, den der erste Zertifizierungslauf
aufdeckte.

Seit `1.23.0` gibt es Migration 0033 als Ort für Definitionen und
`POST /v1/projects/{projectId}/environments/{environment}/compute/invoke/{name}`
als Aufrufweg. Aufrufen darf ein **Service**-Projektschlüssel oder ein
Administrator; es gibt bewusst keinen anonymen und keinen Endnutzer-Pfad und
keine CORS-Freigabe, weil eine Function mit der Autorität des Projekts läuft und
nicht mit der ihres Aufrufers.

Die Definition wird bei jedem Aufruf frisch gelesen. Ein zwischengespeichertes
Bild liefe nach einem Abschalten weiter.

`maxConcurrency` wird seit `1.23.0` gespeichert und seit `1.24.0` beim Aufruf
durchgesetzt — allerdings **prozesslokal**, nicht clusterweit.

Seit `1.27.0` gilt **DNS-Pinning** für jede Ausgangsverbindung: Der Name wird
einmal aufgelöst, **jede** zurückgegebene Adresse muss öffentlich sein, und
danach wird zu genau der geprüften Adresse verbunden. Der Name bleibt SNI und
erwarteter Zertifikatsname. Ohne dieses Festhalten bliebe zwischen Prüfung und
Verbindungsaufbau ein Rebinding-Fenster offen.

Seit `2.98.0` hebt der Aufrufdienst die **Inhaltslogs** je Aufruf auf
(Migration 0069): jede Zeile auf `stderr` und jede Zeile auf `stdout`, die kein
JSON-Objekt der Leitung ist, mit Zeitpunkt des Eintreffens und Strom. Grenzen
je Aufruf: 500 Zeilen, 64 KiB, 2 KiB je Zeile; darüber wird gezählt und
abgeschnitten, und das Protokoll trägt `truncated`. Der Sandbox-Port nimmt
dafür einen optionalen `output`-Sink; ohne ihn wird verworfen wie zuvor. Eine
Nicht-JSON-Zeile auf `stdout` beendet den Aufruf seit `2.98.0` nicht mehr.
QKERN streicht **nichts** aus den Zeilen: Der Prozess kennt keinen Wert eines
Geheimnisses, den er streichen könnte (nur Referenzen, kein `--env`, eigene
Umgebung bleibt draussen); was eine Function selbst ausgibt, verantwortet sie.
Gelesen wird über `compute/invocations/{invocationId}/output` und die Liste
`compute/output`, beide nur für Administratoren.

Ein Production-Adapter muss zusätzlich ein Ephemeral-Disk-Limit und
Kill-Evidenz liefern. Es gibt weiterhin keinen Deployment-Weg für Function-Images und keine
Policy je Function für anonyme Aufrufe.

## Webhooks

Webhook-Ziele sind exakte öffentliche HTTPS/443-URLs ohne Query, Fragment oder
Credentials. Ein Signer-Port erhält eine Secret-Referenz und den kanonischen
`timestamp.body`-String; der Delivery-Port erhält nie den Secret-Wert. Requests
tragen Delivery-ID, Event, Timestamp und versionierte Signatur und verbieten
Redirects. Erfolg verlangt sowohl HTTP 2xx als auch die exakt gleiche
Acknowledgement-ID. Payload, Timeout, Events und Signaturformat sind begrenzt.

Seit `1.20.0` gibt es Adapter für beide Ports. `HmacWebhookSigner` signiert mit
HMAC-SHA256 über `timestamp.body` und trägt eine `keyId`, damit ein Empfänger
während einer Rotation beide Schlüssel kennen kann. `FetchWebhookTransport`
liest den Antwortkörper eines fremden Empfängers nie; die Bestätigung kommt
ausschließlich aus dem zurückgespiegelten Header `x-qkern-delivery-id`.

Signaturschlüssel liefert ein `WebhookSecretProvider`. Seit `1.25.0` gibt es
zwei: einen Vault-gestützten für KV Version 2 und einen für die Umgebung, der
eine ausdrückliche Freischaltung verlangt und sich weigert, in Produktion
überhaupt zu existieren. Ist ein Vault konfiguriert, wird der Umgebungs-Provider
gar nicht erst gebaut.

Der Transport wendet seit `1.27.0` dasselbe DNS-Pinning an: einmal auflösen,
jede Adresse gegen die Sperre privater, Link-local- und Metadaten-Netze nach
IPv4 und IPv6 prüfen, die geprüfte Adresse festhalten und damit Rebinding
verhindern. Dieselbe Prüfung gilt für
den Functions-Egress.

Seit `1.28.0` ist dieser ganze Weg gegen einen **echten** HTTPS-Empfänger
belegt: Signatur, Bestätigung über den zurückgespiegelten Header,
Weiterleitungsverbot, Antwortgrenze, Header-Filter und Adressprüfung, alles über
eine echte TLS-Verbindung. Dabei kam heraus, dass das Pinning aus `1.27.0`
gegen einen echten Socket jede Verbindung verhindert hat: Die ersetzte
`lookup`-Funktion muss `options.all` beachten, sonst antwortet sie in der
falschen Form. Gegen ein eingespeistes `fetch` war davon nichts zu sehen.

## Cron

Ein Zeitplan ist ein Fünf-Feld-Ausdruck (Minute, Stunde, Tag, Monat,
Wochentag) mit `*`, `*/N`, `a`, `a-b`, `a-b/N` und Listen daraus; das ist seit
`1.87.0` die ganze klassische Grammatik. Seit `2.66.0` gelten im Monatsfeld
auch `JAN` bis `DEC` und im Wochentagsfeld `SUN` bis `SAT`, gross oder klein,
auch in Bereichen und Listen (`MON-FRI`, `JAN,JUL`). Die Kürzel `@yearly`,
`@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight` und `@hourly` stehen
für je einen Fünf-Feld-Ausdruck. Dazu die Sonderformen, jede allein in ihrem
Feld: im Tagesfeld `L` (letzter Tag des Monats), `LW` (letzter Werktag) und
`NW` (der Werktag, der dem N. am nächsten liegt, im selben Monat); im
Wochentagsfeld `NL` (letzter N-Wochentag des Monats) und `N#K` (der K.
N-Wochentag), N als Zahl oder Name.

Jeder Zeitplan trägt eine IANA-Zeitzone (`Europe/Berlin`); ohne Angabe ist es
`UTC`, und jede Definition von vor `2.66.0` steht auf `UTC`. Die Felder werden
als Wanduhr dieser Zone gelesen, die Rechnung macht `Intl` ohne fremde
Bibliothek. Beim Sommerzeitwechsel gilt die Regel von Vixie-Cron: Ein Plan mit
fester Stunde (`30 2 * * *`) meint einen Termin am Tag. Gibt es die Wanduhrzeit
zweimal, zählt sie einmal, beim ersten Mal; gibt es sie nicht, feuert der Plan
in dem Moment, in dem die Uhr darüber hinwegspringt. Ein Plan ohne feste Stunde
(`*/30 * * * *`) ist ein Takt und folgt der echten Zeit. Ein Versatz wie
`+02:00` wird abgewiesen, denn er nähme die Sommerzeit gerade nicht mit.

Eine exakte Occurrence wird mit dem deterministischen Dedupe-Key
`cron:<definition-id>:<scheduled-at-iso>` in eine vorhandene Project Queue
geschrieben; der Zeitpunkt darin ist immer der UTC-Moment, auch bei einem Plan
mit Zeitzone. Crash/Retry nach erfolgreichem Enqueue erzeugt dadurch keine
zweite Nachricht. Tenant, Service Role, Schedule und Queue bleiben serverseitig
gebunden.

Diese Zusage hängt am Dedupe-Fenster der Zielqueue. Hat die Queue
`dedupe_window_seconds = 0`, ist ihre Deduplizierung abgeschaltet: Der
Dispatcher reiht weiterhin bei jedem Vorkommen ein, der Schlüssel wird aber
ignoriert, und ein Crash zwischen Enqueue und Quittung kann eine zweite
Nachricht erzeugen. Bis `2.43.0` scheiterte in einer solchen Queue stattdessen
jedes Vorkommen an der Paarbedingung aus Migration 0026, und zwar als
generischer Queue-Fehler. Wer die Zusage braucht, wählt ein Fenster größer null
und mindestens so lang wie der Takt des Cron-Jobs.

Persistente Cron-Definitionen (Migration 0031), begrenztes Catch-up und die
Webhook-Outbox (Migration 0032) sind seit `1.18.0` beziehungsweise `1.19.0`
vorhanden und gegen echtes PostgreSQL zertifiziert.

## Betrieb

`workers/compute-runtime.mts` (`npm run worker:compute`) löst fällige
Cron-Vorkommen aus und stellt Webhooks zu. Bis `1.19.0` waren beide
Bibliotheken, die niemand aufrief.

Welche Projekte der Prozess bedient, steht ausdrücklich in
`QKERN_COMPUTE_SCOPES_JSON`. Die Runtime-Rolle sieht durch RLS nur die eigene
Organisation; eine organisationsübergreifende Suche nach fälliger Arbeit ginge
nur mit einer Rolle, die alles sieht.

Der Prozess startet nicht ohne erreichbaren Signaturschlüssel. Ein Zusteller,
der stillschweigend unsigniert sendet, wäre schlimmer als einer, der gar nicht
startet.

## Verwaltung

Seit `1.21.0` verwalten REST und Console beide Definitionsarten unter
`/v1/projects/{projectId}/environments/{environment}/compute/`. Die Berechtigung
`project_compute_admin` haben nur `owner` und `administrator`; wer sie nicht hat,
erhält 404 statt 403.

**Nur `enabled` ist änderbar.** Ausdruck, Zeitzone, Queue, Nutzlast, Ziel-URL und
Signaturreferenz sind unveränderlich; eine Änderung ist ein Löschen und ein neues
Anlegen. Die Grenze liegt als Spaltenrecht in den Migrationen 0031 und 0032, nicht
als Prüfung im Dienst — ein zweiter Schreiber könnte eine Prüfung umgehen, das
Spaltenrecht nicht.

Ein Cron-Ausdruck wird beim Anlegen mit demselben Parser geprüft, den der
Scheduler benutzt, und die Zielqueue muss existieren. Ein Webhook-Ziel wird mit
derselben Funktion geprüft, die der Zusteller anwendet. Beides verhindert
Definitionen, die erst im Betrieb stumm scheitern.

Ein Webhook lässt sich erst löschen, nachdem er abgeschaltet wurde: Das Löschen
entfernt über den Fremdschlüssel auch alle wartenden Zustellungen.

Die Zustellstatusliste gibt niemals eine Nutzlast zurück.

Offen bleiben: Scheduler-Leases, Zeitzonen/DST, automatische Scope-Entdeckung,
SDK-/CLI-Anbindung, manuelles Auslösen eines Vorkommens, Wiederholen einer toten
Zustellung und ein Deployment-Weg für Function-Images. Keine dieser Foundations
ist in MCP exponiert.
