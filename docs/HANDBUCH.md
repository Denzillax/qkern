# QKERN Handbuch

Dieses Handbuch gilt für `2.46.0`. QKERN benötigt Node.js **24.7 oder neuer**.

> Neu hier? Beginne mit [Was ist QKERN](guide/de/WAS_IST_QKERN.md), auch auf
> Englisch, Französisch und Italienisch unter `docs/guide/`. Dieses Handbuch ist
> die Fassung für Fortgeschrittene; auf der Website steht der Einstieg unter `/docs`.

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

### Sicherheitsberater

Seit `2.39.0` zeigt **Advisors → Sicherheit** konkrete Befunde für eine
Umgebung. Der Berater liest nur und repariert nichts. Jeder Befund nennt das
Objekt, die Regel, eine Schwere und in Worten, was zu tun ist. Darunter steht für
jede Regel, ob sie gelaufen ist, und wenn nicht, warum.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/advisors/security`,
mit derselben Tür wie `/schema/policies` (Session mit Leserecht oder
scope-gebundener Projekt-Key), ohne Query-Parameter und mit
`Cache-Control: private, no-store`. Die Antwort ist
`{ data: { findings, checks, checkedAt } }`. Gerechnet wird bei jedem Aufruf neu.

| Regel | Schwere | Liest | Befund, wenn |
| --- | --- | --- | --- |
| `rls_disabled` | hoch | Tabellen im Schema `public` | eine gewöhnliche oder partitionierte Tabelle hat RLS aus |
| `rls_no_policies` | mittel | Tabellen und Policies in `public` | RLS ist an, aber keine Policy existiert (die Tabelle ist dann gesperrt, nicht offen) |
| `policy_always_true` | hoch | Policies in `public` | eine erlaubende Policy für `public`, `anon` oder `authenticated` hat `USING` oder `WITH CHECK` gleich `true`, auch in Klammern |
| `policy_check_missing` | niedrig | Policies in `public` | eine erlaubende INSERT-Policy hat kein `WITH CHECK`, oder eine UPDATE- oder ALL-Policy hat weder `WITH CHECK` noch `USING` |
| `bucket_public_read` | mittel | Buckets | die Leserichtlinie ist `public` |
| `bucket_authenticated_write_any_type` | niedrig | Buckets | die Schreibrichtlinie ist `authenticated` und keine MIME-Typen sind gesetzt |
| `api_key_broad` | mittel | Art, Ablauf, Widerruf der API-Keys | in Production ist ein Service-Key aktiv |
| `auth_provider_unverified_email` | niedrig | nichts | läuft nie, siehe unten |

Buckets und API-Keys liest der Berater nur mit einer Console-Sitzung, deren Rolle
`project_storage_admin` beziehungsweise `project_api_keys` hat; ein Projekt-Key
sieht dort „nicht geprüft". Ist Storage aus, die Projektdatenbank nicht
angebunden oder ein Dienst nicht erreichbar, laufen die betroffenen Regeln nicht
(`ran: false` mit Grund); die Route antwortet trotzdem mit 200. Schneidet der
Katalog ab (100 Tabellen, 200 Policies), sagt der Grund das; `rls_no_policies`
läuft dann gar nicht, weil eine fehlende Policy nur abgeschnitten sein könnte.

Was der Berater nicht sieht: Schemas ausser `public`, Funktionen mit
`SECURITY DEFINER`, Views ohne `security_invoker`, Spaltenrechte, Tabellen ohne
Spalten, Policies, die an die Verbindungsrolle der Data API statt an `public`
gebunden sind, und alles, was nur in der Serverkonfiguration steht. Dazu gehört,
ob ein OIDC-Anbieter mit `emailVerification: "trusted"` ohne `email_verified`
zugelassen ist: Die Provider-Liste gibt bewusst nur Kennung und Issuer heraus.
Ein Befund ist kein Urteil. Eine Policy mit `USING (true)` für eine wirklich
öffentliche Tabelle ist gewollt; der Berater meldet sie trotzdem.

### Leistungsberater

Seit `2.40.0` zeigt **Advisors → Leistung** Verdachtsfälle aus der Statistik
einer Umgebung. Gleiche Bauart wie der Sicherheitsberater: nur lesend, kein
Reparieren, kein Zurücksetzen eines Zählers. Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/advisors/performance`,
dieselbe Tür, ohne Query-Parameter, mit `Cache-Control: private, no-store` und
der Antwort `{ data: { findings, checks, checkedAt } }`.

Gelesen wird `pg_stat_user_tables` und `pg_stat_user_indexes` für das Schema
`public`, dazu `pg_index` und `pg_relation_size`, in derselben
READ-ONLY-Transaktion wie jeder andere Inspektor (höchstens 200 Tabellen und
400 Indizes, danach sagt der Grund, dass abgeschnitten wurde).

| Regel | Schwere | Liest | Befund, wenn |
| --- | --- | --- | --- |
| `missing_index_suspected` | mittel | Scans und lebende Zeilen je Tabelle | ab 50 sequenzielle Scans, höchstens ein Zehntel davon als Index-Scans, mindestens 1000 lebende Zeilen |
| `slow_statement` | mittel | nichts | läuft nie, siehe unten |
| `unused_index` | niedrig | Scans, Grösse und Art der Indizes | ein Index ohne Primärschlüssel- und Unique-Eigenschaft hat null Scans und mindestens 1 MiB |
| `bloat_suspected` | niedrig | lebende und tote Zeilen je Tabelle | mindestens 1000 tote Zeilen und mindestens ein Fünftel so viele tote wie lebende |
| `never_analyzed` | niedrig | letzte Stichprobe und letztes Autovacuum | mindestens 1000 lebende Zeilen, aber weder `ANALYZE` (auch nicht automatisch) noch Autovacuum |

Die Schwellen stehen in `PERFORMANCE_THRESHOLDS` und nur dort; jeder Text nennt
sie in Worten. Eine Regel feuert ab dem Wert, nicht erst darüber.

`pg_stat_statements` liest QKERN bewusst nicht. Die Sicht gilt für den ganzen
Cluster, und `pg_stat_statements` normalisiert nur Abfragen: der Text eines
Utility-Befehls behält seine Literale, etwa ein Passwort aus
`CREATE ROLE ... PASSWORD '...'`. Dort könnten also Werte eines anderen
Projekts stehen. Darum steht `slow_statement` immer mit `ran: false` und genau
diesem Grund in der Antwort. Das reine Regelmodul kann die Regel rechnen,
sobald die Quelle sicher zu öffnen ist (eine je Projekt gefilterte Sicht mit
`pg_read_all_stats` beim Betreiber wäre ein Weg); die Route öffnet sie nicht.

Statistik ist kein Geheimnis eines anderen Mandanten: Scans, geschätzte Zeilen
und Indexgrössen betreffen nur die Objekte dieses Schemas in dieser
Projektdatenbank, und gelesen wird über dieselbe Leserolle wie jeder Katalog.
Ein Statementtext kann dagegen Literale tragen, und deshalb bleibt er draussen.

Die Zähler laufen seit dem letzten Reset und seit dem Start des Clusters. Eine
frische Datenbank hat keine Statistik, und dann gibt es zu Recht keinen Befund;
die Ansicht sagt das selbst. Jeder Befund ist ein Verdacht: welche Spalte einem
Index fehlt, sagt kein Zähler, und ein Index für einen seltenen Bericht darf
fast nie zählen. Nicht im Blick sind einzelne Abfragepläne, Sperren,
Cache-Trefferquoten, Verbindungen, die Grösse der Tabellen selbst und Schemas
ausser `public`.

### Projekt-Gesundheit

Seit `2.44.0` zeigt **Advisors → Gesundheit** je Teilsystem einer Umgebung, ob
es erreichbar, abgeschaltet, nicht eingerichtet oder gestört ist, und woran das
abgelesen wurde. Nur lesend: kein Neustart, kein Einschalten, keine Reparatur.
Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/advisors/health`,
dieselbe Tür wie die beiden Berater daneben, ohne Query-Parameter, mit
`Cache-Control: private, no-store` und der Antwort
`{ data: { overall, counts, subsystems, checkedAt } }`. Die acht Proben laufen
nebenläufig, und jede fängt ihren eigenen Fehlschlag: Ein abgeschalteter oder
nicht erreichbarer Dienst wird zu einem Zustand, nie zu einem 500.

| Teil | Probe | Beleg |
| --- | --- | --- |
| `database` | ein Katalogabruf im Schema `public` über die Leserolle der Data API | Anzahl Tabellen oder die Fehlerklasse |
| `data_api` | das generierte OpenAPI-Dokument dieser Umgebung | Anzahl freigegebener Tabellen |
| `auth` | Liste der Anmeldeanbieter und öffentliche Schlüssel aus dem JWKS | Anzahl Anbieter und Anzahl Signaturschlüssel |
| `storage` | die Bucket-Liste der Umgebung | Anzahl Buckets |
| `compute` | die Function-Definitionen, dazu ob die Sandbox freigeschaltet ist | Anzahl Definitionen, Sandbox ja oder nein |
| `queues_cron` | Queue- und Cron-Definitionen, dazu der Ausdruck jeder aktiven Cron-Definition | Anzahl Queues, Anzahl Zeitpläne, Anzahl nie ausgelöster |
| `realtime` | ob eine Adresse des Realtime-Servers hinterlegt ist | Adresse hinterlegt ja oder nein |
| `vault` | ob überhaupt ein Vault verbunden ist | Vault verbunden ja oder nein |

Fünf Zustände: `ok`, `off`, `unconfigured`, `unknown`, `degraded`. Das
Gesamturteil ist der schlechteste vorhandene Zustand, in genau dieser
Reihenfolge von harmlos nach schlimm. `degraded` steht über `unknown`, weil ein
eingerichteter Dienst, der nicht antwortet, mehr aussagt als eine Probe, die
nicht laufen konnte.

`auth`, `storage`, `compute` und `queues_cron` liest die Seite nur mit einer
Console-Sitzung, deren Rolle `project_auth_admin`, `project_storage_admin`,
`project_compute_admin` beziehungsweise `project_queues_admin` hat. Fehlt sie,
steht dort `unknown` mit genau diesem Grund — nicht 403 für die ganze Seite.
Ein Projekt-Key sieht diese vier Teile deshalb nie.

Ein Zeitplan, der noch nie ausgelöst hat, ist der einzige Befund dieser Seite,
der auf etwas Laufendes zeigt. Gemessen wird am Ausdruck selbst: Das erste
Vorkommen nach dem Anlegen und das zweite danach spannen ein Intervall auf; ist
auch das zweite vorbei und nichts ausgelöst, ist das keine Frage des
Zeitpunkts mehr.

Was in die Antwort geht, ist festgelegt: ein Textschlüssel aus
`lib/console/health-advisor-texts.ts` und höchstens eine Zahl. Ein
Verbindungsstring, ein Token, ein Vault-Pfad oder ein Kundenwert hat dort keine
Stelle, an der er stehen könnte. Realtime und Vault prüft die Seite nur als
Konfiguration; eine Verbindung baut sie nicht auf, und den Vault fragt sie
nicht.

Und die Grenze steht auf der Seite selbst: Gesund heisst hier erreichbar und
eingerichtet. Ob die Anwendung eines Kunden funktioniert, sagt diese Seite
nicht. Sie misst keine Antwortzeit, ruft keine Function auf und liest kein
Secret.

### Schema-Visualizer

Seit `2.41.0` zeigt **Datenbank → Schema-Visualizer** das Schema `public` als
Bild: je Tabelle ein Kasten mit ihren Spalten, je Fremdschlüssel eine Linie von
der verweisenden Spalte zur Zieltabelle. Nur lesend; nichts wird verschoben,
angelegt oder geändert, und eine Beziehung entsteht wie jede Schemaänderung über
ein Change Set.

Die Tabellen und Spalten kommen aus `/schema`, die Beziehungen aus der neuen
Route
`GET /api/v1/projects/{projectId}/environments/{environment}/schema/foreign-keys?schema=public`,
mit derselben Tür wie `/schema/policies` (Session mit Leserecht oder
scope-gebundener Projekt-Key), dieselbe Prüfung des Parameters `schema`
(Vorgabe `public`, jeder andere Parameter und ein zweites `schema` sind ein 400),
`Cache-Control: private, no-store`, Antwort
`{ data: { source, schema, foreignKeys, truncated } }`.

Gelesen wird `pg_constraint` mit `contype = 'f'`, verbunden mit `pg_class` und
`pg_namespace`. `conkey` und `confkey` werden über
`unnest ... WITH ORDINALITY` zu Spaltennamen aufgelöst, und zwar in der
Reihenfolge des Schlüssels: bei `FOREIGN KEY (b, a) REFERENCES p (y, x)` gehört
`b` zu `y`. `confdeltype` und `confupdtype` stehen als Worte in der Antwort
(`no_action`, `restrict`, `cascade`, `set_null`, `set_default`); ein Buchstabe,
den QKERN nicht kennt, wird abgewiesen statt geraten. Höchstens 400
Fremdschlüssel, danach ist `truncated` wahr, und die Ansicht sagt das.

Gefiltert wird nach dem Schema der verweisenden Tabelle. Zeigt ein Schlüssel in
ein anderes Schema, bleibt er drin und nennt jenes Schema; im Bild steht dann
ein gestrichelter Kasten mit `schema.tabelle`. Still wegwerfen wäre eine Lüge im
Bild.

Das Diagramm rechnet `buildSchemaDiagram` in `lib/console/schema-diagram.ts`
aus: eine reine Funktion, keine neue Abhängigkeit, keine Farbe, keine Sprache.
Tabellen nach Namen sortiert, in ein Gitter mit 1 bis 4 Spalten je nach
Tabellenzahl, jede Gitterzeile so hoch wie ihr höchster Kasten, darum können
sich zwei Kästen nie überschneiden. Linien laufen rechtwinklig mit einem Knick
in der Mitte, ein Selbstverweis wird zur Schlaufe an der rechten Kante. Gleiche
Eingabe ergibt dasselbe Bild. Gefärbt wird erst in der Ansicht, mit
`currentColor` und den CSS-Variablen der Console, damit das Bild hell und dunkel
lesbar bleibt.

Unter dem Bild steht dieselbe Auskunft in Worten, denn ein Diagramm ist für eine
Vorleseausgabe nichts. Das SVG selbst trägt `role="img"` und ein `aria-label`
mit Schema und beiden Zählern.

Gezeichnet wird, was der Katalog hergibt: Tabellen, Spalten und
Fremdschlüssel. Vererbung, Partitionen, Sichten und Regeln fehlen im Bild,
ebenso Primärschlüssel, denn die liefert `/schema` nicht mit. Bei mehr als zwölf
Spalten zeigt ein Kasten die ersten zwölf und darunter die Zahl der übrigen.

### Datenbank und Verbindungen

Seit `2.46.0` zeigen **Berichte → Datenbank** und **Berichte → Verbindungen**,
was die Projektdatenbank gerade tut. Zwei Seiten, eine Quelle, eine Route:

```
GET /api/v1/projects/{projectId}/environments/{environment}/database/activity
```

Dieselbe Tür wie `/schema/policies` (Session mit Leserecht oder scope-gebundener
Projekt-Key), `Cache-Control: private, no-store`, und **kein einziger
Query-Parameter**: Es gibt nichts zu wählen, darum ist jeder Parameter ein 400
statt einer stillschweigend ignorierten Angabe. Die Route liegt neben `schema/`
und nicht darunter, weil `schema/` beschreibt, was definiert ist, und diese
Route, was läuft.

**Kein Abfragetext verlässt den Server.** Das ist die wichtigste Zusage dieser
Seiten. `pg_stat_activity` trägt den Text laufender Statements, und ein
Statement kann ein Literal eines anderen Mandanten enthalten; für eine Rolle
mit genug Rechten stehen dort ausserdem die Sitzungen anderer Datenbanken
desselben Clusters. QKERN liest darum

* aus `pg_stat_database` nur Zähler, und nur die Zeile mit
  `datname = current_database()`: `xact_commit`, `xact_rollback`, `blks_read`,
  `blks_hit`, `deadlocks`, `temp_files`, `temp_bytes`, `numbackends` und
  `stats_reset`, dazu `current_setting('max_connections')`;
* aus `pg_stat_activity` nur `usename`, `state` und zwei Aggregate
  (`count(*)` und das Alter der ältesten Sitzung aus `min(backend_start)`),
  gefiltert auf `datname = current_database()` und gruppiert nach Rolle und
  Zustand.

Nicht gelesen werden `query`, `backend_xmin`, `client_addr`, `client_hostname`,
`application_name`, `pid` und `query_start`. Sie stehen in keiner Abfrage, in
keiner Antwort und in keiner Ansicht. Geschrieben wird nichts;
`pg_terminate_backend` und `pg_cancel_backend` kommen im ganzen Pfad nicht vor,
auch nicht hinter einem Schalter.

Die Antwort trägt eine Zeile je **Gruppe**, nie eine je Sitzung: Eine einzelne
Sitzung ist ein Mensch bei der Arbeit, eine Anzahl ist eine Betriebszahl. Mehr
als 200 Gruppen setzen `truncated` auf `true`.

Was die Projekt-Leserolle nicht sehen darf, fehlt in der Zählung: PostgreSQL
blendet für eine unprivilegierte Rolle die Sitzungen anderer Rollen aus (Zustand
und Zeiten fehlen dann, die Zeile selbst kann ganz wegfallen). Das ist kein
Defekt, sondern die Grenze, und die Seite sagt es: *Gezaehlt wird, was diese
Rolle sehen darf.* Deshalb kann die Summe der Gruppen unter `backends` aus
`pg_stat_database` liegen; beide Zahlen stehen nebeneinander.

Die Datenbankseite rechnet aus `blks_hit` und `blks_read` die
Cache-Trefferquote und stellt `numbackends` gegen `max_connections`. Wurde noch
kein Block gelesen, zeigt sie keine Quote statt null Prozent. Alle Zähler gelten
seit `stats_reset`, nicht seit dem Start der Datenbank; auch dieser Satz steht
über den Zahlen und nicht im Kleingedruckten.

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
Ohne `schema=` gilt `public`. Seit 2.33 gelten für Schemanamen dieselben Regeln
wie für Tabellennamen, also auch Großbuchstaben wie in `schema=Shop`. Die
Schreibweise zählt: `Shop` und `shop` sind zwei Schemas. Systemschemas (`pg_*`,
`information_schema`, `qkern_internal`) lehnt die API ab.

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
- `admin/users/{userId}/sessions` (GET listet die aktiven Sitzungen ohne Token-Material,
  DELETE beendet alle) und `admin/users/{userId}/sessions/{sessionId}` (DELETE beendet
  eine Sitzung samt ihrer ganzen Refresh-Familie), ebenfalls nur über die Console-Session
  und mit geprüftem Origin; in der Console unter Auth → Sitzungen
- `admin/audit?limit=1..100&cursor=` (GET) liefert den Auth-Auszug aus der Audit-Kette
  der Plattform, neueste zuerst, nur für dieses Projekt und diese Umgebung; in der
  Console unter Auth → Audit-Log

Project Auth schreibt seit 2.35 diese Ereignisse in die Hash-Kette `audit_logs`:
`project_auth.signup.succeeded`, `project_auth.login.succeeded`,
`project_auth.login.failed`, `project_auth.logout`, `project_auth.mfa.enrolled`,
`project_auth.mfa.verified`, `project_auth.user.updated`,
`project_auth.session.revoked` und `project_auth.sessions.revoked_all`. Ein Refresh
wird nicht protokolliert, das wäre zu viel Rauschen. App-Nutzer erscheinen nur als
`project_auth_user:<id>`, ein Fehlversuch mit unbekannter E-Mail als `anonymous`,
Console-Aktionen mit der ID des Console-Nutzers. E-Mails, Passwörter, Token und
Codes stehen nie im Audit. Fällt das Schreiben aus, gelingt die Anmeldung trotzdem;
im Log steht dann nur die Aktion. Eine Lücke im Audit ist besser als ein Ausfall
aller Anmeldungen, und die Kette bleibt intakt, weil nichts Halbes geschrieben wird.
Die Rechte dafür vergibt `db/migrations/0046_project_auth_audit.sql`.

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
und Scan-Durchstich zuerst PostgreSQL, versitygw (S3) und ClamAV starten:

```powershell
docker compose up -d postgres minio clamav
```

Wer den Stack schon vor `2.14.0` mit MinIO betrieben hat, entfernt zuerst das alte
Volume, dessen Ablage versitygw nicht lesen kann: `docker compose down` und
`docker volume rm qkern_qkern-minio`. Dann den Provider-Bucket
`qkern-project-storage` einmal anlegen (versitygw hat keine Web-UI; das Skript
signiert ein `PUT /bucket` mit den lokalen Compose-Werten):

```powershell
npm run storage:bucket
```

Danach in derselben PowerShell-Sitzung setzen:

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

Der echte Wegwerf-Zertifizierungslauf startet portlos versitygw und ClamAV, prüft einen
sauberen Upload/Download sowie die EICAR-Testsignatur und entfernt anschließend
Container und Volumes:

```powershell
npm run test:storage:docker
```

Der Lauf benötigt Docker und darf nur dann als bestanden dokumentiert werden, wenn
der Befehl tatsächlich grün beendet wurde. Das im Compose-File gepinnte versitygw-Image
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

### Grenzen und Rechte in der Console

Seit `2.47.0` zeigen **Realtime → Einstellungen** und **Realtime → Rechte**, was
für den Transport dieser Installation tatsächlich gilt. Die Einstellungsseite
liest eine Route:

```
GET /api/v1/projects/{projectId}/environments/{environment}/realtime/settings
```

Dieselbe Tür wie `/database/activity` (Session mit Leserecht oder
scope-gebundener Projekt-Key), `Cache-Control: private, no-store`, und **kein
einziger Query-Parameter**: Es gibt nichts zu wählen, darum ist jeder Parameter
ein 400.

Jede Grenze nennt ihren Wert, ihre Einheit und ihren **Ursprung**:

* `environment` — die Variable ist gesetzt und trägt einen brauchbaren Wert.
* `default` — die Variable gibt es, sie ist nicht gesetzt, es gilt die Vorgabe.
* `code` — für diese Grenze gibt es gar keine Variable. Die Nachrichtenrate
  (100 Nachrichten je 10 Sekunden und Verbindung), die Tiefe und die Knotenzahl
  eines Payloads und die Feldzahl eines Presence-Zustands stehen fest im
  Gateway beziehungsweise im Dienst.

Einen Ursprung `database` gibt es bewusst nicht: **Keine Realtime-Grenze steht
in einer Tabelle.** Trägt eine Variable etwas, das die Runtime ablehnt, meldet
die Route `value: null` und `invalid: true` — das ist kein Rückfall auf die
Vorgabe, sondern ein Realtime-Server, der gar nicht startet.

Gelesen wird ausschliesslich die feste Liste in
`lib/server/realtime/settings.ts`. Das Cursor-Geheimnis, die Datenbank-Adresse
und die Origin-Liste stehen nicht darin und können diesen Weg nicht nehmen. Die
Antwort trägt Variablennamen, nie fremde Werte. **Betriebszahlen fehlen mit
Ansage:** Offene Verbindungen und Abonnements zählt der Realtime-Prozess, und
ihn über das Netz zu fragen wäre eine Wirkung, die eine Leseroute nicht hat.

Ändern lässt sich nichts davon in der Console. Die Seite hat kein Eingabefeld
und keinen Speicherknopf, und hinter der Route steht kein Schreibverb.

**Realtime → Rechte** braucht keine Route, weil es nichts abzufragen gibt: Es
gibt keine Kanalrechte, die sich anlegen liessen, und keine Zeile in einer
Tabelle. Wer welchen Kanal lesen und beschreiben darf, entscheidet allein
`PrefixRealtimeAuthorization` aus der Rolle der Verbindung (`anon` bei Public
Key, `authenticated` mit Project-Auth-Token, `service_role` bei Service Key) und
dem Kanalpräfix. Die Seite zeigt diese Regel als Tabelle; der Vertrag
`console-realtime-view` hält jede ihrer 36 Zellen gegen den Code.

Auf `changes:`-Kanälen kommt die Row Level Security der Projekttabelle dazu:
Jede geänderte Zeile wird je Abonnent mit dessen Claims durch die Generated Data
API gelesen, und was RLS nicht herausgibt, kommt nicht an. Nach einem DELETE
kann RLS nicht mehr beantworten, wer die Zeile hätte sehen dürfen; davon erfährt
nur `service_role`, und nur den Schlüssel.

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

Für retry-sichere Aufrufe `dedupeKey` stabil setzen. Wirksam ist der Schlüssel
nur, solange das `dedupeWindowSeconds` der Queue größer als null ist. **Null
schaltet die Deduplizierung dieser Queue ab**: Ein mitgeschickter `dedupeKey`
wird dann ignoriert, es wird kein Verifikator gespeichert, und jedes Einreihen
erzeugt eine eigene Nachricht (`deduplicated: false`). Seit `2.43.0` ist das so;
davor scheiterte in einer solchen Queue jedes Einreihen mit `dedupeKey` an der
Paarbedingung aus Migration 0026 und kam als generischer Queue-Fehler zurück.
Queue-Definitionen sind unveränderlich — wer Deduplizierung braucht, legt die
Queue mit einem Fenster größer null an (Vorgabe 300 Sekunden).

Den beim Claim gelieferten
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

### Zeitreihen der Nutzung

Seit `2.45.0` zeigen **Berichte → API**, **Berichte → Storage** und
**Berichte → Functions** den Verlauf der gemessenen Nutzung. Drei Seiten, eine
Ansicht, eine Route: Sie unterscheiden sich nur in der Metrik und in dem Satz,
der sagt, was sie nicht zeigen können.

Grundlage ist `usage_events` aus Migration `0028`. Eine neue Tabelle braucht es
nicht: Eine Zeitreihe ist eine Aggregation über `observed_at`. Sie entsteht
**in der Datenbank** (`date_trunc`, `GROUP BY`, `ORDER BY`), nicht durch Laden
der Zeilen in JavaScript; die Eimergrösse ist ein Parameter, und `date_trunc`
rechnet ausdrücklich in UTC, damit die Grenzen nicht an der Zeitzone der
Verbindung hängen. Leere Eimer füllt der Dienst auf, nicht SQL: So liest die
Datenbank nur, was wirklich vorhanden ist.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/usage/series?metric=<name>&bucket=<hour|day>`
mit derselben Authentifizierung wie `usage/billing` und `usage/invoices`,
`Cache-Control: private, no-store` und genau zwei Parametern. `metric` ist
Pflicht und muss einer der sechs Metriknamen sein, `bucket` ist `hour` oder
`day` und steht ohne Angabe auf `hour`. Ein unbekannter Name, eine zweite
Angabe desselben Parameters und jeder fremde Parameter sind ein 400. Ist das
Usage Metering abgeschaltet, kommt ein 503 mit `Usage Metering is disabled`,
und die Ansicht sagt das statt einen Verlauf zu erfinden.

Das Fenster steht nicht im Aufruf, sondern folgt der Eimergrösse: 48
Stundeneimer oder 90 Tageseimer, endend mit dem laufenden und darum noch
unvollständigen Eimer. Die Antwort nennt `windowStart`, `windowEnd`, `bucket`,
`bucketCount` und `truncated`; jeder Eimer des Fensters steht darin, ein leerer
als Null. Mengen sind Dezimalstrings.

| Seite | Metriken | Was sie nicht zeigt |
| --- | --- | --- |
| Berichte → API | `api_requests`, `database_row_reads` | Antwortzeiten und Fehlercodes — sie stehen in keinem Nutzungsereignis |
| Berichte → Storage | `storage_egress_bytes` | die Belegung eines Buckets; gezählt werden ausgehende Bytes je Abschnitt |
| Berichte → Functions | `function_invocations` | ob ein Aufruf im Container gescheitert ist |

`abgelehnt` heisst in allen drei Ansichten dasselbe: Eine Quota hat gegriffen.
Es heisst **nicht**, dass eine Anfrage mit einem Fehler beantwortet wurde.

Das Bild ist ein Balkendiagramm aus einer reinen Funktion
(`lib/console/usage-series-chart.ts`), ohne neue Abhängigkeit und ohne eigene
Farbe; daneben stehen dieselben Zahlen als Tabelle, weil ein Bild nicht die
einzige Quelle sein darf. Die Reihe reicht nur so weit zurück, wie die
Nutzungsereignisse aufbewahrt werden.

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

## 9b. Cron und Webhooks in der Console verwalten

Seit `1.21.0` gibt es die Ansicht **Cron & Webhooks**. Sie verlangt die
Berechtigung `project_compute_admin` (nur `owner` und `administrator`) und die
Freischaltung der Fläche:

```powershell
$env:QKERN_RUNTIME_MODE="postgres"
$env:QKERN_PROJECT_QUEUES_ENABLED="true"
$env:QKERN_COMPUTE_DEFINITIONS_ENABLED="true"
npm run dev
```

Ein Cron-Job braucht einen Ausdruck, den der Scheduler versteht (`*/N * * * *`
oder `M H * * *` in UTC), und eine **bereits vorhandene** Projekt-Queue. Beides
wird beim Anlegen geprüft; ohne diese Prüfung entstünde ein Zeitplan, der bei
jedem Vorkommen scheitert und dabei aussieht, als liefe er.

Ein Webhook braucht ein exaktes öffentliches HTTPS-Ziel auf Port 443 ohne Query
und Fragment sowie die **Referenz** des Signaturschlüssels — niemals den
Schlüssel selbst. Die Regel für das Ziel ist dieselbe, die der Zusteller
anwendet, damit ein hier angenommenes Ziel später nicht stumm abgewiesen wird.

**Nur das Aktivierungsflag ist änderbar.** Ausdruck, Queue, Nutzlast, Ziel-URL
und Signaturreferenz sind unveränderlich; eine Änderung ist ein Löschen und ein
neues Anlegen. Diese Grenze liegt als Spaltenrecht in der Datenbank, nicht in
der Oberfläche.

Ein Webhook lässt sich erst löschen, nachdem er pausiert wurde: Das Löschen
entfernt auch alle wartenden Zustellungen, und der Umweg macht diesen Verlust zu
einer bewussten Entscheidung.

Die Zustellstatusliste zeigt Ereignistyp, Status, Versuchszahl und Fehlercode —
**nie die Nutzlast**. Sie beantwortet die Betriebsfrage, ob etwas ankommt und
warum nicht; der Inhalt der Nachricht beantwortet sie nicht.

Dieselben Operationen stehen unter
`/api/v1/projects/{projectId}/environments/{environment}/compute/` als REST zur
Verfügung und sind im OpenAPI-Vertrag beschrieben.

### Secrets der Functions

Seit `2.38.0` zeigt **Functions & Jobs → Secrets** für jede Function die
Secret-Referenzen, die ihre Definition deklariert, und ob der Vault sie auflöst:
**vorhanden**, **fehlt** oder **kein Zugriff**. Einen Wert zeigt QKERN nie.
Secrets werden im Vault angelegt und geändert; die Console prüft nur, ob eine
Referenz aufgelöst wird.

Die Route dazu ist
`GET /api/v1/projects/{projectId}/environments/{environment}/compute/functions/{functionId}/secrets`
mit derselben Berechtigung wie die übrigen Definitionsrouten
(`project_compute_admin`) und `Cache-Control: private, no-store`. Die Antwort
trägt je Referenz nur `ref` und `status` sowie den Prüfzeitpunkt `checkedAt`.

Geprüft wird über den Metadaten-Endpunkt von KV Version 2
(`<mount>/metadata/<pfad>`), nie über den Datenendpunkt. Eine aktuelle Version,
die gelöscht oder zerstört ist, gilt als **fehlt**, weil der Datenendpunkt dafür
ebenfalls 404 liefert. Die Pfadregel ist dieselbe wie bei den
Webhook-Signaturschlüsseln: `vault:` und danach Segmente aus Buchstaben, Ziffern,
`_` und `-`, durch `/` getrennt, unter dem fest konfigurierten Mount. Eine
Referenz, die nicht in diese Form passt, gilt als **kein Zugriff** und wird nicht
angefragt. Antwortet der Vault mit 403, heisst das ebenfalls **kein Zugriff**:
Die Policy des Tokens muss `read` auf `<mount>/metadata/<pfad>` erlauben, das
Lesen der Daten braucht diese Ansicht nicht.

```powershell
$env:QKERN_VAULT_TOKEN_FILE="/run/qkern/vault-token"
# Optional; ohne diese Variable gilt der Mount der Webhook-Signaturschlüssel.
$env:QKERN_FUNCTIONS_VAULT_KV_URL="https://vault.example.net/v1/secret"
```

Ist kein Vault konfiguriert, antwortet die Route mit 503 und dem Code
`VAULT_NOT_CONFIGURED`, und die Console zeigt „Vault nicht verbunden".
`VAULT_MISCONFIGURED` steht für eine halbe Konfiguration, `VAULT_UNAVAILABLE`
für einen Vault, der nicht oder nicht in der erwarteten Form geantwortet hat.

### Cron-Log

Seit `2.42.0` zeigt **Logs → Cron** je Cron-Definition, was aus ihren
Vorkommen geworden ist. Nur lesend: kein Auslösen von Hand, kein Wiederholen,
kein Pausieren — das bleibt unter Functions & Jobs.

QKERN schreibt **kein** Protokoll je Cron-Lauf. Das Log wird aus zwei Tatsachen
zusammengesetzt: dem Ausdruck der Definition und den Nachrichten der Zielqueue.
Die Brücke ist der Dedupe-Schlüssel `cron:<id>:<zeitpunkt>`, den der
Dispatcher beim Einreihen setzt; die Queue speichert davon nur den
SHA-256-Verifikator `dedupe_key_hash`, nie den Schlüssel selbst. Die Ansicht
rechnet die erwarteten Vorkommen mit demselben Parser aus, den der Scheduler
benutzt, bildet denselben Verifikator und stellt die gefundene Nachricht
daneben. Was der Container ausgegeben hat, steht nicht dort.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/compute/cron/{cronId}/occurrences`
mit derselben Berechtigung wie die übrigen Definitionsrouten
(`project_compute_admin`), `Cache-Control: private, no-store` und **ohne jeden
Query-Parameter**: Jeder Parameter ist ein 400, eine unbekannte oder fremde
Definition ein 404. Das Fenster steht im Dienst und nicht im Aufruf — die
letzten 24 Stunden und die nächste Stunde, höchstens 50 Vorkommen, neueste
zuerst.

Je Vorkommen nennt die Antwort den Zeitpunkt, den Zustand und, wenn es eine
Nachricht gibt, deren Zustand (`pending`, `in_flight`, `done`, `dead_letter`),
die Versuchszahl, den Zeitpunkt der Einreihung und den des Abschlusses.
**Nie die Nutzlast, nie den Dedupe-Schlüssel, nie die Nachrichten-Id**: Die
Nutzlast eines Cron-Jobs kann Kundendaten tragen, und die Betriebsfrage braucht
sie nicht. Den Zeitpunkt des letzten Versuchs gibt es nicht, weil die Queue ihn
nicht führt.

Vier Zustände, weil zwei gelogen wären:

- **gefunden** — eine Nachricht mit dem Verifikator dieses Vorkommens liegt in
  der Queue.
- **fehlt** — das Vorkommen war fällig, die Definition gab es schon, und es
  liegt keine Nachricht dazu vor.
- **noch nicht fällig** — das Vorkommen liegt in der Zukunft oder ist erst
  wenige Minuten her. Der Dispatcher läuft im Intervall; fünf Minuten Karenz
  verhindern eine Lücke, die es nicht gibt.
- **nicht nachweisbar** — das Vorkommen liegt vor dem Anlegen der Definition,
  oder das Dedupe-Fenster der Queue ist abgelaufen und der Verifikator darin
  gelöscht (Migration 0026). Dort beweist eine fehlende Nachricht nichts.

Zwei Grenzen bleiben: Ein geänderter Ausdruck ist nicht rekonstruierbar —
Ausdruck und Queue sind unveränderlich, eine Änderung ist Löschen und
Neuanlegen, und die alten Vorkommen gehören dann zu einer anderen Id. Und ein
Dedupe-Fenster, das kürzer ist als der Takt des Cron-Jobs, macht das Log
wertlos, noch bevor es alt ist; 300 Sekunden Vorgabe reichen für einen
Minutentakt, nicht für einen stündlichen. Eine Zielqueue mit Fenster null hat
gar kein Log: Ohne Verifikator gibt es keine Brücke zwischen Vorkommen und
Nachricht, jedes fällige Vorkommen steht dann als **nicht nachweisbar** da, und
der Cron-Job verliert seine Zusage, dass ein Vorkommen höchstens eine Nachricht
erzeugt.

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

Backup- und Restore-Drill (seit `2.29.0`, Sprosse 10 lokal in Docker): ein
PostgreSQL 17 mit TLS-Pflicht und WAL-Archiv, ein verschlüsseltes Basisbackup
über `sslmode=verify-full`, ein zweiter Server, der aus Backup und Archiv bis
zu einem Zeitpunkt wiederhergestellt wird, und der Beleg über Schema, Zeilen,
Audit-Kette und Manifest. Die signierte Evidenz landet unter
`docs/evidence/backup-restore/` und wird vom Produkt-Verifier gelesen
(`npm run verify:backup-restore`, Pfade absolut, auf Linux; Windows-Pfade
lehnt der Verifier ab):

```powershell
npm run test:backup:docker
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
