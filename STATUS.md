# QKERN Status

> Stand: 1. Oktober 2026 · Release: `2.71.0` · Statusdatei ist Teil der Definition of Done.

QKERN ist ein belastbarer Product-MVP und eine modulare Architekturgrundlage,
aber noch keine vollständige Supabase-Alternative.

## Fortschrittsmessung

Ein einzelner Prozentwert wurde entfernt. Er maß Fläche statt Tiefe und besaß
keine Messvorschrift; er zählte geschriebenen Code, nicht verifiziertes
Verhalten. Release 1.9 hat gezeigt, wie irreführend das ist: Zwei als fertig
oder implementiert dokumentierte Pfade waren gegen eine reale Datenbank
überhaupt nicht funktionsfähig.

Gemessen wird jetzt zweiachsig je Modul:

- **implementiert** — ausführbare vertikale Funktion vorhanden, lokal getestet
- **zertifiziert** — gegen echte Dienste ausgeführt, Lauf archiviert

| Modul | implementiert | zertifiziert |
| --- | --- | --- |
| Control Plane, Approval/Audit, Migration Runtime | ja | ja — 79 Real-DB-Fälle; der Migrations-**Prozess** wendet seit `1.49.0` in einer echten Projektdatenbank an, mit Ledger-Eintrag |
| Generated Data API | ja | ja — 18 Real-DB-Fälle: RLS, Injection, `security_invoker`-Views (`1.71.0`), RPC über SECURITY-INVOKER-Funktionen (`1.72.0`), ein OpenAPI-Dokument, das Views und RPC nach denselben Grenzen beschreibt (`1.80.0`), Aggregate unter der RLS des Aufrufers (`1.86.0`) , die Trigger-Liste aus dem Katalog (`2.9.0`), die Funktionsliste (`2.18.0`) sowie Indizes, Policies und Enum-Typen (`2.19.0`) und Erweiterungen, Rollen, Publikationen und Spaltenrechte (`2.20.0`) sowie Namen mit Grossbuchstaben (`2.26.0`) und ein Pflichtargument namens `valueOf` (`2.28.0`) |
| Project Auth | ja | ja — Lifecycle, Replay, echtes SMTP, echtes OIDC und SAML 2.0 gegen einen Anbieter, der wirklich unterschreibt (`2.99`); die Gegenstelle ist kein fremdes Produkt, und das steht auch im Fall |
| Object Storage | ja | ja — 8 Real-DB-Fälle plus versitygw/ClamAV (bis `2.13.0` MinIO, dessen Image von Docker Hub verschwunden ist); seit `2.96` ein S3-Endpunkt `/s3` mit SigV4, im Storage-Stack mit echter Signatur zertifiziert; seit `2.99` dazu Presigned URLs, `aws-chunked`, Range, CopyObject und DeleteObjects, und **ein echter Client hat den Endpunkt gesehen**: das AWS SDK für JavaScript über HTTP; seit `2.101` Multipart am S3-Endpunkt auf demselben Dienstweg, und der Client hat die Datei **selbst geteilt** |
| Project Queues | ja | ja — 9 Real-DB-Fälle plus 6 Multi-Instance-Fälle unter Last; seit `1.88.0` mit Metrics-Export im Prometheus-Textformat |
| Usage Metering | teilweise | teilweise — 34 Real-DB-Fälle; **alle sechs Metriken melden**, append-only Preisblatt mit Monatsprojektion (`1.67.0`) und ein Rechnungslauf, der abgeschlossene Monate als eigener Prozess fakturiert (`1.68.0`), mit REST-Lesefläche und belegtem Wettlauf zweier Läufe (`1.77.0`) und lückenlosem Nummernkreis samt Fälligkeit (`1.81.0`); keine Zahlungsanbindung |
| Realtime | ja | ja — Log, Fan-out, CDC, Tenant, Ordering, Drop und Soak zertifiziert; dauerhafte Presence mit Pacht und Aufräumer, instanzübergreifend zusammengeführt; Nachreichen auf einem `changes:`-Kanal mit erneut angewandter Zeilensicherheit; Production-Start gegen TLS-PostgreSQL belegt, Verbindung als `verify-full` im Server nachgelesen; Postgres Changes laufen unter `production` ueber denselben vault-gestuetzten Projektdatenbank-Katalog wie die Migrationen, belegt gegen echten Vault |
| Compute Contracts | Functions, Cron und Webhooks hinterlegbar, verwaltbar, ausführbar und nach aussen rufend; Egress adressgeprüft; Nebenläufigkeit clusterweit | ja — 51 Real-DB-Fälle, dazu 33 im Functions-Lauf und 14 gegen einen echten HTTPS-Empfänger; Kette von der Queue bis in den Container in einem Lauf; der Cron-Prozess dispatcht als eigener Prozess; seit `2.67.0` Inhaltslogs je Aufruf am echten Container |
| SDK und CLI | ja | teilweise — nur Linux belegt |
| Managed Operations | nein | nein |

## Releasezustand

| Prüfschritt | Ergebnis |
| --- | --- |
| Strict TypeScript | grün |
| Vitest (Windows) | grün, 0 fehlgeschlagen; die Zahlen je Release stehen in `docs/QA.md` |
| **Startfähigkeit der Worker** | **alle 7 Prozesse erreichen ihre eigene Konfigurationsgrenze — seit `1.44.0` als Vertrag geprüft** |
| **Arbeitende Prozesse** | **8 von 8 belegt: der Rechnungslauf seit `1.68.0`, Queue-Wirt (`1.44.0`), Compute (`1.45.0`), Migrationen (`1.49.0`), Incident-Publisher (`1.56.0`), Realtime (`1.57.0`), Apply-Publisher (`1.58.0`) und seit `1.62.0` der Provisioner — er macht aus einem wartenden Auftrag eine Bindung in der Datenbank und ein Projekt im Zustand `ready`, gegen einen echten HTTPS-Broker mit der echten Rolle. Der Weg dorthin führte durch drei Produktfehler: das fehlende Leserecht des Heartbeat-`ON CONFLICT` (`1.61.0`), ein mehrdeutiges `RETURNING` und ein fehlendes Leserecht für `INSERT … RETURNING` (beide `1.62.0`)** |
| **Health-Probe** | **6 von 7 Prozessen starten sie: vier seit Baseline `1.8.0`, Compute seit `1.46.0`, der Queue-Wirt seit `1.47.0`. Realtime ist ausgenommen und begründet — es hat keine Runde, die `ready` tragen könnte** |
| Next.js Production Build | grün |
| Production Dependency Audit | 0 bekannte Schwachstellen |
| SDK-/CLI-Paketbuild | ESM/DTS und CLI-JS grün; die Tarball-Prüfung läuft seit `2.14.0` auch auf Windows (npm-cli.js direkt mit Node) und ist auf allen drei Runnern belegt (`2.15.0`) |
| Fresh-Project-Smoke | **Linux, Windows und macOS auf GitHub-Runnern grün (`2.15.0`, Lauf 36163798505, archiviert unter `docs/evidence/2026-09-25/`)** |
| **PostgreSQL-17-Zertifizierung** | **249 von 249 bestanden, exit 0, zweimal reproduziert — seit `1.90.0` mit 300 Verbindungsplätzen statt der Voreinstellung 100, geprüft im Lauf** |
| **versitygw-/ClamAV-Zertifizierung** | **11 von 11 bestanden, exit 0, zweimal reproduziert im Slice-Lauf `qkern-slice-mp` mit zwei Mutationsproben (Multipart am S3-Endpunkt, `2.101`: die Prüfsumme der ganzen Datei erreicht den Scanner nicht, ein abgebrochener Upload lässt die Reservierung stehen) — der neue Fall lässt das AWS SDK eine Datei über der Multipart-Schwelle hochladen, die es selbst in Teile schneidet; seit `2.14.0` gegen versitygw statt MinIO, dessen Image von Docker Hub verschwunden ist; seit `1.78.0` räumt der Lifecycle verfallene Multipart-Reservierungen und Provider-Waisen ab und verschont lebende Uploads** |
| **Project-Auth-Provider-Zertifizierung** | **11 von 11 bestanden, exit 0, zweimal reproduziert im Slice-Lauf `qkern-slice-samlrest` mit einer Mutationsprobe (die signierte `AuthnRequest` lässt das `SigAlg` aus dem unterschriebenen Text weg, und der Kopplungsfall fällt) — der neue Fall holt die Metadaten über die echte Route und prüft die Signatur der Anfrage **nur** mit dem Zertifikat aus diesem Dokument; seit `1.76.0` mit zwei echten, getrennten OIDC-Providern; seit `1.83.0` mit aufzählbarer Provider-Auswahl als Zwei-Felder-Projektion; seit `1.85.0` mit `email_verified`-Erfordernis je Provider; seit `2.99` mit SAML 2.0 über die echte Assertion-Consumer-Route — vierzehn Fälschungen fallen einzeln, dieselbe Assertion zweimal fällt am Riegel in der Datenbank, und die Gegenstelle unterschreibt mit `node:crypto` statt ein fremdes Produkt zu sein** |
| **Functions gegen Docker plus PostgreSQL** | **33 von 33 bestanden, exit 0, zweimal reproduziert im Slice-Lauf `qkern-slice-fns` mit einer Mutationsprobe (Inhaltslogs am Drain, 2.108: wird nur die erste Ausgabezeile je Aufruf aufgelöst, fällt der neue Fall) — seit `1.89.0` mit Aufrufprotokoll, seit `2.67.0` mit Inhaltslogs am echten Container, und der neue Fall trägt genau diese Zeilen in eine Log-Drain-Ladung (2.108)** |
| **Webhook-Signatur gegen echten Vault** | **8 von 8 bestanden, exit 0, zweimal reproduziert** |
| **Ausgehender Weg gegen echten HTTPS-Empfänger** | **16 von 16 bestanden, exit 0, zweimal reproduziert** |
| **Backup und Restore gegen TLS-PostgreSQL mit WAL-Archiv** | **1 von 1 bestanden, exit 0, zweimal reproduziert — seit `2.29.0`: verschlüsseltes Basisbackup über `sslmode=verify-full`, Wiederherstellung bis zu einem Zeitpunkt aus dem WAL-Archiv, Schema, Zeilen, Audit-Kette und Manifest belegt, Evidenz vom Produkt-Verifier geprüft; Mutation (Archiv aus) fällt** |
| **Realtime gegen echtes PostgreSQL** | **7 Faelle mit zwei Instanzen, davon zwei fuer dauerhafte Presence, plus 7 Faelle der ganzen Aenderungskette, davon einer fuer das Nachreichen unter Zeilensicherheit** |
| **Realtime-Production gegen TLS-PostgreSQL und echten Vault** | **19 von 19 bestanden, exit 0, zweimal reproduziert im Slice-Lauf `qkern-slice-pres`, davor 17 von 17 im Lauf `qkern-slice-rtc`; je Slice zwei Mutationsproben. Der ausgelieferte Prozess laeuft unter `NODE_ENV=production` an, traegt einen Broadcast durch und einen zweiten in eine zweite Instanz; `pg_stat_ssl` meldet fuer jede seiner Verbindungen TLSv1.3; ohne Vertrauensanker und unter einem Namen, der nicht im Zertifikat steht, kommt er nicht hoch; jede der fuenf Bedingungen des Tors laesst den Start einzeln fallen und nennt sich. Neu: Eine echte Datenbankaenderung geht durch `qkern_internal.change_feed` bis zu einem angemeldeten Abonnenten, mit dessen Claims gelesen und unter Zeilensicherheit; die Zeile des anderen Nutzers kommt nicht an. Die Zugangsdaten der lesenden Rolle holt der Prozess ueber `https` aus einem Vault mit gepruefter Kette, die Verbindung zur Projektdatenbank haengt zusaetzlich an einem Blatt-Pin, und `pg_stat_ssl` meldet fuer sie TLSv1.3 unter `qkern_project_api_app`. Neu dazu: Presence zwischen zwei Production-Prozessen wird zusammengefuehrt, und der Eintrag der Instanz, die mit `SIGKILL` stirbt, laeuft aus und kommt als Leave an; ein Abonnent, der die Verbindung verloren hat, setzt mit seinem Cursor wieder auf und bekommt genau die verpasste Zeile, die ihm Row Level Security gibt, nicht die des anderen Nutzers. Die Mutationsproben dieses Slices: Reicht das Nachreichen die Zeile ohne erneute Pruefung aus, faellt der Fall mit zwei statt einer Zeile; laesst der Aufraeumer verwaiste Presence stehen, fallen der Fall mit zwei Instanzen und (2.113). Sechs Faelle halten die andere Haelfte: Fehlt der Vault-Zweig, die Bindung, die Tokendatei, die `https`-Adresse oder die Generated Data API, faellt der Start und nennt sich; und ein Vault, der fuer eine gueltige Bindung kein Zugangsdatum hat, laesst ihn ebenfalls fallen, statt lauschend in ein leeres `changes:`-Abonnement zu rutschen** |
| Rohlogs und Manifeste | `docs/evidence/2026-08-04/` bis `docs/evidence/2026-10-01/` |
| Realtime Soak | 120 Aenderungen ohne Verlust **mit eingeschaltetem Usage-Emitter**, p95 zwischen 421 und 3315 ms ueber fuenf Laeufe; die Streuung ueberdeckt die Kosten des Emitters. Der hoechste Wert und ein Fehlschlag mit p95 7638 ms stammen aus einem Lauf auf einer Maschine mit rund 1 GiB freiem Speicher; der Wiederholungslauf derselben Aenderung war gruen. Der Soak selbst laeuft weiter unter `test`; den Production-Start belegt der eigene TLS-Stack |
| Project Queues Multi-Instance/Load | **zertifiziert** |
| **Webhook-Zustellkette** | **6 Fälle Ende zu Ende plus Mutationsprobe** |
| **Functions Ende zu Ende** | **Registry → Datenbank → Dienst → Container in einem Lauf zertifiziert**; seit `1.35.0` ohne jede ersetzte Stelle |
| **GitHub Actions** | **seit `2.15.0` belegt: Zertifizierung (161/161, 8/8, 7/7) und Developer Experience auf Ubuntu, Windows und macOS, Lauf 36164575195 und 36164575183, archiviert unter `docs/evidence/2026-09-25/`** |
| Managed Production Go-live | noch nicht freigegeben |

Die 334 übersprungenen Fälle sind Real-Service-Tests, die in den Docker-Läufen
laufen, und POSIX-Fälle, die auf Windows nicht ausdrückbar sind. Sie gelten als
übersprungen, nie als bestanden. Die Zahl stand bis zu diesem Slice auf 173 und
war damit über mehrere Releases überholt; gemessen sind es 2384 bestandene und
334 übersprungene Fälle in 378 Dateien.

## Ausführbar implementiert

- Account, Session, persönlicher Workspace und serverseitige Rollenmatrix
- tenantisolierte PostgreSQL-Control-Plane mit RLS und getrennten Laufzeitrollen
- Change Sets, verschlüsselte Statements, Approval-Artefakte und Audit-Hash-Kette
- je Projektumgebung `manual`, `guarded` oder `autonomous`, Risikogrenze,
  Auto-Queue und Not-Aus; autonome Entscheidungen bleiben auditiert
- echte opt-in PostgreSQL-Data-Plane für Schema-Introspection und begrenzte
  Read-only-Abfragen über REST und MCP
- opt-in Generated Data API mit live-schema-gebundenem CRUD, RLS, Projekt-Keys,
  parametrierten Filtern, Cursor-Pagination, OpenAPI und Console Table Editor
- getrennte Project-Auth-App-User mit Email/Passwort, Magic Link, Reset,
  TOTP-/Recovery-MFA, OIDC/PKCE, Ed25519-JWT/JWKS und Refresh-Replay-Sperre
- opt-in Object Storage mit privaten Buckets, festen Policies, Quota, signed S3-
  Grants, Provider-HEAD, Quarantäne, ClamAV-Port, Lifecycle und Race-Härtung
- asynchrone Migration Queue, Worker, Target-Ledger/Fence, Reconciliation,
  Incidents, getrennte Publisher sowie Provisioning-/Release-Sicherheitsverträge
- lokaler Realtime-WebSocket-Transport mit exakter Origin-/Pfad-/Subprotocol-
  Prüfung, First-Frame-Auth, Channel-Policy, Broadcast, Presence, Ordering,
  signiertem Replay und Backpressure
- neue opt-in Project-Queues-Foundation mit Scope-/Policy-Isolation, verzögertem
  JSON-Enqueue, SHA-256-verifier-only Dedupe und Queue-Capacity
- atomare Claims, einmalige workergebundene Lease-Tokens, Renewal, monotones
  Reclaim-Fencing, serverberechnetes exponentielles Retry und Dead Letters
- dauerhafter PostgreSQL-17-Adapter mit Migration 0026, Tenant-RLS, engen
  Spaltengrants, `FOR UPDATE SKIP LOCKED`, persistentem Fencing und Cleanup
- injizierbarer Queue-Worker mit Lease-Heartbeat, Timeout/Abort, fester
  Fehlerklassifikation, sicherem Shutdown und redigierten Ereignissen/Zählern
- Admin-only Dead-Letter-Liste und concurrent-idempotentes Replay über eine
  unveränderliche same-tenant Quellbindung aus Migration 0027
- Function-, Cron- und Webhook-Vertragsports mit digest-gepinnten Images,
  Ressourcen-/Egress-/Secret-Ref-Grenzen, Cron-Dedupe und signiertem Exact-Ack
- frameworkfreies generisches TypeScript-SDK mit Typed Table CRUD sowie Clients
  für Schema, Project Auth, Storage und Queues über einen gehärteten Fetch-Port
- secretfreie CLI für init/status/schema pull/migration plan/seed check mit
  Type-Generator, Projektpfadgrenze und niemals impliziter Ausführung
- eigenständig kompilierbare private SDK-/CLI-Pakete mit ESM, Typdeklarationen,
  Manifest-/Tarball-Gate und einem ausführbaren secretfreien Fresh-Project-Smoke;
  Schema Pull akzeptiert jetzt scope-gebundene Project Keys wie SDK und CLI
- REST/OpenAPI sowie MCP für Queue-Liste, Status und Enqueue; Worker-Lease-
  Operationen bleiben bewusst aus MCP ausgeschlossen, und der Bereich
  `queues:write` erreicht sie darum auch über OAuth nicht
- opt-in Usage-Metering mit sechs festen Monatsmetriken, verifier-only
  Idempotenz, atomaren `observe`-/`enforce`-Quotas und stabilen Retry-Entscheidungen
- dauerhafter Usage-Adapter mit Migration 0028, Tenant-RLS, append-only Events,
  monotonen Countern und optimistisch versionierten Quota-Policies
- read-only Usage-/Quota-Projektion in REST, OpenAPI und Console; Dezimalstrings
  vermeiden Präzisionsverlust, Event Keys und Einzelereignisse bleiben intern
- lesende und schreibende, eng annotierte MCP-Werkzeuge über dieselben Policy-
  und Tenantgrenzen wie REST
- read-only Sicht auf die Realtime-Grenzen in REST, OpenAPI und Console mit
  Ursprung je Grenze (`environment`, `default`, `code`; keine liegt in der
  Datenbank) und die Kanalrechte so benannt, wie der Code sie entscheidet:
  feste Präfixregel plus RLS auf `changes:`-Kanälen, kein anlegbares Rechtemodell

## Product Preview oder offen

| Modul | Stand | Nächster belastbarer Slice |
| --- | --- | --- |
| Project Auth | **abgeschlossen und zertifiziert** | weitere Provider, SMS und SAML als eigener Slice |
| Storage | **abgeschlossen und zertifiziert; Multipart/Resumable seit `1.70.0`** | Transform-Service und CDN als eigener Slice |
| Realtime | **abgeschlossen und zertifiziert; Production-Tor seit `1.73.0`, Production-Start gegen TLS-PostgreSQL belegt, Postgres Changes unter `production` belegt; dauerhafte Presence und Nachreichen belegt** | die Position des Pollers liegt je Instanz im Prozess und eine Verbindung steht in keiner Tabelle; der Katalog des Realtime-Prozesses kommt nur aus ausdruecklichen Bindungen, nicht aus der Control Plane |
| Project Queues / Jobs | Multi-Instance zertifiziert | startbarer Handler-Host und Metrics-Export |
| Functions/Cron/Webhooks | **abgeschlossen und zertifiziert** | Image-Deployment, AppRole-Auth und clusterweite Nebenläufigkeit |
| SDK/CLI | **auf npm seit `2.16.0`**: `@qkern/sdk@1.7.0-alpha.5`, `@qkern/cli@1.7.0-alpha.5` (`2.26.0`), Apache 2.0, Tag `alpha`; CI-Evidenz auf drei Betriebssystemen seit `2.15.0` | Upgrade-E2E und ein `latest`-Release |
| Billing/Usage | Alpha 1 Metering-/Quota-Grundlage | transaktionale Produkt-Emitter, Reconciliation, Tarife und Rechnungsintegration |
| Managed Swiss Operations | Nachweisverträge | Provider-Onboarding, HA, PITR, Restore, Datenflussnachweis |

## Aktueller Fokus

**Release 1.9 hat beide Zertifizierungsstacks erstmals ausgeführt.** Dabei traten
fünf Produktfehler zutage, die ausschließlich unter einer realen Datenbank
auftreten — darunter zwei, die einen als fertig beziehungsweise implementiert
dokumentierten Pfad vollständig funktionsunfähig machten: Der dauerhafte
Queue-Adapter konnte nie eine Nachricht schreiben, und die Generated Data API lud
keine einzige reale Tabelle. Beide sind behoben und belegt. Details in
[Release 1.9](docs/RELEASE_1.9.md).

**Release 1.10 schließt Stufe 1.3.** Ein dritter Wegwerfstack mit Mailpit als
echtem SMTP-Server und Dex als echtem OIDC-Provider erbringt die vom
Austrittskriterium verlangte Provider-E2E-Matrix. Der Dienst läuft dabei ohne
Debug-Token: Der einzige Weg an ein Verifikations-, Magic-Link- oder
Reset-Token führt über eine tatsächlich zugestellte Nachricht. Details in
[Release 1.10](docs/RELEASE_1.10.md).

Damit sind die Stufen 1.1 bis 1.4 abgeschlossen. Als nächstes steht Stufe 1.5
Realtime an; dort fehlt der persistente PostgreSQL-Event-Log mit CDC.

## Wichtige Grenzen

- Project Queues ist disabled-by-default. `QKERN_RUNTIME_MODE=postgres` wählt den
  dauerhaften RLS-Adapter; der `ephemeral` Memory-Adapter bleibt Production-verboten.
- Der PostgreSQL-Queuepfad ist jetzt gegen einen realen Server zertifiziert
  (5 Fälle: Dedupe, disjunkte Claims, Lease-Fencing, Replay-Bindung, Cross-Tenant-
  RLS). Mehrere Prozesse, Crash-Races und Last sind weiterhin nicht zertifiziert;
  der Pfad ist deshalb nicht Go-live-frei.
- Project Auth kann Mails zustellen, sobald ein SMTP-Host konfiguriert ist. Ohne
  Konfiguration bleibt der Port fail-closed und verweigert Action-Tokens, statt
  sie stillschweigend zu verwerfen. Eine Provider-E2E gegen einen echten Mail-
  und OIDC-Server fehlt weiterhin.
- Der Worker ist ein injizierbarer Execution-Port, noch kein allgemeiner Sandbox-
  Host. Zähler liegen pro Prozess vor und sind noch nicht extern scrapebar.
- Cron und Webhooks laufen seit `1.20.0` in einem startbaren Prozess
  (`npm run worker:compute`) und sind seit `1.21.0` über REST und Console
  verwaltbar. Nur das Aktivierungsflag ist änderbar; jede andere Änderung ist
  ein Löschen und ein neues Anlegen, und diese Grenze liegt als Spaltenrecht in
  der Datenbank. Es fehlen weiterhin ein Vault-gestützter Signaturschlüssel-
  Provider, automatische Entdeckung der zu bedienenden Scopes, SDK-/CLI-
  Anbindung und automatische Entdeckung der zu bedienenden Scopes. Seit `1.28.0`
  ist der Zustellprozess auch gegen einen echten HTTPS-Empfänger gelaufen —
  dabei kam heraus, dass das DNS-Pinning aus `1.27.0` gegen einen echten Socket
  jede Verbindung verhindert hatte. Ein Empfänger ausserhalb des eigenen
  Docker-Netzes und ein öffentlich vertrauenswürdiges Zertifikat bleiben offen.
- Queue-Claims und Settlement verlangen eine Service Role sowie exakten Worker,
  Token und Ablauf. Roh-Dedupe-/Lease-Secrets werden nicht persistiert.
- Realtime bindet standardmässig Loopback; seit `1.73.0` ersetzt ein Tor mit
  benannten Bedingungen (dauerhafter Log, Cursor-Geheimnis, Aufbewahrung,
  https-Origins, TLS-Attestierung bei öffentlichem Binding) das pauschale
  Production-Verbot. Der vollständige Production-Start ist jetzt belegt: Der
  Stack `docker-compose.realtime-certification.yml` führt ein PostgreSQL mit
  eigener CA, das Klartext abweist, und der ausgelieferte Prozess läuft davor
  an. Dabei kam ein Produktfehler heraus, der diesen Start seit `1.11.0`
  unmöglich gemacht hatte: Die `LISTEN`-Verbindung des Fan-outs baute sich ohne
  jede TLS-Konfiguration auf. Postgres Changes laufen jetzt auch unter
  `production`: Der Prozess ruft für seinen Projektdatenbank-Katalog dieselbe
  Fabrik wie der Migrations-Prozess, holt die Zugangsdaten der lesenden Rolle
  über `https` aus einem Vault und greift vor dem Lauschen einmal bis zur
  Datenbank durch. Offen bleiben History und Presence, die weiter im
  Prozessspeicher liegen.
- Usage Metering ist disabled-by-default. Browser und MCP dürfen keine Quota-
  Policies mutieren; `meter`/`operator` bleiben interne Autoritäten.
- Seit `1.29.0` melden Project Queues und Functions ihre Operationen selbst; ein
  erschöpftes hartes Limit weist die Operation wirklich ab. Seit `1.30.0` bucht
  der Enqueue **in derselben Transaktion**, in der er schreibt: keine Nachricht
  ohne ihre Zählung, keine Zählung ohne ihre Nachricht. Der Function-Aufruf
  bleibt nicht-transaktional, weil er nichts in die Control Plane schreibt, mit
  dem er atomar sein könnte. Seit `1.31.0` melden auch Generated Data API
  (gelesene Zeilen) und Storage (freigegebene Bytes); für diese beiden Metriken
  ist `enforce` nicht setzbar, weil die Menge erst nach der Arbeit feststeht.
  Seit `1.32.0` zählt `api_requests` an der HTTP-Grenze — in den
  Kontext-Resolvern von Queues, Storage und Generated Data API, also genau
  einmal je Anfrage — und ein erschöpftes hartes Limit antwortet mit 429. Seit
  `1.33.0` meldet auch Realtime, gebündelt statt je Nachricht. Damit melden
  **alle sechs Metriken**. Für drei davon ist `enforce` nicht setzbar, weil es
  nichts verhindern könnte: `database_row_reads` und `storage_egress_bytes`
  stehen erst nach der Arbeit fest, `realtime_messages` ist beim Schreiben
  längst gezählt. Ein Absturz des Realtime-Prozesses verliert den Puffer —
  bewusst zu wenig statt zu viel. Es existieren weder Preise noch Rechnungen,
  und keine dieser Zahlen ist ein Abrechnungsbeleg.
- Der PostgreSQL-Usagepfad ist lokal nur statisch und in Memory getestet; die vier
  Real-DB-Fälle sowie Multi-Instance-, Crash-, Reconciliation- und Lastläufe fehlen.
- `autonomous` ist eine explizite stehende Autorisierung, kein stiller Bypass.
- Generated Data API, Project Auth und Storage bleiben opt-in und verlangen ihre
  dokumentierten unprivilegierten Rollen, Provider und Scanner.
- Production Apply benötigt weiterhin eine externe maschinelle Release-Signatur.
- Schweizer Hosting, Datenresidenz, HA, RPO/RTO und Compliance sind vor einem
  Marktversprechen technisch und rechtlich nachzuweisen.
- Die vorhandene GitHub-Matrix ist noch keine Evidenz: Windows und macOS gelten
  erst nach tatsächlich grünen archivierten Runnerläufen als bestätigt.

## Dokumentation

- [Dokumentationsindex](docs/INDEX.md)
- [Handbuch](docs/HANDBUCH.md)
- [Project Queues](docs/PROJECT_QUEUES.md)
- [Usage Metering und Quotas](docs/USAGE_METERING.md)
- [Compute Contracts](docs/COMPUTE_CONTRACTS.md)
- [TypeScript SDK](docs/SDK_TYPESCRIPT.md)
- [CLI](docs/CLI.md)
- [Developer Experience](docs/DEVELOPER_EXPERIENCE.md)
- [Release 1.8 Alpha 1](docs/RELEASE_1.8_ALPHA1.md)
- [Realtime-Protokoll](docs/REALTIME_PROTOCOL.md)
- [Stufenplan](docs/STUFENPLAN.md)
- [Modularchitektur](docs/MODULES.md)
- [BaaS-Roadmap](docs/BAAS_ROADMAP.md)
- [Dokumentationspflege](docs/DOCS_MAINTENANCE.md)
- [Claude-/Agentenübergabe](docs/CLAUDE_HANDOFF.md)
