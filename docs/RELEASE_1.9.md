# Release 1.9.0 — Real-Service Certification

> Datum: 4. August 2026 · Vorgänger: `1.8.0-alpha.1`

## Wofür dieses Release steht

Bis `1.8.0-alpha.1` galt für jede Stufe ab 1.3 derselbe dokumentierte Vorbehalt:
„Docker, Podman, `postgres` und `psql` waren in dieser Arbeitsumgebung nicht
verfügbar." Sämtliche dauerhaften Adapter waren codiert, statisch geprüft und
**nie gegen einen echten Dienst ausgeführt**. 30 Real-Service-Tests standen
dauerhaft auf `skipped`.

Dieses Release führt beide Zertifizierungsstacks erstmals aus. Das Ergebnis ist
der eigentliche Inhalt: **fünf Produktfehler, die ausschließlich unter einer
realen Datenbank auftreten** — darunter zwei, die einen als fertig
dokumentierten Pfad vollständig funktionsunfähig machten.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | 28 von 28 bestanden, exit 0, 29 Migrationen angewandt |
| MinIO-/ClamAV-Zertifizierung | 2 von 2 bestanden, exit 0, Clean- und EICAR-Pfad |
| Lokale Vitest-Suite (Windows) | 692 bestanden, 47 übersprungen, 0 fehlgeschlagen |
| Strict TypeScript | grün |
| Rohlogs und Manifeste | `docs/evidence/2026-08-04/` |

Die Läufe liegen ungefiltert samt generiertem Manifest ab. Ein Manifest nennt
Commit, Exit-Code, Testzahlen, Migrationszahl und Image-Tags und wird aus dem
Log erzeugt, nicht von Hand gepflegt.

## Behobene Produktfehler

### Der dauerhafte Queue-Adapter konnte nie eine Nachricht schreiben

`enqueue` sperrt die Queue-Definition mit `SELECT … FOR UPDATE`. Das scheiterte
zweifach: PostgreSQL verlangt für jede Sperrklausel zusätzlich zu `SELECT` die
`UPDATE`-Berechtigung auf mindestens einer Spalte, und unter aktivem Row Level
Security muss die Zeile zusätzlich eine UPDATE-Policy erfüllen. Migration 0026
gewährte weder das eine noch definierte sie das andere. Jedes durable Enqueue
brach mit `permission denied for table project_queues`.

Migration 0029 ergänzt beides eng begrenzt: `UPDATE` auf genau einer Spalte und
eine Lock-Policy mit `WITH CHECK (false)`. Der Trigger `project_queues_immutable`
weist weiterhin jedes `UPDATE` ab; die Definition bleibt unveränderlich.

### Domänenfehler wurden an der Transaktionsgrenze gelöscht

`withTenantTransaction` leitete jeden Fehler aus dem Callback durch
`mapPostgresError`. Domänenfehler erben von `Error`, nicht von
`RepositoryError`, und wurden dort zu einem generischen `PERSISTENCE_ERROR`.
Die Verträge `QUEUE_LEASE_LOST`, `STORAGE_CONFLICT` und
`STORAGE_QUOTA_EXCEEDED` erreichten ihre Aufrufer nicht mehr, sobald ein Adapter
gegen eine echte Datenbank lief. Ein erwarteter fachlicher Konflikt war nicht
mehr von einem Infrastrukturausfall zu unterscheiden.

Unterschieden wird jetzt über die Fehlerklasse: Eine eigene Klasse trägt einen
Domänenvertrag und wird unverändert weitergereicht.

### Die Generated Data API lud gegen echtes PostgreSQL keine Tabelle

`pg_index.indkey` ist ein `int2vector` und damit **nullbasiert**, anders als ein
gewöhnliches PostgreSQL-Array. `array_position` liefert den rohen Subscript, die
erste Primärschlüsselspalte also `0`. Die Grenzprüfung verlangt eine
einsbasierte Position und verwarf deshalb **jede reale Tabelle** mit
`GENERATED_DATA_API_BOUNDARY_REJECTED`. Die Position wird jetzt gegen
`array_lower` normalisiert.

Damit war der Kern der im Stufenplan als *fertig* geführten Stufe 1.2 gegen
echtes PostgreSQL nie funktionsfähig.

### Sensible Spalten standen in der Tabellenbeschreibung

Spalten mit sensitivem Namen waren aus Zeilen, Filtern, Sortierung, Mutationen
und der generierten OpenAPI ausgeschlossen, erschienen aber weiterhin mit Namen
in der mitgelieferten Tabellenbeschreibung. Das offenbarte jedem Inhaber eines
öffentlichen Projekt-Keys Existenz und Namen einer Spalte wie `api_token` und
widersprach dem dokumentierten Vertrag. `publicTable` filtert sie jetzt.

### Fehlerursachen waren nicht diagnostizierbar

`mapError` der Queue-Domäne und die Grenzprüfung der Generated Data API
verwarfen ihre Ursache ersatzlos. Der erste echte Lauf war dadurch nicht
auswertbar. Beide führen die Ursache jetzt als internen `cause`; Routen und MCP
serialisieren weiterhin ausschließlich `code`.

## Behobene Harness- und Testfehler

- `docker-compose.certification.yml` mountete das Rollen-Script in ein
  read-only Verzeichnis-Mount hinein. Docker Desktop und WSL2 lehnen das mit
  `make mountpoint: read-only file system` ab; der PostgreSQL-Container startete
  nicht. Neu liegt genau eine Datei in `/docker-entrypoint-initdb.d`.
- Beide Stacks hängten ein `node_modules`-Volume in den read-only Bind des
  Arbeitsverzeichnisses. Das funktionierte nur, solange lokal zufällig ein
  `node_modules` existierte; in CI mit frischem Clone wäre es derselbe Fehler.
- ClamAV war nur als `service_started` deklariert, während `freshclam` beim
  ersten Start die Signaturdatenbank lädt. Jetzt entscheidet `clamdcheck.sh`.
- Der Storage-Stack adressierte MinIO über den Docker-Servicenamen und scheiterte
  an der korrekten Regel, dass Klartext-HTTP nur gegen Loopback erlaubt ist. Der
  Testcontainer teilt jetzt die Netzwerk-Namespace von MinIO.
- Die Real-DB-Teardowns verletzten zwei richtige Invarianten: den Fremdschlüssel
  auf den Organisationsgründer und die Append-only-Regel des Audit-Logs.
- `npm test` war auf **Windows nie grün**. 17 Fälle in 10 Dateien prüfen
  POSIX-Dateirechte, die Windows nicht ausdrücken kann. Sie laufen jetzt auf
  POSIX und melden sonst `skipped`, nie `passed`.

Die Harness-Tests hatten den ersten Defekt per String-Assertion festgeschrieben.
Sie prüfen jetzt strukturell, dass kein Mount-Ziel innerhalb eines anderen liegt.

## Neu: SMTP-Delivery für Project Auth

`ProjectAuthDeliveryPort` besaß nur `DisabledProjectAuthDelivery`, das wirft, und
`NoopDevelopmentProjectAuthDelivery`, das nichts tut. In Production war weder
Verifikationsmail noch Magic Link noch Passwort-Reset zustellbar.

Der neue Adapter spricht SMTP direkt über `node:net` und `node:tls`, wie schon
der ClamAV-INSTREAM-Client und der S3-SigV4-Provider. Vertrag: genau ein
Empfänger, TLS außer bei explizitem Development-Opt-in, Credentials niemals
unverschlüsselt, Adressen und Redirect-Ziel gegen Header-Injektion geprüft,
begrenzte Antwortgröße, Connect- und Command-Timeout. Das Einmal-Token steht nur
im Nachrichtenkörper. Ohne konfigurierten SMTP-Host bleibt der Port fail-closed.

## Stufenwirkung

**Stufe 1.4 Storage ist abgeschlossen.** Das Austrittskriterium verlangt
Cross-Tenant-, Malware-/Content-Type- und Signed-URL-Expiry-Tests. Alle laufen
gegen echtes PostgreSQL 17, echtes MinIO und echtes ClamAV, und die Läufe sind
archiviert.

**Stufe 1.3 Project Auth bleibt offen.** Account-Lifecycle und Token-Replay sind
gegen echtes PostgreSQL grün, der Mail-Adapter existiert. Das Austrittskriterium
verlangt zusätzlich eine Provider-E2E-Matrix; echte Mailzustellung und ein echter
OIDC-Provider fehlen weiterhin.

**Stufe 1.2 wird nicht zurückgestuft, aber korrigiert vermerkt.** Sie bleibt
abgeschlossen, jetzt jedoch erstmals gegen eine reale Datenbank belegt statt nur
gegen ein nachgebildetes Schema.

## Ehrlich offen

- Provider-E2E für Project Auth: echte Mailzustellung und echter OIDC-Provider
- Realtime PostgreSQL-CDC, horizontaler Fan-out, Multi-Instance-Fencing
- Queue-Multi-Instance-, Crash-, Soak- und Lastläufe
- Functions-Sandbox, Cron-Lease, Webhook-Outbox, DNS-Pinning
- transaktionale Usage-Emitter, Tarife, Rechnungen, Payments
- archivierte Windows-/macOS-CI-Läufe, Registry-Publishing
- HA, PITR, Restore-Drill, Schweizer Datenflussnachweis, unabhängiger Pentest
