# QKERN Stufenplan

Statuswerte: `fertig` bedeutet im Source-Release automatisiert geprüft;
`in Arbeit` ist ein unvollständiger vertikaler Slice; `offen` ist noch keine
ausführbare Produktfunktion. Externe Live-Zertifizierung bleibt separat.

## Übersicht

| Stufe | Status | Ergebnis |
| --- | --- | --- |
| 0.1–1.0 | fertig, zertifiziert | Control Plane, Auth-Basis, Approval/Audit, Migration Runtime, operative Sicherheitsverträge |
| 1.1 | fertig als Alpha | Reale Lese-Data-Plane und einstellbare Agentenautonomie |
| 1.2 | fertig, zertifiziert | Generated Data API, Projekt-Keys und echter Table Editor |
| 1.3 | **abgeschlossen und zertifiziert** | Project Auth gegen echtes PostgreSQL, echtes SMTP und echtes OIDC |
| 1.4 | **abgeschlossen und zertifiziert** | Object Storage gegen echtes PostgreSQL, MinIO und ClamAV |
| 1.5 | **abgeschlossen und zertifiziert** | Realtime mit dauerhaftem Log, Fan-out, CDC und Soak gegen echtes PostgreSQL |
| 1.6 | in Arbeit | Queues, Cron und Webhook-Outbox zertifiziert; Functions-Sandbox offen |
| 1.7 | Alpha-Checkpoint | SDK, CLI, Paketbuild und Linux-Fresh-Project-Smoke; Drei-OS-/Publishing-Evidenz offen |
| 1.8 | in Arbeit als Alpha | Usage-/Quota-Grundlage; Teams, Billing und vollständige Operations offen |
| 2.0 | offen | Zertifizierte Managed Platform |

## Stufe 1.1 — Data Plane und Autonomie

Enthält feste Schema-Introspection, AST-validierte Read-only-Queries, harte
Zeilen-/Bytegrenzen, RLS/Rollenprüfung, REST/MCP-Parität und pro Environment die
Modi `manual`, `guarded`, `autonomous`. Austrittskriterium: automatische Approval
erzeugt weiterhin ein exaktes Decision-/Audit-Artefakt; Not-Aus und Production-
Release-Signatur können nicht umgangen werden. Status: **erfüllt im Alpha-Release**.

## Stufe 1.2 — Generated Data API

Eintritt: 1.1 grün. Umfang: tabellengebundene CRUD-Endpunkte, erlaubte Filter,
Sortierung, Cursor-Pagination, Schema-/Spalten-Allowlist, Public/Service Keys,
User-Claims für RLS und aus dem realen Schema generierte OpenAPI. Austritt:
Cross-Tenant- und SQLi-Matrix gegen echtes PostgreSQL, Typed API Contract und
Console Table Editor ohne Beispieldaten.

Status: **erfüllt im Alpha-Release**. Die API prüft das reale Schema bei jeder
Operation, verlangt RLS und Primärschlüssel, parametrisiert alle Werte, begrenzt
Filter/Zeilen/Bytes und setzt ausschließlich serverseitig abgeleitete Claims.
Public-/Service-Keys sind ablaufend, nur als SHA-256-Verifier gespeichert und
irreversibel widerrufbar. Der optionale PostgreSQL-17-Test zertifiziert RLS-
Isolation und CRUD gegen einen echten unprivilegierten Login. Endnutzer-JWTs und
damit nutzerspezifische Claims über Projekt-Auth wurden mit dem nachfolgenden
Alpha-Slice ergänzt.

**Nachtrag Release 1.9.** Der optionale PostgreSQL-Test wurde bis dahin nie
ausgeführt. Sein erster echter Lauf zeigte, dass die Schema-Introspektion gegen
eine reale Datenbank **keine einzige Tabelle** laden konnte: `pg_index.indkey`
ist ein nullbasierter `int2vector`, der Code erwartete eine einsbasierte
Primärschlüsselposition und verwarf jede Zeile an der Grenzprüfung. Zusätzlich
standen sensible Spalten mit Namen in der mitgelieferten Tabellenbeschreibung,
obwohl der Vertrag ihren Ausschluss zusagt. Beides ist behoben; die Stufe ist
jetzt erstmals gegen eine reale Datenbank belegt statt nur gegen ein
nachgebildetes Schema.

## Stufe 1.3 — Project Auth

App-User getrennt von QKERN-Control-Plane-Usern, Email/Passwort, Magic Link,
OAuth/OIDC, MFA, JWT/JWKS, Rotation, Revocation, Admin API und RLS-Claim-Mapping.
Austritt: komplette Account-Lifecycle-, Token-Replay- und Provider-E2E-Matrix.

Status: **in Arbeit als Alpha**. Implementiert sind scope-isolierte App-User,
Email-Verifikation, Passwort-/Magic-Link-Flow, TOTP und einmalige Recovery Codes,
Ed25519-JWT/JWKS mit Schlüsselüberlappung, rotierende opaque Refresh Tokens mit
Familienwiderruf bei Replay, Session-/User-Revocation, OIDC Authorization Code mit
PKCE/State/Nonce, Control-Plane-Admin-API, Console-Sicht und das serverseitige
RLS-Claim-Mapping.

**Nachtrag Release 1.9.** Der PostgreSQL-17-Lifecycle-Test ist erfüllt: Persistenz
über die Auth-Rolle, verweigerter Runtime-Zugriff, unveränderlicher Scope und
atomare Familienrevocation bei Refresh-Replay laufen gegen eine echte Datenbank
und sind archiviert. Ein echter SMTP-Adapter existiert; ohne konfigurierten Host
bleibt die Zustellung fail-closed.

**Nachtrag Release 1.10: Austrittskriterium erfüllt.** Ein dritter Wegwerfstack
mit Mailpit und Dex erbringt die Provider-E2E-Matrix: Verifikationsmail über
echtes SMTP, Magic Link, Passwort-Reset mit anschließender Anmeldung,
vollständiger Authorization-Code-Flow mit PKCE gegen einen echten OIDC-Provider
über TLS sowie ein abgewiesener State-Replay.

Der Nachweis läuft ohne Debug-Token: Der Dienst gibt keines zurück, der einzige
Weg an ein Token führt über eine tatsächlich zugestellte Nachricht, die der Test
aus dem Postfach liest. Dex läuft über echtes TLS unter einem routbaren
Hostnamen, weil der OIDC-Katalog exaktes HTTPS verlangt und localhost sowie
IP-Adressen ablehnt; die Produktgrenze wurde nicht aufgeweicht.

Nicht Teil des Austrittskriteriums und weiterhin offen: weitere OIDC-Provider,
SMS- und SAML-Anmeldung.

## Stufe 1.4 — Storage

S3-kompatible Buckets, private Defaults, signed Upload/Download URLs, RLS-nahe
Object Policies, Quotas, MIME-/Größenlimits, Lifecycle und optionale Transformen.
Austritt: Cross-Tenant-, Malware-/Content-Type- und Signed-URL-Expiry-Tests.

Status: **in Arbeit als Alpha**. Implementiert sind tenantgebundene Bucket-, Upload-
und Object-Metadaten, private Defaults, feste `private`-/`authenticated`-/`owner`-/
`public`-/`service`-Policies ohne Public-Write, MIME-/Größen-Allowlist, atomare
Quota-Reservierung, verifier-only Completion Tokens, S3-SigV4-POST/GET, Provider-
HEAD-Verifikation, Quarantäne, Scanner-Port, Infected-Delete, Retention/Lifecycle,
REST/OpenAPI, echte Console-Buckets und lesender MCP-Zugriff. Der Produktionspfad
verlangt injizierte rotierende Provider-Credentials und einen Malware-Scanner;
rohe Environment-Credentials sind nur Development erlaubt. Ein fail-closed
Development-/CI-Adapter streamt intern geladene Objects begrenzt an ClamAV, prüft
Bytezahl, MIME und SHA-256 erneut und akzeptiert ausschließlich ein exaktes
Scannerurteil. Ein portloser Docker-Wegwerfstack prüft Clean- und EICAR-Pfade
gegen echte MinIO-/ClamAV-Dienste und räumt Container und Volumes stets ab.
Quota-Reservierungen werden pro Bucket serialisiert; Completion-Replays committen
genau ein Object. Gewinnt Expiry während eines langsamen Scans, wird das nicht
commitbare Provider-Object entfernt. Delete und Lifecycle geben Usage auch im Race
nur einmal frei. Drei ausführbare Memory-Races und vier zusätzliche optionale
PostgreSQL-17-Races binden diese Invarianten.

Offen bleiben die tatsächliche Ausführung und Archivierung dieses realen S3-
kompatiblen Provider-/Scanner-E2E-Laufs sowie der PostgreSQL-17-Concurrency-Matrix
in einer Docker-fähigen Umgebung, großer Multipart-/Resumable-Upload, optionale
Transformen sowie Browser-, Last- und unabhängige Security-
Zertifizierung. Das Austrittskriterium ist deshalb noch nicht vollständig erfüllt.

**Nachtrag Release 1.9: Austrittskriterium erfüllt.** Die Cross-Tenant-,
Malware-/Content-Type- und Signed-URL-Expiry-Tests laufen gegen echtes
PostgreSQL 17, echtes MinIO und echtes ClamAV. Beide Läufe wurden zweimal
reproduzierbar ausgeführt und samt Manifest unter `docs/evidence/2026-08-04/`
archiviert.

Der erste echte Lauf deckte dabei einen Fehler auf, der nur unter einer realen
Datenbank auftritt: `withTenantTransaction` überschrieb `STORAGE_CONFLICT` und
`STORAGE_QUOTA_EXCEEDED` mit einem generischen Persistenzfehler, sodass ein
erwarteter fachlicher Konflikt nicht mehr von einem Infrastrukturausfall zu
unterscheiden war. Beide Verträge sind repariert und real belegt.

Nicht Teil des Austrittskriteriums und weiterhin offen: großer Multipart-/
Resumable-Upload, optionale Transformen sowie Browser-, Last- und unabhängige
Security-Zertifizierung. Sie gehören in einen eigenen Slice.

## Stufe 1.5 — Realtime

PostgreSQL CDC, WebSocket Channels, RLS pro Event, Broadcast, Presence,
Backpressure und Reconnect/Catch-up. Austritt: Tenant-, Ordering-, Drop- und
Lasttests gegen echte Infrastruktur.

Status: **in Arbeit als Alpha**. Alpha 1 implementiert einen echten lokalen
WebSocket-Transport mit exaktem Pfad, Subprotocol und Origin, First-Frame-
Authentifizierung über Project Key plus optionales Project-Auth-JWT, serverseitig
gebundenem Tenant-/Projekt-/Environment-Scope, festen Channel-Präfix-Policies,
Broadcast, privaten Presence-Schlüsseln, monotoner Reihenfolge, HMAC-signierten
Replay-Cursors, Heartbeat, Rate-/Größenlimits und Backpressure. Replay und Live-
Events werden pro Channel serialisiert; alte oder das Limit überschreitende Cursors
scheitern geschlossen, statt Events zu überspringen.

Der Event Log ist noch prozesslokal. PostgreSQL CDC, persistente Retention,
datenbankgestützte RLS pro Event, horizontaler Fan-out, Multi-Instance-Fencing,
Production-TLS/Proxy, Telemetrie, Browser-SDK und echte Drop-/Soak-/Lasttests sind
offen. Der Alpha-1-Host bindet nur Loopback und verweigert Production technisch;
das Austrittskriterium ist nicht erfüllt.

**Nachtrag Release 1.11.** Der Event-Log ist jetzt dauerhaft: Migration 0030
speichert Ereignisse und die Kanal-Sequenz mit Tenant-RLS, Append-only-Trigger
und engen Spaltengrants. Die Sequenz kommt aus der Datenbank, sodass mehrere
Instanzen dieselbe Reihenfolge sehen und sie einen Neustart überlebt. Ein neuer
optionaler Event-Bus verteilt Verweise über `LISTEN`/`NOTIFY`; die
Benachrichtigung trägt keine Payload, und ein Verweis löst ein Replay ab der
zuletzt zugestellten Sequenz aus, damit ein verpasster Hinweis keine stille
Lücke hinterlässt.

Fünf Fälle laufen gegen echtes PostgreSQL mit zwei Instanzen, getrennten Pools
und getrennten `LISTEN`-Verbindungen: Zustellung über die Instanzgrenze, globale
Sequenz bei gleichzeitigem Schreiben, Persistenz über einen Neustart,
Tenant-Isolation und die Append-only-Invariante.

Das Austrittskriterium bleibt **nicht erfüllt**. Offen sind PostgreSQL-CDC und
RLS pro Ereignis sowie Drop-, Reconnect-, Soak- und Lasttests. Auch der
Mehrinstanznachweis hat eine Grenze: Beide Instanzen laufen im selben
Betriebssystemprozess, Prozessabsturz und Netzwerkausfall sind nicht geprüft.

**Nachtrag Release 1.15: Austrittskriterium erfüllt.** Tenant-, Ordering-, Drop-
und Lasttests laufen gegen echtes PostgreSQL. Der Soak-Lauf betreibt einen
laufenden Poller mit 100-ms-Intervall gegen einen anhaltenden Schreiber und
stellt 120 Änderungen vollständig, in Reihenfolge und ohne Rückstau zu; die
gemessene p95-Latenz lag bei 224 bis 333 ms.

Release 1.11 ergänzte den dauerhaften Event-Log und den instanzübergreifenden
Fan-out, 1.12 bis 1.14 die Postgres Changes mit RLS pro Abonnent samt Trigger-
Zertifizierung, 1.15 den Betrieb als Dauerschleife und die Vermittlung je
Projekt.

Ausdrücklich festgehalten, ohne die Stufe offen zu halten: `changes:`-Kanäle
sind in `workers/realtime-runtime.ts` **noch nicht betriebsbereit**. Registry,
Quelle und Reader sind zertifiziert, aber die Runtime besitzt keinen Port, der
je Scope eine Projektdatenbank auflöst; ein Abonnement bleibt dort leer. Der
technische Production-Deny der Runtime bleibt ein Go-live-Gate der Stufe 2.0.

## Stufe 1.6 — Compute und Messaging

Isolierte Functions, Cron, Jobs, Queues, Webhooks und Vault-Referenzen. Austritt:
Egress-Policy, Ressourcenlimits, Idempotenz, Dead Letters, Retry und Secret-Canary-
Tests ohne gemeinsame Ausführungsautorität.

Status: **in Arbeit als Alpha**. Alpha 1 implementiert tenant-/projekt-/environment-
gebundene Queue-Definitionen, verzögertes JSON-Enqueue, SHA-256-verifier-only
Dedupe, atomare geordnete Claims, einmalige workergebundene Lease-Tokens,
Lease-Renewal, monotones Reclaim-Fencing, serverberechnetes begrenztes
Exponential-Backoff und Dead Letters. REST, OpenAPI und die kleinen MCP-Werkzeuge
für Queue-Liste, Status und Enqueue verwenden dieselben Scope- und Policy-Grenzen;
Worker-Claim und Settlement bleiben aus MCP ausgeschlossen.

Alpha 2 ergänzt Migration 0026 und einen RLS-gebundenen PostgreSQL-Adapter mit
`FOR UPDATE SKIP LOCKED`, persistenten Dedupe-/Lease-Verifiern, monotonem Fencing,
Expiry-Recovery und Cleanup. Der gebündelte Memory-Port bleibt `ephemeral` und
Production-verboten. Reale horizontale Multi-Instance-/Crash-/Lastzertifizierung,
Dead-Letter-Replay, separater Worker-Host, Functions-Sandbox, Cron, Webhook-
Zustellung, Vault-Secret-Injektion, Egress-/Ressourcen-Policy und Metriken sind
offen. Das Austrittskriterium ist deshalb nicht erfüllt.
Alpha 3 ergänzt einen injizierbaren Worker-/Runtime-Port mit Lease-Heartbeat,
Timeout/Abort und redigierten Zählern sowie Admin-only DLQ-Liste und concurrent-
idempotentes Replay über Migration 0027. Ein allgemeiner Sandbox-Host, externe
Metrics und reale Worker-/Broker-Evidenz bleiben offen.
Alpha 4 ergänzt interne Function-Sandbox-, Webhook-Signer/Transport- und
Cron→Queue-Ports mit digest-gepinnten Images, bounded JSON/Ressourcen/Egress,
SSRF-/Redirect-/Timeout-/Exact-Ack-Grenzen und deterministischen Occurrence-Dedupe-
Keys. Persistenz, Sandbox-/DNS-Pinning-Adapter und Provider-E2E bleiben offen.

**Nachtrag Release 1.17.** Sechs Faelle zertifizieren Project Queues ueber
mehrere Instanzen gegen echtes PostgreSQL: Claim-Disjunktheit bei 180
Nachrichten und sechs gleichzeitig claimenden Instanzen, genau ein Gewinner bei
acht gleichzeitigen Zugriffen auf eine Nachricht, Lease-Fencing nach echtem
Ablauf mit totem Alt-Token, Retry-Autoritaet beim Server, Kapazitaetsgrenze
unter Nebenlaeufigkeit und Dedupe ueber Instanzgrenzen.

Kein Produktfehler dabei; alle Fehlschlaege lagen in den Testparametern. Ein
Umgehungsversuch am Trigger vorbei bestaetigte zudem, dass
`project_queue_messages_update_guard` Zustandsuebergaenge auch gegen den
Owner-Zugang schuetzt.

Das Austrittskriterium bleibt **nicht erfuellt**: Es verlangt zusaetzlich
Egress-Policy, Ressourcenlimits und Secret-Canary-Tests ohne gemeinsame
Ausfuehrungsautoritaet, also Functions-Sandbox, Cron und Webhook-Zustellung.
Diese sind weiterhin nur interne Vertragsports ohne Laufzeit.

## Stufe 1.7 — Developer Experience

TypeScript SDK, CLI, lokale Umgebung, Schema Pull/Push, Migrationen, Seed,
Typed Clients und Framework-Beispiele. Austritt: reproduzierbarer Fresh-Install-
und Upgrade-E2E auf Windows, macOS und Linux.

Status: **Alpha-Checkpoint erreicht**. Alpha 1 liefert ein frameworkfreies generisches
TypeScript-SDK mit Typed Table CRUD, Schema-, Queue-, Project-Auth- und Storage-
Clients sowie sicheren Origin-/Credential-/Timeout-/Fehlergrenzen.
Alpha 2 ergänzt secretfreie Initialisierung, Status, deterministischen Schema-
Type-Generator, Single-Statement-Migration-Plan und INSERT-only Seed-Check. Alle
Apply-/Push-Schritte bleiben bewusst aus. Alpha 3 ergänzt ESM/DTS-/CLI-Builds,
Tarball-Verträge, Project-Key-Schema-Pull, Fresh-Project-Smoke und eine ausführbare
Drei-OS-CI-Matrix. Lokal bestätigt ist nur Linux; archivierte Windows-/macOS-Läufe,
Upgrade-E2E und Publishing bleiben offen und verhindern den stabilen Austritt.

## Stufe 1.8 — Product Operations

Teams, feinere Rollen, Usage Metering, Quotas, Billing, Logs, Monitoring, PITR,
Restore, Status Page und Support-Consent. Austritt: Billing-/Quota-Konsistenz,
Restore-Drills und vollständige Operator-Runbooks.

Status: **Alpha 1 erreicht**. Sechs feste Metriken, UTC-Monatsfenster, verifier-only
Idempotenz, atomare `observe`-/`enforce`-Quotas, optimistische Policy-Revisionen,
Migration 0028 mit Tenant-RLS sowie eine read-only REST-/Console-Projektion sind
implementiert. Vier optionale PostgreSQL-Fälle sind codiert, aber lokal ohne
Docker nicht ausgeführt. Produktmodule emittieren noch nicht durchgängig
transaktional; Tarife, Preise, Rechnungen, Payments, Teams, PITR/Restore und die
weiteren Operations-Flächen bleiben offen.

## Stufe 2.0 — Managed Platform

Provider-Onboarding, HA, Upgrades, Skalierung, reale signierte DR-/Security-/
Deployment-Evidenz, Schweizer Datenflussnachweis und unabhängiger Pentest ohne
offene Critical/High Findings. Erst dann ist eine stabile Managed-BaaS-
Freigabe vertretbar.
