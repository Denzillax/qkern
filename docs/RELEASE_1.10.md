# Release 1.10.0 — Project Auth Provider Certification

> Datum: 4. August 2026 · Vorgänger: `1.9.0`

## Wofür dieses Release steht

Release 1.9 hat die Zertifizierung gegen echtes PostgreSQL, MinIO und ClamAV
erbracht und Stufe 1.4 geschlossen. Für Stufe 1.3 blieb die vom
Austrittskriterium verlangte **Provider-E2E-Matrix** offen: Der SMTP-Adapter war
gegen einen lokalen Socket getestet, aber nie gegen einen echten Mailserver, und
der OIDC-Pfad nie gegen einen echten Provider.

Dieses Release ergänzt den dritten Wegwerfstack und schließt damit Stufe 1.3.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Project-Auth-Provider-Zertifizierung | 5 von 5 bestanden, exit 0 |
| PostgreSQL-17-Zertifizierung | 28 von 28 bestanden, exit 0 |
| MinIO-/ClamAV-Zertifizierung | 2 von 2 bestanden, exit 0 |
| Strict TypeScript | grün |
| Rohlogs und Manifeste | `docs/evidence/2026-08-04/` |

## Der neue Stack

`docker-compose.auth-certification.yml` startet **Mailpit** als echten
SMTP-Server und **Dex** als echten OIDC-Provider.

Entscheidend ist die Konstruktion des Nachweises: Der Dienst läuft mit
`exposeDeliveryTokens: false`. Er gibt kein Token zurück. Der einzige Weg an ein
Verifikations-, Magic-Link- oder Reset-Token führt über eine tatsächlich
zugestellte Nachricht, die der Test über die Mailpit-API aus dem Postfach liest.
Genau das unterscheidet diesen Nachweis von den lokalen Tests, in denen ein
Debug-Token den Zustellweg überspringt.

Dex läuft über **echtes TLS** unter dem Netzwerk-Alias `dex.qkern.test`, weil
`ProjectAuthOidcCatalog` für Issuer, Authorization-, Token- und JWKS-Endpunkt
exaktes HTTPS verlangt und `localhost` sowie IP-Adressen ablehnt. Das Zertifikat
entsteht im Stack und wird über `NODE_EXTRA_CA_CERTS` vertraut. Die
Produktgrenze wurde nicht aufgeweicht; der Harness-Test prüft ausdrücklich, dass
`NODE_TLS_REJECT_UNAUTHORIZED` nirgends vorkommt.

Die fünf Fälle: Verifikationsmail über echtes SMTP, Magic Link, Passwort-Reset
mit anschließender Anmeldung, vollständiger Authorization-Code-Flow mit PKCE
gegen Dex sowie ein abgewiesener State-Replay.

## Behobene Fehler

### Fehlerursachen im SMTP-Adapter waren nicht diagnostizierbar

`DELIVERY_UNAVAILABLE` verwarf die Ursache ersatzlos, und die Verbindungsschicht
verwarf zusätzlich den Socket-Fehler. Ein fehlgeschlagener Zustellversuch gegen
einen echten Mailserver war dadurch nicht auswertbar. Beide führen die Ursache
jetzt als internen `cause`; der nach außen sichtbare Code bleibt unverändert,
und das Einmal-Token bleibt ausschließlich im Nachrichtenkörper.

Damit ist dieselbe Lücke geschlossen, die Release 1.9 bereits in der
Queue-Domäne und in der Generated Data API beseitigt hat.

### Harness-Fehler

- Der Testcontainer startete, bevor der SMTP-Listener bereit war. Mailpit hat
  jetzt einen Healthcheck und `condition: service_healthy` — dasselbe
  Startrennen, das in 1.9 schon bei ClamAV auftrat.
- `--abort-on-container-exit` beendete den gesamten Stack, sobald der einmalige
  Zertifikatsdienst planmäßig mit Code 0 endete. Ein Einmal-Dienst und dieses
  Flag sind unvereinbar. Der Runner fährt die Dienste jetzt vorab hoch und
  führt den Testcontainer getrennt aus; die Aufräumung bleibt garantiert.

## Stufenwirkung

**Stufe 1.3 Project Auth ist abgeschlossen.** Das Austrittskriterium verlangt
eine komplette Account-Lifecycle-, Token-Replay- und Provider-E2E-Matrix.
Lifecycle und Replay sind seit 1.9 gegen echtes PostgreSQL belegt; die
Provider-E2E gegen echten SMTP- und OIDC-Server ist jetzt ergänzt und
archiviert.

Damit sind die Stufen 1.1 bis 1.4 abgeschlossen.

## Ehrlich offen

- Realtime PostgreSQL-CDC, horizontaler Fan-out, Multi-Instance-Fencing
- Queue-Multi-Instance-, Crash-, Soak- und Lastläufe
- Functions-Sandbox, Cron-Lease, Webhook-Outbox, DNS-Pinning
- transaktionale Usage-Emitter, Tarife, Rechnungen, Payments
- weitere OIDC-Provider, SMS- und SAML-Anmeldung
- archivierte Windows-/macOS-CI-Läufe, Registry-Publishing
- HA, PITR, Restore-Drill, Schweizer Datenflussnachweis, unabhängiger Pentest
