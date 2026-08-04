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
Ein Production-Adapter muss zusätzlich DNS-Pinning, NetworkPolicy, Read-only-
Filesystem, Non-root, CPU-Limits, Ephemeral-Disk-Limit und Kill-Evidenz liefern.

## Webhooks

Webhook-Ziele sind exakte öffentliche HTTPS/443-URLs ohne Query, Fragment oder
Credentials. Ein Signer-Port erhält eine Secret-Referenz und den kanonischen
`timestamp.body`-String; der Delivery-Port erhält nie den Secret-Wert. Requests
tragen Delivery-ID, Event, Timestamp und versionierte Signatur und verbieten
Redirects. Erfolg verlangt sowohl HTTP 2xx als auch die exakt gleiche
Acknowledgement-ID. Payload, Timeout, Events und Signaturformat sind begrenzt.

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

Persistente Cron-Definitionen, Scheduler-Leases, Catch-up-Policy, Zeitzonen/DST,
Management-API, Functions-Sandbox-Deployment, Webhook-Outbox und Provider-E2E sind
noch offen. Keine dieser Foundations ist in MCP exponiert.
