# Compute Contracts Alpha 4

Dieses Dokument beschreibt den internen ausführbaren Vertrag von
`1.6.0-alpha.4`. Er definiert sichere Ports für Functions, Cron und Webhooks,
stellt aber noch keinen allgemein verfügbaren Serverless-Host oder öffentliche
Management-API dar.

## Functions

Eine Function-Definition referenziert ausschließlich ein Image mit festem
`sha256`-Digest, `nodejs24`, einen begrenzten Entrypoint sowie feste Timeout-,
Memory- und Concurrency-Werte. Egress ist standardmäßig leer und ansonsten eine
Liste exakter öffentlicher HTTPS-Origins. Localhost, IP-Literale, `.local`,
`.internal`, Credentials, andere Ports und ungenaue Origins werden abgewiesen.

Secrets erscheinen nur als Referenzen. Der Sandbox-Port erhält keine von QKERN
aufgelösten Secret-Werte. Input ist auf 64 KiB, Output auf 256 KiB sowie Tiefe und
Knoten begrenzt. Response-Header sind klein, CRLF-frei und schließen Cookie- und
Hop-by-Hop-Header aus. Timeout und Abort werden außerhalb der Sandbox erzwungen.

Seit `1.22.0` gibt es mit `DockerFunctionSandbox` einen Adapter. Er setzt
`--network none`, `--read-only` mit einem `noexec`-tmpfs, einen Nicht-root-
Benutzer, `--cap-drop ALL`, `no-new-privileges`, `--memory` gleich
`--memory-swap`, eine CPU- und eine PID-Grenze — und **kein** `--env`, damit die
Umgebung dieser Runtime den Container nicht erreicht.

Eine Definition mit erlaubten Egress-Origins wird **abgewiesen**: Ohne
Egress-Proxy gäbe es nur alles oder nichts, und „alles" wäre keine Policy.

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

Ein Production-Adapter muss zusätzlich DNS-Pinning, einen Egress-Proxy für die
erlaubten Origins, ein Ephemeral-Disk-Limit und Kill-Evidenz liefern. Es gibt
weiterhin keinen Deployment-Weg für Function-Images, `maxConcurrency` wird nicht
durchgesetzt, und eine Policy je Function für anonyme Aufrufe fehlt.

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

Signaturschlüssel liefert ein `WebhookSecretProvider`. Der einzige heutige
Provider liest sie aus der Umgebung, verlangt eine ausdrückliche Freischaltung
und weigert sich, in Produktion überhaupt zu existieren. Ein Vault-gestützter
Provider ist offen.

Der Production-Transport muss DNS einmal auflösen, öffentliche IPs pinnen, alle
privaten/Link-local/Metadata-Netze nach IPv4 und IPv6 blockieren und Rebinding
verhindern. Dieser Netzwerkadapter ist noch nicht enthalten.

## Cron

Der aktuelle UTC-Vertrag akzeptiert bewusst nur `*/N * * * *` mit 1 bis 59
Minuten oder einen festen täglichen Ausdruck `M H * * *`. Eine exakte Occurrence
wird mit dem deterministischen Dedupe-Key
`cron:<definition-id>:<scheduled-at-iso>` in eine vorhandene Project Queue
geschrieben. Crash/Retry nach erfolgreichem Enqueue erzeugt dadurch keine zweite
Nachricht. Tenant, Service Role, Schedule und Queue bleiben serverseitig gebunden.

Persistente Cron-Definitionen (Migration 0031), begrenztes Catch-up und die
Webhook-Outbox (Migration 0032) sind seit `1.18.0` beziehungsweise `1.19.0`
vorhanden und gegen echtes PostgreSQL zertifiziert.

## Betrieb

`workers/compute-runtime.ts` (`npm run worker:compute`) löst fällige
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

**Nur `enabled` ist änderbar.** Ausdruck, Queue, Nutzlast, Ziel-URL und
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

Offen bleiben: Scheduler-Leases, Zeitzonen/DST, Vault-gestützte
Signaturschlüssel, automatische Scope-Entdeckung, SDK-/CLI-Anbindung, manuelles
Auslösen eines Vorkommens, Wiederholen einer toten Zustellung,
Functions-Sandbox-Deployment und Provider-E2E gegen einen echten
HTTPS-Empfänger. Keine dieser Foundations ist in MCP exponiert.
