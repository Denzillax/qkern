# QKERN Handbuch

Dieses Handbuch gilt für `1.20.0`. QKERN benötigt Node.js **24.7 oder neuer**.

## 1. Lokaler Schnellstart unter Windows PowerShell

```powershell
node --version
npm --version
npm ci
$env:QKERN_RUNTIME_MODE="memory"
npm run dev
```

Dann `http://localhost:3000/register` öffnen, Account erstellen und die Console
aufrufen. Memory Mode ist für UI- und Workflow-Tests; Neustarts löschen Daten,
Production Apply und die echte Projekt-Data-Plane bleiben dort geschlossen.

Falls `node --version` kleiner als `v24.7.0` ist, Node aktualisieren, PowerShell
komplett schließen, neu öffnen und erneut prüfen. Native Argon2id-Fehler nach einem
Node-Update werden meist mit einer frischen Installation behoben:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

## 2. Vollständige lokale Control Plane mit PostgreSQL

Docker Desktop starten und im Projektordner ausführen:

```powershell
docker compose up -d
Copy-Item .env.example .env.local
npm run dev
```

In `.env.local` mindestens sichere lokale Werte für Passwort-Pepper und Statement-
Encryption setzen. Die Beispiel-URLs sind nur lokal. Die nummerierten Migrationen
werden vom offiziellen PostgreSQL-Image nur bei einem **neuen leeren Volume**
automatisch ausgeführt. Ein bestehendes Volume benötigt einen kontrollierten
Migrationslauf bis `0025_project_storage.sql`; nicht blind löschen.

## 3. Automation im Approval Center

Projekt und Environment auswählen, `Approval Center` öffnen und die Policy setzen:

- `Manuell`: riskante Änderungen warten auf einen User.
- `Abgesichert`: nur kleine erlaubte DDL-Klassen bis Medium, nie Production.
- `Autonom`: Änderungen bis zur gewählten Risikogrenze werden ohne menschliche
  Einzelentscheidung genehmigt.
- `Auto-Queue`: genehmigte Development-/Staging-Änderungen direkt einreihen.
- `Not-Aus`: automatische Genehmigung und neues Auto-Queueing sofort sperren.

Eine autonome Entscheidung bleibt als Approval Decision und Audit Event sichtbar.
Production benötigt beim Apply zusätzlich den externen maschinellen Signer aus dem
Production-Apply-Runbook; eine Person muss nicht pro Änderung klicken, die Signatur-
und Evidenzgrenze bleibt aber bestehen.

## 4. Echte Projekt-Data-Plane

Die Data Plane ist standardmäßig aus. Für lokale Entwicklung werden eine separate
Projekt-PostgreSQL-Datenbank und ein dedizierter Read-Login ohne Rollenmitgliedschaft,
Superuser, `BYPASSRLS`, CreateDB/CreateRole oder Replication benötigt. Danach:

```powershell
$env:QKERN_DATA_PLANE_ENABLED="true"
$env:QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG="true"
$env:QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON='[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_reader:local-only@127.0.0.1/project_database","expectedRole":"qkern_project_reader","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]'
```

Die Control Plane muss die Environment-Referenz auf denselben `managed:*`-Wert
gebunden haben. Production akzeptiert diesen Raw-URL-Adapter nicht und benötigt
einen injizierten Read-Role-Resolver.

Verfügbare Endpunkte:

- `GET /api/v1/projects/{projectId}/environments/{environment}/schema`
- `POST /api/v1/projects/{projectId}/environments/{environment}/query`

## 5. Generated Data API und Projekt-Keys

CRUD ist unabhängig von der freien Lese-Data-Plane standardmäßig aus. Es benötigt
einen eigenen Projekt-Login ohne Superuser, `BYPASSRLS`, Rollenmitgliedschaften,
Tabellenownership, CreateDB/CreateRole oder Replication. Der Login erhält nur die
benötigten direkten Tabellen-/Spaltenrechte. Jede freigegebene Tabelle benötigt
aktivierte RLS, einen Primärschlüssel und passende Policies.

Lokale Aktivierung unter PowerShell:

```powershell
$env:QKERN_GENERATED_DATA_API_ENABLED="true"
$env:QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG="true"
$env:QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON='[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_api:local-only@127.0.0.1/project_database","expectedRole":"qkern_project_api","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]'
```

Production lehnt diesen Raw-URL-Katalog ab und benötigt einen injizierten Vault-
Resolver für die dedizierte API-Rolle. Die Environment-Referenz in der Control
Plane muss exakt der `managed:*`-Referenz des Katalogs entsprechen.

In der Console unter `API` können Owner und Administratoren ablaufende `public`-
oder `service`-Keys erzeugen und widerrufen. Das Secret wird genau einmal angezeigt;
QKERN speichert nur einen SHA-256-Verifier. In diesem Alpha bleiben beide Key-Arten
RLS-pflichtig: `public` setzt den Claim `anon`, `service` den Claim `service_role`.
Ein Service-Key umgeht RLS nicht. Ein verifiziertes Project-Auth-JWT setzt
`authenticated` und die servergeprüften User-/Session-Claims.

Wichtige Endpunkte:

- `GET|POST|PATCH|DELETE /api/v1/projects/{projectId}/environments/{environment}/tables/{table}/rows`
- `GET /api/v1/projects/{projectId}/environments/{environment}/generated-openapi`
- `GET|POST /api/v1/projects/{projectId}/environments/{environment}/api-keys`
- `DELETE /api/v1/projects/{projectId}/environments/{environment}/api-keys/{keyId}`

Listen akzeptieren `select=id,name`, bis zu zehn wiederholte
`filter=spalte:operator:wert`, `order=spalte.asc|desc`, `limit=1..100` und den
zurückgegebenen opaken `cursor`. Erlaubte Operatoren sind `eq`, `neq`, `gt`,
`gte`, `lt`, `lte` und `in`; JSON-Werte wie `true`, `42`, `null` oder
`[1,2,3]` werden erkannt, alle Datenwerte aber serverseitig parametrisiert.

Beispiel mit einem bereits einmalig kopierten Key:

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
$uri = "http://localhost:3000/api/v1/projects/<project-id>/environments/development/tables/orders/rows?limit=20&filter=status:eq:paid"
Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
```

`POST` erhält `{ "schema":"public", "rows":[{...}] }`. `PATCH` erhält den
exakten Primärschlüssel als `match` und neue Werte als `values`; `DELETE` erhält
nur `schema` und `match`. Spalten mit Passwort-/Secret-/Token-/Key-Mustern sind
von Lesen, Filtern, Sortieren und Mutieren ausgeschlossen. Die Console `Table
Editor` benutzt dieselben Endpunkte und zeigt nie Beispieldaten.

## 6. Project Auth für App-User

Project Auth verwaltet die Nutzer einer Kundenanwendung getrennt von QKERN-Login,
Organisation und Membership. Es ist standardmäßig deaktiviert. Für einen lokalen
Durchstich zuerst eigene Schlüssel erzeugen; Werte nie committen:

```powershell
node -e "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519').privateKey;console.log('PRIVATE='+k.export({format:'der',type:'pkcs8'}).toString('base64'));console.log('MFA='+c.randomBytes(32).toString('base64url'));console.log('PEPPER='+c.randomBytes(32).toString('base64url'))"
```

Die drei ausgegebenen Werte in der aktuellen PowerShell-Sitzung setzen:

```powershell
$env:QKERN_PROJECT_AUTH_ENABLED="true"
$env:QKERN_PROJECT_AUTH_ALLOWED_ORIGINS="http://localhost:3000"
$env:QKERN_PROJECT_AUTH_REDIRECT_ORIGINS="http://localhost:3000"
$env:QKERN_PROJECT_AUTH_CALLBACK_BASE_URL="http://localhost:3000"
$env:QKERN_PROJECT_AUTH_ISSUER_BASE_URL="http://localhost:3000"
$env:QKERN_PROJECT_AUTH_SIGNING_KEY_ID="local-project-auth-1"
$env:QKERN_PROJECT_AUTH_SIGNING_PRIVATE_KEY_BASE64="<PRIVATE>"
$env:QKERN_PROJECT_AUTH_MFA_ENCRYPTION_KEY="<MFA>"
$env:QKERN_PROJECT_AUTH_PASSWORD_PEPPER="<PEPPER>"
$env:QKERN_PROJECT_AUTH_DEV_EXPOSE_TOKENS="true"
npm run dev
```

Das Debug-Flag gibt Verifikations-, Magic-Link- und Reset-Tokens nur lokal in der
Antwort zurück. Production verweigert mit diesem Flag den Start und benötigt einen
injizierten realen Delivery-Adapter. OIDC-Provider werden ausschließlich über die
serverseitige JSON-Konfiguration aus `.env.example` registriert; Request-Daten
können keine Token-, JWKS- oder Authorization-Endpunkte bestimmen.

Wichtige öffentliche Pfade beginnen mit
`/api/v1/projects/{projectId}/environments/{environment}/auth/`:

- `signup`, `verify`, `token`, `magic-link` und `password-reset`
- `mfa/enroll`, `mfa/challenge`, `user` und `logout`
- `oidc/{provider}/authorize`, `oidc/{provider}/callback` und `.well-known/jwks.json`
- `admin/users` für Owner/Administratoren über die QKERN-Console-Session

Alle öffentlichen Auth-Aufrufe benötigen einen exakt passenden Projekt-Key.
Für normale Tabellenzugriffe sendet die Anwendung den Projekt-Key in
`X-QKERN-Key` und das App-Access-JWT als Bearer:

```powershell
$headers = @{
  "X-QKERN-Key" = $env:QKERN_PUBLIC_KEY
  Authorization = "Bearer $env:QKERN_APP_ACCESS_TOKEN"
}
$uri = "http://localhost:3000/api/v1/projects/<project-id>/environments/development/tables/orders/rows?limit=20"
Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
```

Access Tokens laufen standardmäßig nach 15 Minuten ab. Refresh Tokens sind opaque,
werden bei jedem Gebrauch ersetzt und nur als Verifier gespeichert. Die Wiedergabe
eines alten Refresh Tokens sperrt die ganze Familie. Deaktivieren eines Users oder
Logout widerruft die Session sofort, weil die JWT-Prüfung auch die persistierte
Session kontrolliert. TOTP-Secrets sind AES-256-GCM-verschlüsselt; Recovery Codes
werden nur als HMAC-Verifier gespeichert und sind einmalig.

## 7. Project Storage

Project Storage ist unabhängig opt-in. Für einen vollständigen lokalen Upload-
und Scan-Durchstich zuerst PostgreSQL, MinIO und ClamAV starten:

```powershell
docker compose up -d postgres minio clamav
```

Im MinIO-UI unter `http://127.0.0.1:9001` mit den lokalen Compose-Werten anmelden
und einmal den Provider-Bucket `qkern-project-storage` anlegen. Danach in derselben
PowerShell-Sitzung setzen:

```powershell
$env:QKERN_PROJECT_STORAGE_ENABLED="true"
$env:QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS="http://localhost:3000"
$env:QKERN_PROJECT_STORAGE_S3_ENDPOINT="http://127.0.0.1:9000"
$env:QKERN_PROJECT_STORAGE_S3_REGION="us-east-1"
$env:QKERN_PROJECT_STORAGE_S3_BUCKET="qkern-project-storage"
$env:QKERN_PROJECT_STORAGE_S3_ACCESS_KEY_ID="qkern_local_access"
$env:QKERN_PROJECT_STORAGE_S3_SECRET_ACCESS_KEY="qkern_local_password_change_me_32bytes"
$env:QKERN_PROJECT_STORAGE_CLAMAV_HOST="127.0.0.1"
$env:QKERN_PROJECT_STORAGE_CLAMAV_PORT="3310"
$env:QKERN_PROJECT_STORAGE_SCANNER_MAX_OBJECT_BYTES="26214400"
npm run dev
```

Die Werte sind ausschließlich lokale Entwicklungsdaten. Production akzeptiert
keine rohen S3-Credentials aus Environment-Variablen und startet Storage nur mit
injiziertem rotierendem Provider-Credential-Port und Malware-Scanner. clamd besitzt
keine eigene TCP-Authentisierung: Port 3310 darf niemals ins Internet publiziert
werden; der lokale Compose-Stack bindet ihn nur an `127.0.0.1`. Für den ClamAV-
Container mindestens 3 GiB, besser 4 GiB RAM einplanen. Das standardmäßige Scanner-
Limit beträgt 25 MiB. Größere Objects bleiben `quarantined`, bis Adapter-, clamd-
und Bucket-Limits bewusst aufeinander abgestimmt wurden.

Owner oder Administratoren erstellen und löschen leere Buckets in der Console
unter `Storage`. Neue Buckets sind `private`/`private`, erlauben zunächst JPEG,
PNG, WebP und PDF, maximal 10 MB pro Object und 1 GB Gesamtquota. Die Admin-API
kann Read-/Write-Policy, Allowlist, Größen, Quota und Retention vollständig setzen.
`public` existiert nur für Reads; öffentliche Writes sind kein gültiger Zustand.

Der App-Upload besteht aus drei Schritten:

1. Die Anwendung berechnet SHA-256, deklariert Key, MIME und exakte Bytezahl und
   ruft `POST .../storage/buckets/{bucket}/uploads` auf.
2. Sie sendet Datei plus alle unveränderten Formfelder an die kurzlebige S3-POST-
   URL. Die Policy bindet Key, MIME und Checksum und begrenzt die gesamte Multipart-
   Größe; Quota ist bereits atomar reserviert.
3. Sie sendet den einmalig erhaltenen Completion Token an
   `POST .../storage/uploads/{uploadId}/complete`. QKERN prüft Provider-HEAD gegen
   exakte Bytezahl, MIME und Checksum. Erst danach wird Metadata committed.

Ohne ClamAV-Konfiguration liefert der lokale Default-Scanner absichtlich `pending`;
das Object bleibt `quarantined` und kann nicht heruntergeladen werden. Mit dem oben
konfigurierten Adapter lädt QKERN das Object intern ohne Redirect, streamt es
begrenzt an clamd und prüft Bytezahl, MIME und SHA-256 erneut. Nur ein exaktes
`clean`-Urteil nach erfolgreicher Integritätsprüfung hebt die Quarantäne auf.
Timeout, Scannerfehler, Drift und Größenüberschreitung bleiben fail-closed;
`infected` löscht das Provider-Object und gibt Quota frei. Signierte Downloads
funktionieren ausschließlich für `clean` Objects und laufen nach 30 bis höchstens
900 Sekunden ab.

Der echte Wegwerf-Zertifizierungslauf startet portlos MinIO und ClamAV, prüft einen
sauberen Upload/Download sowie die EICAR-Testsignatur und entfernt anschließend
Container und Volumes:

```powershell
npm run test:storage:docker
```

Der Lauf benötigt Docker und darf nur dann als bestanden dokumentiert werden, wenn
der Befehl tatsächlich grün beendet wurde. Das im Compose-File gepinnte MinIO-Image
ist ein reproduzierbarer Kompatibilitätstest, keine Production-Hosting-Empfehlung.

Storage-Quota und -Metadaten sind gegen parallele Übergänge gehärtet. Zwei
gleichzeitige Reservationen können das Bucket-Limit nicht überschreiten;
Completion-Replays erhöhen Usage nur einmal. Wenn ein Upload während eines
langsamen Scans abläuft, wird ein danach nicht mehr commitbares Provider-Object
bereinigt. Gleichzeitiges manuelles Delete und Lifecycle-Delete geben Usage nur
einmal frei. Der PostgreSQL-Dockerlauf unten enthält dafür sechs Storage-Tests.

Wichtige Pfade:

- `GET|POST /api/v1/projects/{projectId}/environments/{environment}/storage/buckets`
- `PATCH|DELETE .../storage/buckets/{bucketId}`
- `GET|DELETE .../storage/buckets/{bucketId}/objects`
- `POST .../storage/buckets/{bucketId}/uploads`
- `POST .../storage/uploads/{uploadId}/complete`
- `POST .../storage/buckets/{bucketId}/downloads`
- `POST .../storage/scans/{objectId}` und `POST .../storage/lifecycle`

App-Routen benötigen den exakt passenden Projekt-Key. `authenticated` und `owner`
benötigen zusätzlich das App-JWT in `Authorization` und den Projekt-Key in
`X-QKERN-Key`. Provider-Key, persistierter Completion-Verifier und Object-Checksum
werden nicht in öffentlichen Object-Antworten ausgegeben.

## 8. Realtime lokal testen

Realtime Alpha 1 benötigt die PostgreSQL-Control-Plane, weil Project API Keys und
optionale Project-Auth-Sessions daraus serverseitig verifiziert werden. Einen
Public Key in der Console erzeugen, das Secret nur lokal kopieren und dann einen
zweiten PowerShell-Prozess starten:

```powershell
$env:QKERN_RUNTIME_MODE="postgres"
$env:QKERN_REALTIME_ENABLED="true"
$env:QKERN_REALTIME_ALLOWED_ORIGINS="http://localhost:3000"
$env:QKERN_REALTIME_PORT="8788"
npm run realtime
```

Der Socket liegt unter
`ws://127.0.0.1:8788/realtime/v1/projects/<project-id>/environments/development`
und verlangt das Subprotocol `qkern.realtime.v1`. Der erste JSON-Frame enthält
`type: "auth"`, eine `requestId`, den einmalig kopierten `projectKey` und optional
das Project-Auth-`accessToken`. Keys und Tokens niemals an die URL anhängen.

Danach können Clients `public:<name>`, authentifizierte Nutzer `private:<name>` und
ihren eigenen `user:<subject>:<name>` abonnieren. Broadcast, Presence, Ping sowie
signierter Cursor-Catch-up sind in [REALTIME_PROTOCOL.md](REALTIME_PROTOCOL.md)
vollständig beschrieben. Ohne Cursor startet Subscribe am aktuellen Ende. Bei
`REALTIME_CURSOR_STALE` muss die Anwendung den Zustand über REST neu laden und neu
abonnieren; QKERN überspringt keine Ereignisse still.

Der Prozess bindet ausschließlich Loopback und verweigert in dieser Version
`NODE_ENV=production`. Der Event Log und Presence sind in-memory und gehen beim
Neustart verloren. Das ist ein lokaler Funktionsdurchstich, kein Ersatz für TLS,
persistenten CDC/Event Log, horizontalen Fan-out oder Lasttests.

## 9. Project Queues lokal testen

Project Queues Alpha 3 läuft im Memory-Modus prozesslokal oder im PostgreSQL-Modus
dauerhaft. Vor `npm run dev` in PowerShell explizit aktivieren:

```powershell
$env:QKERN_PROJECT_QUEUES_ENABLED="true"
$env:QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS="http://localhost:3000"
$env:QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES="65536"
npm run dev
```

Als Owner oder Administrator zuerst eine Queue anlegen:

```text
POST /api/v1/projects/<project-id>/environments/development/queues
{"name":"email_jobs","enqueuePolicy":"service","maxAttempts":5}
```

App-Enqueue, Claim und Settlement benötigen einen exakt passenden Project Key.
Nur ein Service Key darf `claims`, `ack`, `fail` und `lease` aufrufen. Ein
authentifizierter Project-Auth-User darf nur in einer Queue mit Policy
`authenticated` enqueueen; ein anonymer Public-Key-Aufruf darf es nicht.

Für retry-sichere Aufrufe `dedupeKey` stabil setzen. Den beim Claim gelieferten
`leaseToken` nur im Worker-Arbeitsspeicher halten und bei Ack/Fail/Renewal zusammen
mit demselben `workerId` senden. Der Token wird einmal ausgegeben und kann nicht
wiederhergestellt werden. Retry-Zeitpunkte und Dead-Letter-Übergänge berechnet
QKERN; der Client darf keine freien Backoff- oder Statuswerte setzen.

Wichtige Pfade:

- `GET|POST .../queues`
- `POST .../queues/{queue}/messages` und `POST .../queues/{queue}/claims`
- `POST .../queues/{queue}/messages/{messageId}/ack|fail|lease`
- `GET .../queues/{queue}/status`
- `GET .../queues/{queue}/dead-letters`
- `POST .../queues/{queue}/dead-letters/{messageId}/replay` (Admin, Same-Origin)

Im lokalen Memory-Modus geht der Zustand bei einem Prozessneustart verloren. Für
Persistenz `QKERN_RUNTIME_MODE=postgres` und `QKERN_RUNTIME_DATABASE_URL` setzen
und Migration `0026_project_queues.sql` kontrolliert anwenden. Die Runtime wählt
dann automatisch den RLS-gebundenen PostgreSQL-Adapter. `NODE_ENV=production`
weist den Memory-Adapter selbst bei gesetztem Enable-Flag ab. Vertrag, Beispiele
und offene Grenzen:
[PROJECT_QUEUES.md](PROJECT_QUEUES.md).

### 9.1 Compute-Vertragsports

Alpha 4 stellt noch keine Function-Management-UI bereit. Adapter-Entwickler
verwenden `lib/server/compute`: Function-Sandbox, Webhook-Signer/Transport und
Cron→Queue sind dependency-injizierte Ports. Production-Adapter müssen digest-
gepinnt, non-root, ressourcenbegrenzt und netzwerkisoliert sein. Cron läuft in UTC;
Webhook-Secrets werden nur über Referenzen an einen Signer übergeben. Vollständiger
Vertrag und bewusst offene Adapter: [COMPUTE_CONTRACTS.md](COMPUTE_CONTRACTS.md).

### 9.2 TypeScript SDK

Das ESM-SDK aus `sdk/typescript` wird mit `createQkernClient<Database>()`
initialisiert. `baseUrl` ist eine exakte HTTPS-Origin; lokal sind nur
`http://localhost` und `http://127.0.0.1` erlaubt. Project Key und optionales
Project-Auth-Access-Token nie in URLs oder persistenten Client-Logs speichern.
Typed Table CRUD, Queue-, Auth-, Storage- und Schema-Beispiele stehen in
[SDK_TYPESCRIPT.md](SDK_TYPESCRIPT.md). Writes werden nicht automatisch wiederholt.

### 9.3 CLI

Nach `npm ci` steht `npm run qkern --` für `init`, `status`, `schema pull`,
`migration plan <file>` und `seed check` bereit. Die genaue PowerShell-Nutzung,
secretfreie Konfiguration und Grenzen stehen in [CLI.md](CLI.md).

### 9.4 Pakete und Fresh-Project-Prüfung

`npm run build:packages` kompiliert das private `@qkern/sdk` zu ESM plus
Typdeklarationen und `@qkern/cli` zu direkt startbarem Node.js-ESM. Der vollständige
Developer-Experience-Vertrag baut beide Pakete, prüft ihre Tarball-Inhalte und
startet die gebaute CLI in einem frischen temporären Projekt:

```powershell
npm run verify:dx:full
```

Der Befehl ist plattformneutral. In diesem Release wurde er lokal nur auf Linux
x64/Node 24 ausgeführt. Die ausführbare GitHub-Matrix für Windows, macOS und Linux
liegt unter `.github/workflows/developer-experience.yml`; nicht gelaufene Runner
dürfen nicht als bestanden gemeldet werden. Details: [DEVELOPER_EXPERIENCE.md](DEVELOPER_EXPERIENCE.md).

### 9.5 Usage Metering und Quotas

Alpha 1 ist standardmäßig deaktiviert. Für einen lokalen Memory-Test in PowerShell:

```powershell
$env:QKERN_USAGE_METERING_ENABLED="true"
npm run dev
```

Nach dem Login zeigt die Console unter **Usage & Quotas** die echte read-only
Monatsprojektion für Projekt und Umgebung. Ohne intern angebundenen Emitter sind
Nullwerte korrekt. Der Browser darf weder Usage Events erfassen noch Quota-
Policies ändern. Große Mengen kommen als Dezimalstrings, nicht als ungenaue
JavaScript-Zahlen.

Für dauerhafte Persistenz Migration `0028_usage_metering.sql` kontrolliert anwenden
und `QKERN_RUNTIME_MODE=postgres` samt getrennter Runtime-Datenbank-URL setzen.
Production verweigert den Memory-Port. Quotas werden in Alpha 1 nur über den
internen, revisionsgebundenen Operator-Port provisioniert; es gibt bewusst keine
öffentliche REST-/MCP-Mutation.

Der vollständige Metrik-/Quellenvertrag, `observe` versus `enforce`, Idempotenz,
Beispielantwort und offene Billing-Grenzen stehen in
[USAGE_METERING.md](USAGE_METERING.md). Preise, Tarife, Rechnungen und Zahlungen
sind nicht Teil dieses Releases.

## 9a. Cron und Webhooks lokal betreiben

Cron-Definitionen und Webhook-Zustellungen liegen seit `1.18.0` und `1.19.0` in
der Datenbank, aber erst der Compute-Prozess arbeitet sie ab. Er verlangt den
PostgreSQL-Modus und eine ausdrückliche Liste der zu bedienenden Projekte: Die
Runtime-Rolle sieht durch RLS nur die eigene Organisation, deshalb gibt es keine
organisationsübergreifende Suche nach fälliger Arbeit.

```powershell
$env:QKERN_RUNTIME_MODE="postgres"
$env:QKERN_PROJECT_QUEUES_ENABLED="true"
$env:QKERN_COMPUTE_RUNTIME_ENABLED="true"
$env:QKERN_COMPUTE_SCOPES_JSON='[{"organizationId":"<org-id>","projectId":"<project-id>","environment":"development"}]'
$env:QKERN_ALLOW_LOCAL_WEBHOOK_SIGNING_SECRETS="true"
$env:QKERN_LOCAL_WEBHOOK_SIGNING_SECRETS_JSON='{"vault:webhook/orders":{"keyId":"local-1","secret":"<base64url mit mindestens 32 Bytes>"}}'
npm run worker:compute
```

Der Prozess startet **nicht**, wenn kein Signaturschlüssel erreichbar ist. Ein
Zusteller, der stillschweigend unsigniert sendet, wäre schlimmer als einer, der
gar nicht startet: Der Empfänger könnte dann nicht mehr unterscheiden, ob eine
Nachricht wirklich von QKERN kommt.

Der Umgebungs-Provider ist ausdrücklich nur für lokale Entwicklung und weigert
sich, unter `NODE_ENV=production` überhaupt zu existieren — ein Signaturgeheimnis
in einer Umgebungsvariable steht in jedem Prozessabbild und in jeder
Container-Definition.

Der Empfänger prüft die Signatur über `<zeitstempel>.<körper>` mit HMAC-SHA256
und muss den Header `x-qkern-delivery-id` unverändert zurückspiegeln. Fehlt die
Bestätigung oder passt sie nicht, gilt die Zustellung als fehlgeschlagen und wird
nach serverberechneter Wartezeit wiederholt.

Definitionen entstehen in dieser Version weiterhin nur über direkten
Datenbankzugriff; eine Management-API und eine Console-Fläche fehlen.

## 10. MCP für KI-Agenten

STDIO starten:

```powershell
$env:QKERN_MCP_ORGANIZATION_ID="<organization-id>"
$env:QKERN_MCP_PROJECT_ID="<project-id>"
$env:QKERN_MCP_ENVIRONMENT="development"
$env:QKERN_MCP_ACTOR_REF="codex-local"
npm run mcp
```

Der Agent kann Projekt, Automation Policy, Schema, begrenzte Reads, Audit Logs und
Migration Previews verwenden. Apply bleibt ein separates destruktives Tool. Die
QKERN-Policy entscheidet, ob ein Preview pending oder automatisch approved wird.
Remote MCP in Production bleibt bis zum OAuth/OIDC-Resource-Server-Gate deaktiviert.

Wenn die Generated Data API aktiviert ist, stehen zusätzlich
`qkern_table_rows_list`, `qkern_table_rows_insert`, `qkern_table_row_update` und
`qkern_table_row_delete` bereit. Sie verwenden exakt dieselbe Live-Schema-/RLS-
Grenze wie REST. Insert/Update/Delete sind als destruktive MCP-Tools annotiert;
ob der lokale Claude-/Codex-Client vor jedem Aufruf fragt, bestimmt dessen Tool-
Approval-Konfiguration. QKERN selbst verlangt für RLS-erlaubte Zeilenmutationen
keinen zusätzlichen menschlichen Klick. Die Automation Policy im Approval Center
regelt weiterhin Schema-/Migration-Change-Sets, nicht normale App-Datenzeilen.

Mit aktiviertem Project Storage stehen außerdem `qkern_storage_buckets_list` und
`qkern_storage_objects_list` bereit. Beide sind read-only und geben weder Provider-
Keys noch Checksums oder Token-Verifier aus. Upload, Delete, Scan und Lifecycle
haben in diesem Alpha bewusst kein MCP-Tool und bleiben über die engeren REST-/
Console-Autorisationspfade steuerbar.

Mit aktivierten Project Queues kommen `qkern_queues_list`, `qkern_queue_status`
und `qkern_queue_message_enqueue` hinzu. Das Enqueue-Tool ist ein Write und ohne
`dedupeKey` nicht als idempotent annotiert. Queue-Claim, Ack, Fail und Lease sind
bewusst keine MCP-Tools: Ein KI-Client erhält keine Worker-Lease-Autorität. Ob ein
MCP-Client vor dem Enqueue fragt, steuert dessen Write-Approval-Konfiguration;
QKERN erzwingt unabhängig davon Scope, Queue-Policy, Payloadgrenzen und Capacity.

## 11. Qualitätsprüfung

```powershell
npm run typecheck
npm test
npm run build
npm run verify:dx:full
npm audit --omit=dev --audit-level=moderate
```

Optionale echte PostgreSQL-Zertifizierung:

```powershell
npm run test:postgres:docker
```

Dieser Lauf umfasst inzwischen 28 optionale Real-PostgreSQL-Tests, darunter sechs
für Storage, fünf für Queue-Persistenz/RLS/Concurrency/DLQ-Replay und vier für
Usage-Limit, Restart-Persistenz und Tenant-RLS. Ohne grünen Dockerlauf ist die
PostgreSQL-Zertifizierung vorbereitet, aber nicht bestätigt.

## 12. Updates, Versionsübergabe und Fehlerdiagnose

Vor einem Update `AGENTS.md`, `STATUS.md`, `docs/CLAUDE_HANDOFF.md`, die aktuelle
Release Note und Migrationen lesen. Dann Quellcode sichern, `npm ci`, Migrationen
kontrolliert anwenden, Typecheck, Tests und Build ausführen. Jede Version erhält
eine neue Release Note und ein geprüftes `QKERN_Source_v*.zip`; alte Release Notes
werden nie umgeschrieben. Bei `Account could not be created` zuerst Serverlog,
Node-Version, Argon2-Neuinstallation, Datenbankzustand und angewendete Migrationen
prüfen; keine Passwörter oder Connection URLs in Tickets oder Chat kopieren.

Weitere Betriebsdetails stehen in den spezialisierten `*_RUNBOOK.md`-Dateien.
