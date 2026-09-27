# QKERN Handbuch

Dieses Handbuch gilt für `2.55.0`. QKERN benötigt Node.js **24.7 oder neuer**.

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
| `auth_provider_unverified_email` | niedrig | je Anmeldeanbieter Slug und ein Ja/Nein zu `email_verified` | ein Anbieter ist mit `emailVerification: "trusted"` hinterlegt, nimmt also ein ID-Token ohne den Claim an |

Buckets und API-Keys liest der Berater nur mit einer Console-Sitzung, deren Rolle
`project_storage_admin` beziehungsweise `project_api_keys` hat; ein Projekt-Key
sieht dort „nicht geprüft". Ist Storage aus, die Projektdatenbank nicht
angebunden oder ein Dienst nicht erreichbar, laufen die betroffenen Regeln nicht
(`ran: false` mit Grund); die Route antwortet trotzdem mit 200. Schneidet der
Katalog ab (100 Tabellen, 200 Policies), sagt der Grund das; `rls_no_policies`
läuft dann gar nicht, weil eine fehlende Policy nur abgeschnitten sein könnte.

Die Anmeldeanbieter liest der Berater seit `2.57.0` — mit derselben Console-
Sitzung und derselben Fähigkeit `project_auth_admin` wie die Gesundheitsseite.
Bis `2.56.0` lief die Regel `auth_provider_unverified_email` nie, weil
`listOidcProviders` nur Kennung und Issuer nannte. Die Projektion trägt jetzt
ein drittes Feld, `requiresVerifiedEmail`, und mehr nicht: ein abgeleitetes
`boolean` aus `emailVerification`, in das strukturell kein Geheimnis passt.
Client-ID, Endpunkte und der Name der Secret-Umgebungsvariablen bleiben drinnen,
und die **öffentliche** Provider-Route `/auth/oidc/providers` verengt weiterhin
auf Kennung und Issuer: Wie ein Anbieter eingestellt ist, geht niemanden etwas
an, der noch nicht angemeldet ist.

Was der Berater nicht sieht: Schemas ausser `public`, Funktionen mit
`SECURITY DEFINER`, Views ohne `security_invoker`, Spaltenrechte, Tabellen ohne
Spalten, Policies, die an die Verbindungsrolle der Data API statt an `public`
gebunden sind, und an den Anmeldeanbietern alles ausser der einen Frage nach
`email_verified`. Ein Befund ist kein Urteil. Eine Policy mit `USING (true)` für eine wirklich
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
| `slow_statement` | mittel | aus `pg_stat_statements` nur Zeilen der eigenen Datenbank, je Zeile nur Kennung, Aufrufe und Gesamtzeit | ein Statement summiert mindestens 10 Sekunden; gemeldet werden höchstens die fünf teuersten |
| `unused_index` | niedrig | Scans, Grösse und Art der Indizes | ein Index ohne Primärschlüssel- und Unique-Eigenschaft hat null Scans und mindestens 1 MiB |
| `bloat_suspected` | niedrig | lebende und tote Zeilen je Tabelle | mindestens 1000 tote Zeilen und mindestens ein Fünftel so viele tote wie lebende |
| `never_analyzed` | niedrig | letzte Stichprobe und letztes Autovacuum | mindestens 1000 lebende Zeilen, aber weder `ANALYZE` (auch nicht automatisch) noch Autovacuum |

Die Schwellen stehen in `PERFORMANCE_THRESHOLDS` und nur dort; jeder Text nennt
sie in Worten. Eine Regel feuert ab dem Wert, nicht erst darüber.

`pg_stat_statements` liest QKERN seit `2.57.0` — aber nur den Teilausschnitt,
der sicher ist. Bis `2.56.0` blieb die Sicht ganz ungelesen, mit zwei Gründen:
Sie gilt für den ganzen Cluster, und sie normalisiert nur Abfragen, weshalb der
Text eines Utility-Befehls seine Literale behält — etwa ein Passwort aus
`CREATE ROLE ... PASSWORD '...'`. Beide Gründe treffen die Spalte `query` und
die Zeilen fremder Datenbanken, nicht die Zähler. `inspectStatements` grenzt
deshalb auf `dbid` der eigenen Datenbank ein, wählt `query` nirgends aus und
lässt Zeilen ohne `queryid` weg (die zeigt PostgreSQL einer Rolle ohne
`pg_read_all_stats` für fremde Sitzungen). Übrig bleiben die normalisierte
Kennung, die Zahl der Aufrufe und die Gesamtzeit; `PerformanceAdvisorStatement`
hat kein Feld mehr, in das ein Text passen würde. Ein Befund nennt darum die
Kennung, und nachschlagen lässt sie sich in `pg_stat_statements` selbst.

Ist die Erweiterung nicht installiert oder für die Leserolle nicht erreichbar,
läuft die Regel nicht und die Antwort sagt genau das; eine Erweiterung, die es
nicht gibt, ist kein Fehler. Der Zertifizierungsfall
„(2.57) proves the advisor rules that used to be unreachable“ legt einen Marker
als Literal in den Text eines Utility-Befehls, weist nach, dass die Sicht ihn
wirklich trägt, und prüft danach, dass die ganze Antwort frei davon ist.

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
es erreichbar, nur eingerichtet, abgeschaltet, nicht eingerichtet oder gestört
ist, und woran das abgelesen wurde. Nur lesend: kein Neustart, kein Einschalten, keine Reparatur.
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

Sechs Zustände: `ok`, `configured`, `off`, `unconfigured`, `unknown`,
`degraded`. Das Gesamturteil ist der schlechteste vorhandene Zustand, in genau
dieser Reihenfolge von harmlos nach schlimm.

`configured` gibt es seit `2.57.0` und trennt zwei Aussagen, die `2.44.0` beide
`ok` genannt hat. `ok` heisst: Der Dienst wurde gefragt und hat geantwortet.
`configured` heisst: Es ist eine Adresse oder eine Anbindung hinterlegt, gefragt
wurde niemand. Realtime und Vault tragen nie mehr als das, und sie standen bis
`2.56.0` mit dem Wort „erreichbar“ da, obwohl die Seite dort nie angeklopft
hat. Solange einer der beiden eingerichtet ist, sagt darum auch das
Gesamturteil nicht mehr „erreichbar“. `degraded` steht über `unknown`, weil ein
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
nicht. Genau deshalb heissen die beiden `configured` und nicht `ok`.

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
`pg_stat_database` liegen.

Seit `2.57.0` ist dieser Unterschied eine Zahl und keine Fussnote mehr: Die
Kachel **FÜR DIESE ROLLE UNSICHTBAR** zeigt `backends` minus die gezählten
Gruppen, und der Satz darunter nennt dieselbe Zahl in Worten oder sagt
ausdrücklich, dass die Zählung die Zahl der Backends erreicht. Nach unten wird
auf null geklemmt: Beide Zahlen kommen aus zwei Abfragen nacheinander, und eine
dazwischen geschlossene Sitzung soll keine negative „unsichtbare“ Zahl
ergeben.

Die Datenbankseite rechnet aus `blks_hit` und `blks_read` die
Cache-Trefferquote und stellt `numbackends` gegen `max_connections`. Wurde noch
kein Block gelesen, zeigt sie keine Quote statt null Prozent. Alle Zähler gelten
seit `stats_reset`, nicht seit dem Start der Datenbank; auch dieser Satz steht
über den Zahlen und nicht im Kleingedruckten.

### Wiederherstellung auf einen Zeitpunkt

Seit `2.53.0` ist **Datenbank → Point-in-time Recovery** keine Platzhalterseite
mehr. Der Platzhalter sagte, es fehle ein WAL-Archiv ausserhalb des
Wegwerf-Stacks. Das stimmt weiterhin, und genau das sagt jetzt die Seite selbst,
statt es in der Navigation zu verstecken.

**Was QKERN belegt.** Der Restore-Drill aus `2.29.0` stellt nicht bis zum Ende
des Archivs wieder her, sondern auf einen gewählten Zeitpunkt. Er schreibt die
Phasen A und B, merkt sich einen Zeitpunkt danach, schreibt Phase C, erzwingt
einen Segmentwechsel und wartet, bis `pg_stat_archiver` das Segment bestätigt.
Der zweite Server läuft mit `restore_command` aus dem Archiv und
`recovery_target_time` auf diesem Zeitpunkt. Belegt wird: die Zeilen 1 bis 6
sind da, keine Zeile aus Phase C ist da. Das ist die eine Aussage, die eine
Wiederherstellung auf einen Zeitpunkt von einer gewöhnlichen Rücksicherung
unterscheidet, und sie steht seit `2.29.0` im Drill. Der Drill wurde für diese
Seite nicht erweitert, weil es nichts zu erweitern gab.

Der Drill läuft aber gegen einen eigenen Stack mit eigenem WAL-Archiv. Er belegt
das Verfahren und die Software, nicht das Archiv einer Installation.

**Was die Seite zeigt.** Zuerst den Zustand, und im leeren Fall zuerst den
leeren Satz: *Kein Archiv, keine Wiederherstellung auf einen Zeitpunkt.* Darunter
das Fenster, soweit es bekannt ist, die Eckdaten des letzten Drills und die
Schritte, die ein Betreiber am Server geht. Die Seite führt keinen davon aus.

| Zustand | Wann |
| --- | --- |
| Kein Archiv | Es ist kein WAL-Archiv erklärt. Ohne Archiv gibt es keinen Zeitpunkt, auf den wiederhergestellt werden könnte. |
| Archiv erklärt, nicht belegt | Ein Archiv ist erklärt, aber es liegt keine gültige, signierte Drill-Evidenz vor. |
| Archiv erklärt, letzter Drill belegt | Ein Archiv ist erklärt, und die Evidenz liegt innerhalb der festen Policy. |

**Erklärt, nicht gemessen.** QKERN verwaltet kein WAL-Archiv und liest keines.
Die drei Angaben kommen darum aus der Umgebung und sind Angaben des Betreibers:

| Variable | Bedeutung |
| --- | --- |
| `QKERN_BACKUP_WAL_ARCHIVE_DECLARED` | `true`, wenn ein WAL-Archiv geführt wird. Alles andere gilt als kein Archiv. |
| `QKERN_BACKUP_WAL_ARCHIVE_RETENTION_DAYS` | Aufbewahrung in Tagen, 1 bis 730. |
| `QKERN_BACKUP_WAL_ARCHIVE_SINCE` | Beginn der Archivierung als UTC-Zeitstempel mit Millisekunden. |

Eine vierte Variable gibt es nicht, und insbesondere keine für den Ort des
Archivs. So kann über diese Seite keine Verbindungszeile, kein Bucket und kein
Schlüssel hinausgehen. Ein unbrauchbar gesetzter Wert wird nicht geraten: er
fällt weg, und die Seite nennt den Variablennamen, nie seinen Inhalt.

Der **älteste** wiederherstellbare Punkt ist der spätere von „jetzt minus
Aufbewahrung“ und „Beginn der Archivierung“. Beides begrenzt nach unten, und die
strengere Grenze gilt. Ist keines von beiden erklärt, sagt die Seite, dass der
älteste Punkt nicht bekannt ist. Der **neueste** Punkt bleibt leer: er hängt
davon ab, wie aktuell das Archiv ist, und das weiss nur, wer ins Archiv sieht.
Eine Schätzung stünde dort als Zahl und wäre im Ernstfall die falsche.

Die Route dahinter ist
`GET /api/v1/projects/{projectId}/environments/{environment}/database/backups/point-in-time`,
dieselbe Tür wie `/database/activity`, `private, no-store`, und jeder
Query-Parameter ist ein `400`. Von der Drill-Evidenz gehen nur Zeitpunkte und
Dauern hinaus, nicht ihre ID, nicht ihre Key-ID und keiner ihrer Digests. Fehlt
die Evidenz, ist sie abgeschaltet oder älter, als die Policy zulässt, dann fehlt
der Drill in der Antwort; ein Fehler ist das nicht.
### Datenbank-Einstellungen

Seit `2.53.0` ist **Datenbank → Datenbank-Einstellungen** keine Platzhalterseite
mehr. Der Platzhalter versprach vier Dinge — Verbindungsdaten, Pooler,
SSL-Zwang, Netzwerkbeschränkungen — und die Seite sagt jetzt zu jedem davon die
Wahrheit, statt vier leere Kacheln zu zeigen. Sie liest eine Route:

```
GET /api/v1/projects/{projectId}/environments/{environment}/database/settings
```

Dieselbe Tür wie `/database/activity` (Session mit Leserecht oder
scope-gebundener Projekt-Key), `Cache-Control: private, no-store`, und **kein
einziger Query-Parameter**: Die Auskunft gilt für die eine Datenbank dieses
Environments, darum ist jede Angabe ein 400.

**Keine Verbindungsdaten.** Das ist die wichtigste Zusage dieser Seite, und sie
steht in ihrer ersten Zeile. Weder Host noch Port, weder Benutzername einer
fremden Rolle noch Passwort noch Verbindungszeichenfolge stehen in der Antwort.
Sie sind dort nicht ausgelassen oder maskiert, sondern nie gelesen:
`inet_server_addr`, `inet_server_port` und `client_addr` kommen hinter dieser
Route nirgends vor. Die Adresse einer Projektdatenbank lebt im serverseitigen
Verbindungskatalog (`TrustedProjectDatabaseConnectionCatalog`), und der gibt sie
nicht heraus — eine Umgebung kennt von ihrer Datenbank nur die undurchsichtige
Referenz `managed:…` in `project_environments.database_instance_ref`.

Was die Seite zeigt, kommt aus dem Katalog des Servers:

* **Datenbank und Eigentümerin** aus `pg_database` für `current_database()`,
  dazu die Rolle, mit der die Data Plane gelesen hat.
* **Die Rollen dieser Datenbank** aus `pg_roles`, genau die Liste, die auch
  **Datenbank → Rollen** zeigt: die eigene Rolle, Eigentümer von Objekten in
  Anwendungsschemata, Empfänger von Tabellen- oder Spaltenrechten dort und in
  einer Policy genannte Rollen, ohne die vordefinierten `pg_*`-Rollen. Jede
  Rolle steht mit ihren Rechten in Worten da: ob sie sich anmelden darf oder
  eine Gruppenrolle ist, ob sie Datenbanken oder Rollen anlegen, replizieren
  oder Row Level Security umgehen darf, ob sie nicht automatisch erbt, ob sie
  eine eigene Verbindungsgrenze und ob sie ein befristetes Passwort hat.
* **Der TLS-Zustand**, und zwar als zwei getrennte Aussagen. `encrypted` kommt
  aus `pg_stat_ssl` für `pg_backend_pid()`, gilt also für genau die Verbindung,
  mit der diese Antwort gelesen wurde, und nie für eine fremde Sitzung.
  `serverEnabled` ist die Servereinstellung `ssl`. Sie sagt, dass der Server TLS
  **anbietet**, nicht, dass er es **verlangt**; verlangt wird TLS in
  `pg_hba.conf`, und die liest QKERN nicht. Chiffre, Schlüssellänge und
  `client_dn` bleiben draussen: Ein Zertifikatsname ist eine Identität und keine
  Betriebszahl.
* **Die Verbindungsgrenzen** des Servers: `max_connections`,
  `superuser_reserved_connections`, `datconnlimit` dieser Datenbank und
  `rolconnlimit` der lesenden Rolle. `null` heisst unbegrenzt, so wie der
  Katalog das mit `-1` ausdrückt.

Was es **nicht** gibt, steht als eigener Block auf der Seite: QKERN hat
**keinen Pooler** vor der Projektdatenbank — jeder Prozess hält seinen eigenen
Pool, es gibt nichts einzustellen. Es gibt **keine Netzwerkbeschränkung**, die
QKERN verwaltet; wer sich verbinden darf, entscheidet der Server in
`pg_hba.conf`. Es gibt **keinen Wechsel der Verbindung**: Die Console kann kein
Passwort drehen und keine Umgebung neu binden, denn die Bindung ist
unveränderlich, sobald sie steht. Und **erzwingen** lässt sich TLS von hier aus
nicht; die Seite zeigt den Zustand und ändert ihn nicht. Die Route hat kein
Schreibverb, die Ansicht kein Eingabefeld.

Gebunden wird eine Umgebung darum ausserhalb der Console. In Produktion trägt
der Provisionierer nach dem Bootstrap die Referenz in
`project_environments.database_instance_ref` ein; lokal tut dieselbe eine
`UPDATE`-Anweisung das Skript

```
npm run dev:bind-project-database -- <projekt-uuid> <development|staging>
```

das nur aus `pending:` heraus bindet, `production` nie bindet und ohne
`--allow-remote-host` nur gegen einen lokalen Host läuft. Ob die Verbindung
dahinter TLS benutzt, entscheidet nicht die Console: In Produktion verlangt
`lib/server/db/pool.ts` ohnehin `DATABASE_SSL=require`, und ein
vault-gebundener Katalog prüft zusätzlich den Fingerabdruck des
Serverzertifikats, wenn einer hinterlegt ist.

### Tabellen-Designer

Seit `2.49.0` ist **Datenbank → Tabellen** keine Platzhalterseite mehr. Die
Ansicht listet die Tabellen des Schemas `public` mit ihren Spalten (dieselbe
Route `/schema` wie der Schema-Visualizer) und bereitet drei Änderungen vor:
eine Tabelle anlegen, eine Tabelle umbenennen, einer Tabelle eine Spalte geben.

Neu ist daran, dass die Console zum ersten Mal schreibt, und zwar auf dem Weg,
den das Produkt ohnehin vorschreibt. Die Ansicht führt **kein** SQL aus. Sie
erzeugt genau eine Anweisung, zeigt sie vollständig an, und schickt sie danach
an die bestehende Route `POST /api/v1/changesets`. Eine neue Route gibt es
nicht. Was dann geschieht, entscheidet die **Freigabezentrale**; angewendet wird
ausschließlich vom Migrationsprozess, nach der Freigabe. Die Seite sagt das und
verlinkt dorthin.

Die Anweisungen entstehen in `lib/console/table-change-sets.ts`, einem reinen
Modul ohne React, ohne `fetch`, ohne Datenbank:

```
CREATE TABLE "public"."kunden" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, "erstellt_am" timestamptz DEFAULT now())
ALTER TABLE "public"."kunden" RENAME TO "kundschaft"
ALTER TABLE "public"."kunden" ADD COLUMN "notiz" text
```

Drei Regeln tragen das Modul. Erstens muss jeder Name die Grammatik der Data API
erfüllen (`[A-Za-z_][A-Za-z0-9_]{0,62}`); ein Anführungszeichen, ein Semikolon,
ein Kommentarzeichen, ein kyrillisches `а` oder ein 64. Zeichen fällt damit
durch. Zweitens kommen Typ und Vorgabewert nicht aus der Eingabe, sondern aus
zwei festen Listen (`text`, `integer`, `bigint`, `numeric`, `boolean`, `uuid`,
`date`, `timestamptz`, `jsonb`; `keine Vorgabe`, `now()`, `gen_random_uuid()`),
und ein Vorgabewert muss zum Typ passen. Drittens wird erst nach der Prüfung
zitiert und immer zitiert; weil die Grammatik das Anführungszeichen verbietet,
kann kein Name aus seinen Anführungszeichen ausbrechen. Zusätzlich lehnt der
Designer reservierte Wörter von PostgreSQL ab (zitiert funktionierten sie, aber
eine Tabelle `"order"` zwingt jede spätere Abfrage zu Anführungszeichen) und
eine neue Spalte mit `NOT NULL` ohne Vorgabewert, weil sie an den Zeilen
scheitern würde, die es schon gibt.

Was der Designer bewusst nicht kann: Tabellen oder Spalten entfernen, den Typ
einer bestehenden Spalte ändern, eine Spalte umbenennen, einen
Primärschlüssel oder einen Fremdschlüssel setzen. Es gibt im Modul keinen Weg,
eine solche Anweisung zu erzeugen; die Ansicht sagt das ebenfalls. Verlorene
Daten gehören nicht in einen ersten schreibenden Slice.

Zertifiziert ist der ganze Weg gegen echte Dienste: Fall `(2.49)` in
`tests/postgres.integration.test.ts` baut mit dem Generator ein Change Set,
lässt es über den echten Freigabe- und Apply-Dienst laufen, lässt den echten
Worker es mit dem echten Executor in eine echte Projektdatenbank anwenden und
liest danach den Katalog zurück: Spalten, Typen, `NOT NULL` und Vorgabewerte wie
beschrieben, dazu der Ledger-Eintrag. Ein feindlicher Name wird im selben Fall
abgewiesen, bevor irgendetwas geschrieben ist.

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
- `admin/audit/series?bucket=<hour|day>` (GET) fasst dieselben Einträge seit `2.47.0`
  zu einer Zeitreihe zusammen; in der Console unter Berichte → Auth
- `admin/mfa` (GET liest, PUT setzt) legt seit `2.49.0` fest, ob diese Umgebung den
  zweiten Faktor verlangt; in der Console unter Auth → Mehrfaktor
- `admin/return-targets` (GET liest, PUT ersetzt) führt seit `2.51.0` die erlaubten
  Rücksprungziele dieser Umgebung; in der Console unter Auth → URL-Konfiguration
- `admin/mail` (nur GET) zeigt seit `2.51.0` den wirksamen Mailweg und die festen
  Texte der Aktionsmails; in der Console unter Auth → SMTP und Auth → E-Mail-Vorlagen
- `admin/rate-limits` (GET liest, PUT ersetzt) führt seit `2.52.0` die Grenzen je
  Zeitfenster dieser Umgebung; in der Console unter Auth → Rate Limits
- `admin/password-protection` (GET liest, PUT ersetzt) führt seit `2.53.0` den
  Passwortschutz dieser Umgebung: Prüfung gegen bekannte Lecks, Mindestlänge und
  Wortlaut einer Ablehnung; in der Console unter Auth → Passwortschutz

Project Auth schreibt seit 2.35 diese Ereignisse in die Hash-Kette `audit_logs`:
`project_auth.signup.succeeded`, `project_auth.login.succeeded`,
`project_auth.login.failed`, `project_auth.logout`, `project_auth.mfa.enrolled`,
`project_auth.mfa.verified`, `project_auth.user.updated`,
`project_auth.session.revoked`, `project_auth.sessions.revoked_all` und seit
`2.49.0` `project_auth.mfa.enforcement_changed`, seit `2.52.0`
`project_auth.rate_limits.changed` und `project_auth.rate_limit.blocked` sowie seit
`2.53.0` `project_auth.password_protection.changed` und
`project_auth.password.refused`. Ein Refresh
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

### Zweiter Faktor je Projekt erzwingbar

Seit `2.49.0` ist **Auth → Mehrfaktor** keine Platzhalterseite mehr. Der alte
Hinweis — „Erzwingen je Projekt und weitere Faktoren fehlen“ — stimmt zur
Hälfte nicht mehr: Erzwingen gibt es jetzt. Weitere Faktoren gibt es weiterhin
nicht, und die Seite sagt das auch.

Die Einstellung gehört zur **Projektumgebung**, nicht zum Nutzer und nicht zum
Prozess: Development darf offen bleiben, während Production den Faktor
verlangt. Sie liegt in `project_auth_settings`
(`db/migrations/0048_project_auth_mfa_enforcement.sql`); eine fehlende Zeile
heisst „nicht erzwungen“.

**Was Erzwingen tut.** Ist der Schalter an, ergibt eine Anmeldung ohne zweiten
Faktor keine brauchbare Sitzung. Geprüft wird an genau den drei Stellen, an
denen eine Sitzung brauchbar wird, und alle drei liegen im Dienst, nicht in der
Console:

1. **Beim Anlegen** (`beginAuthenticatedSession`): Ein Nutzer ohne bestätigten
   Faktor bekommt keine Zeile in `project_auth_sessions` und kein Access Token.
2. **Beim Erneuern** (`refresh`): Eine `aal1`-Sitzung wird nicht rotiert,
   sondern ihre ganze Refresh-Familie widerrufen. Sonst lebten die Sitzungen
   von vor dem Einschalten bis zum Ablauf ihres Refresh Tokens weiter, und der
   steht auf 30 Tagen.
3. **Beim Prüfen** (`verifyAccess`): Die Tür, durch die Data API, Realtime,
   `auth/user` und `auth/mfa/enroll` gehen. Damit schliesst sich auch das
   Restfenster von bis zu 15 Minuten, in dem ein vorher ausgegebenes
   `aal1`-Token sonst noch gälte.

**Wer noch keinen Faktor hat, kommt trotzdem zur Einrichtung.** Die Anmeldung
gibt ihm statt einer Sitzung einen Einrichtungsschein: ein opakes
`qk_enroll_…`-Token, 15 Minuten gültig, gespeichert nur als Verifier. Es öffnet
einzig `auth/mfa/enroll` — dort wird es als Bearer vorgezeigt — und sonst
nichts; jede andere Grenze prüft ein Access Token, und ein `qk_`-Token wird
dort als Bearer abgewiesen. Beim gelungenen Bestätigen ist der Schein
verbraucht. Ohne diesen Weg würde das Einschalten jeden aussperren, der noch
keinen Faktor hat — und das wäre beim ersten Mal jeder. Die Anmeldung, die nur
einen Schein ergibt, steht als `project_auth.login.failed` mit dem Grund
`mfa_enrollment_required` im Audit.

Die Route ist
`GET|PUT /api/v1/projects/{projectId}/environments/{environment}/auth/admin/mfa`
— dieselbe Tür wie die übrigen `admin/*`-Routen: Console-Session mit
`project_auth_admin`, `Cache-Control: private, no-store`, bei `PUT` zusätzlich
ein geprüfter Origin. Der Körper hat genau ein Feld, `required`, und muss ein
Boolean sein; alles andere ist ein 400 vor dem Dienstaufruf. Jede Änderung
schreibt `project_auth.mfa.enforcement_changed` in die Audit-Kette, mit dem
neuen Zustand und sonst nichts.

Als zweiter Faktor gibt es heute genau einen: TOTP aus einer Authenticator-App
mit einmaligen Recovery-Codes. **WebAuthn, Passkeys, SMS und E-Mail-Codes gibt
es nicht**, und dieser Schalter bringt sie nicht mit. Die Console-Anmeldung von
QKERN selbst ist davon unberührt; sie läuft nicht über Project Auth.

Ausschalten nimmt die Pflicht weg, nicht die Faktoren: Wer einen bestätigten
Faktor hat, wird weiterhin danach gefragt.

### Rücksprungziele je Projektumgebung

Seit `2.51.0` ist **Auth → URL-Konfiguration** keine Platzhalterseite mehr. Der
alte Hinweis — „Site-URL und erlaubte Rücksprungziele für Magic Link und OIDC"
— beschrieb eine Seite, die es nicht gab; es gab nur eine Liste in der
Umgebung des Prozesses.

Ein **Rücksprungziel** ist der Ort, an den ein Magic Link, eine
Bestätigungsmail oder ein OIDC-Flow den Nutzer zurückschickt. Wer diese Liste
weiten kann, kann sich ein Aktionstoken an eine fremde Adresse schicken
lassen; sie hat darum echtes Sicherheitsgewicht.

**Zwei Grenzen, und die Richtung trägt alles.**

1. Die **äussere Grenze** ist `QKERN_PROJECT_AUTH_REDIRECT_ORIGINS`, gelesen
   beim Start des Prozesses (`lib/server/project-auth/runtime.ts`). Sie gehört
   dem Betrieb und ist aus der Console nicht erreichbar. Ohne den Wert nimmt
   eine Nicht-Produktionsumgebung `NEXT_PUBLIC_APP_URL` oder
   `http://localhost:3000`; in Produktion gibt es keinen Ersatzwert.
2. Die **Liste der Projektumgebung** steht in `project_auth_settings`, Spalte
   `redirect_allow_list` (`db/migrations/0051_project_auth_return_targets.sql`).
   Sie kann die äussere Grenze nur **verengen**, nie weiten. Eine leere Liste
   verengt nichts; dann gilt genau die äussere Grenze, also das Verhalten von
   vor `2.51.0`. Jede Umgebung startet so.

Ein Eintrag ausserhalb der äusseren Grenze wird **abgelehnt**, nicht
stillschweigend weggelassen: Die Route antwortet mit 400 und nennt den Grund
`outside_outer_bound` samt dem Wert, damit die Console sagen kann, warum. Dass
die Liste nur verengt, steht auch auf der Seite selbst.

**Die Form eines Eintrags** ist dieselbe strenge Form wie bei der äusseren
Grenze: eine exakte Herkunft aus Schema, Host und Port. HTTPS, dazu HTTP nur
auf `localhost`, `127.0.0.1` oder `[::1]`. Keine Zugangsdaten, kein Pfad,
keine Abfrage, kein Fragment, kein Stern — Platzhalter gibt es an keiner
Stelle dieses Produkts, und das bestehende Backend kannte nie einen. Höchstens
zwanzig Einträge, je höchstens 255 Zeichen; doppelte fallen weg.

**Wo geprüft wird.** In `ProjectAuthService.returnTarget`, der einzigen
Stelle, an der ein Ziel angenommen wird, und zwar bevor irgendetwas
gespeichert oder versendet wird. Vier Wege führen dort hindurch: `signup`,
`magic-link`, `password-reset` und `oidc/{provider}/authorize`. QKERN schickt
selbst **nie** einen 302 an ein Rücksprungziel; der Wert wandert als
`redirect_to` in den Link der Aktionsmail und in den verschlüsselten
OIDC-Flow-Zustand, sonst nirgendwohin. Die reine Entscheidung liegt in
`lib/server/project-auth/return-targets.ts`, ohne Datenbank und ohne Zeit.

Die Route ist
`GET|PUT /api/v1/projects/{projectId}/environments/{environment}/auth/admin/return-targets`
— dieselbe Tür wie die übrigen `admin/*`-Routen: Console-Session mit
`project_auth_admin`, `Cache-Control: private, no-store`, bei `PUT` zusätzlich
ein geprüfter Origin. Der Körper hat genau ein Feld, `targets`, und das ist
ein Feld von Zeichenketten; `PUT` ersetzt die Liste ganz. Jede Änderung
schreibt `project_auth.return_targets.changed` in die Audit-Kette, mit der
Anzahl der Ziele danach und der ID des Console-Nutzers, nie mit seiner
Adresse. In der Zeitreihe unter Berichte → Auth zählt diese Handlung unter
`other`; die zehn benannten Handlungen der Reihe sind unverändert.

### Grenzen je Zeitfenster

Seit `2.52.0` ist **Auth → Rate Limits** eine echte Seite, und dahinter steht
eine Durchsetzung, die wirklich greift.

**Was es vorher gab.** Einen Zähler im Speicher des Prozesses
(`lib/server/auth/rate-limit.ts`, `InMemoryRateLimiter`), mit drei fest
verdrahteten Werten und einem Schlüssel, der aus einem gehashten
Netzwerk-Bezeichner bestand. Bei genau einer Instanz war das richtig. Bei zwei
Instanzen hinter einem Lastverteiler galt in Wahrheit das Doppelte der
gemeinten Grenze, und ein Neustart setzte alles auf null. Eine Grenze, die
man durch einen Neustart oder durch eine weitere Instanz weitet, ist keine.
Dieser Zähler bleibt bestehen — er fängt je Anfrageherkunft die groben
Wellen ab —, aber er ist nicht mehr die Aussage.

**Was es jetzt gibt.** Drei Grenzen je Projektumgebung, gespeichert in
`project_auth_settings`: `sign_in` für Anmeldeversuche, `mail` für
angeforderte Aktionsmails und `refresh` für Token-Erneuerungen. Jede besteht
aus zwei Zahlen, einem Maximum von 1 bis 10 000 und einem Fenster von 60 bis
86 400 Sekunden; beide Grenzen prüfen Route, Dienst **und** Datenbank. Die
Vorgaben sind genau die Werte, die vorher im Quelltext standen: zehn
Anmeldeversuche je 15 Minuten, fünf Mails je Stunde, sechzig Erneuerungen je
Stunde. Eine Umgebung ohne Zeile verhält sich damit wie vorher — nur wirksam
über mehr als eine Instanz.

**Wo gezählt wird.** In `project_auth_rate_counters`, in genau einer
Anweisung: ein `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, das den Stand
nach dem Hochzählen zurückgibt. Zwei Instanzen, die gleichzeitig denselben
Schlüssel zählen, bekommen darum 1 und 2 und nie zweimal 1. Das Fenster ist
ein festes Raster (`floor(t / w) * w`); deshalb rechnen beide ohne jede
Absprache denselben Fensteranfang aus und treffen dieselbe Zeile. Dieselbe
Anweisung räumt die abgelaufenen Fenster desselben Schlüssels weg, sodass
höchstens eine Zeile je aktivem Schlüssel stehen bleibt und kein
Aufräumprozess nötig ist.

**Wonach gezählt wird.** Bei `sign_in` und `mail` nach der Identität, also
nach der kanonischen Adresse; bei `refresh` nach der Sitzungsfamilie.
**Nie nach IP-Adresse allein**, und es wird auch keine gespeichert: Eine IP
wechselt der Angreifer, ein ganzes Büro teilt sich eine, und sie gehört als
personenbezogenes Datum nicht in eine Zähltabelle. Der Schlüssel geht
ausserdem nur als SHA-256 über Scope, Art und Wert (base64url) in die Zeile;
in `project_auth_rate_counters` steht damit nie eine Adresse. Das ist ein
Pseudonym und keine Anonymisierung — wer eine Adresse vermutet, kann sie
nachrechnen —, und genau so viel braucht ein Zähler.

**Fail closed auf der Grenze, fail open auf einem Fehler des Zählers.** Wer
die Grenze erreicht, wird abgewiesen, ohne Ausnahme. Lässt sich der Zähler
selbst nicht lesen oder schreiben, läuft der Versuch weiter zur eigentlichen
Prüfung, und der Fehler landet im Betriebsprotokoll. Der Grund ist die Rolle
dieser Schicht: Der Zähler schützt vor Raten, die Tür ist die
Passwortprüfung, und die steht unberührt dahinter. Wäre es umgekehrt, machte
ein Fehler in der Zähltabelle die ganze Anmeldung der Umgebung unbrauchbar.

**Was die Antwort verrät.** Nichts über die Identität. Gezählt wird, bevor
irgendetwas nachgeschlagen wird; eine bekannte und eine unbekannte Adresse
bekommen dieselbe Abweisung, `429` mit `Retry-After` auf das Ende des
laufenden Fensters. Der typisierte Fehler ist `RATE_LIMITED` und damit
derselbe wie bisher.

**Was eine Grenze nicht kann**, und das steht auch auf der Seite selbst: Eine
Grenze je Identität hält einen **verteilten** Angriff über viele Konten nicht
auf. Wer ein Passwort gegen zehntausend verschiedene Adressen probiert,
bleibt bei jeder einzelnen unter der Grenze. Dagegen hilft die Prüfung gegen
bekannte Lecks, die seit `2.53.0` unter Auth → Passwortschutz steht, und
darüber hinaus ein Captcha oder eine Bot-Abwehr — zwei Dinge, die QKERN nicht
hat und die im nächsten Abschnitt begründet fehlen. Eine Grenze ist auch keine
Kontosperre und keine Zustellsperre. Und die Refresh-Grenze greift erst, wenn
ein Token zu einer echten Familie gehört; ein geratenes Token wird davor
abgelehnt und kommt beim Zähler gar nicht an.

Die Route ist
`GET|PUT /api/v1/projects/{projectId}/environments/{environment}/auth/admin/rate-limits`
— dieselbe Tür wie die übrigen `admin/*`-Routen: Console-Session mit
`project_auth_admin`, `Cache-Control: private, no-store`, bei `PUT`
zusätzlich ein geprüfter Origin. Der Körper nennt alle drei Arten auf einmal,
weil ein Körper mit nur einer offen liesse, was mit den beiden anderen
geschehen soll. Jede Änderung schreibt `project_auth.rate_limits.changed` mit
den sechs Zahlen danach; greift eine Grenze, entsteht
`project_auth.rate_limit.blocked` mit Art, Grenze und Fenster — ohne
Schlüssel, ohne Hash und ohne Adresse. Die reine Entscheidung liegt in
`lib/server/project-auth/rate-limits.ts`, ohne Datenbank und ohne React.

### Passwörter gegen bekannte Lecks

Seit `2.53.0` ist **Auth → Passwortschutz** keine Platzhalterseite mehr. Der
Platzhalter hiess „Angriffsschutz“ und versprach drei Dinge: „Captcha,
Passwortprüfung gegen bekannte Lecks, Bot-Abwehr“. Gebaut ist **eines** davon,
und zwar dasjenige, das ohne fremden Dienst und ohne Browser-Herausforderung
auskommt. Die anderen zwei fehlen weiterhin, und weiter unten steht, warum.

**Kein fremder Dienst, und das ist der Punkt.** Der naheliegende Weg wäre Have
I Been Pwned: die ersten fünf Zeichen des SHA-1 hinschicken, die Antwort
durchsehen. Das ist k-Anonymität und technisch anständig — und es hiesse
doch, dass jede Registrierung jedes Kunden dieser Installation an einen
fremden Host geht, samt Zeitpunkt, Häufigkeit und Hashpräfix. Diese
Entscheidung darf ein Backend nicht für seine Nutzer treffen. QKERN prüft
darum **ausschliesslich lokal**: eine Liste im Prozessspeicher, kein einziger
ausgehender Aufruf. Das reine Modul
`lib/server/project-auth/password-leaks.ts` importiert nichts ausser
`node:crypto`.

**Was eingestellt wird.** Drei Werte je Projektumgebung, gespeichert in
`project_auth_settings` (Migration `0053`): ein Schalter
`leaked_password_check`, eine Mindestlänge `password_min_length` von 12 bis
128 Zeichen und ein Wortlaut `leaked_password_notice`, entweder `named` oder
`generic`. Beide Grenzen prüfen Route, Dienst **und** Datenbank. Die Vorgabe
ist **aus**: Die Prüfung lehnt ein Passwort ab, das ein Nutzer gerade gewählt
hat, und dieses Verhalten soll ein Betreiber einschalten, nicht geschenkt
bekommen. Nach unten ist die Mindestlänge bei 12 zu Ende, weil der Dienst
jedes kürzere Passwort seit jeher abweist; eine Einstellung, die diese Zusage
unterlaufen könnte, wäre eine Verschlechterung, die wie eine Einstellung
aussieht.

**Wo durchgesetzt wird.** An den beiden Stellen, an denen ein Passwort gesetzt
wird: `signUp` und `resetPassword` in
`lib/server/project-auth/service.ts`. Nicht in der Console und nicht in der
Route — es gibt mehr als eine Tür zu diesen Stellen (REST, SDK, CLI, MCP), und
eine Regel, die an einer Tür hängt, ist keine Regel. Beim Zurücksetzen steht
die Prüfung **vor** dem Einlösen des Tokens: Ein abgelehntes Passwort soll den
Zurücksetz-Schein nicht verbrauchen.

**Was verglichen wird.** Nie das Passwort, immer sein SHA-1- oder
SHA-256-Digest, gross geschrieben und auf die Präfixlänge der Liste gekürzt.
Ein Treffer auf einem Präfix ist streng genommen ein *möglicher* Treffer; bei
16 Hexzeichen liegt die Kollisionswahrscheinlichkeit je Eintrag bei 2^-64. Das
ist die Genauigkeit, die das Format hergibt.

**Die Liste.** Eine Installation zeigt mit
`QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE` auf eine Textdatei, wahlweise mit
`QKERN_PROJECT_AUTH_LEAKED_PASSWORD_ALGORITHM` auf `sha1` (Vorgabe) oder
`sha256`. Format: je Zeile ein Digest oder ein Präfix davon in Hex, wahlweise
gefolgt von `:` und einer Zahl, die verworfen wird — genau das Format, in dem
die bekannten Listen ausgeliefert werden. Leerzeilen und Zeilen mit `#` sind
Kommentar; alle Einträge müssen dieselbe Länge zwischen 16 Hexzeichen und der
Digestlänge haben, höchstens eine Million Einträge und höchstens 16 MiB. Eine
fehlende, zu grosse oder fehlerhafte Datei ist eine `ConfigurationError` und
lässt Project Auth **nicht starten**; still auf die eingebaute Liste
zurückzufallen hiesse, eine eingeschaltete Prüfung weiterlaufen zu lassen, die
nichts mehr prüft. Der Fehlertext nennt Grund und Zeilennummer, nie den Pfad
und nie einen Eintrag.

**Die eingebaute Liste, samt der unbequemen Hälfte.** Ohne Datei gelten
**25 Einträge**: die Ränge 1 bis 25 der jährlich veröffentlichten Liste „Worst
Passwords of the Year 2019“ von SplashData, in ihrer Reihenfolge. Keine
erfundenen Einträge, keine behauptete Quelle. Eine echte Leckliste ist
hunderte Megabyte gross, veraltet ab dem Tag des Commits und gehört nicht in
dieses Repository. **Und alle 25 Einträge sind kürzer als die zwölf Zeichen,
die QKERN ohnehin verlangt** — ohne hinterlegte Datei lehnt die Prüfung
deshalb nichts ab, was die Längenregel nicht schon ablehnt. Die eingebaute
Liste gibt dem Schalter ein definiertes Verhalten, keinen Schutz. Die
Alternative wäre gewesen, längere Einträge zu erfinden und eine Quelle zu
behaupten, die es nicht gibt.

**Was eine Ablehnung verrät.** Bei `named`: dass dieses Passwort aus bekannten
Lecks stammt (`LEAKED_PASSWORD`, `400`, „Password appears in a known
credential leak“). Das ist handelbar und kein Geheimnis — wer es eingegeben
hat, kennt es. Bei `generic`: nur, dass das Passwort den Regeln dieses
Projekts nicht genügt (`WEAK_PASSWORD`, `400`). **Nie** sagt eine Ablehnung,
wie oft das Passwort vorkommt oder aus welchem Leck; die erste Angabe kennt
die Prüfung nicht einmal, weil in der Liste ein Digest und kein Zähler steht.
Das Passwort selbst erscheint in keiner Logzeile, keinem Fehlertext und keinem
Audit-Eintrag.

**Fail closed, anders als beim Zähler.** Die Grenzen aus `2.52.0` öffnen bei
einem Fehler des Zählers; diese Prüfung tut das nicht. Der Zähler ist eine
Schicht vor der Tür und darf im Zweifel durchlassen; hier wird entschieden,
welches Passwort ein Konto bekommt, und ein Lesefehler auf den Einstellungen
ist keine Erlaubnis.

**Was diese Seite nicht baut**, und das steht auch auf ihr selbst:

- **Kein Captcha.** Es braucht zwei Dinge, die QKERN hier nicht hat: einen
  fremden Dienst, der die Aufgabe stellt und das Ergebnis bestätigt, und eine
  Browser-Herausforderung im Frontend des Kunden. Ein Schalter in der Console,
  hinter dem nichts steht, wäre schlimmer als ein ehrlich leerer Platz.
- **Keine Bot-Abwehr** über die Grenzen je Zeitfenster aus `2.52.0` hinaus.
  Was darüber hinausgehen würde — Fingerprinting, Reputationslisten,
  Verhaltensmodelle — braucht Daten über den Anfragenden, die QKERN bewusst
  nicht sammelt.
- **Keine nachträgliche Prüfung bestehender Konten.** QKERN speichert
  Passwörter als Argon2id-Hash und kann sie nicht lesen, also auch nicht
  gegen eine Liste halten. Die Prüfung greift nur bei neu gesetzten
  Passwörtern.
- **Kein Schutz gegen einen verteilten Angriff.** Geprüft wird, was ein Nutzer
  sich aussucht, nicht, was ein Angreifer rät. Gegen das Raten helfen die
  Rate Limits, gegen ein erratenes Passwort der zweite Faktor.

Die Route ist
`GET|PUT /api/v1/projects/{projectId}/environments/{environment}/auth/admin/password-protection`
— dieselbe Tür wie die übrigen `admin/*`-Routen: Console-Session mit
`project_auth_admin`, `Cache-Control: private, no-store`, bei `PUT` zusätzlich
ein geprüfter Origin. Der Körper nennt alle drei Werte auf einmal. Ein
Passwort erreicht diese Route nie und sie hat auch keinen Weg, eines
entgegenzunehmen. Jede Änderung schreibt
`project_auth.password_protection.changed` mit Schalter, Mindestlänge,
Wortlaut sowie Herkunft und Grösse der geltenden Liste; eine Ablehnung
schreibt `project_auth.password.refused` mit dem Grund — ohne Passwort, ohne
Digest und ohne Adresse.

### Der Mailweg, ehrlich gezeigt

Seit `2.51.0` sind **Auth → SMTP** und **Auth → E-Mail-Vorlagen** echte
Seiten — und beide **lesen nur**. Das ist keine halbe Arbeit, sondern die
richtige Antwort auf die Lage:

- **SMTP** steht in der Umgebung des Prozesses
  (`QKERN_PROJECT_AUTH_SMTP_HOST`, `_PORT`, `_SECURITY`, `_USERNAME`,
  `_PASSWORD`, `_SENDER` und `QKERN_PROJECT_AUTH_ACTION_BASE_URL`), nicht in
  der Datenbank und nicht je Projekt. Der Dienst liest die Werte beim Start
  und baut daraus seinen Adapter. Ein Formular in der Console hätte nichts,
  wohin es schreiben könnte; also gibt es keines. Die Seite zeigt je Wert
  seine Herkunft — aus der Umgebung, Vorgabe des Dienstes oder nicht gesetzt —
  und sagt in ganzen Sätzen, dass die Einstellung woanders liegt. **Das
  Passwort geht nie hinaus**, auch nicht gekürzt, und es gibt keine
  zusammengesetzte Verbindungszeichenkette. Gezeigt wird nur, **ob** sich der
  Dienst anmeldet. Ohne konfigurierten Host bleibt der Weg fail-closed: Eine
  Produktion ohne Mailkonfiguration gibt gar kein Aktionstoken aus, statt
  Mails still fallen zu lassen.
- **Vorlagen** gibt es nicht. Die drei Aktionsmails — Adresse bestätigen,
  Magic Link, Passwort zurücksetzen — haben einen festen Text im Quelltext,
  auf Englisch, ohne Sprachvarianten. Die Seite zeigt diesen Text, und zwar
  aus derselben Funktion, die ihn versendet (`projectAuthMailBody` in
  `lib/server/project-auth/smtp-delivery.ts`), damit die Ansicht nicht vom
  Versand abweichen kann. Der gezeigte Link ist ein Beispiel; ein echtes
  Token steht dort nie. **Ändern heisst: Quelltext ändern und ausliefern.**
  Ein Editor, der in nichts schreibt, wäre schlimmer als diese Auskunft.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/auth/admin/mail`
— dieselbe Tür wie die übrigen `admin/*`-Routen, `Cache-Control: private,
no-store`, und **nur GET**: kein PUT, kein POST, kein PATCH, kein DELETE.

### Anmeldungen als Reihe und als Protokoll

Seit `2.47.0` sind **Berichte → Auth** und **Logs → Auth** echte Ansichten.
Beide lesen dasselbe: das Project-Auth-Audit aus `audit_logs`, das Release 2.35
eingeführt hat. Der alte Hinweis auf dem Platzhalter — „Kein Zähler dafür“ —
war seitdem falsch.

Die Reihe entsteht **in der Datenbank** (`date_trunc`, `GROUP BY`, `ORDER BY`,
ein `LIMIT`, jeder Wert ein Parameter): je Eimer und Handlung eine Gruppe mit
Anzahl und Fehlversuchen. `date_trunc` rechnet ausdrücklich in UTC, sonst
hängen die Eimergrenzen an der Zeitzone der Verbindung. Die leeren Eimer füllt
der reine Teil (`lib/server/project-auth/audit-series.ts`), nicht SQL: So liest
die Datenbank nur, was wirklich da ist.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/auth/admin/audit/series?bucket=<hour|day>`
— dieselbe Tür wie `admin/audit`: Console-Session mit `project_auth_admin`,
`Cache-Control: private, no-store`. Ein unbekannter Wert, eine zweite Angabe
desselben Parameters und jeder fremde Parameter sind ein 400, vor jedem
Dienstaufruf. Ohne eingerichteten Audit-Sink kommt ein 503 mit
`Project Auth audit is not configured`; eine leere Reihe hiesse „es hat sich
niemand angemeldet“, und das wäre gelogen.

Das Fenster steht nicht im Aufruf, sondern folgt der Eimergrösse: 48
Stundeneimer oder 90 Tageseimer, endend mit dem laufenden und darum noch
unvollständigen Eimer. Die Antwort nennt `windowStart`, `windowEnd`, `bucket`,
`bucketCount` und `truncated`; jeder Eimer des Fensters steht darin, ein leerer
als Null.

Gezählt werden die zehn Handlungen, die der Dienst wirklich schreibt
(`project_auth.signup.succeeded` bis `project_auth.mfa.enforcement_changed`), dazu
`other` für eine `project_auth.*`-Handlung, die diese Fassung noch nicht kennt.
Sie wegzulassen würde die Summe fälschen.

| Seite | Was sie zeigt | Was sie nicht zeigen kann |
| --- | --- | --- |
| Berichte → Auth | Handlungen je Abschnitt, nach Art und Ausgang getrennt | wie viele Token ausgegeben wurden — eine Token-Ausgabe und ein Refresh werden nicht protokolliert |
| Logs → Auth | die neuesten 50 Einträge mit Zeit, Handlung, Ausgang und Referenz | Magic Links, E-Mail-Adressen und TOTP-Codes — sie stehen in keinem Eintrag |

Das Bild ist dasselbe Balkendiagramm aus einer reinen Funktion
(`lib/console/usage-series-chart.ts`) wie bei den Nutzungsreihen, ohne neue
Abhängigkeit und ohne eigene Farbe; daneben stehen dieselben Zahlen als
Tabelle. Das Protokoll liest fünf Felder und kein sechstes: Zeit, Handlung,
Art des Akteurs, Ausgang und die schon bereinigte Referenz. Adressen, Token und
Schlüssel kommen dort ohnehin nie an, weil `sanitizeProjectAuthAuditEvent` sie
gar nicht erst in die Kette lässt.

### Was ein angemeldeter Nutzer darf

Seit `2.54.0` ist **Auth → Policies** keine Platzhalterseite mehr. Der
Platzhalter sagte, hier stehe die gleiche Lage wie unter Datenbank →
Policies. Genau das tut die Seite nicht, denn eine Policy-Liste beantwortet die
Frage nicht, die man von der Anmeldung aus stellt: **Was darf ein angemeldeter
Nutzer dieses Projekts wirklich lesen und schreiben, und warum?** Sie liest eine
Route:

```
GET /api/v1/projects/{projectId}/environments/{environment}/auth/access?schema=public
```

Dieselbe Tür wie `/schema/policies` (Session mit Leserecht oder scope-gebundener
Projekt-Key), dieselbe Fehlerabbildung, dieselbe Prüfung des einen Parameters
`schema`, `Cache-Control: private, no-store`. Nur lesend.

**Die Abbildung steht oben, nicht im Kleingedruckten.** Ohne sie sagt eine
Policy-Liste niemandem etwas: Eine Policy nennt Rollen, und welche Rolle eine
angemeldete Anfrage ist, steht nicht in ihr.

* **Die Datenbankrolle.** Eine angemeldete Anfrage wird *keine* eigene
  Datenbankrolle. Jede Anfrage der Data API läuft über die eine Anwendungsrolle
  dieser Umgebung, und die Seite nennt sie mit Namen. Es gibt kein `SET ROLE`,
  und vor jeder Anweisung prüft der Server, dass diese Rolle kein Superuser ist,
  Row Level Security nicht umgehen darf und in keiner Gruppenrolle steckt.
* **Die Claims.** Wer angemeldet ist, steht nur im Access Token: `role` ist
  immer `authenticated`, `sub` ist die Nutzer-ID, dazu `email`,
  `email_verified`, `aal`, `session_id`, `user_metadata` und `app_metadata`.
* **Die Einstellungen.** Vor der Anweisung setzt der Server vier Einstellungen,
  jede nur für diese Transaktion: `request.jwt.claims` mit allen Claims als
  JSON, `request.jwt.claim.role`, `request.jwt.claim.sub` und
  `qkern.actor_ref`. Eine Policy liest sie mit `current_setting`; das ist der
  einzige Weg, auf dem eine Bedingung von der Anmeldung erfahren kann.
* **Row Level Security bleibt an.** Jede Transaktion setzt `row_security = on`,
  eine Leseanfrage läuft als `BEGIN READ ONLY`. Ein Service Key ändert daran
  nichts: Er trägt nur einen anderen `role`-Claim, nämlich `service_role`, und
  umgeht keine Policy.
* **Dieselben Claims an der Realtime-Tür.** Welchen Kanal jemand abonnieren
  darf, entscheiden dieselben zwei Claims. `anon` darf nur `public:`-Kanäle,
  `authenticated` dazu `private:`-Kanäle und genau den eigenen Kanal
  `user:<sub>`; in `changes:`-Kanäle darf niemand senden, weil nur der Server
  sie füllt.

Darunter steht je Tabelle des Schemas ein Urteil in Worten, und je Befehl
(SELECT, INSERT, UPDATE, DELETE) eine Antwort. Abgeleitet wird das in einem
reinen Modul (`lib/server/data-plane/auth-access-rules.ts`), das ohne Datenbank
prüfbar ist:

| Urteil | wann |
| --- | --- |
| `refused` | Row Level Security ist aus. Die Data API **verweigert die Tabelle vollständig** (`GENERATED_DATA_API_RLS_REQUIRED`) — sie wird dadurch nicht offen, sondern unerreichbar. |
| `locked` | Row Level Security ist an, aber keine Policy gilt für die Anwendungsrolle. Lesen gibt null Zeilen, Schreiben wird abgewiesen. |
| `open` | Eine permissive Policy für PUBLIC erlaubt das Lesen ohne Bedingung. Dann sieht auch ein Public Key die Zeilen. |
| `writable` | Mindestens eine Policy erlaubt INSERT, UPDATE oder DELETE. |
| `readable` | Gelesen werden darf, geschrieben nicht. |

Eine Policy gilt für eine angemeldete Anfrage nur, wenn sie `PUBLIC` oder die
Anwendungsrolle nennt. Jede andere steht mit Namen da und trägt `applies: false`
— sichtbar, aber folgenlos. Eine restriktive Policy erlaubt nie etwas; sie engt
ein, was die permissiven zusammen erlauben.

**Was das Urteil nicht wissen kann, sagt es in der Zeile, um die es geht.** Eine
Bedingung, die `current_setting`, `current_user`, `session_user` oder irgendeine
Funktion liest, heisst `request`: Sie kann bei einer Anfrage zutreffen und bei
der nächsten nicht. Der Befehl heisst dann `sometimes` statt `always`, und die
Tabelle trägt `uncertain: true`. Eine Bedingung, die nur Spalten vergleicht,
heisst `constant` — welche Zeilen sie erfasst, entscheidet der Inhalt der
Tabelle, und diese Seite liest keine Zeile. Es gibt dafür bewusst keine
Fussnote am Seitenende.

Views stehen nicht in der Liste. Sie tragen keine eigene Policy; die Data API
nimmt eine View nur mit `security_invoker` an und liest sie dann unter den
Policies der Tabellen darunter. Wie viele Views es gibt, sagt die Antwort als
Zahl.

Ändern lässt sich hier nichts: Eine Policy anzulegen, zu ändern oder zu löschen
und Row Level Security einzuschalten sind Schemaänderungen und gehen über ein
Change Set mit Freigabe. Die Route hat kein Schreibverb, die Ansicht kein
Eingabefeld. Wer eine einzelne Regel im Wortlaut sucht, findet sie weiter unter
**Datenbank → Policies**; diese Seite fasst zusammen, was aus allen Regeln
zusammen folgt.

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

### Speicherobjekte und ihr Urteil

Seit `2.49.0` ist **Logs → Storage** keine Platzhalterseite mehr — und heisst
trotzdem etwas anderes, als sie liefert. Der Platzhalter versprach „Uploads,
Downloads und Scanner-Urteile je Objekt". Zwei der drei Dinge gibt es nicht:
**QKERN führt kein Zugriffsprotokoll je Objekt.** Ein Upload hinterlässt die
Reservierung in `project_storage_uploads`, die beim Abschluss zur Objektzeile
wird; ein Download hinterlässt nur eine kurzlebige signierte Adresse und sonst
nichts. Die einzige dauerhafte Tatsache über ein Objekt ist seine Zeile in
`project_storage_objects` aus Migration `0025`: Bucket, Schlüssel, Grösse,
Typ, Eigentümer, der aktuelle Stand (`quarantined`, `clean`, `infected`) und
drei Zeitpunkte — Anlage, geplante Löschung, vollzogene Löschung. Die Ansicht
zeigt genau das und sagt es vor der ersten Zeile selbst.

Entfernte Objekte bleiben in der Liste. Das ist kein Versehen: Ein befallenes
Objekt bekommt beim Urteil im selben Schritt sein `deleted_at`, und wer nur
die lebenden Zeilen liest, sieht nie ein einziges `infected` und hält das für
eine saubere Umgebung.

Die Route ist
`GET /api/v1/projects/{projectId}/environments/{environment}/storage/objects`
mit derselben Berechtigung wie die übrigen Console-Routen von Storage
(`project_storage_admin`), `Cache-Control: private, no-store` und genau vier
Parametern: `bucket` (Id oder Name, unbekannt ist ein 404), `status`, `cursor`
und `limit` (1 bis 100, ohne Angabe 50). Jeder fremde Parameter, jede zweite
Angabe desselben Parameters und jeder Wert ausserhalb der Grenzen sind ein
400. Die Seitenfolge läuft über den Schlüssel `<Millisekunden>.<Uuid>`,
neueste zuerst. Ist der Object Storage abgeschaltet, kommt ein 503 mit
`Project Storage is disabled`, und die Ansicht sagt das, statt eine Liste zu
erfinden.

**Nie ein Provider-Schlüssel, nie eine Prüfsumme, nie eine signierte Adresse
und nie der Inhalt eines Objekts.** Signieren bleibt ein eigener Weg
(`storage/buckets/{bucketId}/downloads`) unter Storage → Buckets.

Ebenfalls seit `2.49.0` ist **Berichte → Realtime** echt. Es ist dieselbe
Ansicht wie die drei Zeitreihen aus `2.45.0`, nur mit der Metrik
`realtime_messages` aus Migration `0028`. Auch hier sagt die Seite, was sie
nicht zeigt: Wie viele Verbindungen offen waren und welche Kanäle sie
abonniert hatten, steht in keinem Nutzungsereignis — gemessen wird die
zugestellte Nachricht, nicht die Verbindung.

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

### Datenbank-Webhooks

Seit `2.50.0` ist **Integrationen → Datenbank-Webhooks** keine Platzhalterseite
mehr: Eine Änderung an einer Tabelle der Projektdatenbank löst einen
ausgehenden, signierten Webhook aus.

**Die Kopplung ist der vorhandene Änderungs-Feed.** QKERN beobachtet
Tabellenänderungen seit `db/project/0003` über `qkern_internal.change_feed` und
den Trigger `qkern_internal.capture_change()`; Realtime liest diesen Feed.
Datenbank-Webhooks lesen **denselben** Feed. QKERN legt dafür keinen
zusätzlichen Trigger und keine zusätzliche Funktion in Ihrer Datenbank an.

Der verworfene Gegenentwurf wäre ein eigener Trigger über ein Change Set
gewesen. Er hätte zwei Erfassungswege nebeneinander gestellt, mit zwei
Zusicherungen darüber, was eine erfasste Änderung trägt — und genau diese
Zusicherung ist der Grund, warum die Fläche sicher ist. Dazu hätte jede Tabelle
zwei Trigger für dieselbe Beobachtung getragen.

Daraus folgt eine Grenze, die offen dasteht: **Eine Tabelle ohne
Änderungserfassung erzeugt keine Zustellung.** Das Anschalten je Tabelle ist
eine Schemaänderung und läuft über ein Change Set und die Freigabezentrale —
derselbe Weg, den Realtime dafür schon nimmt.

**Was eine Zustellung trägt.** Genau das, was der Feed hält:

```json
{
  "schema": "public",
  "table": "bestellungen",
  "operation": "insert",
  "key": { "id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" },
  "position": 4711,
  "committedAt": "2026-09-26T19:00:00.000Z"
}
```

**Was sie nicht trägt:** keinen weiteren Spaltenwert, kein Bild der Zeile vor
der Änderung, keines danach, keine Liste der geänderten Spalten und keine
Claims eines Nutzers. Der Feed speichert diese Werte gar nicht; Realtime liest
die Zeile je Abonnent frisch unter dessen Rechten, und Row Level Security
autorisiert und erzeugt die Nutzlast in einem Schritt. Ein Empfänger im Internet
hat keine solchen Rechte — die Zeile für ihn zu lesen hieße, die
Sichtbarkeitsfrage außerhalb der Datenbank zu beantworten.

Der Primärschlüssel geht mit, sonst könnte ein Empfänger nichts anfangen. Er
ist ein Zeilenwert, und das ist die eine bewusste Offenlegung: Der Empfänger
erfährt, dass es eine Zeile mit diesem Schlüssel gibt, auch bei einem `delete`.
Dieselbe Vertrauensstufe räumt der Feed `service_role`-Abonnenten schon ein, und
das Ziel hat ein Projektadministrator zusammen mit einer Vault-Referenz
eingetragen.

**Signiert wird wie jeder andere ausgehende Webhook**: HMAC-SHA256 über
`<zeitstempel>.<körper>`, Schlüssel aus dem Vault, `x-qkern-signature:
v1=<signatur>;key=<keyId>`. Gespeichert wird ausschließlich die **Referenz**.
QKERN zeigt den Wert eines Signaturgeheimnisses nirgends an — weder in der
Console noch über eine Route.

**Die Routen**, mit `project_compute_admin` und `Cache-Control: private,
no-store` wie die benachbarten Definitionsrouten:

- `GET /api/v1/projects/{projectId}/environments/{environment}/compute/database-webhooks`
- `POST` auf dieselbe Route legt an. Ziel, Tabelle, Ereignisse und Referenz sind
  danach unveränderlich; eine Änderung ist Neuanlegen.
- `GET` und `PATCH` auf
  `.../compute/database-webhooks/{databaseWebhookId}`; `PATCH` nimmt nur
  `{ "enabled": true | false }`.

**Kein DELETE.** Löschen nähme über den Fremdschlüssel die wartenden
Zustellungen mit; dieser Verlust braucht eine eigene, bewusste Fläche.
Abschalten leistet, was der Alltag braucht: Es erzeugt keine neuen Zustellungen
mehr, hält die wartenden an, statt ihre Versuche zu verbrennen, und ist
rücknehmbar.

Der Zustellstatus steht unter
`.../compute/webhooks/{webhookId}/deliveries` — dieselbe Liste wie für jeden
anderen ausgehenden Webhook, weiterhin **ohne Nutzlast**. Die Console zeigt die
letzten fünf je Kopplung.

Datenbank: Migration `0049_project_database_webhooks.sql` hält die Kopplung.
Die ausgehende Definition, die Outbox, die Lease, das Backoff und der Dead
Letter bleiben in `0032`.

### Log-Drains

Seit `2.54.0` ist **Einstellungen → Log-Drains** keine Platzhalterseite mehr:
QKERN leitet Logs an ein fremdes Ziel weiter, etwa an einen Log-Dienst oder ein
SIEM.

**Die eine harte Grenze.** Ein Drain trägt genau die Felder, die die Console
für dieselbe Quelle schon zeigt, und kein einziges mehr. Ein Drain, der rohe
Anwendungslogs an einen fremden Dienst schickt, ist ein Datenleck mit
freundlichem Namen: Die Adresse eines Endnutzers, eine Nutzlast oder ein
Geheimnis verlässt dabei die Plattform, und niemand bemerkt es, weil das Ziel ja
bestellt war.

Die Grenze steht als Feldliste je Quelle in `lib/console/log-drains` und hängt
an einem Vertrag: `tests/log-drain-field-boundary` liest die Console-Ansicht
jeder Quelle und verlangt für **jedes** weitergeleitete Feld einen Eintrag in
ihrer Projektion. Ein Feld mehr lässt den Lauf scheitern. Durchgesetzt wird sie
zur Laufzeit von einer Whitelist: `projectLogDrainEntry` geht die deklarierten
Feldnamen durch und nimmt nur, was dort steht — ein Leser, der versehentlich
eine Spalte mehr liest, kann sie nicht weiterleiten.

**Die Quellen und ihre Felder.**

| Quelle | Felder | Zurückgehalten |
| --- | --- | --- |
| `auth_audit` | `id`, `createdAt`, `action`, `actorType`, `resourceRef`, `status` | `actorRef`, `metadata` |
| `function_invocations` | `functionId`, `functionName`, `invocationId`, `startedAt`, `durationMs`, `outcome`, `statusCode`, `errorCode` | `invokedBy` |
| `storage_objects` | `id`, `bucketName`, `key`, `sizeBytes`, `contentType`, `status`, `createdAt`, `deleteAfter`, `deletedAt` | `bucketId`, `ownerSubject` |
| `webhook_deliveries` | `id`, `eventType`, `status`, `attemptCount`, `lastFailureCode`, `occurredAt`, `settledAt` | Nutzlast, Ziel-Adresse |
| `usage_series` | `metric`, `bucket`, `start`, `accepted`, `rejected`, `events` | Einzelereignisse |

Drei Felder zeigt die Console und ein Drain trägt sie trotzdem nicht:
`invokedBy` und `ownerSubject` sind Akteursreferenzen und dürfen nach `0045`
und `0025` bis zu 320 Zeichen lang sein — eine E-Mail-Adresse passt hinein, und
an ein fremdes Ziel gehört sie nicht. `bucketId` ist eine interne Kennung, die
der Bucket-Name lesbar ersetzt. Das Auth-Protokoll hat dieses Problem nicht:
Der Sanitizer aus `2.35.0` verbietet in jeder Referenz `@` und `qk_` und wirft,
bevor irgendein Sink schreibt.

**Warum das Cron-Log nicht auf der Liste steht.** Es ist kein gespeichertes Log.
Es wird bei jeder Anfrage aus dem Ausdruck, dem Dedupe-Fenster und den
vorhandenen Nachrichten rekonstruiert, und der Zustand eines Vorkommens ändert
sich danach noch. Weiterleiten hieße, dasselbe Vorkommen mehrfach mit
wechselndem Zustand zu senden und einem Empfänger einen Ereignisstrom zu
versprechen, den es nicht gibt. Aus demselben Grund gehen von
`webhook_deliveries` nur **abgeschlossene** Zustellungen und von `usage_series`
nur **abgeschlossene** Stunden hinaus.

**Was eine Ladung trägt.** Eine Hülle mit der Fassung des Vertrags, der Quelle,
der Anzahl und den Einträgen — ohne Ziel, ohne Referenz, ohne Geheimnis:

```json
{
  "schemaVersion": 1,
  "source": "auth_audit",
  "count": 2,
  "entries": [
    {
      "id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
      "createdAt": "2026-09-27T09:00:00.000Z",
      "action": "project_auth.sign_in",
      "actorType": "app_user",
      "resourceRef": "project_auth_user:7b1c…",
      "status": "succeeded"
    }
  ]
}
```

**Zugestellt wird über den vorhandenen Webhook-Weg.** Es gibt keinen zweiten:
dieselbe Outbox mit Lease aus `0032`, dieselbe serverberechnete Wartezeit,
dieselbe Versuchsgrenze, dasselbe Dead Letter, derselbe `HmacWebhookSigner`
über den Vault und dieselbe Zielregel `isDeliverableWebhookTarget`. Ein zweiter
Zustellweg wäre eine zweite Stelle, an der die Regeln für ausgehende
Verbindungen auseinanderfallen könnten — und die erste, an der es niemand
merkt. Gebündelt wird nach Anzahl **oder** Alter: Die Anzahl hält die Last
klein, das Alter verhindert, dass eine ruhige Umgebung ihre letzten Einträge
stundenlang liegen lässt.

**Die eigenen Zustellungen bleiben draußen.** Die Quelle `webhook_deliveries`
überspringt jede Zustellung, die zu einem Log-Drain gehört. Ohne diese Bedingung
erzeugte jede weitergeleitete Ladung eine neue Zustellzeile, die beim nächsten
Lauf wieder weitergeleitet würde.

**Keine Lückenlosigkeit.** Der Stand des Sammlers steht im Prozess, nicht in der
Datenbank. Ein Neustart beginnt an der Gegenwart, statt die Vergangenheit
nachzuschicken, und ein abgebrochener Lauf kann eine Ladung doppelt senden. Wer
eine beweisbare Kette braucht, liest das Audit-Log, das sie hat.

**Die Routen**, mit `project_compute_admin` und `Cache-Control: private,
no-store` wie die benachbarten Definitionsrouten:

- `GET /api/v1/projects/{projectId}/environments/{environment}/compute/log-drains`
- `POST` auf dieselbe Route legt an. Ziel, Quellen und Referenz sind danach
  unveränderlich; eine Änderung ist Neuanlegen.
- `GET` und `PATCH` auf `.../compute/log-drains/{logDrainId}`; `PATCH` nimmt nur
  `{ "enabled": true | false }`.

Ein Feld für eine Feldauswahl, einen Filter oder eine Nutzlast gibt es in
keinem dieser Körper. Wäre es wählbar, wäre die Grenze verhandelbar.

**Kein DELETE**, aus demselben Grund wie bei den Datenbank-Webhooks: Löschen
nähme über den Fremdschlüssel die wartenden Ladungen mit. Abschalten hält sie
an, ohne etwas zu verlieren, und ist rücknehmbar.

Das Signaturgeheimnis liegt im Vault; gespeichert wird ausschließlich die
**Referenz**. Sie erscheint unter Integrationen → Vault als Benutzer der Sorte
Webhook, weil ein Drain eine ausgehende Definition aus `0032` besitzt.

Datenbank: Migration `0054_project_log_drains.sql` hält die Kopplung samt der
festen Quellenliste. Die ausgehende Definition, die Outbox, die Lease, das
Backoff und der Dead Letter bleiben in `0032`.

### Eigene Darstellung der Console

Seit `2.55.0` ist **Einstellungen → Dashboard** keine Platzhalterseite mehr. Die
Seite stellt fünf Dinge ein, und alle fünf wirken: die Sprache der Console, das
Gebietsschema für Datum, Uhrzeit und Zahlen, die Zeitzone, die Ansicht, auf der
die Console öffnet, und das helle oder dunkle Aussehen. Sie gehören zum Konto,
nicht zum Projekt und nicht zur Organisation.

**Der Punkt ist nicht das Speichern, sondern das Wirken.** Vor `2.55.0` hatte die
Console rund vierzig Stellen, die selbst formatierten — jede mit `de-CH` fest im
Code und jede stillschweigend in der Zeitzone des Browsers. Die Console sprach
also vier Sprachen, zeigte ihre Zahlen und Zeitpunkte aber in einer, und welcher
Tag in einer Logzeile stand, entschied der Rechner des Betrachters: 22:30 UTC am
24. ist in Zürich der 25. und in New York der 24., und die Seite sagte nie, in
welcher Zone sie rechnet.

Alle diese Stellen laufen jetzt durch `lib/console/display-settings`, gebunden
über `components/console/console-display`. Der Vertrag
`tests/console-display-contract` liest jede Datei in `components/console` und
lässt dort weder `Intl.DateTimeFormat` noch `Intl.NumberFormat`, weder
`toLocale*` noch `toFixed` zu. Die nächste Ansicht kann darum nicht wieder
abdriften.

**Die Vorgaben ändern nichts.** `language: browser` (Sprache weiter aus dem
Locale-Cookie), `formatLocale: de-CH`, `timeZone: browser` (es wird keine Zone
gesetzt, also rechnet `Intl` wie bisher), `startView: overview`, `theme: system`.
Wer nichts einstellt, sieht Zeichen für Zeichen dasselbe wie vor `2.55.0`; ein
eigener Testfall vergleicht jede Form gegen genau den Ausdruck, der vorher an
der jeweiligen Stelle stand.

**Zwei Dinge ändern sich bewusst nicht mit.** Geldbeträge bleiben im Format des
Ledgers (`de-CH`, auf Rappen abgerundet, Regel aus `2.37.0`): Was die Console als
Betrag zeigt, muss der Rechnung gleichen, und eine Rechnung wird im Format des
Ledgers gestellt, nicht in dem des Betrachters. Und ein Kalendertag wie ein
Gültigkeitsdatum einer Rolle oder eine Rechnungsperiode bleibt ISO — er hat
keine Uhrzeit, in die sich eine Zeitzone umrechnen liesse.

**Die Vorschau** rechnet mit demselben reinen Modul, das jede andere Ansicht
benutzt. Was dort steht, steht nach dem Speichern wirklich überall; der
Geldbetrag steht absichtlich daneben, damit man auf derselben Seite sieht, dass
er sich nicht mitändert.

**Route.** `GET` und `PUT` auf `/api/v1/auth/console-settings`, durch dieselbe
Tür wie die übrigen Kontorouten: Session-Cookie, kein Organisationsbezug,
`Cache-Control: private, no-store`. Ein fehlendes Feld nimmt die Vorgabe; ein
vorhandenes, aber unbrauchbares Feld wird mit `400` und dem Grund in Worten
abgelehnt und nie stillschweigend ersetzt. Kein `DELETE`: Zurückstellen heisst,
die Vorgaben zu schreiben.

Datenbank: Migration `0055_user_console_settings.sql` legt `user_console_settings`
neben `users` — nicht hinein. `users` ist die Tabelle der Anmeldung, und eine
Vorliebe dort abzulegen hiesse, der Anmelderolle ein `UPDATE` auf der Tabelle
mit den Passworthashes zu geben, damit jemand seine Zeitzone wechseln kann.
### Log-Explorer: suchen, ohne eine Abfragefläche zu öffnen

Seit `2.55.0` ist **Logs → Explorer** keine Platzhalterseite mehr. Der
Platzhalter versprach „Logs mit SQL durchsuchen, speichern, als Vorlage
ablegen". Eingelöst werden das Durchsuchen und das Speichern. **Das SQL nicht**,
und das ist die Zusage der Seite, nicht ihre Lücke.

**Warum kein SQL über die Logs.** Jede log-artige Quelle von QKERN liegt in der
**Control Plane**: das Auth-Protokoll in `audit_logs`, das Aufrufprotokoll in
`project_function_invocations` (`0045`), der Stand der Speicherobjekte in
`project_storage_objects` (`0025`), die Zustellungen in
`project_webhook_deliveries` (`0032`), die Nutzung in `usage_events` (`0028`).
Dort stehen die Zeilen **aller** Organisationen in denselben Tabellen, getrennt
allein durch `organization_id` und die Policies darüber.

Der SQL-Editor der Console läuft nicht dort. Er läuft über
`environments/{environment}/query` gegen die **Projektdatenbank** — eine eigene
Datenbank je Projekt. Ein freier SQL-Weg dorthin ist vertretbar, weil das
Schlimmste, was eine falsche Abfrage sieht, die eigenen Daten sind. Dieselbe
Fläche über die Control Plane zu öffnen wäre etwas anderes: Sie hänge mit jeder
Zeile an einer einzigen Policy, und fällt die aus, gibt die Seite fremde Zeilen
heraus, ohne dass es der Abfrage anzusehen wäre. Die Ansicht sagt diesen Satz
wörtlich, statt ihn dem Betrieb zu überlassen.

**Was stattdessen gebaut ist.** Eine strukturierte Suche über Zeitraum, Quellen
und ein paar getypte Filter je Quelle. Beantwortet wird sie, indem der Server
die Lesewege fächert, die es für jede Quelle ohnehin gibt — dieselbe Tür,
derselbe Dienst, dieselbe Projektion — und die Ergebnisse zu **einer**
geordneten Liste zusammenführt. Es entsteht keine neue Lesestelle.

| Quelle | Vorhandene Route | Rolle |
| --- | --- | --- |
| `auth_audit` | `auth/admin/audit` | `project_auth_admin` |
| `function_invocations` | `compute/invocations` | `project_compute_admin` |
| `storage_objects` | `storage/objects` | `project_storage_admin` |

Wer eine Quelle heute nicht lesen darf, bekommt sie auch hier nicht: Sie
erscheint als **nicht lesbar**, und die übrigen bleiben nutzbar. Eine Quelle,
die nicht antwortet, nimmt die anderen ebenfalls nicht mit — gefächert wird mit
`allSettled`, nicht mit `all`.

**Die Ordnung.** Neueste zuerst nach Zeitpunkt, danach nach Quelle, danach nach
Kennung. Die beiden nachrangigen Kriterien sind kein Beiwerk: Ohne sie hänge die
Reihenfolge zweier Einträge derselben Mikrosekunde an der Antwortzeit zweier
Dienste, und Blättern zeigte einen Eintrag doppelt und einen nie. Jeder
Zeitpunkt wird auf eine Schreibweise gebracht (`YYYY-MM-DDTHH:mm:ss.sssZ`),
sonst wäre `…00.500Z` lexikografisch kleiner als `…00Z`.

**Das Leserbudget.** Je Quelle liest der Explorer höchstens fünf Seiten. Reicht
das für einen Zeitraum nicht, meldet die Quelle den Zustand `truncated`, statt
eine vollständige Antwort vorzutäuschen.

**Was der Explorer nicht erreicht**, und warum — die Seite zählt es selbst auf,
und die Antwort der Route tut es auch:

- **Webhook-Zustellungen**: lesbar nur je Webhook über dessen eigene Route. Eine
  Leseroute über alle Webhooks einer Umgebung gibt es nicht.
- **Nutzung je Zeitfenster**: aggregierte Eimer, keine Ereignisse. Ein Eimer hat
  keinen Zeitpunkt, an dem etwas passiert wäre.
- **Cron-Vorkommen**: kein gespeichertes Log, sondern je Anfrage rekonstruiert.
- **Ausgabe eines Function-Containers**: wird nicht gespeichert (`0045`).
- **Postgres-, Pooler-, Realtime- und API-Gateway-Log**: kein Backend.

**Gespeicherte Suchen** halten den strukturierten Filter — Zeitraum, Quellen,
getypte Filter —, nie eine Abfrage. Sie liegen in der Ablage des Browsers, je
Projekt und Umgebung. Eine Tabelle in der Control Plane bekommen sie bewusst
nicht: Eine Migration für eine Bequemlichkeit, die eine Person auf einem Gerät
benutzt, wäre außer Verhältnis, und geteilt werden muss eine gespeicherte Suche
nicht.

**Die Route**, mit `Cache-Control: private, no-store`:

- `GET /api/v1/projects/{projectId}/environments/{environment}/logs/search`
- Parameter: `sources`, `from`, `to`, `limit` (1 bis 100), `before` und die
  getypten Filter `authStatus`, `authActor`, `outcome`, `objectStatus`.
- Jeder unbekannte Parameter, jede zweite Angabe desselben Parameters und jeder
  Filter ohne seine Quelle sind ein **400 vor jedem Dienstaufruf**. Ein
  Tippfehler wäre sonst eine Suche ohne diesen Filter, und die Antwort sähe
  richtig aus.
- Kein Schreibverb, kein Feld für einen Ausdruck.

Eine gemischte Zeile trägt sechs Felder: Quelle, Kennung, Zeitpunkt, Handlung,
Gegenstand, Ausgang und einen kurzen getypten Zusatz. Nicht dabei sind die
Aufruferreferenz eines Function-Aufrufs und der Eigentümer eines
Speicherobjekts — beide können eine E-Mail-Adresse sein, und in einer
gemischten Liste haben sie nichts zu suchen.

Keine Migration. Der Schnitt liest nur, und zwar durch vorhandene Türen.

### Vault: was QKERN kennt, und was es nicht kennt

Seit `2.52.0` ist **Integrationen → Vault** keine Platzhalterseite mehr. Der
Platzhalter versprach „Geheimnisse verwalten". Verwaltet wird dort nichts, und
das ist die Zusage der Seite, nicht ihre Lücke: **QKERN zeigt nie einen
Geheimniswert und nimmt nie einen über die Console entgegen.** Ein Formular, das
ein Geheimnis entgegennimmt, trägt es durch einen Browser, ein Anfrageprotokoll
und einen Prozess, die es nichts angeht.

**Was die Seite zeigt.** Jede Secret-Referenz, auf die QKERN in dieser Umgebung
selbst zeigt, mit der Stelle, die sie benutzt, und dem Urteil des Vaults:
**vorhanden**, **fehlt** oder **kein Zugriff**. Drei Quellen gibt es heute:

| Quelle | Woher die Referenz kommt |
| --- | --- |
| Function | `secretRefs` der Function-Definition |
| Webhook | `signingSecretRef` des ausgehenden Webhooks aus `0032` |
| Datenbank-Webhook | `signingSecretRef` der Kopplung aus `0049` (seit `2.50.0`) |

Gruppiert wird nach der **Referenz**: Ein Geheimnis, das zwei Webhooks signiert,
steht in einer Zeile, und beide Benutzer stehen darin. Ein Datenbank-Webhook
besitzt zusätzlich eine ausgehende Definition aus `0032`; diese Definition
erscheint nicht ein zweites Mal als eigener Benutzer, sonst stünde dieselbe
Referenz unter zwei Namen da.

**Was die Seite nicht zeigen kann.** Sie listet den Vault **nicht** auf. Ein
Geheimnis, auf das nichts in QKERN zeigt, erscheint hier nicht — ohne eine
Auflistung kann QKERN es nicht kennen, und ein Verzeichnis fremder Vault-Pfade
in einer Web-Konsole wäre genau die Offenlegung, die diese Seite vermeidet: Wer
die Console lesen darf, erführe damit die Struktur des Schlüsselspeichers, ohne
je eine Vault-Policy dafür bekommen zu haben. Die Seite sagt diesen Satz
wörtlich, statt eine Vollständigkeit zu behaupten, die sie nicht hat.

**Was ein Betreiber im Vault selbst tun muss.** Anlegen, Rotieren und Löschen
laufen über den Vault, etwa über `vault kv put`. Die Pfadregel, die QKERN
akzeptiert, ist dieselbe wie bei den Webhook-Signaturschlüsseln: `vault:` und
danach Segmente aus Buchstaben, Ziffern, `_` und `-`, durch `/` getrennt, jedes
Segment höchstens 64 Zeichen, unter dem fest konfigurierten KV-Mount. Kein
führender Schrägstrich, kein `..`, keine Query. Was nicht in diese Form passt,
gilt als **kein Zugriff** und wird nicht angefragt.

Die Policy des Tokens, mit dem die Console prüft, braucht genau eine Fähigkeit:

```hcl
path "secret/metadata/webhooks/*" { capabilities = ["read"] }
```

Der Zustellprozess signiert und liest dafür den Wert; sein Token braucht `read`
auf `<mount>/data/<pfad>`. Das sind bewusst zwei Tokens mit zwei Policies: Die
Console soll den Schlüssel nicht lesen können, den sie anzeigt.

Die Route dazu ist
`GET /api/v1/projects/{projectId}/environments/{environment}/compute/secrets`
mit derselben Berechtigung wie die übrigen Definitionsrouten
(`project_compute_admin`) und `Cache-Control: private, no-store`. Jeder
Query-Parameter ist ein 400, bevor irgendetwas gelesen wird. Die Antwort trägt
je Referenz `ref`, `status` und `users`, dazu die Zähler je Zustand und den
Prüfzeitpunkt `checkedAt` — kein Wert, keine Version, keine Metadaten. Es gibt
auf diesem Pfad keine schreibende Operation. Gefragt wird je **verschiedener**
Referenz genau einmal und ausschliesslich der Metadaten-Endpunkt von KV
Version 2.

Ist kein Vault konfiguriert, antwortet die Route mit 503 und dem Code
`VAULT_NOT_CONFIGURED`, und die Console zeigt „Vault nicht verbunden".
`VAULT_MISCONFIGURED` steht für eine halbe Konfiguration, `VAULT_UNAVAILABLE`
für einen Vault, der nicht oder nicht in der erwarteten Form geantwortet hat.

### Function-Aufrufe im Protokoll

Seit `2.51.0` ist **Logs → Functions** keine Platzhalterseite mehr. Der
Platzhalter versprach „Start, Ende und Fehler je Function-Aufruf, mit Dauer
und Ausgangsverbindungen“. Eingelöst wird davon das, was seit `1.89.0` in
`project_function_invocations` (Migration `0045`) wirklich steht.

**Was eine Zeile trägt:** den Beginn des Aufrufs, die Function, den Auslöser
(Projektschlüssel oder Administratorin), die Dauer in Millisekunden, den
Ausgang — `completed` oder `failed` — und entweder den HTTP-Status der Antwort
oder einen festen Fehlercode wie `FUNCTION_TIMEOUT`. Mehr nicht.

**Was sie nicht trägt, und warum:**

- **Keine Ausgabe des Containers.** stdout und stderr werden nicht
  gespeichert. Sie stammen aus fremdem Code und könnten alles enthalten, was
  die Function gesehen hat; das ist die Haltung aus `1.22.0` und sie gilt
  weiter. Die Platzhalterseite **Functions → Function-Logs** bleibt deshalb
  ein Platzhalter.
- **Keine Ausgangsverbindungen.** Jede Verbindung einer Function wird gegen
  ihre Allowlist geprüft, aber die Prüfung hinterlässt keine Zeile. Eine
  Liste der Ziele je Aufruf gibt es nicht, und diese Seite erfindet keine.
- **Kein eigenes Ende.** Es ergibt sich aus Beginn plus Dauer.
- **Keine Nutzlast** und **keine Fehlermeldung** aus Sandbox oder Datenbank.
  Im Fehlerfall steht ein fester Code, nie ein Text.

Das Protokoll ist append-only: `0045` hat weder eine UPDATE- noch eine
DELETE-Policy. Was gelaufen ist, lässt sich nicht umschreiben.

Die Lesefläche ist
`GET .../compute/invocations` mit `function`, `outcome`, `limit` (höchstens
200) und `offset` (höchstens 10 000). Jeder andere Parameter, jede doppelte
Angabe und jede Zahl ausserhalb der Form sind ein 400, bevor der Dienst
gerufen wird; die Antwort trägt `Cache-Control: private, no-store`. Die
Zählung je Ausgang ignoriert den Ausgangsfilter, damit die Seite neben
„nur fehlgeschlagene“ weiterhin sagen kann, wie viele Aufrufe es insgesamt
gab. Die ältere Route `.../compute/functions/{functionId}/invocations` aus
`1.89.0` bleibt daneben bestehen; sie liest eine einzelne Function.

### Abfrage-Leistung: was eine Abfrage kostet, ohne die Abfrage

Seit `2.56.0` ist **Observability → Abfrage-Leistung** keine Platzhalterseite
mehr. Die Seite liest `pg_stat_statements` in Ihrer Projektdatenbank und zeigt
je Kennung: Aufrufe, Gesamtzeit, mittlere Zeit, gelesene oder geschriebene
Zeilen und den Anteil an der Gesamtzeit aller gezeigten Statements. Sortiert
wird nach Gesamtzeit, absteigend.

**Den Abfragetext zeigt sie nicht**, auch nicht den normalisierten, und das
ist eine Entscheidung mit Grund. PostgreSQL ersetzt die Literale nur in
Abfragen. Ein Utility-Befehl wird nicht normalisiert: `CREATE ROLE … PASSWORD
'…'` steht mit seinem Passwort in der Sicht. Dazu trägt auch eine
normalisierte Abfrage noch Tabellen- und Spaltennamen, und die Eingrenzung auf
die eigene Datenbank ist eine Zeile SQL, die jemand entfernen kann.

Der Ersatz steht auf der Seite: Wer wissen will, warum eine bestimmte Abfrage
teuer ist, führt sie im SQL-Editor als Plan aus. Wer `pg_stat_statements` in
der Projektdatenbank nicht installiert hat, bekommt diesen Satz und keine
leere Liste.

### Abfrage-Einblicke: der Plan, ohne die Abfrage auszuführen

Seit `2.56.0` ist **Observability → Abfrage-Einblicke** keine Platzhalterseite
mehr. Sie holt den Plan einer lesenden Abfrage mit `EXPLAIN (FORMAT JSON,
COSTS ON, VERBOSE OFF, SUMMARY ON)` und zeigt je Knoten die Art, die
geschätzten Kosten, den Eigenanteil an den Gesamtkosten und eine Erklärung,
was dieser Knotentyp tut.

**`ANALYZE` wird nicht benutzt.** Mit `ANALYZE` würde ein Knopf in der Console
die Abfrage wirklich ausführen, und das ist eine andere Zusage als „zeig mir
den Plan“. Die Prüfung, dass die Abfrage nur liest, steht **vor** dem Präfix;
sonst käme `EXPLAIN ANALYZE DELETE FROM …` durch. Gelesen wird über dieselbe
Verbindung, dieselbe Rolle und dieselbe Transaktion `BEGIN READ ONLY` wie im
SQL-Editor.

**Die Bedingungstexte der Knoten bleiben in der Datenbank.** `Filter` und
`Index Cond` tragen die Literale Ihrer Abfrage; die Seite zeigt sie nicht und
sagt das. Die einzige wirklich gemessene Zahl ist die Planungszeit. Alles
andere ist die Schätzung des Planers, nicht die Wirklichkeit.

### Infrastruktur: worauf diese Umgebung läuft

Seit `2.56.0` ist **Einstellungen → Infrastruktur** keine Platzhalterseite
mehr. Die Seite beantwortet „worauf läuft das hier“ und nicht „wie ist es
eingestellt“; das Zweite steht unter Datenbank-Einstellungen.

Vom Server selbst kommen Version, Versionsnummer, Kodierung, Sortierung,
Zeichenklassen, Startzeit, Grösse der Datenbank und ob er gerade eine
Wiederherstellung fährt. Aus der Control Plane kommen die Region, der Zustand
des Projekts und die Umgebungen mit ihrer Datenbankreferenz. Die
Erweiterungen liest die Seite über die Route, die es dafür schon gibt.

**Lese-Replikate, Instanzgrösse und Platte gibt es nicht.** Das steht als
Zeile mit Grund da und nicht als leere Kachel: Die Provisionierung meldet
diese Angaben nicht, und die Seite erfindet sie nicht.

### Auth-Leistung: was scheitert, und seit wann

**Authentication → Auth-Leistung** ist keine Platzhalterseite mehr. Der
Platzhalter versprach „Antwortzeiten und Fehlerraten der Anmeldung“. Die eine
Hälfte davon gibt es, die andere nicht, und die Seite sagt das als Erstes.

**Antwortzeiten misst QKERN nicht.** Ein Eintrag der Audit-Kette hält den
Zeitpunkt einer Handlung fest, ihre Art, ihren Ausgang und eine Referenz. Eine
Dauer bräuchte einen zweiten Zeitpunkt derselben Handlung, und den schreibt
niemand. Es steht darum keine Millisekunde auf der Seite, auch keine
geschätzte.

**Die Fehlerrate je Handlungsart gibt es wirklich.** Die Seite liest dieselbe
Route wie Berichte → Auth (`admin/audit/series`, ein GET, kein Schreibverb)
und stellt eine andere Frage an dieselbe Antwort: nicht „wie viel wann“,
sondern „was scheitert, wie oft, und seit wann“. Gezeigt werden drei Dinge:

1. **Handlungen, Fehlschläge und ihr Anteil im Fenster**, 48 Stunden in
   Stundenschritten oder 90 Tage in Tagesschritten.
2. **Die Handlungsarten, die scheitern**, die häufigsten zuerst, jede mit
   ihrem Anteil und mit dem Abschnitt, seit dem sie scheitert. Sortiert wird
   nach der Zahl der Fehlschläge und nicht nach dem Anteil: Eine Art, die
   einmal vorkam und einmal scheiterte, hätte sonst den ersten Platz.
3. **Handlungen und Fehlschläge je Abschnitt.** Abschnitte ohne jede Handlung
   bleiben aus der Tabelle, und wie viele das sind, steht daneben.

Die Aufteilung nach Handlung ist neu, die Abfrage ist es nicht: Die Datenbank
gruppiert seit `2.47.0` nach Abschnitt **und** Handlung und zählt dabei die
gescheiterten je Gruppe mit. Bisher wurde diese Zahl beim Aufbau der Reihe zu
einer einzigen Summe je Abschnitt gefaltet und war danach weg; „die Anmeldung
scheitert“ und „der zweite Faktor scheitert“ waren darin nicht zu
unterscheiden. Es kommt für diese Seite keine Abfrage dazu.

**Ein Fehlschlag ist kein Angriff**, und das steht auf der Seite. Ein
vertipptes Passwort, ein abgelaufener Code, eine Uhr, die falsch geht, oder
eine App, die es nach dem Abmelden noch einmal versucht: All das erscheint
hier gleich. Was die Seite über die Ursache sagen kann, ist nichts. In keinem
Eintrag steht ein Grund, ein Fehlercode, eine Adresse, ein Gerät oder ein Ort,
und nachträglich lässt sich das auch nicht erfahren. Das „seit wann“ ist der
Beginn des Abschnitts, in dem der erste Fehlschlag liegt, nicht seine Minute;
feiner löst die Reihe nicht auf. Fällt es auf den ersten Abschnitt des
Fensters, kann es früher angefangen haben.

### Data API: kein Anfrageprotokoll

Seit `2.51.0` ist auch **Logs → Data API** keine Platzhalterseite mehr — und
die Seite sagt als Erstes, dass es das Versprochene nicht gibt. Der
Platzhalter nannte „jede Anfrage mit Rolle, Tabelle und Antwortzeit“.

**Eine solche Zeile schreibt niemand.** QKERN führt für die generierte Data
API kein Protokoll je Anfrage. An ihrer HTTP-Grenze wird **gezählt**, nicht
protokolliert: `admitApiRequest` legt ein Nutzungsereignis der Metrik
`api_requests` an, und das trägt eine Menge, einen Zeitpunkt, seine Quelle
und den Entscheid der Quota — keine Rolle, keine Tabelle, keinen Statuscode,
keine Dauer.

Die Seite zeigt deshalb genau zwei Dinge, jedes mit seinem Namen:

1. **Die Stundenreihe der Metrik `api_requests`** aus `2.45.0`. Sie ist
   ausdrücklich **keine** Zahl der Data-API-Anfragen: Unter derselben Metrik
   zählen auch Control Plane, Auth, Storage, Queues, Realtime und MCP mit. Das
   Ereignis trägt seine Quelle zwar in der Spalte `source`, die Aggregation
   gruppiert aber nur nach Metrik. Die Kurve ist eine Obergrenze.
2. **Die Freigabe der Data API** aus `2.32.0`: welche Tabellen im erzeugten
   OpenAPI-Dokument stehen. Das sagt, was möglich ist, nicht was geschehen
   ist.

**Was ein echtes Anfrageprotokoll bräuchte:** eine Zeile je Anfrage, erzeugt
an der HTTP-Grenze der generierten Data API, mit Rolle, Schema, Tabelle,
Operation, Statuscode und Dauer, dazu eine eigene Aufbewahrung und ein eigenes
Leserecht. Bevor es diese Zeile gibt, kann die Seite kein Log zeigen — und
auch dann trüge sie nie Filter, Werte oder gelesene Zeilen einer Anfrage.

#### Die Brücke laufen lassen

`2.50.0` hat die Brücke gebaut und zertifiziert — und niemanden gehabt, der sie
aufruft. Seit `2.53.0` betreibt sie der Compute-Prozess. Es ist derselbe
Prozess, der Cron auslöst und Webhooks zustellt; er liest jetzt zusätzlich den
Änderungs-Feed der Projektdatenbanken, die er bedient.

Anschalten ist ausdrücklich, aus demselben Grund wie bei Realtime Changes: Der
Prozess öffnet damit Verbindungen zu Kundendatenbanken. Der Katalog ist
**derselbe** wie für Realtime Changes und die Generated Data API — dieselbe
unprivilegierte Rolle in denselben Datenbanken, und `db/project/0003` erteilt
genau ihr das Leserecht auf dem Feed:

```powershell
$env:QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED="true"
$env:QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG="true"
$env:QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON='[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_api_app:local-only@127.0.0.1:5432/project_database","expectedRole":"qkern_project_api_app","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]'
npm run worker:compute
```

**Welche Umgebungen gelesen werden, steht nicht in der Konfiguration.** In
`QKERN_COMPUTE_SCOPES_JSON` stehen die Umgebungen, die dieser Prozess bedient;
welche davon die Brücke anfasst, fragt er alle
`QKERN_COMPUTE_DATABASE_WEBHOOK_DISCOVERY_MS` in der Control Plane nach. Eine
Umgebung ohne jede Kopplung sieht von der Brücke keine einzige Verbindung.

Eine Umgebung, deren Kopplungen **alle abgeschaltet** sind, wird weiter gelesen
— sie erzeugt dabei nichts, aber ihre Position wandert weiter. Das ist Absicht
und dieselbe Regel wie beim Abschalten einer einzelnen Kopplung: Abschalten ist
pausieren, nicht stauen. Ohne dieses Weiterlesen bekäme ein Empfänger beim
Wiedereinschalten auf einen Schlag alles, was der Feed seither hält.

**Die Position liegt in der Datenbank**, je Umgebung eine Zeile in
`0050_project_database_webhook_cursors.sql`. Sie wird erst fortgeschrieben,
nachdem die Zustellungen eines Stapels eingereiht sind, und sie kann nur
vorwärts. Damit wiederholt ein Neustart höchstens einen Stapel; er überspringt
nichts. Lieber eine Zustellung doppelt als eine verlorene — die Zustellung
trägt eine eigene Id, und `position` in der Nutzlast macht die Wiederholung für
den Empfänger erkennbar.

**Eine unerreichbare Projektdatenbank nimmt die anderen nicht mit.** Sie
bekommt eine Wartezeit, die sich mit jedem Fehlschlag verdoppelt (Grundwert
`QKERN_COMPUTE_DATABASE_WEBHOOK_ERROR_MS`, Obergrenze fünf Minuten); die
übrigen Umgebungen laufen weiter. Der Prozess meldet dabei
`compute.database_webhook_failed` mit einem festen Code und dem Index der
Umgebung in Ihrer Scope-Liste — keine Datenbankmeldung, keine Id, kein
Endpunkt. Ist die Datenbank zurück, läuft sie ohne Eingriff weiter.

Gelesen wird der Reihe nach, in der Reihenfolge Ihrer Scope-Liste, und immer
nur eine Umgebung gleichzeitig: So hält der Prozess zu jedem Zeitpunkt
höchstens **eine** Verbindung zu einer Projektdatenbank offen, und zwar nur für
die Dauer einer Abfrage. `QKERN_COMPUTE_DATABASE_WEBHOOK_MAX_BATCHES` begrenzt,
wie viel eine einzelne Umgebung je Runde aufholen darf; ohne diese Grenze
könnte eine Umgebung mit großem Rückstand die übrigen aushungern.

**Aufgeräumt wird hier nichts, und das ist keine Lücke.** Den Feed räumt die
Realtime-Aufbewahrung (`QKERN_REALTIME_CHANGE_RETENTION_MS`); die Brücke wüsste
nicht, was Realtime noch braucht. Die Zustellungen, die sie erzeugt, räumt die
vorhandene Webhook-Aufbewahrung im selben Prozess — sie unterscheiden sich in
nichts von jeder anderen Zustellung.

Der Prozess nennt die Brücke in seiner Startzeile. Ein Prozess, der sie stumm
laufen ließe, wäre von einem ohne sie nicht zu unterscheiden — und genau diese
Verwechslung war zwischen `2.50.0` und `2.52.0` der Zustand.

#### Den Log-Drain-Sammler laufen lassen

`2.54.0` hat die Log-Drains gebaut und zertifiziert — und denselben Fehler
wiederholt: Niemand rief den Sammler auf. Seit `2.55.0` betreibt ihn derselbe
Compute-Prozess, der Cron auslöst, Webhooks zustellt und den Änderungs-Feed
liest.

Anschalten ist ausdrücklich, aus demselben Grund wie bei der Brücke: Der
Prozess schickt damit Protokollzeilen an ein Ziel im Internet. Eine Verbindung
zu einer Projektdatenbank braucht er dafür **nicht** — alle fünf Quellen liegen
in der Control Plane:

```powershell
$env:QKERN_COMPUTE_LOG_DRAINS_ENABLED="true"
npm run worker:compute
```

**Welche Umgebungen gelesen werden, steht nicht in der Konfiguration.** In
`QKERN_COMPUTE_SCOPES_JSON` stehen die Umgebungen, die dieser Prozess bedient;
welche davon der Sammler anfasst, fragt er alle
`QKERN_COMPUTE_LOG_DRAIN_DISCOVERY_MS` in der Control Plane nach. Eine Umgebung
ohne jeden Drain sieht von ihm keine einzige Abfrage auf ihre Logs.

**Die Position liegt in der Datenbank**, je Drain **und** je Quelle eine Zeile
in `0056_project_log_drain_cursors.sql`. Je Drain, weil zwei Drains derselben
Umgebung verschiedene Quellen beliefern dürfen; eine gemeinsame Position hieße
für einen der beiden überspringen oder wiederholen. Sie wird erst
fortgeschrieben, nachdem eine Ladung eingereiht ist, und sie kann nur vorwärts.
Damit wiederholt ein Neustart höchstens eine Ladung; er überspringt nichts.

Ein **neuer** Drain beginnt an der Spitze seiner Quelle — er schickt dem
Empfänger nicht als erste Handlung das ganze bisherige Protokoll. Dieser
Anfangsstand wird sofort festgehalten, sonst spränge ein Neustart vor der
ersten Ladung auf die inzwischen gewachsene Spitze. Lässt sich die Position
eines Drains nicht lesen, **startet er nicht**: An der Spitze zu beginnen hieße
überspringen, am Anfang zu beginnen hieße das ganze Protokoll zu wiederholen.

**Ein gescheiterter Drain nimmt die anderen nicht mit.** Er bekommt eine
Wartezeit, die sich mit jedem Fehlschlag verdoppelt (Grundwert
`QKERN_COMPUTE_LOG_DRAIN_ERROR_MS`, Obergrenze fünf Minuten); die übrigen
Drains derselben Umgebung laufen weiter. Der Prozess meldet dabei
`compute.log_drain_failed` mit einem festen Code und dem Index der Umgebung in
Ihrer Scope-Liste — keine Datenbankmeldung, keine Id, kein Endpunkt. Ein
unerreichbares Ziel merkt der Sammler übrigens gar nicht: Er reiht ein, und die
Zustellung mit Backoff und Dead Letter ist Sache der vorhandenen Outbox.

Gebündelt wird nach Anzahl **oder** Alter
(`QKERN_COMPUTE_LOG_DRAIN_BATCH_ENTRIES`, `QKERN_COMPUTE_LOG_DRAIN_BATCH_AGE_MS`):
Die Anzahl hält die Last klein, das Alter verhindert, dass eine ruhige Umgebung
ihre letzten Einträge stundenlang liegen lässt. Beim Anhalten geht ein offener
Puffer **nicht** hinaus — er ist noch nicht eingereiht, seine Position ist noch
nicht festgehalten, und der nächste Start liest denselben Bereich erneut.

Die Console zeigt daraufhin je Drain, wann er zuletzt weitergeleitet hat und
bis zu welcher Position — und „noch nie", solange nichts hinausgegangen ist.
Der Prozess nennt den Sammler in seiner Startzeile.

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
