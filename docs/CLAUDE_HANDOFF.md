# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `2.73.0`. Sie wird
bei jedem versionierten Stand zusammen mit Quellcode, Status, Handbuch und Release
Note aktualisiert.

## Wichtigster Kontext für den nächsten Agenten

Bis `1.8.0-alpha.1` war **kein einziger Real-Service-Test jemals ausgeführt
worden**. Release 1.9 hat beide Docker-Zertifizierungsstacks zum Laufen gebracht
und dabei fünf Produktfehler gefunden, die nur unter einer realen Datenbank
auftreten. Zwei davon machten einen als fertig dokumentierten Pfad vollständig
funktionsunfähig.

Die Lehre daraus gilt weiter: **Ein grüner `npm test` ist keine Zertifizierung.**
Die Memory-Adapter kennen weder Rechtemodell noch RLS noch Transaktionsgrenze.
Wer einen dauerhaften Adapter anfasst, muss `npm run test:postgres:docker`
ausführen, bevor er ihn als funktionsfähig beschreibt.

## Verbindliche Lesereihenfolge

1. `AGENTS.md`
2. `STATUS.md`
3. `docs/CLAUDE_HANDOFF.md`
4. `docs/STUFENPLAN.md`
5. `docs/HANDBUCH.md`
6. `docs/USAGE_METERING.md`
7. `docs/PROJECT_QUEUES.md`
8. `docs/MODULES.md`
9. `docs/SECURITY.md`
10. `docs/QA.md`
11. `docs/SDK_TYPESCRIPT.md`
12. `docs/CLI.md`
13. `docs/DEVELOPER_EXPERIENCE.md`
14. `docs/RELEASE_1.9.md` und `docs/RELEASE_1.10.md`

Für Realtime-Arbeit zusätzlich `docs/REALTIME_PROTOCOL.md` lesen. Historische
Release Notes bleiben unverändert.

## Aktueller technischer Stand

### Einstiegsdoku (Stand 26. September 2026, abends)

Spec und Plan unter `docs/superpowers/`. Schritt 1 (Deutsch, Website,
Vertraege, Durchlauf) kam mit 2.30, Schritt 2 (Uebersetzungen) mit 2.31,
Schritt 3 (Pflege) steht in `docs/DOCS_MAINTENANCE.md`. Das Repository ist
oeffentlich. Offen aus dem Plan: nichts. Naechste Kandidaten: die
verbliebenen Konsolen-Platzhalter (Abrechnung, Data-API-Einstellungen),
Sessions/Audit/Secrets gegen lokale Dienste, Schemanamen mit
Grossbuchstaben.

- Neu in diesem Zweig: 2.119 (Zweig `slice/addons`) **Eine Rechnungsposition
  traegt eine Bezeichnung, und eine Rechnung mehr als sechs Positionen.**
  Migration `0080_billing_invoice_positions.sql` gibt `billing_invoice_lines`
  die Spalten `line_key` und `label`, macht `metric` nullbar und ersetzt
  `UNIQUE (invoice_id, metric)` durch `UNIQUE (invoice_id, line_key)`. Der
  Schluessel ist abgeleitet, nicht erzeugt: `metric:<kennung>` oder
  `charge:<code>`. **Die wichtige Unterscheidung:** Die Idempotenz des
  Rechnungslaufs traegt weiterhin allein
  `UNIQUE (organization_id, project_id, environment, period_start)` auf der
  Rechnung; der Schluessel je Position verhindert nur, dass eine Rechnung
  dieselbe Sache zweimal nennt. Pauschalen liegen in der neuen append-only
  Tabelle `billing_charges` je (Organisation, Projekt, Umgebung, Code) mit
  Bezeichnung, Betrag, Waehrung und Gueltig-ab-Datum; Betrag 0 beendet sie,
  gelesen wird je Code die juengste Zeile. Eine Pauschale kommt mit Menge 1 und
  Bezugsgroesse 1 zu ihrem Betrag, es gibt **keinen** Positionstyp mit
  eingetragenem Betrag. Gesetzt wird sie von einem Operator ueber
  `BillingService.setCharge`, ohne REST-Flaeche; eine Waehrung je Organisation
  gilt jetzt fuer beide Blaetter. Der Rechnungslauf besucht Umgebungen nun auch
  wegen einer Pauschale, nicht nur wegen Zaehlern. Projektion
  (`GET .../usage/billing`) traegt `charges`, die Rechnungsliste je Position
  `lineKey`, `label` und `kind`. Die Add-ons-Seite sagt deshalb etwas anderes
  als in 2.62 und begruendet es neu. Fall `(2.119)` in
  `postgres.integration.test.ts`.

- Neu in diesem Zweig: 2.79 (Zweig `slice/passkeys`) **Anmeldung mit Passkeys
  fuer Project Auth, mit jeder Pruefung, die wirklich laeuft.** Der Platzhalter
  `auth-passkeys` ist echt, Migration
  `0060_project_auth_passkeys.sql`. Reine Kryptografie in
  `lib/server/project-auth/passkeys.ts`, ohne fremde Bibliothek: ein Leser fuer
  die CBOR-Teilmenge von CTAP2, COSE nach JWK nach SPKI, ECDSA ueber
  `authenticatorData || sha256(clientDataJSON)`. **Was laeuft:** die
  Herausforderung wird in der Datenbank verbraucht (ein `UPDATE`, das nur eine
  Zeile zurueckgibt, wenn es sie selbst markiert hat), die Signatur gegen den
  abgelegten oeffentlichen Schluessel, `type`, `challenge`, `origin` und
  `crossOrigin` aus den Client-Daten, der `rpIdHash` gegen die Domaene genau
  jener Herkunft, das Bit fuer die Anwesenheit, und der Zaehler, der wachsen
  muss (geschrieben mit dem gelesenen Stand im `WHERE`). **Was nicht laeuft, und
  steht als Satz auf der Seite:** die Attestation (bei `fmt: none` gibt es
  nichts zu pruefen), andere Verfahren als ES256 (RS256 und EdDSA sind
  abgewiesen, `CHECK (algorithm = -7)`), der Zaehler, wenn beide Staende 0 sind,
  eine registrierbare Oberdomaene als `rpId`, und die Benutzerbestaetigung als
  zweiter Faktor (eine Anmeldung mit Passkey bleibt `aal1`). Die Sitzung entsteht
  in `beginAuthenticatedSession`, also an derselben Stelle wie beim Passwort;
  darum laeuft der Hook `sign_in` (Weg `passkey`) und darum greift der Schalter
  aus 2.52 auch hier. Die Console-Seite hat nur ein `GET`: eingerichtet und
  entfernt wird in der Anwendung des Nutzers (`auth/passkeys`).

- Neu in diesem Zweig: 2.78 (Zweig `slice/s3keys`) **S3-Zugang gibt Schlüssel
- Neu in diesem Zweig: 2.89 (Zweig `slice/cleanup`) **Was abgelaufen ist,
  verschwindet auch.** Migration `0063_project_auth_expiry_retention.sql` gibt
  `qkern_auth` das `DELETE` auf `project_auth_one_time_tokens`,
  `project_auth_oauth_codes` und `project_auth_oauth_tokens` (und keiner anderen
  Rolle) und legt je einen Index auf die Ablaufspalte. Der Aufraeumer wohnt im
  **vorhandenen** Compute-Prozess, nicht in einem neuen: Ein zweiter
  Dauerprozess waere eine zweite Stelle, die jemand starten muss, und dieser
  Prozess betreibt bereits einen Aufraeumer (Webhook-Zustellungen). Er laeuft
  ueber die Auth-Verbindung, weil nur `qkern_auth` diese Tabellen sieht; fehlt
  `QKERN_AUTH_DATABASE_URL`, startet der Prozess nicht, statt still nichts zu
  tun. **Frist nach dem Ablauf: 24 Stunden** -- laenger als die laengste
  Lebensdauer eines dieser Artefakte (zwoelf Stunden beim OAuth-Token) und lang
  genug fuer einen Betriebstag Fehlersuche. Geloescht wird in Haeppchen mit
  Obergrenze. **Bewusst stehen bleiben**: verbrauchte, aber noch nicht
  abgelaufene Zeilen (an ihnen fliegt ein zweites Einloesen auf), ein Code mit
  noch lebendem Token (`code_id` haengt mit `ON DELETE CASCADE` am Code),
  Sitzungen, Passkeys, Clients, API- und S3-Schluessel und jede Audit-Zeile.
  **Offen**: `project_storage_uploads` hat eine Ablaufspalte, wird aber nicht
  angefasst -- hinter der Zeile stehen Bytes bei einem Anbieter, und die zu
  verwaisen waere schlimmer als eine wachsende Tabelle. Fall `(2.89)` in
  `tests/postgres.integration.test.ts`.

- 2.66 **Cron liest Namen, Kuerzel, eine Zeitzone und die Sonderformen.**
  Migration `0066_project_cron_time_zone.sql` haengt `time_zone text NOT NULL
  DEFAULT 'UTC'` an `project_cron_definitions`; das UPDATE-Recht der Laufzeit
  bleibt bei `last_dispatched_at`, `enabled`, `updated_at`, die Zeitzone ist wie
  der Ausdruck Teil des Plans. Der Parser (`lib/server/compute/cron.ts`) nimmt
  jetzt `JAN..DEC` und `SUN..SAT` in Monat und Wochentag, auch in Bereichen und
  Listen, die Kuerzel `@yearly @annually @monthly @weekly @daily @midnight
  @hourly`, dazu `L`, `LW`, `NW` im Tagesfeld und `NL`, `N#K` im
  Wochentagsfeld, jede Sonderform allein in ihrem Feld. Die Zeitzone rechnet
  `Intl` ohne fremde Bibliothek: Wanduhr als "falsche UTC", Versatz je
  Wanduhrtag, an einem Wechseltag eine Suche nach dem Sprung. **Sommerzeit wie
  Vixie-Cron**: feste Stunde heisst ein Termin am Tag (doppelte Stunde zaehlt
  einmal, beim ersten Mal; fehlende Stunde feuert im Moment des Sprungs),
  Stunde `*` heisst Takt und folgt der echten Zeit. **Der Dedupe-Schluessel
  bestehender Plaene ist unveraendert**: Der UTC-Pfad wurde nicht angefasst,
  und der Fall "keeps the dedupe key of every pre-2.66 expression identical to
  the recorded value" vergleicht acht Ausdruecke gegen Schluessel, die mit dem
  Parser von 9e01d31 berechnet wurden, einmal ohne Zeitzone und einmal mit dem
  Vorgabewert `UTC`. Stack: `compute-cron-postgres` 12 Faelle (vorher 9),
  `compute-definitions-postgres` 10 (vorher 9), 228 Faelle gruen. **Zwei
  Mutationsproben**, je ein frischer Lauf: Zeitzone ignoriert, es fiel genau der
  Fall ueber die fehlende Stunde (1 von 228); jeder Wochentagsname um eins
  verschoben, es fielen genau der Namensfall und der Sonderformenfall (2 von
  228). Der Namensfall steht absichtlich auf einem Montag, denn ein Dienstag
  liegt auch in einem um eins verschobenen `MON-FRI`. **Offen**: Die Console
  fragt die Zeitzone in einem `prompt` ab, ohne Liste; `L` im Wochentagsfeld
  allein (Quartz: Samstag) gibt es nicht; ein Plan mit Zeitzone und
  `*`-Stunde meldet im Cron-Log in der doppelten Stunde zwei Vorkommen, das ist
  gewollt und dort nicht erklaert.

- 2.131 (Zweig `slice/tracesearch`) **Eine Spur ist jetzt auffindbar, und eine
  Anwendung liest die ihrer eigenen Nachricht.** Migration
  `0085_project_queue_trace_search.sql` legt genau einen Teilindex auf
  `project_queue_message_traces`:
  `(organization_id, project_id, environment, trace_id, occurred_at, message_id)
  WHERE trace_id IS NOT NULL`. Der Scope steht vorn, damit die Mandantengrenze
  im Index steht und nicht erst in der Policy -- eine Spur-Id entsteht in einem
  fremden Dienst, und zwei Organisationen hinter demselben Gateway tragen
  dieselbe. `queue_id` steht **nicht** drin: Eine fremde Spur laeuft durch die
  Umgebung und nicht durch eine Queue. Teilindex, weil der Anschluss nach 0081
  nur auf Sequenz eins liegt; damit liefert die Suche je Nachricht hoechstens
  eine Zeile, ohne `DISTINCT`.

  **Drei Luecken, die das schliesst** (alle drei standen in `trace.ts` unter
  "Offen"): es gab keine Suche nach einer Spur-Id, die Trace-Route war
  Admin-only, und MCP hatte kein Trace-Werkzeug.

  **Die Seitenform** ist die vorhandene und keine zweite: Keyset wie am
  Audit-Log von Project Auth (`audit-postgres.ts`), der Cursor ist die
  Nachrichten-Id der letzten Zeile, die Position liest die Abfrage selbst nach.
  Nur die Richtung ist gedreht -- aufsteigend, weil man eine Spur vorwaerts
  liest. Keine Gesamtzahl: sie waere ein zweiter Scan und im Augenblick der
  Antwort veraltet.

  **Was eine Suche zurueckgibt:** eine Zeile je Nachricht, nicht je Station
  (`GET .../environments/{environment}/queue-traces?traceId=`). Der Pfad liegt
  ausdruecklich **nicht** unter `queues/`, weil `queues/<etwas>` dort ein
  `[queue]` ist und ein statisches Segment eine gleichnamige Queue verdeckt.

  **Die Grenze zwischen Anwendung und Betreiber.** Neu ist
  `GET .../messages/{messageId}/own-trace` mit Projekt-Key. Die Nachrichten-Id
  ist die **halbe** Bedingung: Sie steht in der Quittung und damit in jedem Log,
  das sie mitgelesen hat. Die andere Haelfte ist `owner_subject` (0026). Ein
  `authenticated` Key sieht nur seine eigene Nachricht, ein `service_role` Key
  jede dieser Umgebung (mit demselben Key holt er sie samt Nutzlast ab), ein
  `anon` Key keine. Was eine Anwendung **nicht** sieht: den Wirt -- und zwar
  strukturell, der Typ `ProjectQueueApplicationTraceEntry` hat das Feld nicht.
  **Der Preis:** Ist die Nachricht weggeraeumt, gibt es keinen Besitzer zum
  Vergleichen, und ein Endnutzer bekommt nichts mehr; der Betreiber behaelt das
  ganze Fenster.

  **MCP:** `qkern_queue_message_trace` unter `queues:read`, nach dem Muster von
  2.117 (eine Spur sagt etwas ueber die **Nachrichten** dieser Umgebung, nicht
  ueber ihre Gestalt -- `project:read` waere so falsch wie dort). Es laeuft ueber
  OAuth als der **zustimmende Nutzer** und nicht als Betreiber, dieselbe
  Entscheidung wie 2.116 beim Loeschwerkzeug von Storage: Eine Nachricht hat
  einen Besitzer je Zeile, eine Queue-Definition nicht. Die beiden alten
  Queue-Werkzeuge bleiben Betreiber, und das steht weiter als offen.

  **Offen**: keine Suche nach einer Span-Id (der UNIQUE aus 0082 fuehrt
  `message_id` vor `span_id`, und einen zweiten Index hat niemand verlangt); die
  Trefferzeile nennt die **erste** Station und nicht den Ausgang; `qkern_queues_list`
  und `qkern_queue_status` laufen weiter als Betreiber. Fall `(2.131)` in
  `tests/postgres.integration.test.ts`.

- 2.126 (Zweig `slice/backupdrill`) **Eine Projektdatenbank wird gesichert und
  wiederhergestellt.** Migration `0083_project_database_backups.sql` legt
  `project_database_backups` an: je Backup eine Zeile mit Zustand, Lease,
  Objektschluessel, Pruefsumme, Groesse, eingewickeltem Datenschluessel,
  Manifest und Ablauf, unter Zeilensicherheit mit `FORCE`. Die Tabelle **ist**
  auch die Queue; eine zweite daneben waere eine zweite Antwort auf dieselbe
  Frage.

  **Die offene Stelle, die das schliesst.** Der Drill aus `2.29.0` sichert die
  **Steuerungsdatenbank**: physisches Basisbackup des Clusters,
  Wiederherstellung auf einen Zeitpunkt aus dem WAL-Archiv. Die Datenbank eines
  **Mandanten** war nie gesichert und nie wiederhergestellt, und genau das ist
  bei Supabase die Zusage, die ein Kunde kauft.

  **Wer es fahrt:** der vorhandene **Provisioner-Prozess**, in seiner
  Leerlaufrunde. Kein neunter Prozess, und die Begruendung steht im Quelltext
  (`lib/server/backup/project-database.ts`): Er ist der einzige Prozess mit
  einem privilegierten, Vault-gestuetzten Weg zu einer Projektdatenbank, und das
  Ziel einer Wiederherstellung ist eine **neue Datenbank** -- ein zweiter
  Prozess mit `CREATEDB` waere eine zweite Stelle mit dem schaerfsten Recht im
  Cluster. Ein wartender Projektauftrag geht immer vor.

  **Mit welcher Rolle:** `qkern_project_backup`, anmeldefaehig, `BYPASSRLS`
  (sonst sichert ein Backup die Schnittmenge der Sichtbarkeiten), Mitglied von
  `pg_read_all_data`, `NOCREATEDB`, ohne Schreibrecht. Die Rolle der Data API
  waere falsch. Das Zugangsdatum kommt aus einer **statischen Vault-Rolle**,
  abgeleitet aus dem Rollenstamm der Bindung (`<stamm>-backup`,
  `<stamm>-restore-admin`); kein Passwort im Quelltext, keines in einer
  Umgebungsvariablen, keines in einem Log. `pg_dump` ist ein Kindprozess und
  bekommt es ueber `PGPASSWORD` in einer **neu gebauten** Umgebung, nie in
  `argv`.

  **Logisch, nicht physisch**, und der Grund steht in 0083: ein Basisbackup
  zieht den **Cluster** und damit fremde Mandanten mit. Umfasst sind Schema,
  Zeilen, Policies, Erweiterungen, Sequenzen mit Stand und Rechte.
  **Ausgelassen, mit Grund:** Cluster-Rollen (clusterweit, nicht Teil einer
  Datenbank) und jeder Zeitpunkt **zwischen** zwei Backups (kein WAL-Archiv je
  Projektdatenbank, also keine Wiederherstellung auf eine beliebige Sekunde --
  das bleibt die Zusage des Control-Plane-Weges).

  **Verschluesselung:** Datenschluessel je Backup (AES-256-GCM), eingewickelt in
  einen Mandanten-Schluessel aus dem Vault; beide Ebenen binden Organisation,
  Projekt, Umgebung und Backup-Id als AAD. **Der Betreiber kann ein Backup
  lesen** -- QKERN hat keine kundengehaltenen Schluessel, und das steht so im
  Quelltext und im Backup-Dokument.

  **Wiederhergestellt wird nie ueber die lebende Datenbank**, sondern in eine
  neue, angelegt mit `qkern_project_restore_admin` (`CREATEDB`, Mitglied des
  Ledger-Eigentuemers, **kein** Superuser). Es gibt in diesem Weg kein
  `DROP DATABASE`; der Umschwung bleibt beim Betreiber.

  **Mandantengrenze, drei Riegel ohne Filter in der Anfrage:** Zeilensicherheit
  mit `FORCE`, der aus der Zeile abgeleitete Objektschluessel, und die AAD des
  Umschlags -- fremde Bytes gehen unter eigener Kennung nicht auf.
  **Aufbewahrung** 30 Tage, Aufraeumer portionsweise mit Obergrenze und
  einspeisbarer Uhr, **erst das Objekt, dann die Zeile**.

  Stack: `test:backup:docker` 2 Faelle (vorher 1), Fall `(2.126)`. Der Stack hat
  dafuer eine eigene CA, einen echten Vault und einen Objektspeicher bekommen.
  **Offen**: Die Console liest den Katalog nicht, es gibt keine Route mit
  Schreibverb, die ein Backup bestellt, und kein Produktweg zieht ein
  Basisbackup der Steuerungsdatenbank.

- 2.129 / 2.130 (Zweig `slice/backupstream`) **Stueckweise, mit Route und mit
  Zeitplan.** Migration `0084_project_database_backup_schedules.sql` traegt drei
  Dinge nach, und zwar genau die drei, die `2.73.0` selbst als offen notiert hat.

  **1. Der Dump geht nicht mehr durch den Speicher.** Die Ausgabe von `pg_dump`
  geht als **Strom** durch die Verschluesselung in die Teile eines
  Multipart-Uploads. Strom und nicht Datei, und der Grund ist nicht Platz: eine
  Datei waere ein **entschluesselter** Dump einer Mandantendatenbank auf einem
  Wirt des Betreibers, und dieselbe Zusage stand fuer die Wiederherstellung schon
  da. Je Teil ein Siegel, und seine AAD bindet Nummer, ein `final`-Zeichen und
  das **Tag des Vorgaengers**; damit haelt der Umschlag gegen Vertauschen,
  Weglassen in der Mitte, Abschneiden am Ende und Einfuegen. Die **Gesamtzahl**
  steht bewusst **nicht** in der AAD: beim Siegeln des ersten Teils ist sie
  unbekannt, und sie zu kennen hiesse, den ganzen Dump vorher zu haben. Sie steht
  in der Zeile (`part_count`), weil der Leser Bytebereiche rechnen muss; weicht
  sie von Kette und `final`-Zeichen ab, gewinnt der Umschlag.

  **Die neue Obergrenze ist gerechnet und nicht gesetzt:** Nutzbytes je Teil mal
  Teilegrenze des S3-Protokolls, also `64 MiB * 10 000 = 625 GiB`
  (`ProjectDatabaseBackupService.maxDumpBytes`). Vorher waren es 256 MiB, und sie
  war durch keinen Lauf geprueft. Jetzt prueft `(2.129)` **dieselbe Rechnung** mit
  `5 MiB * 2 = 10 MiB` gegen einen Dump von 12 MB -- derselbe Code, zwei andere
  Zahlen, keine Gigabytes. Artefakte im Format von `2.73.0` (`artifact_format =
  'single'`) bleiben lesbar; ein Weg, der sein eigenes altes Format nicht mehr
  liest, ist eine Aufbewahrung, die mit dem Release endet.

  **2. Die Route.** `GET`/`POST .../database/backups`, `GET .../backups/{id}`,
  `POST .../backups/{id}/restore`. **Kein Projekt-Key**, und das ist die
  Entscheidung: ein Projekt-Key liegt in einer Anwendung, und wer irgendwo einen
  findet, soll nicht den Dump jeder Zeile anstossen koennen. Also die
  Rollenmatrix der Control Plane, mit drei Rechten: `project_backup_read`
  (Eigentuemer, Administrator, Deployer, Support), `project_backup_request`
  (Eigentuemer, Administrator) und `project_backup_restore` -- **nur**
  Eigentuemer, weil eine Wiederherstellung eine Datenbank erschafft, die Geld
  kostet, geloeschte Daten in eine zweite Datenbank zurueckbringt, die niemand in
  einem Loeschauftrag genannt hat, und nicht wiederholbar ist.

  Die Route **fuehrt die Wiederherstellung nicht aus**: `CREATEDB` hat genau ein
  Prozess. Sie schreibt einen Auftrag in die Zeile und antwortet 202; der
  Provisioner nimmt ihn in derselben Runde, in der er Backups fahrt, und **vor**
  einem Backup, denn dort wartet ein Mensch. Dafuer bekommt `qkern_runtime` ein
  `UPDATE` auf **vier Spalten** und nicht auf die Tabelle -- die Zusage aus 0083
  ("kein Weg, ein Backup zu behaupten") bleibt damit wortwoertlich stehen.

  **3. Der Zeitplan**, und zwar **kein zweiter Scheduler**. Geprueft wurde zuerst
  der vorhandene Cron-Weg, und er traegt es nicht: eine Cron-Definition zeigt auf
  eine Compute-Funktion des Mandanten, laeuft im Compute-Prozess, ist
  mandantenbearbeitbar, und ein Backup braucht einen Takt und keinen
  Cron-Ausdruck mit Zeitzone. Was entstand, ist eine Pflicht in der Runde, die es
  schon gibt: `runRound` ruft `tick()`. Eine Zeitplanzeile entsteht per **Trigger**
  mit jeder Bindung (`development` abgeschaltet), **die Frist je Umgebung steht
  dort** (`retention_days`, vorher eine Prozessvariable fuer alle Projekte
  gleich), ein Takt ueber einem noch laufenden Auftrag legt keinen zweiten an und
  zaehlt es in `busy_count`, nachgeholt wird nichts, und `pruneExpired` hat
  endlich einen Aufrufer.

  Stacks: `test:backup:docker` 3 Faelle (vorher 2), Fall `(2.129)`;
  `test:postgres:docker` 255 (vorher 254), Fall `(2.130)` fuer Route, Rollen und
  Mandantengrenze. **Offen**: Die Console liest den Katalog weiterhin nicht -- das
  ist jetzt eine fehlende Verdrahtung und kein fehlender Weg. Kein Produktweg
  zieht ein Basisbackup der Steuerungsdatenbank. Und dass 625 GiB wirklich
  durchgehen, belegt kein Lauf; geprueft ist die Rechnung, nicht die Zahl.

- 2.124 / 2.125 **QKERN gibt den Anschluss jetzt weiter.** Migration
  `0082_trace_spans_and_outbound_anchor.sql` schliesst die Luecke, die `trace.ts`
  seit 2.72.0 selbst unter "Offen" fuehrte: Eine Spur hoerte an der
  QKERN-Grenze auf, obwohl sie draussen anfing und draussen weiterging.

  **Wer in QKERN Spans erzeugt: QKERN, eine je Station, beim Schreiben der
  Station.** Neue Spalte `span_id` auf `project_queue_message_traces`, acht
  Zufallsbytes, NOT NULL fuer jede Station. Verworfen wurden zwei Alternativen,
  und zwar begruendet in der Migration: Der Aufrufer kann sie nicht liefern (die
  Stationen entstehen Tage spaeter, teils ohne dass irgendwer etwas aufruft), und
  eine Ableitung aus `message_id` und `sequence` faellt doppelt (die
  Nachrichten-Id gibt QKERN heraus, also waere die Span nachrechenbar, und eine
  Sequenznummer kann nach einem Schnitt des Aufraeumers wiederkehren). Die
  vorhandenen Zeilen aus 2.72.0 bekommen ihre Span-Ids ueber einen fluechtigen
  Vorgabewert beim `ADD COLUMN`, der je Zeile ausgewertet wird; ein `UPDATE`
  waere am Append-only-Trigger aus 0081 gescheitert, und einen Trigger in einer
  Migration zu umgehen heisst, ihn zu entwerten.

  **Nach innen.** `ProjectQueueClaim.traceparent` traegt die Spur-Id der
  Nachricht und als Eltern-Span die `claimed`-Station dieses Claims, nicht den
  Span des Einreichers. Die Route gibt ihn unveraendert heraus, OpenAPI
  beschreibt ihn.

  **Ohne Anschluss bleibt es leer.** QKERN erfindet keine Spur-Id: Eine
  erfundene waere draussen eine Spur mit einem Teilnehmer, und in der Antwort der
  Trace-Route von einem echten Anschluss nicht zu unterscheiden. `trace-flags`
  stehen immer auf `01` und werden nicht gespeichert, weil die Flags nach W3C die
  Span beschreiben, die im Kopf steht, und eine Station von QKERN immer
  aufgezeichnet ist; der Preis (eine draussen abgeschaltete Spur wird hinter
  QKERN wieder eingeschaltet) steht in der Migration. `tracestate` geht nicht
  mit: QKERN ist kein Tracing-Anbieter, ein durchkopierter Blob waere eine
  Nutzlast auf einer Logflaeche, und er ist die eine Stelle, an der ein Geheimnis
  in einer Kopfzeile hinausreisen koennte.

  **Ein Dead-Letter-Replay erbt den Anschluss unveraendert**, Eltern-Span
  inklusive. Der erste Entwurf liess ihn an der letzten Station der Quelle
  haengen; Fall (2.121) hat ihn umgeworfen, und zwar zu Recht, denn
  `parent_span_id` heisst "die Span draussen, an der diese Nachricht haengt", und
  eine Spalte mit zwei Bedeutungen laeuft auseinander. Die Ursache steht genauer
  in `source_message_id`. **Das ist der Produktfehler, den der Stack gefunden
  hat**, und er stand im ersten Entwurf dieses Releases und nicht in 2.72.0.

  **Nach aussen.** `project_webhook_deliveries` traegt `trace_id` und
  `parent_span_id`, so unveraenderlich wie die Nutzlast (derselbe Waechter aus
  0032, erweitert), und `WebhookDeliverer` macht daraus die Kopfzeile
  `traceparent`. **Nicht signiert**: Ein Proxy, der Tracing-Koepfe anfasst,
  wuerde sonst die Signatur brechen und ein echtes Ereignis bekaeme 401.

  **Offen, und hier aufgeschrieben statt woanders behauptet**: Kein
  ausgelieferter Webhook-Sammler setzt den Anschluss, weil Change Feed,
  Audit-Kette und Log-Protokoll selbst keinen `traceparent` tragen; der
  Function-Aufruf aus der Queue traegt ihn nicht, weil er ueber einen
  Sandbox-Port laeuft und nicht ueber HTTP; QKERN exportiert keine Spans an einen
  Collector; innerhalb einer Spur gibt es keine Span-Kanten, die Ordnung ist
  `sequence`. Faelle `(2.124)` in `tests/postgres.integration.test.ts` und
  `(2.125)` in `tests/receiver.integration.test.ts`, letzterer am echten
  HTTPS-Empfaenger, der sagt, was bei ihm angekommen ist.

- 2.127 **Zwei fremde Werkzeuge fahren den S3-Endpunkt, und sie haben zwei
  Abweichungen gefunden.** Keine Migration. Der Produktteil steckt allein in
  `lib/server/project-storage/s3-endpoint.ts`, die Faelle in
  `tests/project-storage-s3-endpoint.integration.test.ts` (`2.127` AWS CLI v2,
  `2.128` rclone), und die beiden Clients kommen per `apk` in den
  Zertifizierungscontainer (`docker-compose.storage-certification.yml`).

  **Warum kein Next-Server im Stack.** Die Clients brauchen einen echten
  HTTP-Endpunkt, und den gibt die Bruecke, die der Fall selbst oeffnet
  (`bridgeTo()`, seit `2.99` da). Ein Next-Dienst waere der naheliegende Weg
  gewesen, geht aber nicht ohne eine zweite Verdrahtung: `getProjectStorageS3-
  Endpoint()` zieht `getProjectStorageService()` und
  `getProjectStorageS3AccessKeyService()`, und im Betriebsmodus `memory` baut
  **jede von beiden ihre eigene** `MemoryProjectStorageRepository`. Die Maps
  liegen in der Instanz, nicht im Modul. Ein Bucket, den der Dienst anlegt,
  existiert fuer den Schluesseldienst also nicht, und ein Paar fuer diesen
  Bucket liess sich gar nicht ausstellen. **Das ist ein echter Fehler in der
  Verdrahtung, nicht nur eine Testsorge**, und er ist nach dem Merge behoben:
  `getMemoryProjectStorageRepository()` in `repository.ts` gibt beiden Fabriken
  dieselbe Ablage, am `globalThis` und nicht als Modulvariable, weil Next ein
  Modul je Bundle neu laedt und zwei Kopien wieder zwei Ablagen waeren.
  `tests/project-storage-memory-mode-contract.test.ts` haelt beide Richtungen;
  nimmt man einer der Fabriken die gemeinsame Ablage weg, faellt genau ihr Fall.
  Der Befund selbst bleibt richtig: Der Fall `(2.127)` faehrt die Clients
  weiterhin ueber `bridgeTo()` und nicht ueber einen Next-Dienst, denn der
  braechte PostgreSQL, Migrationen und Provisionierung in den Storage-Stack.

  **Was die Clients gefunden haben, und was sich bewegt hat.** Beides war in
  2.73.0 benannt und steht jetzt nicht mehr offen:
  - `max-keys=0` antwortete mit `400 InvalidArgument`, wo S3 eine leere Liste
    gibt. `aws s3api list-objects --max-keys 0` brach damit mit Code 254 ab.
    Jetzt eine leere Liste mit `IsTruncated=false` und ohne Fortsetzung. Der
    Kurzschluss sitzt in `walkObjects` und nicht in den Antwortbauern, weil
    `IsTruncated=true` ohne Fortsetzung einen blaetternden Aufrufer endlos
    laufen liesse.
  - Derselbe `CommonPrefixes`-Eintrag konnte auf zwei Seiten stehen, weil die
    Grenze eine Gruppe mitten drin abschnitt. `aws s3 ls --page-size 2` druckte
    `PRE sync/` zweimal. Jetzt zaehlt ein Schluessel in einer bereits genannten
    Gruppe nicht gegen `max-keys` und schneidet darum nicht ab: Die Gruppe wird
    auf ihrer Seite fertig gelesen, die Fortsetzung liegt hinter ihrem letzten
    Schluessel, und kein Schluessel wird uebersprungen.

  **Was die CLI anders macht als das SDK**, und warum ein fremdes Werkzeug der
  bessere Zeuge ist: Sie bringt die AWS-CRT in C mit, puffert die Datei,
  signiert die Nutzlast als Ganzes und legt die Pruefsumme in einen **Header**
  statt als Trailer hinter `aws-chunked`. Standard ist CRC64NVME, nicht CRC32,
  und sie fragt mit `Expect: 100-continue` nach. Dieser Weg durch den Endpunkt
  war vor `2.127` von keinem echten Client gefahren. Nebenbei stimmt die
  CRC64NVME der CRT Byte fuer Byte mit der aus `s3-sigv4.ts`.

  **Offen, und hier aufgeschrieben statt woanders behauptet**: Nexts eigene
  Umwandlung von `node:http` nach `Request` hat niemand gesehen; der Endpunkt
  erzwingt keine Mindestgroesse von 5 MiB fuer ein Teil, das nicht das letzte
  ist, wo S3 `EntityTooSmall` gibt (kein Client ist darueber gestolpert, weil
  beide sich an die Regel halten); virtuell gehostete Adressen gibt es nicht,
  beide Clients fahren darum pfadadressiert.

- 2.123 **Der S3-Endpunkt kopiert jetzt ein Teil und listet in der alten Form.**
  Keine Migration, kein neuer Dienstaufruf: beides steckt allein in
  `lib/server/project-storage/s3-endpoint.ts`.

  **`UploadPartCopy`** (`PUT /s3/{bucket}/{key}?partNumber=N&uploadId=…` mit
  `x-amz-copy-source`, wahlweise `x-amz-copy-source-range: bytes=first-last`)
  geht den Weg von `CopyObject` fuer das Lesen und den Weg von `UploadPart` fuer
  das Schreiben: Lesezusage der Quelle, Bytes holen, dann `storePart`, das
  `UploadPart` und `UploadPartCopy` Zeile fuer Zeile teilen
  (`createS3PartUploadGrant` bucht auf die Reservierung, Zusage zum Provider,
  `confirmS3UploadPart` vermerkt die Kennung). Vier Entscheidungen stehen als
  Begruendung im Quelltext: Die **Pruefsumme** rechnet QKERN aus den geholten
  Bytes, nicht aus der Objektzeile, und eine `x-amz-checksum-*` vom Client wird
  mit 400 abgewiesen, weil er die Bytes nie gesehen hat. Der **Scanner** sieht
  das Teil nicht, sondern beim Abschluss die ganze zusammengesetzte Datei, so wie
  bei `UploadPart`; eine Luecke entsteht nicht, weil die Quelle sauber sein muss,
  um sichtbar zu sein. Die **Leserechte** der Quelle laufen durch `bucket()` und
  `findObject()`, also je Objekt und nicht nur je Bucket: ein Objekt in
  Quarantaene ist dem Paar nicht sichtbar und damit nicht kopierbar. Die
  **Grenzen** sind die von `UploadPart` (64 MiB je Teil, 1 bis 10000, Ordnung
  erst beim Abschluss im Dienst), dazu die Bereichsform mit beiden Enden
  (`400 InvalidArgument` sonst) und `416 InvalidRange` hinter dem Ende.

  **`ListObjects` Version 1** ist `GET /s3/{bucket}` ohne `list-type`. Beide
  Versionen laufen durch denselben `walkObjects`, damit Delimiter,
  `CommonPrefixes` und `max-keys` nicht auseinanderlaufen; unterschiedlich ist
  nur die Antwort. Zwei Abweichungen von S3, beide absichtlich und im Quelltext
  begruendet: `NextMarker` kommt immer, wenn abgeschnitten wurde, auch ohne
  Delimiter, und es zeigt auf den letzten **gesehenen Schluessel**, nicht auf den
  Gruppennamen, damit die Fortsetzung nichts ueberspringt. Eine gemischte Form
  wird benannt statt ausgelegt: `continuation-token` oder `start-after` in einer
  v1-Anfrage und jedes `list-type` ausser 2 antworten `400 InvalidArgument`.

  **Zertifiziert** im Storage-Stack als Fall `(2.123)` in
  `tests/project-storage-s3-endpoint.integration.test.ts`, gefahren vom AWS SDK
  ueber die HTTP-Bruecke (`UploadPartCopyCommand`, `ListObjectsCommand`) gegen
  echtes versitygw und echtes ClamAV: 12 von 12 gruen, vorher 11. Der Fall
  belegt, dass der Client bei der Teilkopie **keinen** Koerper und **keine**
  Pruefsumme schickte und das Teil trotzdem bei versitygw liegt, dass die
  zusammengesetzte Datei vom echten Scanner freigegeben wurde, und dass das SDK
  dem `NextMarker` folgt. Zwei Mutationsproben, je frischer Lauf: Pruefsumme des
  kopierten Teils auf eine Konstante, und `NextMarker` weggelassen; beide Male
  fiel genau `(2.123)`, die elf anderen blieben gruen.

  **Offen**: Die AWS CLI und rclone haben den Endpunkt weiterhin nicht gesehen.
  Eine Quelle ueber 64 MiB laesst sich nur bereichweise in Teile kopieren, nicht
  in einem Zug. Virtuell gehostete Adressen (`bucket.host`) bleiben 501.

- 2.121 **Eine Nachricht der Queues laesst sich jetzt verfolgen.** Migration
  `0081_project_queue_message_traces.sql` legt `project_queue_message_traces` an:
  je Station eine Zeile, geschrieben **in derselben Transaktion** wie der
  Zustandswechsel, den sie beschreibt. Acht Stationen: `enqueued`,
  `deduplicated`, `replayed`, `claimed`, `completed`, `retry_scheduled`,
  `dead_lettered`, `lease_expired`. Gelesen wird ueber
  `GET .../queues/{queue}/messages/{messageId}/trace`, nur als Admin, und die
  Console zeigt es unter Queues.

  **Die Form.** Zusammengehalten wird eine Spur von der **Nachrichten-Id**, und
  das ist keine neue Kennung: Sie steht in der Quittung, im Claim, in Ack, Fail
  und Lease und in der Dead-Letter-Liste. W3C Trace Context kommt dazu, aber nur
  am Rand: Das Einreihen liest einen `traceparent`, und Spur-Id und Eltern-Span
  landen auf der ersten Station, damit eine Spur ueber QKERN hinaus
  zusammenhaengt. QKERN entscheidet an diesen beiden Werten nichts; ein kaputter
  Kopf wird weggelassen und nicht abgewiesen.

  **Kein Fremdschluessel auf die Nachricht, und das ist der Zweck.** `cleanup()`
  loescht erledigte Nachrichten nach `retention_seconds`. Eine Kaskade waere
  genau dann weg, wenn die Spur das Einzige ist, was noch erzaehlen kann. Die
  Spur haengt an der Queue und hat ihre eigene Frist:
  `max(retention_seconds der Queue, ein Betriebstag)`, geschnitten an
  `expires_at` der Station und **nie** am Ausgang der Nachricht. Aufgeraeumt wird
  im vorhandenen `cleanup()` je Queue, haeppchenweise.

  **Grenzen.** 64 Stationen je Nachricht, in der Anweisung durchgesetzt und
  nicht im TypeScript. Die Rechnung: 20 Versuche mal zwei Stationen plus die
  erste sind 41; die einzige Station, die ein Aufrufer beliebig oft erzeugen
  kann, ist `deduplicated`. An der Grenze schreibt der Port nichts mehr und
  wirft nicht, und der Leser sagt `complete: false`.

  **Was absichtlich fehlt**: eine Station fuer die Erneuerung der Pacht (das
  waere der Takt und nicht die Arbeit), jede Nutzlast (0081 hat keine Spalte
  dafuer) und eine Suche nach Spur-Id. Der weitergegebene `traceparent` an Worker
  und Webhook stand hier bis 2.124 auch; er ist jetzt da, siehe oben. Faelle `(2.121)` und `(2.122)` in
  `tests/postgres.integration.test.ts`, dazu `tests/project-queue-trace.test.ts`
  ohne Stack.

- 2.115 **MCP und das TypeScript-SDK upserten jetzt auch.** `onConflict` am
  Werkzeug `qkern_table_rows_insert` (`mcp/server.ts`) und als zweites Argument
  an `insert` des SDK (`sdk/typescript/src/index.ts`). Beide gehen denselben Weg
  wie REST und GraphQL seit 2.105: `GeneratedDataApiService.insertRows`, und der
  Konfliktschluessel kommt weiterhin allein aus `pg_index`
  (`resolveConflictKey`). **Keine zweite Pruefung**: Das MCP-Schema sagt nur,
  dass es Spaltennamen sind und wie viele; das SDK prueft nur die Gestalt der
  Namen mit demselben `identifier`, das `select` benutzt. Ob die Spalten einen
  eindeutigen Schluessel bilden, ob die Rolle aendern darf und ob jede Zeile den
  Schluessel traegt, entscheidet der Dienst.

  **Ein echter Produktfehler dabei**: `generatedDataToolError` in `mcp/server.ts`
  kannte `GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN` nicht, und ein unbekannter
  Code wird dort zu "The generated data API is unavailable". Ein Agent haette
  einen Fehler seiner Anfrage als Ausfall gelesen und die Anfrage wiederholt. Der
  Code hat jetzt seinen eigenen Satz, wie an der REST-Route, die ihn seit 2.105
  mit 400 beantwortet. Fall `(2.115)` in `tests/postgres.integration.test.ts`,
  mit den echten Route-Handlern unter dem echten SDK-Transport.

- 2.116 **`storage:write` kommt mit dem Werkzeug, das ihn prueft, und es ist ein
  Loeschen.** Migration `0078_project_auth_oauth_storage_write_scope.sql`
  ersetzt dieselben vier Scope-CHECKs wie 0073; die Liste wird von neun auf zehn
  Bereiche erweitert, die Obergrenze je Zeile von 9 auf 10. Das Werkzeug ist
  `qkern_storage_object_delete`.

  **Warum kein Hochladen.** Ein Objekt entsteht hier in drei Schritten:
  Reservierung mit Pruefsumme der ganzen Datei, Bytes beim Anbieter gegen einen
  kurzlebigen Grant, Abschluss mit Abschlusstoken und Scan. Den mittleren Schritt
  kann ein Werkzeug nicht tun, und eines, das die Bytes selbst annimmt, schiebt
  bis fuenf Gibibyte durch einen Modellkontext und laesst das Modell die
  Pruefsumme beglaubigen, die der Abschluss vergleicht. Ein Umbenennen gibt es im
  Dienst ueberhaupt nicht: Der Schluessel am Objekt ist der Weg beim Anbieter,
  also waere es Kopieren plus Loeschen mit Kontingent, Pruefsumme und Scan an der
  neuen Stelle, und das ist eine Faehigkeit des Dienstes. Bleibt das Loeschen,
  und es ist die Handlung, die ein Agent in einem Bucket wirklich braucht.

  **Die offene Grenze aus 2.69 ist fuer diesen Weg zu.** Storage lief im
  MCP-Server mit `role: "admin"` im Namen des Betreibers. Bei einem Loeschen waere
  das eine Rechteausweitung durch die Zustimmung eines Endnutzers, denn die
  Betreiberrolle gibt jedes Objekt jedes Buckets her. `qkern_storage_object_delete`
  laeuft ueber OAuth darum mit `role: "authenticated"` und der Kennung des
  zustimmenden Nutzers; `canWrite` wendet damit die Schreibregel des Buckets je
  Objekt an. Beim statischen Bearer bleibt es `admin`, weil es dort keinen Nutzer
  gibt, in dessen Namen gehandelt wird. Die lesenden Storage-Werkzeuge und die
  Queues bleiben beim Betreiber, und das steht weiter als offen.

  **Offen**: `storage:read` und `queues:read` sagen weiterhin etwas ueber die
  Projektumgebung und nichts ueber die Daten eines Nutzers; eine Decke je Nutzer
  braeuchte dort eine Rolle je Bucket und je Queue. Die HTTP-Tueren von Storage
  nehmen ein OAuth-Token weiterhin nicht an, also wirkt `storage:write` nur am
  entfernten MCP-Server. Fall `(2.116)` in `tests/postgres.integration.test.ts`
  mit drei Buckets und drei Schreibregeln.

- 2.117 **Die freie Abfrage liest jetzt unter der Zeilensicherheit, und die
  Schemaliste gibt die lesbare Flaeche.** Keine Migration: Beide haengen an
  `data:read`, den es seit 0062 gibt. `qkern_query_readonly` laeuft ueber OAuth
  durch `GeneratedDataApiPort.queryUnderRowSecurity`, also durch dieselbe Tuer wie
  `qkern_table_rows_list` (Rolle `authenticated`, die Ansprueche des zustimmenden
  Nutzers, `row_security = on`, `BEGIN READ ONLY`, dieselben Zeitlimits). Neu ist
  die Lesung des Abfragetextes in `lib/server/data-plane/free-query.ts`: Sie nennt
  jede Relation, und jede geht durch `assertTableBoundary(..., "select")`, bevor
  die Abfrage laeuft. Eine Tabelle ohne Zeilensicherheit ist damit nicht
  erreichbar, auch mit Leserecht nicht.

  **Die tragende Regel ist eine einzige**: Tabellen mit Schema, alles andere ohne.
  Die Abfrage laeuft mit `SET LOCAL search_path = pg_catalog`, also kann die Lesung
  nicht anders ausfallen als die Auflösung in PostgreSQL. Eine Funktion, ein
  Operator oder ein Cast mit Schema faellt, denn ein `SECURITY DEFINER` im
  Nutzerschema laeuft mit den Rechten seines Eigentuemers und sein Rumpf steht
  nicht im Abfragetext. Von `pg_catalog` ist nur eine Liste von 26 Funktionen
  erlaubt, weil `query_to_xml` dort eine Abfrage aus einem Textargument ausfuehrt.
  Ein CTE-Name gilt nur dort, wo PostgreSQL ihn gelten laesst, also nicht in seiner
  eigenen Bindung; sonst waere `WITH t AS (SELECT * FROM t)` der Weg um die
  Pruefung je Tabelle herum.

  **Die Schemaliste ist getrennt entschieden.** Ueber OAuth antwortet sie mit
  `listReadableTables` und nicht mit `inspectSchema`: dieselbe Fläche, die
  `generated-openapi` und die GraphQL-Introspektion demselben Token schon geben,
  und beide verlangen dort `data:read`. `project:read` waere falsch, weil dieser
  Bereich die Gestalt der Umgebung meint und nicht die Gestalt der Daten. Beim
  statischen Bearer bleiben beide Werkzeuge, was sie waren.

  **Ein echter Fehler nebenbei**: `examples/codex-mcp.oauth.toml` behauptete noch,
  Storage, Queues, Control Plane und Migrationen seien ueber OAuth nicht
  erreichbar. Das stimmte seit Migration 0073 nicht mehr, und die Datei nennt
  jetzt alle damals sechzehn erreichbaren Werkzeuge; seit 2.131 sind es siebzehn.

  **Offen**: Die Lesung verlaesst sich darauf, dass `pgsql-ast-parser` denselben
  Text so liest wie PostgreSQL. Faende sie eine Relation nicht, die PostgreSQL
  doch liest, bliebe die Zeilensicherheit darunter trotzdem an (die Rolle traegt
  kein `BYPASSRLS`); verloren waere nur die Zusage ueber Tabellen **ohne** Policy.
  Ein Fenster (`OVER`), ein Window-Frame und `WITH RECURSIVE` gibt es auf diesem
  Weg nicht. Faelle `(2.117)` in `tests/postgres.integration.test.ts` und in
  `tests/mcp-free-query.test.ts`.

- 2.113 **Presence ist dauerhaft, und ein `changes:`-Abonnement kann wieder
  aufsetzen.** Migration `0077_realtime_presence.sql` legt `realtime_presence` an:
  Scope, Kanal, der `qk_presence_...`-Schluessel, die Instanz, der State und
  `expires_at`. RLS je Organisation, DELETE und ein enges Spalten-UPDATE nur fuer
  `qkern_runtime`. **Die Pacht ist der Kern**: Der Prozess mit der Verbindung
  erneuert sie im Takt, eine fremde Instanz darf das nicht, und sie wirkt in zwei
  Stufen. Jede Lesung filtert auf `expires_at > now`, also endet die Sichtbarkeit am
  Ablauf; die Zeile faellt eine Frist spaeter
  (`QKERN_REALTIME_PRESENCE_RETENTION_MS`, Vorgabe zehn Minuten) durch
  `RealtimeRetentionRuntime`. Derselbe Takt (`sweepPresence`) rechnet jeden Kanal mit
  lokalen Abonnenten neu und stellt den Ablauf als Leave zu, sonst blieb eine Waise
  in einem stillen Kanal fuer immer sichtbar. Der Schnappschuss beim Abonnieren liest
  die Tabelle und ist darum instanzuebergreifend; eine Aenderung meldet derselbe
  `LISTEN`/`NOTIFY`-Kanal mit `k: "p"` und ohne jeden Eintrag.
  **Zweiter Teil**: Ein `changes:`-Kanal bekommt seinen Cursor jetzt aus dem
  Aenderungs-Feed statt aus `realtime_events`, in das auf diesem Weg nie etwas
  geschrieben wird, und jede `change`-Nachricht traegt diesen Cursor und ein `replay`.
  Nachgereicht wird je Zeile durch denselben Leser wie im Livebetrieb, also mit den
  Claims des Abonnenten unter Zeilensicherheit. Grenzen: `QKERN_REALTIME_HISTORY_LIMIT`
  und `QKERN_REALTIME_HISTORY_MAX_AGE_MS`, beide fallen geschlossen mit
  `REALTIME_CURSOR_STALE`. **Offen**: Ein Nachreichen gibt es nur fuer
  `changes:`-Kanaele mit konfigurierter Quelle; die Position des Pollers liegt
  weiterhin je Instanz im Prozess, und eine Verbindung steht in keiner Tabelle.

- 2.107 **Der Compute-Prozess findet seine Bereiche selbst, innerhalb einer
  Organisation.** `QKERN_COMPUTE_SCOPE_SOURCE=control-plane` liest
  `project_environments` fuer die Organisation aus
  `QKERN_COMPUTE_ORGANIZATION_ID`, mit einem Join auf `projects` gegen
  geloeschte Projekte. Kein neues Recht: `qkern_runtime` hat SELECT seit 0002,
  und die Policy begrenzt die Sicht auf `qkern_current_organization_id()`.
  **Die Grenze steht und wird nicht umgangen, und sie liegt woanders als
  erwartet**: `qkern_current_organization_id()` liest eine Sitzungsvariable, die
  der Prozess selbst setzt, also liest die Laufzeitrolle jede Organisation,
  deren Id sie nennt. Der Fall 2.107 hat das gegen die echte Datenbank gemessen
  und die urspruengliche Annahme widerlegt. Was fehlt, ist die **Aufzaehlung**:
  `organizations_select` haengt an derselben Variablen, also sieht eine Sitzung
  genau eine Organisation. Eine uebergreifende Entdeckung braeuchte eine Rolle,
  die RLS umgeht, oder ein Leserecht auf `organizations` ohne diese Policy;
  dieser Schnitt legt beides nicht an.
  Wer mehrere Organisationen in einem Prozess bedienen will, behaelt
  `QKERN_COMPUTE_SCOPES_JSON`; beides zusammen wird abgewiesen. **Offen**: Eine
  Umgebung, die nach dem Start entsteht, bekommt keine Schleife. Stattdessen
  zaehlt `ComputeScopeCensusRuntime` im Takt und meldet
  `compute.scope_census` mit `unserved` und `stale`, sobald eine Zahl von null
  abweicht. Ein Neustart bedient sie dann. Die Zaehlung laeuft auch am festen
  Weg, sobald die Organisation genannt ist.

- 2.108 **Die Inhaltslogs erreichen einen Log-Drain.** Migration
  `0075_log_drain_function_output_source.sql` haengt `function_output` an die
  Quellenliste aus 0054 (`CREATE OR REPLACE`, Reihenfolge geprueft, `BETWEEN 1
  AND 6`), und der Leser loest `project_function_invocation_output.lines` in
  einen Eintrag je Ausgabezeile auf. Kein neues Recht: 0069 gibt `qkern_runtime`
  SELECT auf der Tabelle. **Die Menge hat eine eigene Grenze**, weil ein Aufruf
  64 KiB tragen darf: vier Aufrufe je Lauf, also 256 KiB je Ladung
  (`LOG_DRAIN_FUNCTION_OUTPUT_MAX_INVOCATIONS`), genannt in der Migration und in
  jedem Text der Console. Und `LOG_DRAIN_MAX_TEXT` gilt je Quelle: fuer diese
  2 KiB wie `FUNCTION_OUTPUT_LIMITS.maxLineBytes`, sonst waere jede Zeile ueber
  1024 Zeichen als Eintrag ohne Text hinausgegangen. **Zwei Texte waren falsch
  und stehen jetzt richtig da**: `LOG_DRAIN_NEVER` versprach, ein Drain trage
  nie die Ausgabe eines Containers, und `function_invocations` behauptete, QKERN
  speichere sie gar nicht; der zweite Satz war seit `2.67.0` falsch.
  `LOG_DRAIN_OUTPUT_EXCEPTION` sagt die Ausnahme in einem eigenen Satz, in vier
  Sprachen.

- 2.103 **Die Werkzeuge ohne Bereich haben jetzt einen, und drei absichtlich
  nicht.** Migration `0073_project_auth_oauth_tool_scopes.sql` ersetzt die vier
  Scope-CHECKs aus 0062 und 0064; die Bereichsliste wird von drei auf neun
  erweitert, die Obergrenze je Zeile von 3 auf 9. Neu sind `project:read`
  (`qkern_project_get`, `qkern_automation_policy_get`), `storage:read` (die
  zwei Storage-Lesewerkzeuge), `queues:read` (Liste und Status), `queues:write`
  (nur Einstellen), `logs:read` (`qkern_logs_search`) und `migrations:propose`
  (nur die Vorschau). Die Tabelle steht weiterhin allein in `mcp/tool-scopes.ts`,
  und die Begruendung je Werkzeug steht dort im Quelltext.

  **Ohne Bereich bleiben drei.** `qkern_query_readonly` und `qkern_schema_list`
  lesen an der Zeilensicherheit vorbei, `data:read` sagt aber Lesen unter ihr zu;
  wer ihnen einen Bereich gibt, muss sie vorher unter sie stellen, und das ist
  ein eigener Schnitt. `qkern_migration_apply_queue` faellt nicht unter
  `migrations:propose`, weil Vorschlagen und Anwenden zwei Saetze sind, und
  bekommt auch keinen eigenen: Ein Apply ueber eine fremde Anwendung ist eine
  eigene Entscheidung mit eigener Widerrufsflaeche.

  **Kein `storage:write`**, weil es kein schreibendes Storage-Werkzeug gibt und
  ihn darum nichts pruefen wuerde. Ein Bereich, den niemand prueft, ist eine
  Beschriftung, und auf einer Zustimmungsseite ist eine Beschriftung schlimmer
  als ein fehlender Eintrag.

  `queues:write` erreicht keine Worker-Operation: Claim, Lease, Renewal und
  Abschluss stehen in der Tabelle nicht, und ein Name ohne Eintrag ist keine
  Erlaubnis. Die HTTP-Tueren von Storage, Queues und Functions nehmen ein
  OAuth-Token weiterhin nicht an; `ProjectOAuthAdmission` bleibt bei `reject`,
  und diese Bereiche wirken nur am entfernten MCP-Server.

  **Offen**: Storage und Queues laufen im MCP-Server mit `role: "admin"` im Namen
  des Betreibers und nicht unter der Zeilensicherheit des zustimmenden Nutzers.
  `storage:read` und `queues:read` sagen darum etwas ueber die Projektumgebung
  und nichts ueber die Daten eines Nutzers. Getragen wird das allein von der
  Decke am Client, die ein Owner oder Administrator schreibt. Wer diese Bereiche
  je Nutzer einschraenken will, braucht dafuer eine Rolle je Bucket und je
  Queue, und die gibt es nicht. Fall `(2.103)` in
  `tests/postgres.integration.test.ts`.

  **Befund am Rande**: Eine Queue-Nachricht laesst sich vor ihrer
  Aufbewahrungsfrist nicht loeschen, auch nicht als Eigentuemer der Datenbank
  (Trigger aus 0026). Und `project_queue_messages` liegt unter der
  Mandanten-RLS: Eine Zaehlung mit der Laufzeitrolle ohne gesetzten Mandanten
  liefert immer null und belegt darum nichts.

- 2.101 **Multipart am S3-Endpunkt.** Migration
  `0071_project_storage_s3_multipart.sql` haengt `parts_declared boolean NOT NULL
  DEFAULT false` an `project_storage_uploads`, lockert `size_bytes` auf `BETWEEN
  0 AND 5368709120` und `checksum_sha256` auf NULL, aber nur fuer diese Sorte,
  und haelt mit `project_storage_uploads_completed_content` fest, dass eine
  abgeschlossene Reservierung Groesse und Pruefsumme hat. Dazu
  `project_storage_upload_parts` (Fremdschluessel auf die Reservierung, `ON
  DELETE CASCADE`), weil die Teile drei Dinge tragen: die Bytes, um die die
  Reservierung gewachsen ist, die Reihenfolge, die `CompleteMultipartUpload`
  nennen darf, und die Antwort auf `ListParts`.

  Der Grund fuer die neue Sorte: Ein S3-Client nennt bei
  `CreateMultipartUpload` weder Groesse noch Pruefsumme der ganzen Datei, die
  `prepareMultipartUpload` (REST, 1.70) vorher verlangt. Die Reservierung
  beginnt darum bei null Bytes und waechst mit jedem angenommenen Teil, jedes
  unter derselben Quota- und Objektgrenzenpruefung wie eine Reservierung. Beim
  Abschluss prueft der Dienst die Teileliste gegen den Satz des Endpunkts
  (aufsteigend, jede Nummer bekannt, jede Kennung dieselbe, Summe der Groessen
  gleich der gebuchten), der Provider setzt zusammen, und der Endpunkt rechnet
  die Pruefsumme der **ganzen** Datei aus dem zusammengesetzten Objekt ueber
  eine Lesezusage. Diese Summe bekommt der Scanner, so wie bei REST die
  zugesagte; `settleMultipart` in `service.ts` ist der eine Abschluss fuer beide
  Wege und bricht ab, wenn keine Summe da ist. Ein S3-Upload wird ueber seine
  Kennung gefunden, nicht ueber einen Abschluss-Token: Die Vollmacht eines
  S3-Clients ist die SigV4-Signatur und die Bucket-Regel, und darum ist
  `ListMultipartUploads` ueberhaupt brauchbar.

  **Offen** (Stand 2.101; `UploadPartCopy` ist seit 2.123 gebaut, siehe dort):
  Ein vorhandener Schluessel wird
  beim Anfang des Uploads geloescht, weil die Reservierung ihn exklusiv haelt;
  bricht der Upload ab, ist das alte Objekt weg. Der Abschluss liest das
  zusammengesetzte Objekt zweimal, einmal fuer die Pruefsumme und einmal im
  Scanner. Die AWS CLI und rclone haben den Endpunkt weiterhin nicht gesehen;
  gefahren hat ihn das AWS SDK ueber die HTTP-Bruecke, das oberhalb der Schwelle
  von sich aus teilt.

- 2.98 **Inhaltslogs je Function-Aufruf.** Migration
  `0069_project_function_invocation_output.sql` legt
  `project_function_invocation_output` an: genau eine Zeile je Aufruf, per
  Fremdschluessel an `project_function_invocations (organization_id,
  invocation_id)` gebunden, `ON DELETE CASCADE`, RLS je Mandant, nur SELECT und
  INSERT fuer die Laufzeit, die Zeilen als jsonb. Grenzen je Aufruf als CHECK
  wie in `lib/server/compute/function-output.ts`: 500 Zeilen, 64 KiB, 2 KiB je
  Zeile; darueber wird gezaehlt (`dropped_lines`) und `truncated` gesetzt. Die
  Sandbox (`function-sandbox-docker.ts`) gibt jede stderr-Zeile und jede
  stdout-Zeile, die kein JSON-Objekt ist, an einen `FunctionOutputSink`; eine
  Nicht-JSON-Zeile beendet den Aufruf nicht mehr, und nur Leitungszeilen
  zaehlen gegen die 256 KiB der Antwort. **Gestrichen wird nichts**: Der
  Prozess kennt keinen Geheimniswert (nur Referenzen, kein `--env`, eigene
  Umgebung bleibt draussen), ein Filter waere eine Zusage ohne Deckung.
  Leserouten `compute/invocations/{invocationId}/output` und `compute/output`,
  Ansicht Functions → Function-Logs, Quelle `function_output` im Log-Explorer.
  **Nebenbefund**: `createFunctionInvocationServiceFromEnv` gab `invocationLog`
  seit 1.89 nie mit; im Betrieb hat kein Aufruf je eine Zeile geschrieben.
  Seit 2.67.0 verdrahtet, Vertrag `compute-definitions-runtime-invocation-log`.
  Functions-Stack 32 Faelle (vorher 27), zweimal gruen, drei Mutationsproben
  (Zeilengrenze aus: 2 fallen; stderr als stdout: 4 fallen; Canary per `--env`:
  2 fallen). Postgres-Fall `(2.98)`, 231 gruen.

- 2.99 **SAML 2.0 als Anmeldeweg, ohne fremde SAML-Bibliothek.** Migration
  `0070_project_auth_saml.sql` legt `project_auth_saml_assertions` an: nur die
  `ID` einer schon benutzten Assertion, je Umgebung und Anbieter eindeutig, kein
  XML, keine Adresse, kein Subject. Dazu der Zweck `saml_request` in
  `project_auth_one_time_tokens`. Abgedeckt ist das Web Browser SSO Profile,
  SP-initiiert, Anfrage ueber HTTP-Redirect, Antwort ueber HTTP-POST.
  `lib/server/project-auth/saml-xml.ts` ist ein eigener XML-Leser mit
  exklusiver Kanonisierung; `saml.ts` ist die Pruefung. **Die Formen, die der
  Leser annimmt und ablehnt, stehen vollstaendig in seinem Kopfkommentar und im
  Handbuch** — abgelehnt werden Kommentare, `DOCTYPE`, CDATA,
  Verarbeitungsanweisungen, benannte Entities, doppelte `ID`-Werte,
  undeklarierte Praefixe, jede Kanonisierung ausser exklusiv, jeder Digest
  ausser sha256, jede Signatur ausser rsa-sha256 und ecdsa-sha256 und jede
  `EncryptedAssertion`. **Die offene Anfrage wird absichtlich nicht
  verbraucht**: Sonst wiese die zweite Einreichung derselben Assertion mit
  "Zustand unbekannt" ab, und der Riegel in der Datenbank waere eine
  Behauptung. Routen `saml/{provider}/authorize`, `saml/{provider}/acs` (ohne
  Origin-Gate und ohne Projekt-Key, weil der Anbieter das Formular schickt),
  `saml/providers` und `admin/saml`; Ansicht Auth → Anmeldeverfahren.
  **Die Gegenstelle ist kein fremdes Produkt**: `tests/support/saml-idp.ts`
  unterschreibt mit `node:crypto` und baut sein X.509-Zertifikat als DER
  selbst. Interoperabilitaet mit SimpleSAMLphp, Keycloak oder Shibboleth ist
  damit **nicht** belegt. **Offen**: kein Single Logout, keine IdP-initiierte
  Anmeldung, keine verschluesselten Assertions. Nachgezogen: der Aufraeumer
  nimmt `project_auth_saml_assertions` jetzt mit, es gibt eine Metadaten-Route,
  und eine `AuthnRequest` laesst sich je Anbieter unterschreiben.
  Auth-Stack 11 Faelle (vorher 7), Postgres-Faelle `(2.99)` und `(2.104)`.

- 2.94 **Die Zustimmungen haben
  eine Seite, und ein einzelnes Token faellt.** Zwei Luecken aus 2.92, und beide
  hingen zusammen. Die erste: Die Liste der Zustimmungen stand unter
  `auth-oauth-server` nach Client geordnet. Die Frage eines Betreibers geht
  aber vom Menschen aus, und nach Client geordnet ist sie nur zu beantworten,
  indem man alle Clients durchgeht. Neu ist darum die Seite **Auth →
  Zustimmungen** (`auth-oauth-consents`,
  `components/console/auth-oauth-consents-view.tsx`), nach Nutzer geordnet, mit
  demselben Widerruf und mit dem, was 2.92 gar nicht zeigte: den ausgegebenen
  Token. Beide Seiten lesen **dieselbe** Antwort derselben Route
  (`GET /auth/admin/oauth-clients`); eine zweite Route fuer dieselben Zeilen
  waere eine zweite Stelle, an der eine Zustimmung anders aussehen koennte. Der
  OAuth-Server behaelt die Zahl je Client und verweist. **Was die Seite nicht
  ist**: die Seite des Nutzers. Ein Nutzer sieht seine eigenen Erlaubnisse
  weiterhin nirgends, denn das waere eine Seite hinter seiner eigenen Anmeldung
  im Browser, und der Satz steht auf der Seite. Die zweite Luecke: **Widerruf
  genau eines Tokens**, `DELETE /auth/admin/oauth-tokens/{tokenId}`, dazu
  `revokeOAuthToken` in Dienst und Repository und `listOAuthTokens` fuer die
  Liste. Hier ist der Widerruf **wirklich ein Loeschen**, anders als bei der
  Zustimmung: Ein Token gilt, weil eine Zeile existiert, also braucht es keine
  Spalte `revoked_at` und keine zusaetzliche Bedingung im heissen Weg. Das
  `DELETE`-Recht liegt seit 0063 bei `qkern_auth`, **keine neue Migration**.
  Die Zustimmung bleibt dabei gueltig, die Anwendung darf sich ein neues Token
  holen, und der verbrauchte Code gibt keines mehr her. Fall `(2.94)` in
  `tests/postgres.integration.test.ts`. **Nebenbefund**: Der Fall `(2.91)` war
  auf diesem Zweig rot, seit `slice/consent` hereingezogen wurde. Er ist aelter
  als der Zwang zur Zustimmung aus 2.92 und holte sich einen Code ohne eine;
  seit 2.92 gibt `authorizeOAuth` dafuer keinen mehr heraus. Der Fall grantet
  jetzt zuerst. **Zertifiziert** im Stack `qkern-slice-consentui`
  (`docker-compose.certification.yml`, je Lauf frisch): 31 Dateien, 223 Faelle
  gruen, `postgres.integration` 51 Faelle (vorher 50 und 222). **Zwei
  Mutationsproben**, jede in einem eigenen frischen Lauf: `AND id = $4` im
  `DELETE` des Token-Widerrufs zu `AND id <> $4`, und im Dienst der Wurf
  `RESOURCE_NOT_FOUND` bei fehlender Zeile durch ein stilles Zurueckgeben
  ersetzt. Beide Male fiel genau ein Fall, 2.94, und sonst keiner: einmal, weil
  das widerrufene Token noch galt (Zeile 10231), einmal, weil der zweite
  Widerruf aufloeste statt abzulehnen (Zeile 10273). `STATUS.md` zaehlt fuer
  den Control-Plane-Block jetzt 61 Real-DB-Faelle; der Vertrag
  `status-module-counts-contract` verlangt die Zahl, ein Slice kann die Datei
  also nicht auslassen. Die Seite wurde nicht im Browser geoeffnet; belegt ist ihr
  erster Renderdurchlauf ueber `console-view-render-contract`, nicht der Klick.

- 2.92 **Eine Zustimmung ist eine Zeile.** Migration `0064_project_auth_oauth_consents.sql` legt
  `project_auth_oauth_consents` an (Nutzer, Client, Bereiche, `granted_at`,
  `revoked_at`) und haengt `consent_id` an Codes und Token. Damit schliessen sich
  die drei offenen Punkte aus 2.82 als **eine** Sache: Widerruf je Zustimmung
  statt nur je Client, eine Ansicht, wer wem was erlaubt hat, und eine
  Zustimmung, die eine Tatsache in der Datenbank ist statt einer Behauptung der
  Anwendung. **Was das belegt**: dass ein Aufrufer mit dem gueltigen Access Token
  dieses Nutzers genau diese Bereiche ausdruecklich genannt hat, zu diesem
  Zeitpunkt, in einer Anfrage (`POST /auth/oauth/consents`), die nichts anderes
  tut. **Was es nicht belegt**: dass ein Mensch eine Liste gesehen hat. Eine
  eigene Zustimmungsseite gibt es weiterhin nicht, denn sie hiesse, einen
  Anmeldefluss im Browser zu bauen; der Satz steht so auf der Seite und im
  Handbuch. `authorizeOAuth` gibt ohne geltende Zustimmung **keinen Code** mehr
  heraus (`consent_missing`), und verglichen wird auf **genau** diese Bereiche
  und nicht auf mindestens diese: Bei einem Teilmengenvergleich entschiede die
  Reihenfolge der Zeilen, an welcher der Code haengt, und der Widerruf waere ein
  Glueckspiel. Zweimal dieselben Bereiche fuer denselben Client sind **eine**
  Zeile mit dem urspruenglichen Zeitpunkt (Teilindex ueber die nicht
  widerrufenen); andere Bereiche sind eine zweite Zeile, und die erste bleibt
  stehen. **Der Widerruf** wirkt sofort, weil `verifyOAuthToken` die Zustimmung
  in derselben Abfrage mitliest, und er **loescht nicht**: Die Zeile bleibt mit
  beiden Zeitpunkten stehen, `qkern_auth` hat auf der Tabelle kein `DELETE`, und
  ein Waechter laesst `revoked_at` nicht wieder auf NULL. Das Entfernen des
  Clients nimmt die Zustimmungen dagegen wirklich mit (`ON DELETE CASCADE`), und
  die Console sagt den Unterschied an beiden Knoepfen. **Offen**: Ein Nutzer kann
  seine eigene Zustimmung nicht selbst zurueckziehen (nur der Betreiber in der
  Console), und Token aus der Zeit vor 0064 tragen keine Zustimmung und gelten
  darum nicht mehr (hoechstens eine Stunde Wirkung). Neue Routen:
  `POST /auth/oauth/consents` und
  `DELETE /auth/admin/oauth-consents/{consentId}`. Zertifiziert im Fall
  `(2.92)`.

- 2.96 **Die S3-Schluessel oeffnen etwas.** Migration
  `0065_project_storage_s3_access_key_secrets.sql` haengt `secret_ciphertext`
  an `project_storage_s3_access_keys` (AES-256-GCM, Schluessel aus
  `QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY`, AAD ist der oeffentliche Teil)
  und legt `qkern_authenticate_project_storage_s3_access_key(text)` an, eine
  SECURITY-DEFINER-Funktion nur fuer `qkern_runtime`, die ein Paar ueber den
  oeffentlichen Teil holt, solange es weder widerrufen noch abgelaufen ist. Der
  Endpunkt `/s3` (`lib/server/project-storage/s3-endpoint.ts`,
  `app/s3/route.ts`, `app/s3/[...path]/route.ts`) prueft SigV4 im Header
  (`s3-sigv4.ts`) und ruft ausschliesslich `ProjectStorageService` als
  **Service-Rolle** des Paars, beschraenkt auf den Bucket-Satz: ListBuckets,
  HeadBucket, ListObjectsV2, Head/Get/Put/Copy/DeleteObject, DeleteObjects;
  PutObject ist prepareUpload, Einloesen der Zusage beim Provider,
  completeUpload; CopyObject ist Lesezusage der Quelle plus derselbe Weg.
  Seit `2.67.0`: Presigned URLs (Query-Signatur, hoechstens 900 s), aws-chunked
  in allen drei `STREAMING-*`-Formen mit Block- und Trailer-Signatur,
  Pruefsummen `x-amz-checksum-*`, Range. **Was damals fehlte und 501 antwortete**:
  Multipart (gebaut in 2.101), ListObjects v1 (gebaut in 2.123), Bucket anlegen
  oder loeschen (bleibt 501). Paare aus
  2.59 bis 2.65 haben kein Chiffrat (`verifiable: false`) und oeffnen nichts;
  die Seite sagt es je Paar. Zertifiziert im Storage-Stack
  (`tests/project-storage-s3-endpoint.integration.test.ts`, echte Signatur aus
  `node:crypto`, EICAR durch den Endpunkt) und im Fall `(2.96)`.
  Mutationsprobe zu 2.96: Signaturvergleich auf `if (false)`, genau der S3-Fall
  fiel an der gefaelschten Signatur (200 statt 403), die acht anderen blieben
  gruen.
- **Ein echter Client hat den Endpunkt gesehen (2.99).** Der zweite Fall in
  derselben Datei faehrt `@aws-sdk/client-s3` (devDependency, exakt 3.1143.0,
  mit `@aws-sdk/s3-request-presigner`) ueber eine HTTP-Bruecke aus `node:http`
  auf 127.0.0.1 gegen `handle()`. Das SDK waehlt selbst: Pruefsumme im Header
  bei einem Puffer, `aws-chunked` mit `STREAMING-UNSIGNED-PAYLOAD-TRAILER` bei
  einem Strom. **Die AWS CLI und rclone haben ihn nicht gesehen**; beide
  brauchten einen laufenden Next-Server im Zertifizierungsstack, und den gibt
  es dort nicht. Mutationsproben zu 2.99: Blocksignatur ungeprueft, genau der
  Fall `(S3)` fiel; Presigned-Obergrenze auf sieben Tage, genau der Fall
  `(S3-Client)` fiel.
  **Nicht geprueft**: ein echter Client (aws cli, rclone) gegen einen laufenden
  Next-Server; die Pfadkodierung des Canonical Request stammt aus `request.url`
  und ist nur im Handler-Aufruf belegt.

- 2.91 **Der Riegel im Remote-MCP-Server steht jetzt vor OAuth statt vor dem
  Transport.** Ueber OAuth erreichbar sind vier Werkzeuge: Lesen unter
  `data:read`, Einfuegen, Aendern und Loeschen unter `data:write`. Die uebrigen
  zwoelf werden fuer eine solche Sitzung gar nicht erst angemeldet und fehlen
  schon in der Werkzeugliste: Die freie Abfrage und die Schemaliste lesen an der
  Zeilensicherheit vorbei, waehrend `data:read` das Lesen **unter** ihr zusagt,
  und fuer Control Plane, Storage, Queues und die beiden Migrationswerkzeuge gibt
  es keinen Bereich, der sie beschreibt. Die Tabelle steht in
  `mcp/tool-scopes.ts`; ein Werkzeugname ohne Eintrag wirft beim Start. Der
  Mandant kommt vollstaendig aus dem Projekt-Key, die Prozessumgebung gilt auf
  diesem Weg nicht. Der statische Bearer bleibt, aber nur lokal. Zertifiziert im
  Fall `(2.91)`.

- **Dreizehn Konsolenansichten liegen jetzt in eigenen Dateien** unter
  `components/console/`, und der Render-Vertrag aus 2.63 erreicht sie. Der Umzug
  allein war folgenlos; gefunden hat er vier Fehler im ersten Renderdurchlauf:
  Monitoring zeigte acht leere Kaesten und kein Wort, die Live-API behauptete
  "Nicht eingerichtet", bevor sie gefragt hatte, die Freigaben sagten "Regel wird
  geladen" im Perfekt, und sieben Texte liefen nie durch `t()`. **Offen**: Nach
  dem Ausziehen liegen kleine Helfer mehrfach herum (`EmptyState`, `ErrorState`,
  `formatTime`, `CheckIcon`).

- **Befund aus dem Zusammenfuehren, fuer die naechste parallele Runde.** Die
  Schnitte zu 2.91 und 2.92 waren jeder fuer sich gruen und zusammen rot:
  `(2.91)` faehrt einen OAuth-Ablauf ganz durch und kannte die neue
  Zustimmungsregel nicht, weil es ihn im Zustimmungs-Worktree nicht gab. Gefallen
  ist erst der zusammengefuehrte Stand, mit `consent_missing`. Der
  Zertifizierungslauf gehoert deshalb **nach** das Zusammenfuehren.


- Neu in diesem Zweig: 2.82 (Zweig `slice/oauthserver`) **QKERN gibt selbst
  Token aus: Authorization Code mit PKCE, und nur das.** Der Platzhalter
  `auth-oauth-server` ist echt, Migration
  `0062_project_auth_oauth_server.sql` mit drei Tabellen (Clients, Codes,
  Token). Das ist das Gegenstueck zu 2.80: Dort nimmt QKERN fremde Token an,
  hier gibt es eigene aus. **Kein impliziter Ablauf, kein Passwort-Ablauf, kein
  Client-Credentials-Ablauf, kein Refresh Token**, und jede Auslassung steht mit
  Grund im Code, auf der Seite und im Handbuch. Der Client ist oeffentlich und
  hat **keine Spalte fuer ein Geheimnis**; sein Schutz ist PKCE, und nur `S256`
  ist erlaubt (die Datenbank laesst in der Spalte fuer das Verfahren keinen
  anderen Wert zu). Der Code gilt 60 Sekunden, haengt an Client, Ruecksprungziel,
  Pruefsumme und Nutzer, und wird beim Einloesen **verbraucht, bevor irgendetwas
  anderes geprueft wird** (ein `UPDATE ... WHERE consumed_at IS NULL`, das die
  Zeile zurueckgibt); eine zweite Tuer ist die Eindeutigkeit von `code_id` in der
  Token-Tabelle. Das ausgegebene Token ist **undurchsichtig und kein JWT**: Es
  gilt, weil eine Zeile existiert, und genau das macht es widerrufbar; der
  Widerruf geht ueber den Client und nimmt per `ON DELETE CASCADE` dessen Codes
  und alle seine Token mit. **Die Rolle ist immer `authenticated`, nie
  `service_role`**, und diese Grenze steht als Abwesenheit: Es gibt weder am
  Client noch am Token eine Spalte fuer eine Rolle. Drei Bereiche gibt es:
  `identity:read`, `data:read`, `data:write`; das Schreibrecht wird in
  `generatedDataContext` wirklich geprueft, und `projectApplicationPrincipal`
  weist ein OAuth-Token an jeder Tuer ab, die es nicht ausdruecklich zulaesst
  (Vorgabe `reject`), damit Queues und Functions nicht stillschweigend
  mitlaufen. **QKERN schickt selbst keinen 302**: Die Zustimmung ist ein `POST`
  und antwortet mit JSON aus Code, Ziel und `state`; dieselbe Grenze wie bei den
  Ruecksprungzielen aus 2.54. Nebenbei wurde `presentedProjectApiKey` genauer
  gemacht: Ein Bearer gilt nur noch als Projekt-Key, wenn er `qk_public_` oder
  `qk_service_` traegt, sonst waere `qk_oauth_...` an der falschen Tuer
  gelandet. Zertifiziert im Fall `(2.82)`.

- Neu in diesem Zweig: 2.80 (Zweig `slice/thirdparty`) **Fremde Token, gegen
  den Schluesselsatz des Ausstellers geprueft.** Der Platzhalter
  `auth-third-party` ist echt, Migration
  `0061_project_auth_third_party_providers.sql` (0060 bleibt dem parallelen
  Slice). Der Unterschied zum OIDC-Weg ist der ganze Punkt: Dort entsteht ein
  eigener Nutzer und ein eigenes Token; hier nimmt die Data API das Token des
  fremden Dienstes direkt an, und es entsteht **kein** Konto, keine Sitzung, kein
  Refresh Token und damit auch kein Widerruf. **Ein fremdes Token bekommt
  hoechstens `authenticated`, nie `service_role`**, und diese Grenze steht
  dreimal: im reinen Modul
  (`lib/server/project-auth/third-party.ts`), als `CHECK` in 0061 und in
  `assertRequest` der generierten Data API. Das Signaturverfahren kommt aus
  einer Positivliste **und aus dem Schluesseltyp**, nie aus dem Header des
  Tokens; damit fallen `alg: none` und die HS256-Faelschung mit dem
  oeffentlichen Schluessel als Geheimnis. Der Schluesselsatz wird ueber
  `createGuardedFetch` geholt, also ueber dieselbe Adresspruefung wie der Egress
  einer Function, und fuenf Minuten im Prozessspeicher gehalten. Die Ansprueche
  gehen ueber genau denselben Weg in die Zeilensicherheit wie die eines eigenen
  Tokens (`request.jwt.claims`, `request.jwt.claim.role`,
  `request.jwt.claim.sub`), dazu `iss`, damit eine Policy ein fremdes Konto von
  einem eigenen unterscheiden kann. Offen: Die Zahl der Real-DB-Faelle in
  `STATUS.md` steht noch auf 49 und muss beim Release auf 50 gehen; dieser Slice
  darf `STATUS.md` nicht anfassen. Im Browser nicht gesehen
- Frueher in diesem Zweig: 2.78 (Zweig `slice/s3keys`) **S3-Zugang gibt Schlüssel
  aus und sagt, dass sie noch nichts öffnen.** Der Platzhalter `storage-s3` ist
  echt, Migration `0059_project_storage_s3_access_keys.sql` (0058 bleibt dem
  parallelen Slice). Von den zwei möglichen Wegen ist **keiner der beiden
  Zugangswege gebaut**, und beide Gründe stehen im Code. Ein Paar beim Provider
  anzulegen geht nicht: `ProjectStorageProvider` kennt keine Operation für
  Zugangsdaten, und der Dienst legt jedes Objekt jedes Mandanten in **einen**
  Provider-Bucket, getrennt nur über das Präfix. Ein QKERN-Bucket ist eine Zeile
  in `project_storage_buckets`, kein Bucket des Anbieters. Eine SigV4-Prüfung
  gegen QKERN selbst geht nicht, solange nur ein Hash gespeichert wird: Die
  Signatur ist eine HMAC-Kette aus dem Geheimnis, und aus einem SHA-256-Hash
  lässt sie sich nicht rechnen. Gebaut ist deshalb die Ausgabe samt Verwaltung
  (einmal gezeigt, Hash gespeichert, Umgebung plus Bucket-Satz über eine
  Kopplungstabelle mit echtem Fremdschlüssel, widerrufbar), und die Seite sagt
  als ersten Absatz: kein Endpunkt nimmt ein solches Paar heute an. Der
  öffentliche Teil trägt bewusst `QKERNS3…` und nicht die Form eines
  Provider-Schlüssels. Widerruf ist **nicht** löschen: Die Laufzeitrolle hat auf
  `project_storage_s3_access_keys` kein DELETE, nur `UPDATE (revoked_at)`, und
  ein Trigger lässt den Zeitpunkt nur einmal setzen. Wer hier weiterbaut, muss
  **zuerst** entscheiden, wo das Geheimnis liegen soll; ohne diese Entscheidung
  gibt es keinen Pruefweg.
- Neu in diesem Zweig: 2.77 (Zweig `slice/authhooks`) **Auth-Hooks an genau den
  Punkten, an denen sie wirken.** Der Platzhalter `auth-hooks` („Eigener Code
  bei Anmeldung, Token-Ausgabe oder Mailversand") ist echt, und zwar zu zwei
  Dritteln: Gebaut sind `sign_in` (darf die Anmeldung abweisen, laeuft in
  `createSessionResult` und damit auf jedem Anmeldeweg, vor `createSession`) und
  `access_token_claims` (darf Ansprueche aus einer erklaerten Liste setzen,
  laeuft in `sessionResult` und damit auch bei jeder Erneuerung). Der dritte
  Punkt, Mailversand, kommt nicht: Der Link einer Aktionsmail traegt das
  einmalige Token im Klartext, ein Mail-Hook bekaeme damit einen Anmeldeschein.
  **Beide Punkte fallen geschlossen** (keine Antwort in der Frist heisst keine
  Sitzung und kein Token), und die Seite sagt das woertlich samt Preis: Ein
  haengender Hook sperrt die Umgebung aus. Die Frist steht in der Definition
  (100 bis 5000 ms) und beendet das Warten, nicht den Container. Reservierte
  Ansprueche (`sub`, `iss`, `aud`, `exp`, `iat`, `role` und die uebrigen, die
  QKERN selbst ausgibt) weist der Dienst ab, statt sie zu uebergehen; die Liste
  steht in `lib/server/project-auth/hooks.ts`, noch einmal in `tokens.ts` als
  Absicherung und ein drittes Mal als CHECK in
  `0058_project_auth_hooks.sql` (fuenf Spalten auf `project_auth_settings`, wie
  0051 bis 0053, kein `enabled`, weil ein Punkt ohne Function schon aus ist).
  Gerufen wird ueber den **vorhandenen** `FunctionInvocationService`
  (`lib/server/project-auth/hooks-functions.ts`), also mit Kapazitaetsgrenze,
  Kontingent, Egress-Grenzen und Aufrufprotokoll. Der Zertifizierungsfall
  `(2.77)` belegt die ganze Kette gegen die echte Datenbank samt der Abweisung
  eines Hooks, der `role` setzen will, und prueft dabei den **Grund**
  `claim_reserved`, nicht bloss das Scheitern; die Mutationsprobe laesst den
  reservierten Anspruch durch.
- Davor: 2.75 (Zweig `slice/dashhooks`) **Dashboard-Webhooks
  tragen nur, was die Console zeigt.** Der Platzhalter `set-webhooks`
  („Benachrichtigungen bei Ereignissen des Projekts selbst") ist echt. Die
  Quelle ist die **Audit-Kette** der Control Plane (`audit_logs` aus 0001/0002),
  nicht die Projektdatenbank: vier Ereignisarten (`migration_applied`,
  `approval_decided`, `project_state_changed`, `environment_added`), jede mit
  einer Liste von Handlungen aus dem Audit-Log und einer Positivliste von
  Feldern. **Kein zweiter Zustellweg und keine Ereignistabelle**: dieselbe
  Outbox, derselbe Vault-Signierer, dasselbe Backoff und Dead Letter aus `0032`;
  die Kopplung und die Position stehen in
  `0057_project_dashboard_webhooks.sql` (nach 0056 frei, IMMUTABLE-Funktion fuer
  die Artenliste wie 0054, `GREATEST` in der Anweisung, kein DELETE,
  `COLLATE "C"`, `notified_at` getrennt von `updated_at`). Anders als bei den
  Log-Drains wird **nicht gebuendelt**: ein Ereignis, eine Meldung, weil ein
  Projekt am Tag eine Handvoll davon erzeugt. Der Sammler laeuft von Anfang an
  im Compute-Prozess (`QKERN_COMPUTE_DASHBOARD_WEBHOOKS_ENABLED=true`,
  `lib/server/compute/dashboard-webhook-collector-runtime.ts`, Backoff je
  Umgebung, weil es keinen Puffer gibt, der eine Runde ueberdauern muesste).
  Die Feldgrenze haengt an `tests/dashboard-webhook-field-boundary`: Jedes
  gemeldete Feld muss im Zeilentyp der zugehoerigen Ansicht stehen
  (`AuditEvent`, `Approval`, `Project` in `lib/types.ts`, `ReviewItem` in
  `migrations-view.tsx`, `Binding` in `infrastructure-view.tsx`). **Bewusst
  zurueckgehalten**: `actor` bei jeder Art -- die Audit-Ansicht zeigt die
  Referenz des Menschen, in der Control Plane ist das die E-Mail-Adresse des
  Kontos, und eine Benachrichtigung braucht sie nicht; dazu `actionHash` bei
  der Freigabe und `databaseInstanceRef` bei der Umgebung. Die Metadaten
  verlassen die Datenbank nur mit den erlaubten Schluesseln (Positivliste im
  SQL **und** in der Whitelist), `actor_ref`, `actor_type`, `entry_hash` und
  `previous_hash` werden gar nicht gelesen. **Ehrlich offen**: at-least-once,
  kein Nachschicken der Vergangenheit, und die Hashkette geht nicht mit hinaus
  -- aus einer Folge von Meldungen kann ein Empfaenger nicht beweisen, dass
  keine fehlt. Gemeldet wird der **gespeicherte** Zustand und nicht der Badge
  der Audit-Ansicht: Deren Faltung auf drei Werte macht aus dem `succeeded` des
  Provisioners ein `blocked`. PostgreSQL-Fall "(2.75) turns a real project
  event into a signed dashboard webhook delivery". Im Browser nicht gesehen
- Davor: 2.53 Die Webhook-Bruecke laeuft als Prozess, das
  "Ehrlich offen" aus 2.50 ist geschlossen. Der Compute-Prozess
  (`npm run worker:compute`) liest jetzt den Change Feed der
  Projektdatenbanken, die er bedient, und nennt die Bruecke in seiner
  Startzeile. Welche Umgebungen gelesen werden, steht **nicht** in der
  Konfiguration: Aus `QKERN_COMPUTE_SCOPES_JSON` nimmt er die, die in der
  Control Plane eine Kopplung haben. Eine Umgebung mit ausschliesslich
  abgeschalteten Kopplungen bleibt bewusst dabei – sonst wuerde aus dem
  Pausieren ein Stauen. Der Projektdatenbank-Katalog ist **derselbe** wie fuer
  Realtime Changes (`QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON`); nur
  `db/project/0003` erteilt genau dieser Rolle das Leserecht auf dem Feed.
  Migration `0050_project_database_webhook_cursors.sql` haelt die Position je
  Umgebung, monoton ueber `GREATEST`, ohne DELETE-Recht: Ein Neustart
  wiederholt hoechstens einen Stapel und ueberspringt nichts. Eine
  unerreichbare Projektdatenbank bekommt ein verdoppelndes Backoff, die
  uebrigen Umgebungen laufen weiter. PostgreSQL-Fall "(2.53) delivers a table
  change through the running bridge process": 27 statt 26 Faelle im Modul
  Control Plane. Ehrlich offen: Waehrend **alle** Kopplungen einer Umgebung
  weg sind (geloescht, nicht abgeschaltet), wandert ihre Position nicht
  weiter; eine spaeter neu angelegte Kopplung sieht dann, was der Feed
  seither haelt. Im Browser nicht gesehen
- Paketversion: `2.73.0`
- Neuester Slice: 2.63 Gerendert, aufgeraeumt, kein toter Knopf. Drei Schulden
  aus den Releases davor sind bezahlt.

  **`tests/console-view-render-contract`** rendert jede Konsolenansicht
  wenigstens einmal: 79 Komponenten, 93 Faelle, in vier Sprachen also 372
  Durchlaeufe, ueber `renderToStaticMarkup` und **ohne** neue Abhaengigkeit. Er
  findet die Ansichten ueber das Dateisystem, also faellt er, sobald eine neue
  dazukommt und nicht gerendert wird. Was er **nicht** kann, steht in ihm:
  Effekte laufen nicht, also bleiben der fertige Zustand, der Fehlerzustand und
  jede Tabelle mit Zeilen ungesehen. Ein Rendern ohne Effekte ist kein
  Browserbesuch. Vier Ansichten oeffnen im Ruhezustand und stehen namentlich mit
  Begruendung in `OPENS_IDLE`.

  **Der Aufraeumer** (Migration `0063`) laeuft im Compute-Prozess und loescht
  abgelaufene Einmal-Token, OAuth-Token und OAuth-Codes nach **24 Stunden**.
  Die Frist ist mit Absicht laenger als die laengste Lebensdauer dieser
  Artefakte, damit eine geloeschte Zeile nie das Gegenstueck von etwas
  Gueltigem sein kann. Jede Spur bleibt stehen, und
  `project_storage_uploads` ist ausgelassen: Hinter der Zeile stehen Bytes bei
  einem Anbieter.

  **Der Knopf "Backup erstellen" ist weg.** Im Produktquelltext kommt kein
  Backup-Werkzeug vor, und unter den Backup-Routen gibt es genau einen Pfad mit
  genau einem lesenden Verb. Dabei sind zwei Fehler an der PITR-Seite
  aufgefallen: Sie zeigte die Drill-Evidenz so, dass sie sich wie eine Aussage
  ueber diese Projektumgebung liest (der Drill stellt die **Kontrollebene**
  wieder her), und sie rundete Sekunden auf Minuten, wodurch ein Rueckstand von
  29 Sekunden als "0" erschien. Beides ist berichtigt. Im Browser nicht gesehen
- Seit 2.99 ist **kein** Platzhalter mehr uebrig: `storage-analytics` ist eine
  ehrliche Seite (`components/console/analytics-buckets-view.tsx`,
  `lib/console/analytics-buckets-texts.ts`): kein Katalog, keine Engine,
  Multipart am S3-Endpunkt fehlt; das Urteil ueber den Server kommt aus
  `/schema/extensions`. `placeholder-view.tsx` ist weg, `PLACEHOLDERS` bleibt
  als leere Tabelle fuer den naechsten Menuepunkt ohne Seite.
- Slice 2.62 Die letzten Platzhalter. Von den sechsundzwanzig
  Platzhalterseiten, mit denen diese Sitzung begann, war seit 2.93 **einer**
  uebrig: `storage-analytics` (Iceberg). `storage-vectors` ist seit 2.93 eine
  echte Seite: Sie liest den Katalog und sagt, dass dieser Server keinen
  Vektortyp anbietet. Alles andere ist eine echte Seite, und wo es nichts zu
  zeigen gibt, sagt die Seite das mit Grund. Zwei Dinge aus dem Schnitt 2.93,
  die stimmen muessen, wenn jemand die Seite weiterbaut: Alpine 3.24 hat ein
  Paket `postgresql-pgvector`, aber es ist gegen Alpines PostgreSQL 18 gebaut
  und dem selbst gebauten PostgreSQL 17 im Image nutzlos; ein erster Entwurf
  der Seite behauptete, es gebe gar keines, und setzte die Grenze von `cube`
  auf 101; sie liegt bei 100. Die Sonde am Image hat beides gezeigt. Im
  Stack fiel waehrend einer Mutationsprobe einmal `(2.52)` mit dem
  5-Sekunden-Timeout der Vorgabe, im gruenen Lauf davor nicht; der Fall hat
  keinen eigenen Timeout und ist unter Last knapp.

  **Drei Befunde, die ein naechster Agent kennen sollte.** Erstens: **QKERN
  fuehrt keinen Katalog seiner Backups.** Keine der 62 Migrationen legt eine
  Tabelle dafuer an, und der zertifizierte Drill stellt die **Control Plane**
  wieder her, nicht die Projektdatenbank. Wer "in neues Projekt
  wiederherstellen" bauen will, braucht zuerst einen Provisionierungsdienst:
  Den Broker-*Client* gibt es, den Dienst dahinter nicht, die
  Provisioniererrolle hat `NOCREATEDB`, und im Produktquelltext steht kein
  `CREATE DATABASE`. Zweitens: **Im Realtime-Log liegt nur, was ein Client als
  Broadcast geschickt hat.** Zugestellte Datenbankaenderungen werden je
  Abonnent mit dessen Anspruechen gelesen und nie gemeinsam gespeichert,
  Presence gar nicht. Verbindungen liegen in einer Map im Prozessspeicher.
  Drittens, damals: **Eine Rechnungszeile hatte kein Feld fuer eine
  Bezeichnung**, und die Eindeutigkeit je Metrik begrenzte sie auf sechs. Dieser
  Befund ist mit Migration `0080` abgearbeitet; siehe den Eintrag 2.119 oben.

  Der Fall `(2.88)` liegt in `provisioning-port-postgres.integration.test.ts`
  und nicht in `postgres.integration.test.ts`: Dieselbe Beweiskraft, aber die
  Datei wird von `status-module-counts-contract` nicht gezaehlt. Im Browser
  nicht gesehen
- Neuester Slice: 2.61 Ein Ablauf, eine Sprache, drei ehrliche Antworten.
  **`auth-oauth-server`** ist echt, Migration `0062`: genau ein Ablauf
  (Authorization Code mit PKCE), drei Bereiche, Token immer mit der Rolle
  `authenticated`. Die Grenze steht als **Abwesenheit**: Es gibt weder am
  Client noch am Token eine Spalte fuer eine Rolle. QKERN schickt selbst keinen
  302; die Zustimmung ist ein POST mit JSON-Antwort.
  **`int-graphql`** ist echt: lesend, ohne fremde Bibliothek, auf der
  vorhandenen Data API. Was fehlt, ist mehr als was da ist, und jede Auslassung
  hat einen eigenen Ablehnungsgrund. Die Grenzen greifen **vor** der
  Verbindung, und jeder Alias zaehlt einzeln.
  **`compute-logs`, `logs-api`, `logs-pooler`** sind echte Seiten, die sagen,
  dass es ihr Log nicht gibt, und warum: In der Sandbox ist der Standardkanal
  die JSON-Leitung zum Container, es gibt keine Middleware, und es gibt keinen
  Pooler.

  **Drei Dinge fuer den naechsten Agenten.** Erstens: Der Vertrag
  `tests/console-missing-log-views-contract` prueft nicht, dass die Saetze
  dastehen, sondern dass sie **stimmen**; wer ein viertes zaehlendes Modul
  anschliesst, laesst ihn fallen, und das ist Absicht. Zweitens: Eine
  Zusicherung auf die **erste** Zeile einer Abfrage ohne `orderBy` behauptet
  eine Ordnung; der GraphQL-Fall ist genau daran gefallen. Drittens: Beim
  Zusammenfuehren zweier Zweige, die beide einen Fall anhaengen, wird der Block
  an der Kopfzeile des naechsten Falls geschnitten, nicht an einer
  Klammerbilanz: Ein Fall mit GraphQL-Schnipseln hat unbalancierte Klammern im
  Text. Im Browser nicht gesehen
- Neuester Slice: 2.60 Anmelden ohne Passwort, vertrauen mit Grenze.
  **`auth-passkeys`** ist echt, Migration `0060`: WebAuthn fuer die
  Projekt-Anmeldung, ohne fremde Bibliothek, nur `node:crypto`. Die
  Herausforderung wird in der Datenbank verbraucht (ein UPDATE, das nur bei
  `NULL` setzt und nur dann eine Zeile zurueckgibt), der Zaehler wird mit dem
  gelesenen Stand im WHERE geschrieben, und die Sitzung entsteht in
  `beginAuthenticatedSession` -- es gibt **keinen** zweiten Weg zur Sitzung,
  also laufen Hook, MFA-Erzwingung und Grenzen mit. Was **nicht** geprueft
  wird, steht als Satz auf der Seite: Attestation, Verfahren ausser ES256,
  Unterdomaenen, Benutzerbestaetigung als zweiter Faktor.
  **`auth-third-party`** ist echt, Migration `0061`: Ein Token eines fremden
  Ausstellers kommt hoechstens als `authenticated` an, **nie** als
  `service_role`, und die Grenze steht dreimal (reines Modul, `CHECK` in 0061,
  Eingangspruefung der Data API). Das Verfahren kommt aus der Positivliste und
  aus dem Schluesseltyp, nie aus dem Header. **`branches`** ersetzt zwei
  Platzhalter und sagt im ersten Absatz, dass es keine frei benannten Zweige
  gibt.

  **Zwei Fallen, in die der Lauf gegen die echte Datenbank gefuehrt hat.**
  PostgreSQL erlaubt in einem regulaeren Ausdruck hoechstens **255**
  Wiederholungen; `{16,1364}` ist kein gueltiges Muster. Und ein
  EC-Schluessel im DER-Format traegt seinen einen Teil im Klartext, sodass
  base64url davon je nach erstem Byte des anderen woertlich im Schluessel
  steht -- eine Zusicherung darauf ist in einem von vier Laeufen falsch. Im
  Browser nicht gesehen
- Neuester Slice: 2.59 Zwei Hooks, die geschlossen fallen, und Schluessel, die
  nichts oeffnen. **`auth-hooks`** ist echt, Migration `0058`: zwei Punkte,
  `sign_in` (darf abweisen, laeuft in `createSessionResult` vor
  `createSession`, nicht bei einer Erneuerung) und `access_token_claims` (darf
  Ansprueche aus einer erklaerten Liste setzen, laeuft vor **jedem**
  Schreibzugriff, also auch bei jeder Erneuerung). **Beide fallen geschlossen**:
  keine Antwort in der Frist heisst keine Sitzung und kein Token, und ein Hook,
  der haengt, sperrt die Projektumgebung aus. Reservierte Ansprueche stehen
  dreimal (reines Modul, Token-Ausgabe, `CHECK` in `0058`). Keinen Mail-Hook,
  weil der Link einer Aktionsmail das Token im Klartext traegt.
  **`storage-s3`** ist echt, Migration `0059`, aber das Paar **oeffnet heute
  nichts**, und der erste Absatz der Seite sagt das: Beim Anbieter laesst sich
  kein Paar anlegen (alle Objekte aller Projekte liegen in einem Bucket,
  getrennt nur ueber das Praefix), und gegen QKERN selbst laesst es sich nicht
  pruefen, solange nur sein Hash liegt.

  **Zwei Dinge fuer den naechsten Agenten.** Erstens: Der Auth-Weg wird in fast
  jeder Route geladen. Ein **statischer** Import der Compute-Seite in
  `project-auth/runtime.ts` haengt damit an jedem Modul, das Project Auth
  anfasst; der Aufrufdienst wird darum ueber einen Lader geholt und erst beim
  ersten Hook-Aufruf geladen. Zweitens: `tests/openapi-route-coverage` prueft
  seit 2.59 auch die **Verben**, in beide Richtungen, und laesst jede
  Exportform fallen, die es im Bestand nicht gibt. Im Browser nicht gesehen
- Neuester Slice: 2.58 Ein ausgelieferter Fehler und ein Vertrag gegen das
  Nachhinken. **Der Fehler, und er ist der wichtigste Teil**: Der Treiber gibt
  `timestamptz` als JavaScript-`Date` heraus, und ein `Date` kennt nur
  Millisekunden. Wer daraus eine Position baut, hat eine Position, die
  **kleiner** ist als die Zeile, aus der sie stammt; ein Zeilenvergleich
  `(zeit, id) > (zeit, id)` laesst dieselbe Zeile dann bei jedem Lauf wieder
  durch. Der Zeitanteil einer Position kommt darum aus
  `to_char(... 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')` und nie aus
  `toISOString`. Betroffen waren vier von fuenf Lesungen in
  `log-drain-postgres-repository` (seit 2.54 ausgeliefert) und der neue Leser
  der Dashboard-Webhooks. Wer eine weitere Quelle mit einem
  datenbankgesetzten Zeitpunkt anschliesst, faellt in dieselbe Grube.

  **Und eine Lehre zur Mutationsprobe**: Die erste Probe zu diesem Fehler ist
  nicht gefallen, weil der Fall den Sammler prueft und eine wieder
  hereingelesene Zeile sich in dessen Puffer legt. Geprueft wird jetzt der
  Leser. Eine Probe, die nicht faellt, ist die einzige Stelle, an der ein zu
  schwacher Fall auffaellt.

  Dazu: `db-pipelines` ist echt (Replikation mit dem Rueckstand der Slots,
  `subconninfo` wird nicht ausgewaehlt), `set-webhooks` ist echt
  (Dashboard-Webhooks auf der vorhandenen Zustellkette, Migration `0057`), und
  `lib/openapi.ts` hat 27 fehlende Pfade bekommen. Der Vertrag
  `tests/openapi-route-coverage` haelt sie dort; er prueft **Pfade, nicht
  Methoden**, und das ist die naechste offene Aufgabe. Im Browser nicht gesehen
- Davor: 2.57 Drei Seiten, die mit dem beginnen, was sie nicht haben.
  `logs-postgres` heißt jetzt **Postgres-Zustand**: Ein Serverlog gibt es
  nicht; der Server dieses Stacks laeuft ohne Sammler und schreibt auf stderr
  seines Prozesses, und seit `2.109` leitet die Seite das Urteil darueber aus
  `logging_collector` und `log_destination` ab. Gelesen wird
  über `inspectDatabaseHealth` aus `pg_stat_database` und, je nach
  Serverversion, `pg_stat_checkpointer` oder `pg_stat_bgwriter`; welche Sicht
  es gibt, fragt der Dienst mit `to_regclass` nach, weil ein unbekannter Name
  schon beim Parsen scheitert. Ohne Datenprüfsummen meldet die Antwort
  `null` und nicht `0`. `auth-performance` zeigt, **was** scheitert, je
  Handlungsart und seit wann, und sagt, dass es **keine** Antwortzeit gibt:
  Die Audit-Kette hält einen Zeitpunkt je Eintrag, keine Dauer.
  `int-wrappers` liest fremde Datenquellen über `inspectForeignDataWrappers`;
  `srvoptions` darf jede Rolle lesen, die den Katalog liest, und darum zeigt
  QKERN den Wert nur bei Schlüsseln auf einer **Positivliste**
  (`SHOWN_SERVER_OPTION_KEYS`), `umoptions` gar nicht.

  Drei Dinge für den nächsten Agenten. **`docs/RELEASE_2.57.md` gab es schon
  einmal** als Datei, mit den Fallnummern eines Schnitts als Versionsnummer;
  sie heißt jetzt `docs/SLICE_BERATERREGELN.md`. **Das Scratchpad ist zwischen
  parallelen Agenten geteilt**: Sicherungsdateien brauchen eindeutige Namen.
  Und **zwei Zweige hängen ihren Fall an dieselbe Stelle** von
  `tests/postgres.integration.test.ts`; beide Seiten des Konflikts zu behalten
  schiebt die Fälle ineinander, der neue Fall gehört als ganzer Block
  eingesetzt. Im Browser nicht gesehen
- Davor: 2.56 Drei Leseflächen, drei ausgesprochene Grenzen.
  `obs-query-performance` liest `pg_stat_statements` über
  `inspectStatements` und zeigt **keinen Abfragetext**, auch keinen
  normalisierten: Ein Utility-Befehl steht mit seinem Literal in der Sicht,
  also auch das Passwort aus einem `CREATE ROLE`, und auch eine normalisierte
  Abfrage trägt noch Bezeichner. `obs-query-insights` plant über
  `explainReadQuery` mit `EXPLAIN (FORMAT JSON, COSTS ON, VERBOSE OFF,
  SUMMARY ON)` und **ohne `ANALYZE`**; die Prüfung auf eine lesende Abfrage
  steht **vor** dem Präfix, sonst wäre `EXPLAIN ANALYZE DELETE` möglich, und
  die Bedingungstexte der Knoten bleiben draußen, weil sie die Literale
  tragen. `set-infrastructure` liest über `inspectRuntime` und
  `listProjectEnvironments`, was der Server über sich sagt; Lese-Replikate
  gibt es nicht, und das steht als Zeile mit Grund da.

  Zwei Dinge für den nächsten Agenten, beide aus dem Parallelbetrieb. Erstens:
  Die **Fallnummer** in `tests/postgres.integration.test.ts` vergeben drei
  Agenten gleichzeitig gleich; sie ist beim Zusammenführen zu prüfen, hier
  wurde auf 2.67, 2.68 und 2.69 verteilt. Zweitens: **`git stash` gehört dem
  Repository, nicht dem Arbeitsbaum.** Ein `git stash pop` in einem
  Arbeitsbaum greift den Stash eines anderen. In parallelen Arbeitsbäumen
  wird kein Stash benutzt, sondern eine Dateikopie. Im Browser nicht gesehen
- Davor: 2.55 Log-Explorer und Drain-Sammler, dazu zwei Befunde.
  `logs-explorer` ist echt: eine **strukturierte** Suche ueber die drei
  Quellen mit einer Leseroute ueber die ganze Umgebung (Auth-Protokoll,
  Aufrufprotokoll, Stand der Speicherobjekte), gemischt zu einer Liste,
  neueste zuerst, mit Quelle und Kennung als Nachrang. Freies SQL bekommt
  die Seite **bewusst nicht**, und der Grund steht in
  `lib/console/log-explorer`: Alle log-artigen Zeilen liegen in der Control
  Plane, wo die Zeilen aller Organisationen in denselben Tabellen stehen.
  Was der Explorer nicht erreicht, steht mit Grund in
  `LOG_EXPLORER_OUT_OF_REACH`. Der **Drain-Sammler** laeuft seit 2.55 als
  Prozess (`npm run worker:compute`) und haelt seinen Stand in
  `project_log_drain_cursors` (Migration `0056`); ein Neustart springt nicht
  mehr auf die Spitze.

  Zwei Befunde, die ein naechster Agent kennen sollte. Erstens:
  `timestamptz::text` schreibt den Versatz **zweistellig**, wenn er auf volle
  Stunden faellt (`+00`, nicht `+00:00`). Wer daraus mit einem angehaengten
  `Z` ein Datum baut, bekommt `Invalid Date` -- und im Faecher wurde daraus
  stumm eine Quelle im Zustand `failed` und eine halbe Liste. Zweitens: Der
  Zertifizierungsfall "(2.65)" hatte sich die Lesungen der Route nachgebaut,
  weil er die Route ohne HTTP nicht betreten konnte, und belegte damit seine
  eigene Kopie; der Filter `authStatus` stand in der Route und im Fall gar
  nicht, und beide waren gruen. Die Lesungen liegen jetzt in
  `lib/server/logs/log-explorer-fetchers`, Route und Fall setzen nur noch
  die **Tuer** ein. Wer eine neue Quelle anschliesst, baut sie dort und
  nirgends sonst. Im Browser nicht gesehen
- Davor im selben Release: 2.55 Eigene Darstellung. `set-dashboard` ist echt. Fuenf
  Einstellungen je Person (Sprache, Formatgebietsschema, Zeitzone, Startseite,
  helles oder dunkles Aussehen), abgelegt in `user_console_settings`, Migration
  `0055_user_console_settings.sql` (nach 0054 frei) — **neben** `users` und
  nicht darin, weil die Anmelderolle sonst ein UPDATE auf der Tabelle mit den
  Passworthashes braeuchte. Route `GET`/`PUT /v1/auth/console-settings` durch
  dieselbe Tuer wie die uebrigen Kontorouten. Der Punkt des Slices ist das
  **Wirken**: rund vierzig Formatierer in `components/console` (alle mit
  `de-CH` fest im Code, alle stillschweigend in der Browserzone) laufen jetzt
  durch `lib/console/display-settings`, gebunden ueber
  `components/console/console-display`; der Vertrag
  `tests/console-display-contract` verbietet in `components/console` jedes
  `Intl.DateTimeFormat`, `Intl.NumberFormat`, `toLocale*` und `toFixed`. Die
  Vorgaben bilden das Verhalten vor 2.55 Zeichen fuer Zeichen ab. **Bewusst
  ausgenommen**: Geld bleibt im Ledgerformat aus 2.37, und ein Kalendertag
  bleibt ISO, weil er keine Uhrzeit hat, in die sich eine Zone umrechnen
  liesse. Im Browser nicht gesehen
- Aktueller Slice: 2.54 Was hinausgeht – drei Implementierer parallel.
  **Log-Drains**: `set-log-drains` ist echt, und die harte Grenze lautet: ein
  Drain traegt nur, was die Console ohnehin zeigt. Weitergeleitet wird eine
  Positivliste je Quelle (`lib/console/log-drains.ts`), und ein Test liest die
  Zeilentypen der Konsolenansichten aus den Quelldateien und prueft jedes
  Feld dagegen; ein Gegentest haelt fest, dass `invokedBy` und `ownerSubject`
  in der Console stehen und im Drain fehlen, weil sie eine Adresse tragen
  koennen. Zustellung ueber den vorhandenen Outbox- und Signaturweg aus 2.50,
  Migration `0054`. Das Cron-Log ist bewusst keine Quelle (es wird je Anfrage
  rekonstruiert), und Zustellungen eines Drains sind von der Quelle
  `webhook_deliveries` ausgenommen, sonst erzeugte jede Ladung die naechste.
  **SQL-Vorlagen**: `sql-templates` ist echt, zehn nur lesende Vorlagen im
  Editor; Auswaehlen fuegt ein, ausgefuehrt wird nichts. Zwei Vorlagen nehmen
  Parameter, und die gehen durch dieselbe Bezeichnergrammatik wie der
  Tabellen-Designer, mit denselben feindlichen Eingaben im Test. Keine
  Vorlage liest die Spalte `query`. **Anmelderechte**: `auth-policies` ist
  echt und beantwortet die Frage von der Anmeldeseite her. Befund: Ein
  angemeldeter Nutzer wird **keine** eigene Datenbankrolle; es gibt nirgends
  `SET ROLE`. Jede Anfrage laeuft ueber die eine Anwendungsrolle, die Identitaet
  steckt in transaktionslokalen Anspruechen, und der Dienst prueft je
  Transaktion, dass diese Rolle kein Superuser ist, RLS nicht umgeht und
  keiner Gruppe angehoert. Zweiter Befund: Eine Tabelle ohne Zeilensicherheit
  ist nicht offen, sondern fuer die Data API unerreichbar. Das Urteil sagt je
  Zeile, was es nicht wissen kann. PostgreSQL-Faelle "(2.61)", "(2.62)",
  "(2.63)": 198 statt 195. Drei Mutationen fallen, zwei davon doppelt.
  Offen: Der Sammler der Drains hat noch keinen dauerhaften Aufrufer, wie die
  Webhook-Bruecke bis 2.51. Im Browser nicht gesehen
- Vorheriger Slice: 2.53 Was das Passwort verraet – drei Implementierer
  parallel. **Passwortschutz**: `auth-protection` ist echt, aber nur in dem
  Teil, der ohne fremden Dienst auskommt. Ein Abgleich bei einem externen
  Anbieter hiesse, dass jede Anmeldung jedes Kunden zu einem fremden Rechner
  reist. Geprueft wird gegen eine lokale Liste
  (`lib/server/project-auth/password-leaks.ts`), Migration `0053`, durchgesetzt
  in `signUp` und `resetPassword`. Die eingebaute Liste hat 25 benannte
  Eintraege, und alle sind kuerzer als die 12 Zeichen, die QKERN ohnehin
  verlangt: ohne eigene Datei weist der Schalter nichts ab, was die
  Laengenregel nicht schon abweist. Das steht in Modul, Ansicht, Handbuch und
  zwei Tests. Anders als die Zaehlbremse faellt der Abgleich nicht offen: eine
  kaputte Liste laesst den Dienst nicht starten. **Datenbank-Einstellungen**:
  `db-settings` zeigt Rollen, TLS-Zustand und Grenzen. Pooler und
  Netzbeschraenkung gibt es nicht, und die Ansicht sagt das, statt eine
  Oberflaeche fuer nichts zu bauen. **Punkt-in-Zeit**: `db-backups-pitr` ist
  echt, und die Uebung aus 2.29 beweist laengst eine Wiederherstellung auf
  einen gewaehlten Zeitpunkt (Markierung davor da, danach weg); sie wurde
  deshalb nicht angefasst, auch weil ihr Beleg signiert ist und ein
  zusaetzliches Feld die Signatur ungueltig gemacht haette. Fuer echte
  Installationen fehlt jede Archivkonfiguration, also sagt die Ansicht zuerst:
  kein Archiv, keine Wiederherstellung auf einen Zeitpunkt.
  PostgreSQL-Faelle "(2.59)" und "(2.60)": 195 statt 193. Zwei Mutationen
  fallen. Im Browser nicht gesehen
- Davor: 2.52 Grenzen, Geheimnisse, alte Versprechen – drei
  Implementierer parallel. **Grenzen je Zeitfenster**: `auth-rate-limits` ist
  echt, und die Bremse zaehlt jetzt in der Datenbank
  (`project_auth_rate_counters`, Migration `0052`) statt im Arbeitsspeicher
  eines Prozesses. Drei Befunde: die alte Bremse zaehlte je Prozess (bei n
  Instanzen also n-fach), sie zaehlte nach einem Hash der Client-Adresse und
  warf ohne gesetzte Proxy-Einstellung alle in einen Topf, und das
  Auffrischen von Token hatte gar keine Grenze. Gezaehlt wird nach Identitaet
  oder Sitzungsfamilie, nie nach Adresse; der Schluessel steht nur als
  Pseudonym in der Zeile. Bei einem Fehler des Zaehlers geht der Versuch
  durch, weil die Passwortpruefung dahinter steht und ein Zaehlerfehler sonst
  die ganze Anmeldung ausfallen liesse. **Vault-Uebersicht**: `int-vault` ist
  echt, zeigt jede Referenz mit ihrem Zustand und keinen einzigen Wert; der
  Vault wird bewusst nicht aufgelistet, weil ein Pfadverzeichnis in einer
  Webkonsole die Struktur des Schluesselspeichers preisgaebe.
  Vault-Zertifizierung 7 auf 8 Faelle. **Alte Versprechen**: vier Punkte aus
  2.39, 2.40, 2.44 und 2.46 eingeloest. Zwei Regeln, die dauerhaft auf "nicht
  geprueft" standen, laufen; `slow_statement` liest einen sicheren Ausschnitt
  ohne die Spalte `query`, und das Feld, das den Text haette tragen koennen,
  ist aus dem Typ verschwunden. Die Gesundheit hat einen sechsten Zustand
  `configured`: `ok` heisst jetzt gefragt und geantwortet. Der
  Datenbankbericht nennt die fuer diese Rolle unsichtbaren Verbindungen als
  Zahl. Der Stack laedt dafuer `pg_stat_statements`.
  PostgreSQL-Faelle "(2.56)" und "(2.57)": 193 statt 191. Drei Mutationen
  fallen. Im Browser nicht gesehen
- Davor: 2.51 Die Bruecke laeuft – drei Implementierer parallel.
  **Webhook-Prozess**: Die Bruecke aus 2.50 war gebaut, zertifiziert und
  untaetig; jetzt laeuft sie im Compute-Worker
  (`lib/server/compute/database-webhook-bridge-runtime.ts`), eine Schleife
  ueber die Umgebungen mit Kopplung, eine Projektverbindung zur Zeit,
  Verdopplungs-Backoff je Umgebung, feste Fehlercodes ohne Datenbankmeldung.
  Die Position ist dauerhaft (Migration `0050`, `GREATEST` in der Anweisung,
  kein DELETE-Recht); laesst sie sich nicht lesen, startet die Umgebung
  nicht, statt bei null zu beginnen. Umgebungen mit ausgeschalteten
  Kopplungen bleiben bewusst in Beobachtung, sonst wuerde Ausschalten
  aufstauen statt pausieren. **Ruecksprungziele**: je Umgebung eine Liste
  (Migration `0051`, Spalte in `project_auth_settings`), durchgesetzt an der
  einzigen Engstelle `returnTarget`, die der Vertragstest genau viermal
  aufgerufen sehen will. Befund: QKERN leitet nirgends selbst um, das Ziel
  reist nur in die Mailadresse und in den OIDC-Zustand. Mailweg und
  Vorlagen sind nur lesend; die Vorlagenansicht zeigt den Text aus derselben
  Funktion, die ihn versendet. **Protokolle**: Function-Aufrufe mit Ausgang
  und Dauer; das Protokoll traegt weder Containerausgabe noch
  Ausgangsverbindungen noch einen Endzeitpunkt, und die Ansicht sagt das.
  Fuer die Data API gibt es kein Protokoll je Anfrage; der Zaehler mischt
  alle Quellen, also ist er nicht einmal eine Obergrenze fuer sie allein.
  PostgreSQL-Faelle "(2.53)", "(2.54)", "(2.55)": 191 statt 188. Drei
  Mutationen fallen. Im Browser nicht gesehen
- Davor: 2.50 Zweiter Faktor und Datenbank-Webhooks – zwei
  Implementierer parallel, danach zusammengefuehrt. **Zweiter Faktor**:
  `auth-mfa` ist eine echte Ansicht, und der Schalter wirkt an drei Stellen
  in `lib/server/project-auth/service.ts`, nicht in der Console: beim
  Entstehen der Sitzung, beim Auffrischen (die Familie wird widerrufen, nicht
  bloss abgelehnt) und bei jeder Pruefung eines Zugriffstokens, was das
  Restfenster von bis zu 15 Minuten schliesst. Wer keinen Faktor hat, bekommt
  statt einer Sitzung einen Einrichtungsschein (`qk_enroll_`, 15 Minuten, nur
  als Verifikator gespeichert, oeffnet nur die Einrichtung). Migration
  `0048_project_auth_mfa_enforcement.sql`. Dabei kam ein alter Fehler ans
  Licht: `recovery_code_hashes` ist jsonb, und der Treiber machte aus dem
  JavaScript-Feld ein Postgres-Feld – die Einrichtung des zweiten Faktors
  scheiterte an der echten Datenbank, in zwei Pfaden, und kein Fall ging
  bisher diesen Weg. **Datenbank-Webhooks**: `int-webhooks` ist eine echte
  Ansicht; gekoppelt wird ueber den vorhandenen Change Feed
  (`qkern_internal.change_feed`), kein zweiter Trigger in der Kundendatenbank.
  Eine Zustellung traegt Schema, Tabelle, Vorgang, Primaerschluessel, Position
  und Zeitpunkt – und nichts sonst, weil der Feed selbst keine
  Zeilenwerte fuehrt. Migration `0049_project_database_webhooks.sql` (beide
  Zweige hatten 0048 vergeben). Der Stack hat jetzt einen Vault-Dienst, weil
  der Fall eine echte Projektdatenbank und einen echten Vault gleichzeitig
  braucht. **Ehrlich offen**: Die Bruecke hat noch keinen dauerhaften
  Aufrufer, sie ist gebaut und zertifiziert, aber untaetig. PostgreSQL-Faelle
  "(2.50)" und "(2.52)": 188 statt 186. Die Mutationsprobe entlarvte den
  Webhook-Fall: ohne eine zweite, nicht gekoppelte Tabelle bewies er nichts
  ueber den Tabellenfilter; seit `510be1c` tut er es. Im Browser nicht gesehen
- Slice 2.63 (Zweig `slice/logdrains`): **Log-Drains tragen nur, was die
  Console schon zeigt.** Der Platzhalter `set-log-drains` ist weg;
  `components/console/log-drains-view.tsx` ist eine echte Seite. Fuenf Quellen
  (`auth_audit`, `function_invocations`, `storage_objects`,
  `webhook_deliveries`, `usage_series`), je mit einer festen Feldliste in
  `lib/console/log-drains`, die an der Projektion der zugehoerigen
  Console-Ansicht haengt: `tests/log-drain-field-boundary` liest die `.tsx` und
  verlangt fuer jedes weitergeleitete Feld einen Eintrag in ihrem Zeilentyp.
  Durchgesetzt zur Laufzeit von einer Whitelist (`projectLogDrainEntry`), nicht
  vom SQL. **Zurueckgehalten**, obwohl die Console sie zeigt: `invokedBy` und
  `ownerSubject` (Akteursreferenzen bis 320 Zeichen, eine E-Mail passt hinein)
  und `bucketId`. **Kein zweiter Zustellweg**: dieselbe Outbox, derselbe
  Vault-Signierer, dasselbe Backoff und Dead Letter aus `0032`; die Kopplung
  steht in `0054_project_log_drains.sql` (nach 0053 frei), mit einer
  IMMUTABLE-Funktion statt 31 ausgeschriebener Arrays fuer die Quellenliste.
  Gebuendelt nach Anzahl oder Alter, mit `schemaVersion` an der Definition.
  `webhook_deliveries` ueberspringt die Zustellungen der Drains selbst, sonst
  speiste sich die Quelle aus ihrer eigenen Wirkung. Seit Slice 2.64 (Zweig
  `slice/draindaemon`) betreibt der Compute-Prozess den Sammler:
  `lib/server/compute/log-drain-collector-runtime.ts` entdeckt die Umgebungen
  mit mindestens einem Drain, sammelt je Drain einzeln mit eigenem Backoff und
  haelt die Position dauerhaft je Drain **und** Quelle in
  `0056_project_log_drain_cursors.sql` (nach 0054 frei, `GREATEST` in der
  Anweisung, kein DELETE, `COLLATE "C"`, `forwarded_at` getrennt von
  `updated_at`). Angeschaltet mit `QKERN_COMPUTE_LOG_DRAINS_ENABLED=true`; die
  Ansicht zeigt daraufhin je Drain, wann er zuletzt weitergeleitet hat.
  **Ehrlich offen**: at-least-once bleibt -- zwischen dem Einreihen einer
  Ladung und dem Festhalten ihrer Position liegt ein Augenblick, und ein
  offener Puffer geht beim Anhalten nicht hinaus, sondern wird neu gelesen; das
  Cron-Log ist keine Quelle, weil es rekonstruiert und nicht gespeichert wird.
  PostgreSQL-Faelle "(2.63) forwards only the fields the console already shows"
  und "(2.64) forwards through the running collector process and continues
  after a restart". Im Browser nicht gesehen
- Slice 2.60 (Zweig `slice/protection`): **Passwoerter gegen bekannte Lecks,
  ohne fremden Dienst.** Der Platzhalter `auth-protection`
  („Angriffsschutz": Captcha, Passwortpruefung gegen bekannte Lecks,
  Bot-Abwehr) ist weg; `components/console/auth-protection-view.tsx` heisst
  **Passwortschutz** und baut **eines** der drei Dinge. Drei Werte je
  Projektumgebung in `project_auth_settings` (Migration
  `0053_project_auth_password_protection.sql`: `leaked_password_check`,
  `password_min_length` 12–128, `leaked_password_notice` `named`/`generic`;
  keine neue Tabelle, die Liste steht **nie** in der Datenbank). Vorgabe:
  aus. Kein fremder Dienst und ausdruecklich **kein** Have I Been Pwned —
  auch kein Hashpraefix geht hinaus, weil das jede Registrierung jedes Kunden
  an einen fremden Host schicken wuerde; `lib/server/project-auth/password-leaks.ts`
  importiert nur `node:crypto`. Durchgesetzt im Dienst an den **beiden**
  Stellen, die ein Passwort setzen (`signUp`, `resetPassword`), nie in Console
  oder Route. Eine Installation zeigt mit
  `QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE` auf eine Datei mit SHA-1- oder
  SHA-256-Digests oder Praefixen (Format der bekannten Listen, `:Anzahl` wird
  verworfen; gleiche Laenge je Zeile, min. 16 Hexzeichen, max. 1 Mio.
  Eintraege und 16 MiB); eine fehlende oder kaputte Datei laesst Project Auth
  **nicht starten** statt still auf die eingebaute Liste zurueckzufallen.
  **Ehrlich offen:** Die eingebaute Liste sind 25 Eintraege (SplashData,
  „Worst Passwords of the Year 2019", Rang 1–25) und **alle sind kuerzer als
  die 12 Zeichen, die der Dienst ohnehin verlangt** — ohne Datei lehnt die
  Pruefung nichts ab, was die Laengenregel nicht schon ablehnt. Das steht auf
  der Seite, im Handbuch und im Zertifizierungsfall. Ablehnung ist `400`:
  `LEAKED_PASSWORD` nennt das Leck (handelbar, kein Geheimnis),
  `WEAK_PASSWORD` nennt nur die Regeln; **nie** wie oft oder woher. **Fail
  closed** auch auf einem Fehler, anders als der Zaehler aus 2.56. Bestehende
  Konten werden nicht geprueft: Argon2id ist nicht lesbar.
  PostgreSQL-Fall "(2.60) refuses a known leaked password at sign-up when the
  project requires it": 32 statt 31 Faelle in
  `tests/postgres.integration.test.ts`. Nicht gebaut und begruendet: kein
  Captcha (braucht fremden Dienst und Browser-Herausforderung), keine
  Bot-Abwehr ueber die Grenzen aus 2.56 hinaus. Im Browser nicht gesehen
- Slice 2.56 (Zweig `slice/ratelimits`): **Grenzen je Zeitfenster, in der
  Datenbank gezaehlt.** Der Platzhalter `auth-rate-limits` ist weg;
  `components/console/auth-rate-limits-view.tsx` ist eine echte Ansicht mit
  genau einem Schreibweg. Drei Grenzen je Projektumgebung (`sign_in`, `mail`,
  `refresh`), jede mit Maximum und Fenster, in `project_auth_settings`
  (Migration `0052_project_auth_rate_limits.sql`, sechs Spalten plus die neue
  Zaehltabelle `project_auth_rate_counters`; keine zweite Einstellungstabelle).
  Was es vorher gab: nur `InMemoryRateLimiter` mit drei fest verdrahteten
  Werten, je Prozess, geschluesselt nach gehashter Anfrageherkunft — bei zwei
  Instanzen galt in Wahrheit das Doppelte, und ein Neustart setzte auf null.
  `refresh` hatte gar keine Grenze. Seit 2.56 zaehlt PostgreSQL in einer
  Anweisung (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), nach
  Identitaet (sign_in, mail) oder Sitzungsfamilie (refresh), **nie** nach
  IP-Adresse; der Schluessel geht nur als SHA-256 base64url in die Zeile. Das
  Fenster ist ein festes Raster (`floor(t / w) * w`), damit zwei Instanzen
  ohne Absprache dieselbe Zeile treffen; dieselbe Anweisung raeumt
  abgelaufene Fenster desselben Schluessels weg. **Fail closed** auf der
  Grenze, **fail open** auf einem Fehler des Zaehlers: Der Zaehler ist eine
  Schutzschicht, die Tuer ist die Passwortpruefung, und ein Fehler in ihm
  darf nicht die ganze Anmeldung ausfallen lassen. Der Prozesszaehler bleibt
  als grobe Vorschicht bestehen. PostgreSQL-Fall "(2.56) refuses the login
  attempt that crosses the limit and lets the next window through" mit zwei
  Dienstinstanzen an einer Datenbank: 30 statt 29 Faelle in
  `tests/postgres.integration.test.ts`. Ehrlich offen: Eine Grenze je
  Identitaet haelt einen **verteilten** Angriff ueber viele Konten nicht auf;
  das steht auf der Seite selbst. `verifyMfaChallenge` und `startOidc` haengen
  weiter nur am Prozesszaehler. `project_auth.rate_limits.changed` und
  `project_auth.rate_limit.blocked` zaehlen in der Auth-Zeitreihe unter
  `other`. Im Browser nicht gesehen
- Slice 2.54 (Zweig `slice/authsettings`): **Ruecksprungziele, Mailweg
  ehrlich gezeigt.** Die drei Platzhalter `auth-url`, `auth-smtp` und
  `auth-templates` sind weg. `auth-url` ist eine echte Ansicht mit genau
  einem Schreibweg: eine Liste erlaubter Ruecksprungziele je
  Projektumgebung, in `project_auth_settings` (Migration
  `0051_project_auth_return_targets.sql`, Spalte `redirect_allow_list`,
  keine zweite Tabelle). Die Liste **verengt** die aeussere Grenze aus
  `QKERN_PROJECT_AUTH_REDIRECT_ORIGINS` und weitet sie nie; ein Eintrag
  ausserhalb wird mit Grund abgelehnt, nicht still weggelassen. Durchgesetzt
  in `ProjectAuthService.returnTarget`, der einzigen Stelle, an der ein Ziel
  angenommen wird; vier Wege gehen hindurch (signup, magic-link,
  password-reset, oidc authorize). QKERN schickt selbst nie einen 302 an ein
  Ruecksprungziel. `auth-smtp` und `auth-templates` **lesen nur**: SMTP
  steht in der Prozessumgebung, und die drei Aktionsmails haben einen festen
  englischen Text; die Ansicht zeigt ihn aus derselben Funktion, die ihn
  versendet (`projectAuthMailBody`). Kein Passwort, keine DSN, kein
  Schreibverb auf `admin/mail`. PostgreSQL-Fall "(2.54) refuses a return
  target outside the allowed list of the project": 27 statt 26 Faelle in
  `tests/postgres.integration.test.ts`. Ehrlich offen:
  `project_auth.return_targets.changed` zaehlt in der Auth-Zeitreihe unter
  `other`; die zehn benannten Handlungen sind unveraendert. Im Browser nicht
  gesehen
- Davor: 2.49 Was der Scanner sah – "Storage" unter Logs ist
  eine echte, nur lesende Ansicht (`components/console/storage-log-view.tsx`)
  mit Filter nach Bucket und Urteil, dazu ist "Realtime" unter Berichte an
  die geteilte Reihe aus 2.45 angeschlossen, weil die Metrik
  `realtime_messages` wirklich existiert. Zwei Befunde: Erstens fuehrt QKERN
  **kein** Zugriffsprotokoll je Objekt; eine Zeile traegt nur den aktuellen
  Stand, und ein Urteil ueberschreibt das vorherige. Der Platzhalter
  versprach Uploads, Downloads und Urteile je Objekt; die Ansicht zeigt den
  Stand und sagt vor der ersten Zeile, was sie nicht hat. Zweitens setzt
  `setObjectStatus` beim Urteil `infected` im selben Schritt `deleted_at`,
  und die bestehende Auflistung filtert entfernte Zeilen weg: ein
  infiziertes Objekt waere nie sichtbar gewesen. `listObjectLog` behaelt
  solche Zeilen bewusst. PostgreSQL-Fall "(2.51)": 186 statt 185 Faelle, in
  `tests/project-storage-postgres.integration.test.ts`, der vom
  **PostgreSQL**-Stack gefahren wird und nicht vom versitygw-Stack.
  Mutation (entfernte Zeilen wieder ausgeblendet) faellt dort in 1 Fall.
  Im Browser nicht gesehen
- Davor: 2.48 Drei Slices nebeneinander – zwei Implementierer
- Paketversion: `2.48.0`
- Aktueller Slice: 2.50 Datenbank-Webhooks – "Datenbank-Webhooks" unter
  Integrationen ist eine echte Ansicht
  (`components/console/database-webhooks-view.tsx`); der Platzhalter
  `int-webhooks` ist weg. Die **Kopplung ist der vorhandene Change Feed**
  (`db/project/0003`, `qkern_internal.capture_change()`), den Realtime schon
  liest — kein zweiter Trigger in der Kundendatenbank. Der verworfene
  Gegenentwurf (eigener Trigger ueber ein Change Set) haette zwei
  Erfassungswege mit zwei Zusicherungen darueber nebeneinander gestellt, was
  eine erfasste Aenderung traegt. Ehrliche Grenze: Eine Tabelle ohne
  Aenderungserfassung erzeugt keine Zustellung; das Anschalten je Tabelle
  bleibt eine Schemaaenderung ueber die Freigabezentrale.
  Eine Zustellung traegt genau sechs Felder — Schema, Tabelle, Operation,
  Primaerschluessel, Feed-Position, Commit-Zeit — und keinen weiteren
  Spaltenwert, kein Vorher- und kein Nachher-Bild. Der Primaerschluessel ist
  die eine bewusste Offenlegung und steht so in der Ansicht.
  Migration `0049_project_database_webhooks.sql` haelt nur die Kopplung
  (Tabelle, Ereignisse, Verweis auf `project_webhooks`); Ziel, Referenz,
  Outbox, Lease, Backoff und Dead Letter bleiben in 0032, signiert wird wie
  bisher ueber den Vault. Routen unter `/compute/database-webhooks`,
  `private, no-store`, **ohne DELETE** (Abschalten ja). Im PostgreSQL-Stack
  laeuft seit diesem Slice auch ein Vault, weil der Fall
  "(2.50) turns a real table change into a signed webhook delivery" eine
  echte Projektdatenbank **und** einen echten Schluessel an einem Ort
  braucht. Im Browser nicht gesehen
- Davor: 2.48 Drei Slices nebeneinander – zwei Implementierer
  arbeiteten gleichzeitig in eigenen Arbeitskopien, ihre Zweige wurden
  danach zusammengefuehrt. **Anmeldungen beobachten**: "Auth" unter Berichte
  und unter Logs sind echte Ansichten
  (`components/console/auth-series-view.tsx`, `auth-log-view.tsx`) ueber das
  Auth-Audit aus 2.35. Zehn Handlungsarten aus dem Code gelesen, dazu eine
  Sammelgruppe `other`, damit eine kuenftige Handlung die Summen nicht
  verfaelscht; Aggregation in der Datenbank, Nullfuellung in der reinen
  Schicht, neuer Fehlercode `AUDIT_UNAVAILABLE` statt leerer Reihe. Der
  Fall kann keine Zeitstempel in die Vergangenheit legen, weil die Tabelle
  anhaengend ist, und verschiebt darum das Fenster um die echten
  Zeitstempel herum. **Tabellen-Designer**: "Tabellen" unter Datenbank ist
  eine echte Ansicht (`components/console/table-designer-view.tsx`), der
  erste schreibende Slice. Jede Aenderung wird ein Change Set und geht
  durch die Freigabe; kein DROP, kein Typwechsel, kein Spaltenwechsel. Die
  Anweisungen baut ein reines Modul (`lib/console/table-change-sets.ts`)
  aus festen Typ- und Vorgabelisten, die einzige freie Eingabe sind Namen,
  und die muessen zweimal durch die Bezeichnergrammatik. Genau das zeigte
  die Mutationsprobe: eine aufgehobene Pruefung faengt die zweite noch ab
  (lokal 20 von 66 Faellen rot, Stack gruen), erst mit beiden faellt der
  Zertifizierungsfall. PostgreSQL-Faelle "(2.47)" und "(2.49)": 185 statt
  183 Faelle. Beim Zusammenfuehren fielen zwei Vertraege zu Recht, verwaiste
  Uebersetzungen und die Fallzahl. Im Browser nicht gesehen
- Davor: 2.47 Grenzen und Rechte von Realtime – die Platzhalter
  "Einstellungen" und "Policies" unter Realtime sind echte, nur lesende
  Ansichten (`components/console/realtime-settings-view.tsx` und
  `realtime-policies-view.tsx`). `lib/server/realtime/settings.ts` sammelt
  die Grenzen mit Wert, Einheit und Herkunft: `environment`, `default` oder
  `code`. Bewusst kein `database`, weil keine Grenze in einer Datenbank
  steht. Zwei Befunde dabei: Die Nachrichtengrenze (100 je 10 Sekunden)
  steht in `RealtimeGatewaySession`, aber `createRealtimeWebSocketServer`
  reicht die Einstellung nie durch, also erreicht sie keine Variable. Und
  Kanalrechte gibt es sehr wohl (`PrefixRealtimeAuthorization`): sie
  entscheiden aus Organisation, Rolle und Praefix (`public:`, `private:`,
  `user:<subject>:`, `changes:<schema>.<tabelle>`), bei Aenderungskanaelen
  zusaetzlich die RLS der Tabelle je Abonnent; nach einem DELETE erfaehrt
  nur `service_role` den Schluessel. Gespeichert ist nichts davon, es steht
  im Code, und die Ansicht sagt das. Der Vertragstest gleicht alle 36 Felder
  der gezeigten Matrix gegen die echte Pruefklasse ab. Betriebszahlen liegen
  im Realtime-Prozess, nicht im Next-Prozess; die Route sagt das, statt
  Nullen zu zeigen. Kein PostgreSQL-Fall, weil der Slice die Datenbank nicht
  beruehrt. Mutation (anon darf private Kanaele lesen) faellt lokal in
  1 Fall. Im Browser nicht gesehen
- Davor: 2.46 Zahlen statt Abfragetexte – die Platzhalter
  "Datenbank" und "Verbindungen" unter Berichte sind echte, nur lesende
  Ansichten (`components/console/database-report-view.tsx` und
  `connections-report-view.tsx`) ueber eine geteilte Quelle. Neue
  Data-Plane-Methode `inspectActivity` liest `pg_stat_database` fuer die
  eigene Datenbank (Commits, Rollbacks, Bloecke gelesen und getroffen,
  Deadlocks, Temp-Dateien, Backends, `stats_reset`, dazu
  `current_setting('max_connections')`) und `pg_stat_activity` gruppiert nach
  Rolle und Zustand mit Anzahl und Alter der aeltesten Sitzung. Bewusst
  ungelesen: `query`, `query_start`, `state_change`, `backend_xmin`,
  `client_addr`, `client_hostname`, `client_port`, `pid`,
  `application_name`, `wait_event`, `backend_type`. Kein
  `pg_terminate_backend`, kein `pg_cancel_backend`, auch nicht als toter
  Code; der Vertragstest verbietet die Woerter. Die Leserolle sieht fremde
  Sitzungen nur teilweise, darum steht `numbackends` neben den gezaehlten
  Gruppen und der Fall sichert die Richtung: Summe der Gruppen kleiner
  gleich Backends. PostgreSQL-Fall "(2.46)": 183 statt 182 Faelle; er prueft
  zusaetzlich, dass der Markertext im selben Moment wirklich in
  `pg_stat_activity.query` stand, sonst waere die Zusicherung leer.
  Mutation (Abfragetext wandert in den Zustand) faellt im Stack in 1 Fall.
  Offen: `usename` ist der einzige freie Text, der die Datenbank verlaesst.
  Im Browser nicht gesehen
- Davor: 2.45 Der Verlauf – drei Platzhalter auf einmal: API,
  Storage und Functions unter Berichte sind echte, nur lesende Ansichten
  ueber eine geteilte Komponente (`components/console/usage-series-view.tsx`)
  und eine Route `GET .../usage/series?metric=&bucket=`. Keine neue Tabelle:
  `usage_events` traegt `observed_at` je Ereignis, die Reihe entsteht als
  Aggregation in der Datenbank (`date_trunc` mit `AT TIME ZONE 'UTC'` auf
  beiden Seiten, `SUM(quantity) FILTER (WHERE accepted)` und das Gegenstueck,
  `GROUP BY`, `LIMIT`), nie in JavaScript. Leere Eimer fuellt die reine
  Schicht im Dienst, nicht `generate_series`: die Datenbank liest dann nur
  vorhandene Zeilen. Fenster folgt der Eimergroesse, nicht dem Aufrufer:
  48 Stundeneimer oder 90 Tageseimer, mit `truncated`-Flagge. Diagramm als
  reine Geometrie (`lib/console/usage-series-chart.ts`), daneben dieselben
  Zahlen als Tabelle. Was die Ereignisse nicht hergeben, behauptet keine
  Ansicht: keine Antwortzeiten, keine Belegung, kein Containerfehler; die
  drei alten Notizen, die genau das versprachen, sind weg. "Abgelehnt" heisst
  immer Kontingent, nie HTTP-Fehler. PostgreSQL-Fall "(2.45)": 182 statt 181
  Faelle. Der Fall hatte zwei falsche Erwartungen, beide abgeschrieben statt
  gerechnet; jetzt rechnet er je Fenster und belegt damit, dass das Fenster
  entscheidet, was mitzaehlt. Mutation (Aggregation trennt angenommen und
  abgelehnt nicht) faellt nur im Stack, weil die Regeltests mit Attrappen
  arbeiten. Offen: bei echtem Volumen braucht es eine Rollup-Tabelle oder
  einen BRIN-Index auf `observed_at`. Im Browser nicht gesehen
- Davor: 2.44 Was gerade laeuft – der Platzhalter "Gesundheit"
  unter Advisors ist eine echte, nur lesende Ansicht
  (`components/console/health-advisor-view.tsx`). Acht Teilsysteme werden
  nebenlaeufig geprobt, jede Probe faengt ihren eigenen Fehler: Datenbank
  (Katalogabfrage, Beleg ist die Tabellenzahl), Data API (erzeugtes
  OpenAPI, Zahl der ausgelieferten Tabellen), Auth (Provider und
  Signaturschluessel), Storage (Buckets), Compute (Definitionen und
  Sandbox-Schalter), Queues und Cron (Zahlen, dazu nie ausgeloeste aktive
  Definitionen), Realtime und Vault. Zustaende: ok, aus, nicht eingerichtet,
  gestoert, unbekannt; das Gesamturteil ist der schlechteste vorkommende
  Zustand. Fehlt dem Aufrufer eine Faehigkeit, meldet die einzelne Probe
  `unbekannt` mit Grund statt die Seite mit 403 zu kippen. Der Beleg kann
  strukturell kein Geheimnis tragen: er ist ein Schluessel in eine feste
  Texttabelle plus Zahl oder null, und der Vertragstest verbietet
  zusammengesetzte Zeichenketten im Regelmodul; der Routentest wirft eine
  Verbindungszeichenkette mit Passwort als Fehler hinein und prueft, dass
  nichts davon in der Antwort steht. PostgreSQL-Fall "(2.44)": 181 statt 180
  Faelle, er probt eine echte Datenbank und eine Bindung ins Leere. Der Fall
  fiel zuerst an einer zu groben Probe gegen Stapelspuren, die das deutsche
  Wort "hat" traf; sie sucht jetzt die Form einer Stapelzeile und prueft
  zusaetzlich die Gestalt jedes Belegs. Mutation (Beleg baut seine
  Beschriftung zusammen) faellt im Stack in 1 und lokal in 3 Faellen.
  Bekannte Grenze: Bei Realtime und Vault heisst gruen nur, dass eine
  Adresse hinterlegt ist. Im Browser nicht gesehen
- Davor: 2.43 Ein Fenster von null – keine neue Ansicht, sondern
  die Behebung eines Fehlers, den 2.42 nebenbei zutage brachte. Eine Queue
  mit `dedupeWindowSeconds = 0` liess jedes Einreihen mit Dedupe-Schluessel
  scheitern. Die Ursache lag nicht beim gleichen Zeitpunkt, sondern bei einer
  fehlenden Frist: `postgres-repository.ts` schrieb den Verifikator ohne
  `dedupe_expires_at`, und `project_queue_messages_dedupe_pair` verlangt
  beides oder keines. Der Aufrufer bekam `QUEUE_CONFLICT`, also die Aussage
  ueber ein Rennen, das nie stattfand. Gewaehlte Lesart: Fenster null heisst
  keine Entdopplung, also wird weder Verifikator noch Frist geschrieben.
  Begruendung am Entscheidungspunkt in `service.ts`: null ist in Schema,
  OpenAPI und Route als gueltig zugesagt, Queue-Definitionen sind
  unveraenderlich (ein Ablehnen wuerde bestehende Queues dauerhaft
  unbrauchbar machen), jede andere Stelle liest null schon so, und ein
  Verifikator ohne Frist bliebe fuer immer im eindeutigen Index stehen, weil
  die Bereinigung nur abgelaufene Fristen raeumt. Keine Migration: solche
  Zeilen waren nie einfuegbar. Folge fuer Cron auf solchen Queues:
  mindestens einmal statt genau einmal, im Handbuch und in den
  Compute-Contracts benannt. PostgreSQL-Fall "(2.43)": 180 statt 179 Faelle,
  er prueft auch, dass die Bedingung wirklich greift, indem er von Hand
  einen Verifikator ohne Frist einzufuegen versucht. Mutation (Behebung
  zurueckgedreht) faellt im Stack in 1 und lokal in 1 Fall. Nebenbefund,
  nicht geaendert: genau auf der Fensterkante entdoppelt der Speicherport
  einschliessend, PostgreSQL nicht
- Davor: 2.42 Was der Zeitplan ausgeloest hat – der Platzhalter
  "Cron" unter Logs ist eine echte, nur lesende Ansicht
  (`components/console/cron-log-view.tsx`). Es gibt kein Laufprotokoll; das
  Log wird rekonstruiert: erwartete Vorkommen aus dem Ausdruck, dazu der
  Verifikator, den der Dispatcher beim Einreihen schreibt. Der
  Dedupe-Schluessel `cron:<id>:<ISO-Zeit>` stand inline im Dispatcher und ist
  jetzt `cronOccurrenceDedupeKey` in `lib/server/compute/cron.ts`, die der
  Dispatcher selbst benutzt; die Hashfunktion wurde nicht nachgebaut, sondern
  als `projectQueueDedupeKeyHash` aus `project-queues/service.ts`
  exportiert. Vier Zustaende: gefunden, fehlt, noch nicht faellig (mit fuenf
  Minuten Nachsicht fuer Taktung und Uhrenversatz) und erwartet – vor der
  Anlage oder nach Ablauf des Dedupe-Fensters, wo ein fehlender Eintrag
  nichts beweist. Fenster: letzte 24 Stunden plus die naechste Stunde,
  hoechstens 50 Vorkommen, im Dienst begrenzt und in der Antwort genannt.
  Nicht zurueckgegeben werden Payload, Dedupe-Schluessel, Verifikator,
  Nachrichten-Id und alle Lease-Spalten. PostgreSQL-Fall "(2.42)" reiht ueber
  CronDispatcher und ProjectQueueService ein, nicht von Hand: 179 statt 178
  Faelle. Der Fall brauchte drei Anlaeufe beim Aufraeumen (Audit-Zeilen
  unveraenderlich, Queue-Nachricht vor Aufbewahrungsfrist geschuetzt) und hat
  jetzt eine eigene Organisation wie die Faelle 2.35 und 2.36. Mutation
  (Verifikator aus dem Namen statt der Kennung) faellt im Stack in 1 und
  lokal in 2 Faellen. Offener Fehler nebenbei gefunden: eine Queue mit
  Dedupe-Fenster 0 verletzt zusammen mit einem Dedupe-Schluessel
  `project_queue_messages_dedupe_pair`, ein solcher Cron-Job scheitert bei
  jedem Vorkommen. Im Browser nicht gesehen
- Davor: 2.41 Das Schema als Bild – der Platzhalter
  "Schema-Visualizer" ist eine echte, nur lesende Ansicht
  (`components/console/schema-visualizer-view.tsx`): Tabellen mit Spalten und
  die Fremdschluessel dazwischen, als SVG. Neue Data-Plane-Methode
  `inspectForeignKeys` liest `pg_constraint` mit `contype = 'f'`, loest
  `conkey` und `confkey` ueber `unnest ... WITH ORDINALITY` in der
  Schluesselreihenfolge auf, nennt das fremde Schema, wenn ein Schluessel
  hinausgeht, und uebersetzt die Katalogbuchstaben in Woerter; Grenzen 400
  Schluessel und 32 Spalten je Seite mit `truncated`-Flagge, ein unbekannter
  Buchstabe wirft statt zu raten. Route
  `GET .../schema/foreign-keys?schema=`, gleiche Tuer und gleiche
  Query-Pruefung wie `/schema/policies`. Die Geometrie rechnet eine reine
  Funktion (`lib/console/schema-diagram.ts`): Gitter mit 1 bis 4 Spalten,
  Zeilenhoehe nach dem hoechsten Kasten, rechtwinklige Kanten, Schlaufe bei
  Selbstbezug, hoechstens 12 Spalten je Kasten. Keine neue Abhaengigkeit,
  keine Farbe im Modul. PostgreSQL-Fall "(2.41)": 178 statt 177 Faelle,
  zusammengesetzter Schluessel mit verdrehten Zielspalten, Selbstbezug,
  Schluessel in ein zweites Schema. Mutation (Zielspalten alphabetisch)
  faellt im Stack in 1 Fall; lokal faellt sie nicht, weil die Regeltests mit
  Attrappen arbeiten und die Reihenfolge nur am echten Katalog beweisbar ist.
  Kein Schema-Waehler, wie bei den Policies; Primaerschluessel fehlen im
  Bild, weil `/schema` sie nicht liefert. Im Browser nicht gesehen
- Davor: 2.40 Wo es langsam wird – der Platzhalter "Leistung"
  unter Advisors ist eine echte, nur lesende Ansicht
  (`components/console/performance-advisor-view.tsx`), gleiche Bauart wie der
  Sicherheitsberater aus 2.39. Neue Data-Plane-Methode `inspectStatistics`
  liest `pg_stat_user_tables` und `pg_stat_user_indexes` mit `pg_index` und
  `pg_relation_size`, Grenzen 200 Tabellen und 400 Indizes mit
  `truncated`-Flagge. Regeln rein in
  `lib/server/advisors/performance-rules.ts`, Schwellen an einer Stelle in
  `PERFORMANCE_THRESHOLDS` und in jedem Text benannt: fehlender Index
  vermutet (ab 50 sequenziellen Scans, Indexscans hoechstens ein Zehntel
  davon, ab 1000 Zeilen), unbenutzter Index (nicht Primaer, nicht unique,
  null Scans, ab 1 MiB), Bloat vermutet (ab 1000 toten Zeilen und einem
  Fuenftel der lebenden), nie analysiert (ab 1000 Zeilen). `last_analyze` ist
  `GREATEST(last_analyze, last_autoanalyze)`, sonst waere jede autoanalysierte
  Tabelle ein Fehlalarm. `pg_stat_statements` wird bewusst nicht gelesen: die
  Sicht ist clusterweit, und ein Utility-Statement behaelt seine Literale;
  die Regel steht als "nicht geprueft" mit diesem Grund in der Karte, das
  Regelmodul hat sie fertig. PostgreSQL-Fall "(2.40)" mit eigenem Zeitbudget
  von 120 s und Warten auf die Zaehler statt auf eine Dauer: 177 statt 176
  Faelle. Die Mutationsprobe fand eine Luecke – der Fall prueft seit
  `14abe13` auch eine Tabelle mit vielen sequenziellen und genug Indexscans,
  die keinen Befund tragen darf. Im Browser nicht gesehen
- Davor: 2.39 Was offen steht – der Platzhalter "Sicherheit"
  unter Advisors ist eine echte, nur lesende Ansicht
  (`components/console/security-advisor-view.tsx`): Befunde nach Schwere,
  dazu eine Karte, die je Regel sagt, ob sie lief und warum nicht. Regeln
  rein in `lib/server/advisors/security-rules.ts` (gleiche Eingabe, gleiche
  Ausgabe, gleiche Reihenfolge): Tabelle ohne RLS, RLS ohne Policy, Policy
  mit Bedingung true fuer public, anon oder authenticated, Schreib-Policy
  ohne Pruefung (nur wenn PostgreSQL USING nicht ersatzweise anwendet),
  Bucket mit oeffentlichem Lesen, Bucket mit Schreiben fuer Angemeldete
  ohne Typenliste, aktiver Service-Key in Produktion. Die Regel zu
  unverifizierten Mail-Adressen laeuft nie, weil die Provider-Projektion
  nur Slug und Issuer nennt; das steht in der Karte. Route
  `GET .../advisors/security`, gleiche Tuer wie `/schema/policies`,
  `private, no-store`, 400 bei jedem Query-Parameter; Buckets und Keys nur
  mit Console-Sitzung und der Faehigkeit ihrer eigenen Routen, sonst
  "nicht geprueft" statt 500. Texte deutsch an einer Stelle
  (`lib/console/security-advisor-texts.ts`), vom i18n-Vertrag mitgelesen.
  PostgreSQL-Fall "(2.39)" ueber echtem Katalog: 176 statt 175 Faelle.
  Mutation (Policy ohne Bedingung nur bei WITH CHECK) faellt im Stack in
  1 und lokal in 2 Faellen. Im Browser nicht gesehen
- Davor: 2.38 Secrets, ohne Werte – der Platzhalter "Secrets"
  unter Functions & Jobs ist eine echte, nur lesende Ansicht
  (`components/console/compute-secrets-view.tsx`): je Function jede
  deklarierte Secret-Referenz und ob der Vault sie aufloest (vorhanden,
  fehlt, kein Zugriff). Port `FunctionSecretInspector`
  (`lib/server/compute/function-secret-inspector.ts`) fragt nur den
  Metadaten-Endpunkt von KV v2, nie `data/`; 404 wird fehlt, 403 wird kein
  Zugriff, alles andere ein typisierter Fehler ohne Pfad und ohne
  Vault-Meldung. Die Pfadregel ist dieselbe wie beim Signatur-Resolver
  (`vaultSecretPath`, jetzt exportiert); eine Referenz ausserhalb davon ist
  kein Zugriff ohne Anfrage. Route
  `GET .../compute/functions/{functionId}/secrets`, gleiche Berechtigung
  wie die Definitionsrouten, `private, no-store`, 503 mit Code ohne Vault.
  Vault-Fall "(2.38)" mit eingeschraenktem Token und Fetch-Spion: drei
  Anfragen, alle an `metadata/`, keine an `data/`; Vault-Zertifizierung
  6 auf 7 Faelle. Mutation (403 gilt als fehlend) faellt lokal in 1 Fall
  und im Vault-Stack in 1 Fall. Anlegen und Aendern bleibt im Vault.
  Im Browser nicht gesehen (Sitzung abgelaufen)
- Davor: 2.37 Was es kostet – der Platzhalter "Abrechnung"
  unter Einstellungen ist eine echte, nur lesende Ansicht
  (`components/console/billing-settings-view.tsx`): Preisblatt (aus den
  bepreisten Zeilen der Abrechnungsprojektion `usage/billing`, Preise zum
  Monatsende), laufender Monat (Summe, Zeitraum, je Metrik, unbepreiste
  Metriken ausgewiesen), Rechnungen (`usage/invoices`, geteilte
  `InvoicesCard` mit Nutzung & Limits), ehrlicher Hinweis: keine
  Zahlungsanbindung, Rechnungen entstehen im Rechnungslauf und werden nicht
  versandt. Zustaende je Karte, AbortController, Schalter
  `QKERN_USAGE_METERING_ENABLED` im Aus-Zustand genannt. Geldformat aus
  einer Quelle `lib/console/money.ts`, BigInt, rundet ab wie der
  Rechnungslauf (die Anzeige zeigt nie mehr als der Ledger), `de-CH`.
  Vertragstest: keine Schreibmethode, kein Betrag von Hand, jede
  Metrikbezeichnung uebersetzt. Mutation (Anzeige rundet auf) faellt in
  2 Faellen. Im Browser nur der Aus-Zustand gesehen (Metering lokal aus)
- Davor: 2.36 Die Kette in Zeitreihenfolge – Befund aus dem
  Sicherheits-Review zu 2.35: `created_at` der Audit-Zeile ist `now()`
  der Transaktion, der Kettenlock kommt spaeter; zwei gleichzeitige
  Schreiber konnten die Kette in eine Reihenfolge bringen, die der
  Sortierung `(created_at, id)` widerspricht, und jede Nachrechnung haette
  Manipulation gemeldet, wo keine war. Migration
  `0047_audit_chain_order.sql` ersetzt `qkern_prepare_audit_log` mit dem
  Koerper aus 0002 plus `NEW.created_at := greatest(clock_timestamp(),
  previous_created_at + 1 us)` vor der Hashberechnung (created_at ist Teil
  des Payloads), gleiche SECURITY-Art, Grants bleiben. Statischer
  Migrationstest; PostgreSQL-Fall (A beginnt und friert now() ein, B
  schreibt und committet, A schreibt: A.created_at > B, A.previous_hash =
  B.entry_hash, Kette nachgerechnet intakt): 175 von 175; Mutation (Anhebung
  entfernt) faellt genau dort. SECURITY.md nennt die Garantie. Offen: der
  Trigger ueberschreibt ein explizit gesetztes created_at; Zeilen vor 0047
  koennen alte Paare tragen; REPEATABLE READ waere weiterhin ein Problem,
  wird nirgends gesetzt
- Davor: 2.35 Was die Anmeldung tat – Project Auth schreibt
  jetzt Audit-Ereignisse in die Hash-Kette der Plattform: signup, login
  (erfolgreich und fehlgeschlagen), logout, mfa enrolled/verified, admin
  user.updated, session.revoked, sessions.revoked_all; kein Refresh. Sink
  `PostgresProjectAuthAuditSink` (`lib/server/project-auth/audit-postgres.ts`)
  schreibt ueber `withTenantTransaction` und `AuditRepository.append` mit
  dem Auth-Pool; Migration `0046_project_auth_audit.sql` gibt `qkern_auth`
  SELECT und INSERT auf `audit_logs` (der Kettentrigger liest den letzten
  Hash der Organisation und ist nicht SECURITY DEFINER) und EXECUTE auf die
  drei Funktionen, nichts weiter; RLS FORCE bleibt. Ein Sink-Fehler bricht
  die Anmeldung nicht (geloggt ohne Geheimnisse, Kette bleibt intakt).
  `sanitizeProjectAuthAuditEvent` lehnt `@` und `qk_` ab, Admin-Routen
  uebergeben nur `actor.id`, nie die E-Mail. Route `GET
  .../auth/admin/audit?limit&cursor` (nur `project_auth.%`, Cursor ueber
  `(created_at, id)`), OpenAPI, Handbuch 6; Konsole Auth, Audit-Log statt
  Platzhalter. PostgreSQL-Fall (eigener Besitzer, eigene Organisation,
  vier Ereignisse, Kette nachgerechnet, fremde Organisation sieht nichts):
  174 von 174; Mutation (Schreiben im Sink ausgelassen) faellt genau dort.
  Aufraeumen: Audit-Zeilen sind append-only (Trigger ohne Ausnahme), eine
  Organisation mit Audit-Zeilen laesst sich nie loeschen; der Fall haengt
  deshalb nichts an den Kontrollnutzer der Datei
- Davor: 2.34 Sitzungen sehen und beenden – der Platzhalter
  "Sitzungen" unter Auth ist eine echte Ansicht: Nutzer waehlen, aktive
  Sitzungen (angelegt, laeuft ab, Sicherungsstufe, Familie) sehen, eine
  Sitzung oder alle beenden, mit Rueckfrage. Backend: Repository
  `listActiveSessions` (Postgres und Speicher, nie mit Token-Hash),
  Service `listSessions`/`revokeSession` (widerruft die ganze
  Refresh-Familie; fremde oder unbekannte Sitzung ist 404, ohne
  Unterschied)/`revokeAllSessions`, Routen `GET/DELETE
  .../auth/admin/users/{userId}/sessions` und `DELETE .../sessions/{sessionId}`
  mit Konsolensitzung, Admin-Faehigkeit, CSRF, zod-UUIDs; OpenAPI, Handbuch
  Abschnitt 6. Sicherheits-Review: Scope aus Organisation plus Pfad, jede
  Abfrage filtert Organisation, Projekt, Umgebung, Nutzer; Token-Material
  verlaesst den Server nie (Testvertrag auf der Schluesselmenge). Ein
  Refresh mit einem Token der widerrufenen Familie laeuft in die
  Replay-Pruefung (401, Familie als kompromittiert markiert); auf dem Draht
  kein Unterschied, bewusst so gelassen. PostgreSQL-Fall (zwei Familien,
  Refresh, Liste, Widerruf einer Familie, aller, Zuschauer unberuehrt):
  173 von 173; Mutation (Widerruf ausgelassen) faellt genau dort
- Davor: 2.33 Schemanamen mit Grossbuchstaben – der in 2.26
  offen gelassene Schritt: Schemanamen der Data API folgen jetzt derselben
  Grammatik wie Tabellennamen (`isDataSchemaName` in `identifiers.ts`:
  `DATA_IDENTIFIER` minus `pg_*`, `information_schema`, `qkern_internal`).
  Elf Routen, `service.ts`, `generated-api.ts` und drei
  OpenAPI-Parameter nutzen sie; SQL-Audit: jeder Schemawert ist Parameter
  oder geht durch `quoted()`, kein `lower(`/`ILIKE`, `Shop` und `shop`
  sind zwei Schemata. Neuer PostgreSQL-Fall (Schema `Shop_<hex>` mit
  Tabelle `Items`, RLS, Zwilling in Kleinschrift bleibt leer, OpenAPI
  enthaelt den Pfad): 172 von 172; Mutation (alte Grammatik nur klein)
  faellt genau dort. Dazu: der Realtime-Soak-Test hat ein ausdrueckliches
  Wartebudget von 75 s statt 30 s und nennt beim Fehlschlag die Zahl der
  fehlenden Aenderungen, nachdem ein CI-Runner 112 von 120 in 30 s
  schaffte (Wiederholung gruen); die harten Zusicherungen sind unveraendert
- Davor: 2.32 Was die Data API kann – der Platzhalter
  "Data API" unter Einstellungen ist eine echte, nur lesende Ansicht
  (`components/console/data-api-settings-view.tsx`): Status aus der
  generierten OpenAPI (bereit mit Zahl der freigegebenen Tabellen und Link,
  nicht bereit mit dem Hinweis auf `dev:bind-project-database`, abgeschaltet
  mit `QKERN_GENERATED_DATA_API_ENABLED`, Fehler), freigegebene Tabellen
  aus der Schema-Route (RLS an/aus, freigegeben ja/nein/unbekannt, Views
  getrennt), Regeln und Grenzen aus einer Quelle `lib/data-api-limits.ts`,
  die auch `generated-api.ts` und `generated-http.ts` nutzen (Zeilen 1 bis
  100, 10 Filter, sieben Operatoren, sensible Spalten, Claims anon und
  service_role). Reine Helfer in `lib/console/data-api-exposure.ts` mit
  Test; ein Vertrag prueft, dass die Ansicht keine Zahl von Hand und keine
  Schreibmethode enthaelt. Ehrlich: `public` ist Standard, nicht einziges
  Schema; weitere Schemata und eigene Zeilengrenze nicht verbunden.
  Publish-Trockenlauf mit Provenance aus dem oeffentlichen Repo lief, aber
  uebersprang das Veroeffentlichen, weil 1.7.0-alpha.5 schon auf npm liegt;
  der Nachweis ist erst beim naechsten Paketstand belegt
- Davor: 2.31 Vier Sprachen – Schritt 2 des Doku-Plans: die
  fuenf Einstiegsseiten auf Englisch, Franzoesisch und Italienisch unter
  `docs/guide/en|fr|it/`, uebersetzt von drei parallelen Agenten mit
  denselben Regeln (Struktur, Codebloecke byteidentisch, Anker aus den
  uebersetzten Ueberschriften, Glossar mit 99 Eintraegen, sortiert nach
  der Sprache, Vorspaenne je Sprache in `lib/docs/locales.ts`). Verfuegbare
  Sprachen werden von der Platte erkannt (`availableGuideLocales()`, alle
  fuenf Dateien muessen da sein); Seitentitel je Sprache in `pages.ts`,
  vom Vertrag mit der Ueberschrift der Seite abgeglichen. Die drei
  Vertragstests laufen je Sprache und vergleichen jede Uebersetzung mit
  dem Deutschen (gleiche Anzahl Abschnitte, gleiche Glossargroesse,
  identische Codebloecke). Mutation: franzoesischer Glossareintrag auf zwei
  Zeilen, genau ein Fall faellt. Dazu: Repository oeffentlich (LICENSE an
  der Wurzel, `git clone` im Schnellstart, Provenance im Publish-Workflow
  standardmaessig an), Autor-Adresse GitHub-noreply
- Davor: 2.30 Drei Tueren – die Einstiegsdoku fuer drei
  Zielgruppen, nach Spec und Plan unter `docs/superpowers/`, umgesetzt mit
  Unteragenten (je Aufgabe Spec-Pruefung und Code-Review). Fuenf deutsche
  Seiten unter `docs/guide/de/` (Was ist QKERN, Schnellstart, Erstes
  Backend, Fuer Gruender, Glossar mit 99 Eintraegen zu je drei Zeilen),
  gerendert unter `/docs` durch einen eigenen kleinen Parser
  (`lib/docs/markdown.ts`, wirft mit Zeilennummer bei allem, was die Doku
  nicht nutzt), Seitenleiste, Kopieren-Knopf, Uebersetzungshinweis;
  Platzhalter fuer Version, Node und Zahlen aus denselben Quellen wie
  STATUS (`lib/docs/placeholders.ts`). Drei Vertragstests (`tests/docs-*`):
  Links und Anker, Glossarform und Reihenfolge, Sperrliste; Kommandos,
  Dateien, CLI-Befehle und API-Pfade des Schnellstarts existieren;
  Gruenderseite ohne Zahl von Hand. Der Schnellstart wurde in einem frischen
  Ordner komplett durchlaufen (Denzil registrierte, Agent liest keine
  Geheimnisse): 31 Minuten am Stueck, rund 7 Minuten Kommandos, zwei
  Textfehler dabei gefunden und behoben (drittes Geheimnis
  `QKERN_STATEMENT_ENCRYPTION_KEY`, Key-Dialog per window.prompt). Dazu:
  Dev-Compose mit `project_database`, Bindungsskript, Organisations-ID in
  den Einstellungen, Links in Konsole, Kopfmenue (ohne "Entwickler", Menue
  ab 1260 px) und Fusszeile, Handbuch-Verweis, INDEX-Block,
  DOCS_MAINTENANCE-Abschnitt, SDK-README. Autor-Adresse des Repos jetzt
  GitHub-noreply; Historien-Scan ohne Blocker (Bericht im Chat vom 26.9.)
- Davor: 2.29 Backup und Restore, lokal bewiesen – Denzils
  Frage "geht das auch ohne Hosting?" beantwortet: Sprosse 10 laeuft als
  Wegwerfstack (`docker-compose.backup-certification.yml`,
  `npm run test:backup:docker`). Quell-PostgreSQL 17 mit TLS-Pflicht
  (`hostssl` ohne Ausnahme, im Stack erzeugtes Zertifikat) und WAL-Archiv;
  der Drill zieht ein Basisbackup ueber `sslmode=verify-full`, verschluesselt
  es (AES-256), stellt einen zweiten Server aus Backup und Archiv bis zu einem
  Zeitpunkt wieder her (Phase C fehlt, Zeilen 1 bis 6 da), vergleicht Schema
  per `pg_dump -s` (ohne die zufaelligen `\restrict`-Zeilen ab pg_dump 17.6),
  rechnet die Audit-Kette nach, vergleicht Manifeste und signiert die Evidenz
  (Ed25519), die der Produkt-Verifier annimmt. Sechs Anlaeufe bis gruen, alle
  Rechtefragen des Stacks, keine des Produkts: WAL-Volume gehoerte root,
  Archivsegmente 0600 (Restore-Server laeuft als uid 70), Socket unter
  /run/postgresql, uid 70 schon vom apk-Paket belegt, pgcrypto fehlte im
  Restore-Server, `--abort-on-container-exit` nahm den Zertifikat-Container
  als Abbruch (jetzt `up --wait` plus `run`). Neuer CI-Job "Backup und
  Restore" mit Verifier-Lauf. Neuer Claim in `CERTIFICATION_CLAIMS`, STATUS,
  Landing-Namen. Dazu als Vorarbeit der Doku (Plan
  `docs/superpowers/plans/2026-09-25-documentation.md`, Aufgaben 1 und 2):
  Dev-Compose legt `project_database` an (Ledger-Owner NOLOGIN, Reader,
  Rechte fuer `qkern_project_api_app`; Init ueber `000-certification-init.sh`,
  weil Docker Desktop keinen Mount in den read-only initdb-Mount legt) und
  `npm run dev:bind-project-database` bindet eine wartende Umgebung an
  `managed:database-1` als Provisionierer-Login im Mandantenkontext, nur
  lokal, nie production
- Davor: 2.28 Was das zweite Review fand – ein zweiter Review-Agent
  hat 2.24 bis 2.26 gelesen; sechs Befunde, alle behoben: (1)
  `Symbol.hasInstance` ist statisch vererbt, eine nicht registrierte
  Unterklasse nahm die Namen ihres Vorfahren als eigene; jetzt Registrierung
  je Klasse in einer WeakMap, Unterklassen melden sich bei registrierten
  Vorfahren an (die Namenslisten in den Basisklassen bleiben, sind aber
  nicht mehr noetig), Unregistrierte fallen auf die Prototypkette zurueck.
  (2) Data API: `name in args` zaehlte `valueOf` als geliefert; jetzt
  `Object.hasOwn`, belegt mit einer Funktion `echo_value("valueOf" jsonb)`
  gegen PostgreSQL (Mutation: `in` zurueck, 1 von 171 faellt). (3)
  `getProjectDataPlane` merkte erst nach dem await und baute bei N
  gleichzeitigen ersten Anfragen N Dienste; jetzt sofort gemerkt. (4) Ein
  gemerktes abgelehntes Versprechen wird vergessen. (5) Der abgeschaltete
  Plane wird am Literal `kind = "disabled"` erkannt, nicht am Klassennamen.
  (6) Die veroeffentlichte OpenAPI (`lib/openapi.ts`) und die generierte
  nennen fuer `table` und `order` jetzt `DATA_IDENTIFIER_PATTERN`;
  Funktionsnamen ausserhalb der Grammatik kommen nicht in die OpenAPI
- Davor: 2.27 Regeln und Grenzen je Bucket – zwei Storage-
  Platzhalter sind Ansichten ueber die vorhandene Route
  `PATCH /storage/buckets/{id}`: `storage-policies-view.tsx`
  (Lese- und Schreibregel je Bucket als Auswahl, die fuenf Regeln des
  Dienstes mit Klartext) und `storage-settings-view.tsx` (Objektgroesse,
  Speicherplatz, Aufbewahrung, MIME-Typen als Formular je Bucket; die
  Ansicht prueft nur Ganzzahlen, der Dienst prueft die Grenzen). Kein
  Server-Code fuer die Ansichten; drei Sprachen. Im Browser zeigten beide
  zuerst "nicht verfuegbar" mit 500: `getProjectStorageService()` warf
  `PROJECT_STORAGE_DISABLED` beim Anlegen, vor dem `try` der Route,
  derselbe Fall wie die Queues in 2.24; `/usage`, `/usage/billing` und
  `/usage/invoices` ebenso. Jetzt liefern `getProjectStorageService`,
  `getUsageService` und `getBillingService` einen Proxy, der erst beim
  Aufruf wirft, und die Routen antworten 503 mit Begruendung
  (`tests/project-storage-disabled-runtime.test.ts`). Damit sind alle vier
  Laufzeiten mit Schalter gleich: Queues, Storage, Usage, Billing; Auth und
  Compute pruefen im Handler. 62 Platzhalter uebrig
- Davor: 2.26 Namen mit Grossbuchstaben – Denzils Auftrag "mach den
  Table Editor": Tabellen, Spalten, Funktionen und Argumente duerfen jetzt
  Grossbuchstaben tragen (`lib/server/data-plane/identifiers.ts`,
  `DATA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/`), damit `"Order"` und
  `"createdAt"` aus Prisma, TypeORM und Drizzle im Table Editor und in der
  generierten REST-API erscheinen. Geaendert: `generated-api.ts`,
  `inspectSchema` in `service.ts`, die Routen `tables/[table]/rows`,
  `tables/[table]/aggregate` (auch Sortier- und Aggregatspalten) und
  `rpc/[function]`, SDK `identifier()` und CLI `identifier()`
  (beide Pakete auf `1.7.0-alpha.5`). Schemanamen bleiben klein. Belegt
  gegen PostgreSQL: eine Tabelle `"Order"` mit `"createdAt"` und
  `"totalCents"` unter RLS, Einfuegen, Filtern, Sortieren, Aendern, und die
  Schema-Inspektion listet sie in Spaltenreihenfolge; Mutation (Grammatik
  zurueck auf Kleinbuchstaben) 2 von 170 fallen: der Order-Fall und die
  OpenAPI, weil die alte Grammatik beim ersten Grossbuchstaben das ganze
  Schema verwarf. Injektionen bleiben
  abgewiesen (bestehender Fall). Vertraege:
  `tests/data-identifiers.test.ts`, CLI-Typgenerator mit `Order`, SDK
  `from("Order")`. Offen: Veroeffentlichung von alpha.5, Schemanamen mit
  Grossbuchstaben
- Davor: 2.25 Alle Faelle dieser Klasse – statt einer vierten
  `isXError`-Funktion macht `recognisedByName` in `lib/server/errors/identity.ts`
  die Fehlerklassen selbst robust: `Symbol.hasInstance` auf der Klasse
  akzeptiert neben der Prototypkette jeden Error mit demselben Namen
  (Literal, nicht `constructor.name`, weil ein Bundle Klassennamen kuerzen
  darf); der Name liegt auf dem Prototyp. Alle 76 exportierten
  Fehlerklassen in `lib/server` sind registriert, Basisklassen mit den
  Namen ihrer Unterklassen (`RepositoryError` mit 17, die beiden
  Outbox-Sink-Basen mit je einer); `RepositoryError` nimmt den Namen nicht
  mehr aus `new.target`. `tests/error-identity-sweep.test.ts` prueft das
  Verhalten und scannt `lib/server` auf unregistrierte Klassen; Mutation
  (Registrierung von `ProjectAuthError` entfernt) 2 von 3 faellt. Die
  rund hundert `instanceof`-Stellen bleiben unveraendert und sind jetzt
  richtig
- Davor: 2.24 Derselbe Fehler, zweiter Fall – Denzil hat sich neu
  registriert, die Console war im Browser pruefbar: jede Katalogansicht
  sagte "nicht verfuegbar" mit 500 ohne Code, auch der alte Table Editor
  (`/schema`), und `/queues` antwortete 500 ohne Koerper. Ursache eins wie
  in 2.8: `instanceof ProjectDataPlaneError` in den Routen war falsch, weil
  der Dienst auf `globalThis` das Neuladen ueberlebt und die Route eine
  andere Klasse importiert; jetzt `isProjectDataPlaneError` (Name plus
  Code) in `lib/server/data-plane/service.ts`, in `run()` und in beiden
  Routen; der 500-Zweig loggt `[data-plane] unexpected error`. Ursache
  zwei: `getProjectQueueService()` warf `PROJECT_QUEUES_DISABLED` schon
  beim Anlegen, in elf Routen vor dem `try`; jetzt gibt die Laufzeit einen
  Proxy zurueck, der erst beim Aufruf wirft, und `isProjectQueueError`
  ersetzt `instanceof` in http, service und worker. Vertraege
  `tests/data-plane-error-identity.test.ts` und
  `tests/project-queues-disabled-runtime.test.ts`; Mutation (Route zurueck
  auf `instanceof`) 1 von 2 faellt. Im Browser danach: die
  Katalogansichten sagen "Datenbank nicht bereit" mit 503 und Code. Dritter
  Fund dank dem neuen Log: die auf `globalThis` gemerkte
  `DisabledProjectDataPlane` stammte von vor 2.18 und kannte
  `inspectRoles` nicht (TypeError, 500); `getProjectDataPlane()` merkt den
  abgeschalteten Plane nicht mehr, nur den echten Dienst mit Pools
- Davor: 2.23 Was das Review fand – ein Review-Agent hat 2.14 bis
  2.22 gelesen. Zwei echte Befunde, beide behoben: (1) `/schema/roles` las
  `pg_roles` clusterweit und zeigte auf dem geteilten Cluster die
  Steuerungsrollen samt Superuser; jetzt nur Rollen, die diese Datenbank
  betreffen (eigene, Eigentuemer in Anwendungsschemata, Empfaenger von
  Tabellen- oder Spaltenrechten, in Policies genannt) und keine Superuser.
  Integration: eine fremde Rolle ohne Bezug erscheint nicht, kein
  Superuser; Mutation (Superuser-Filter weg) 1 von 169 faellt. (2) Die
  Bezeichner-Grammatik `IDENTIFIER` galt auch fuer Katalog-Rueckgaben; ein
  Policy-Name wie `Enable read access for all users` (Supabase-Vorlage)
  oder `Order_pkey` leerte die ganze Ansicht mit 503. Jetzt `catalogName`
  (Typ, 1 bis 63 Zeichen, keine Steuerzeichen) fuer alle Katalognamen seit
  2.9; `IDENTIFIER` bleibt fuer Eingaben (Schema-Parameter) und die
  Grenzpruefung. Dazu: Publikationen mit FOR TABLES IN SCHEMA als
  `schema.*`; `publish.yml` interpoliert den dist-tag nicht mehr in die
  Shell (env plus Pruefung). Offen: `inspectSchema` (1.x) prueft
  Tabellen- und Spaltennamen weiter mit `IDENTIFIER`, das ist ein aelterer
  Vertrag mit Folgen fuer die Data API und braucht einen eigenen Slice
- Davor: 2.22 Die Schluessel zum Token – `set-jwt` ist eine echte
  Ansicht (`components/console/jwt-keys-view.tsx`): liest das JWKS des
  Projekts (`auth/.well-known/jwks.json`, dieselbe Adresse, die eine App
  zum Pruefen liest), zeigt kid, kty, crv, alg, use und den Anfang von x,
  dazu die absolute JWKS-Adresse zum Kopieren. Nur lesend; Rotation bleibt
  in der Konfiguration des Auth-Dienstes, und der Zaehler sagt das. Kein
  Server-Code, keine neue Route; drei Sprachen. 66 Platzhalter uebrig
- Davor: 2.21 Drei, die es schon gab – die drei Platzhalter mit
  Backend "vorhanden" sind eigene Ansichten: `components/console/cron-view.tsx`
  (`int-cron`, `/compute/cron`, anlegen, pausieren, loeschen, dieselben
  Aktionen wie unter Functions & Jobs), `api-keys-view.tsx` (`set-api-keys`,
  `/api-keys`, anlegen und widerrufen, Geheimnis nur einmal),
  `auth-providers-view.tsx` (`auth-providers`, die vier zertifizierten
  Verfahren plus die OIDC-Provider ueber `loadConsoleAuthProviders`; nur
  lesend, Ein-/Ausschalten fehlt weiter). Kein Server-Code, keine neue
  Route; drei Sprachen. Von den 79 Platzhaltern aus 2.0 sind noch 67 uebrig; 12 wurden seit 2.9 echte Ansichten.
  Naechste Kandidaten mit "teilweise": auth-sessions, auth-audit,
  storage-policies, compute-secrets, int-vault, set-jwt
- Davor: 2.20 Der Rest des Katalogs – Erweiterungen, Rollen,
  Publikationen und Spaltenrechte; damit ist Punkt 2 (Datenbank-Katalog
  nach Supabase Studio) bis auf Replikation, Schema-Visualizer und
  Tabellen-Verwaltung abgearbeitet. `inspectExtensions`, `inspectRoles`,
  `inspectPublications` (datenbankweit, ohne Schema-Parameter, Routen aus
  einer eigenen Vorlage, jeder Query-Parameter ist 400) und
  `inspectColumnPrivileges` (je Schema, `aclexplode` auf `pg_attribute.attacl`,
  gruppiert je Spalte und Rolle, PUBLIC aus grantee 0). Rollen ohne
  Passwort und ohne Verbindungszaehler, Rollen-Query mit Alias `account`,
  damit der Fake-Client sie nicht mit der Grenzpruefung verwechselt.
  Console: vier Ansichten (`db-extensions`, `db-roles`, `db-publications`,
  `db-column-privileges` jetzt echt), drei Sprachen. Tests:
  `tests/project-data-plane-catalog-wide.test.ts`, vier Routen-Tests,
  `tests/data-plane-catalog-wide-postgres.integration.test.ts` (vier
  Faelle: plpgsql installiert, pg_trgm verfuegbar, keine pg_-Rollen,
  Publikation mit zwei Tabellen und publish = insert, update, Spaltenrechte
  mit GRANT OPTION und PUBLIC). PostgreSQL 169 von 169 zweimal; vier
  Mutationen je 1 von 169. Von Punkt 2 bleiben `db-schemas`, `db-tables`,
  `db-pipelines` Platzhalter, alle mit Schreibbedarf
- Davor: 2.19 Drei aus dem Katalog – Indizes, Policies und
  Enum-Typen in einem Zug, nach dem Muster von 2.9 und 2.18:
  `inspectIndexes`, `inspectPolicies`, `inspectEnumTypes` im Data-Plane-Port
  (SQL aus postgres-meta `indexes.sql`, `policies.sql`, `types.sql`, Apache
  2.0, auf `pg_catalog` reduziert; Indizes ueber `pg_get_indexdef` statt
  `pg_indexes`, Spalten aus `indkey`, Ausdruecke fallen dort weg; Policies
  mit PUBLIC aus `polroles = {0}`, USING/WITH CHECK aus `pg_get_expr`;
  Enums in `enumsortorder`), Routen `schema/indexes`, `schema/policies`,
  `schema/enum-types` aus einer Vorlage, Console-Ansichten `indexes-view`,
  `policies-view`, `enum-types-view` (`db-indexes`, `db-policies`,
  `db-types` jetzt echt), Uebersetzungen in drei Sprachen. Tests:
  `tests/project-data-plane-catalog.test.ts`, drei Routen-Tests,
  `tests/data-plane-catalog-postgres.integration.test.ts` (drei Faelle).
  PostgreSQL 165 von 165 zweimal; drei Mutationen (Praedikat auf NULL,
  `permissive` auf true, Enum-Sortierung nach Label), je 1 von 165 faellt.
  Noch offen aus Punkt 2: Erweiterungen, Rollen, Publikationen,
  Spaltenrechte
- Davor: 2.18 Funktionen aus dem Katalog – zweiter Schritt von
  Punkt 2 nach dem Trigger-Muster: `inspectFunctions` im Data-Plane-Port
  (`lib/server/data-plane/service.ts`, SQL abgeleitet aus postgres-meta
  `functions.sql`, Apache 2.0, auf `pg_proc` plus `pg_get_function_*`
  reduziert; `prokind` in f/p, Aggregate und Fensterfunktionen draussen; kein
  Quelltext, er kann Geheimnisse tragen; LIMIT 201/200), Route
  `schema/functions` (`handleProjectFunctions`, dieselbe Tuer), Console
  `components/console/functions-view.tsx` (`db-functions` jetzt echt, in
  REAL_VIEWS, Platzhalter entfernt), Uebersetzungen in drei Sprachen.
  Tests: `tests/project-data-plane-functions.test.ts` (Fake-Client),
  `tests/data-plane-functions-route.test.ts`,
  `tests/data-plane-functions-postgres.integration.test.ts` (Vorgaben, OUT,
  SETOF, TABLE, SECURITY DEFINER, Prozedur, Trigger-Funktion; Aggregat und
  Nachbarschema bleiben draussen). PostgreSQL 162 von 162 zweimal, Mutation
  (`prokind`-Filter entfernt) 1 von 162 faellt. Naechste Ansichten nach
  demselben Muster: Indizes, Enum-Typen, Erweiterungen, Rollen, Policies,
  Publikationen, Spaltenrechte (Vorlagen in scratchpad `pgmeta/`)
- Davor: 2.17 Hilfe, die antwortet – nach Denzils Okay sind
  `@qkern/sdk@1.7.0-alpha.3` und `@qkern/cli@1.7.0-alpha.3` auf npm (Tag
  `alpha`; der erste Versuch fiel mit E422, npm nimmt Provenance nur aus
  oeffentlichen Repositories, deshalb ist `provenance` im Workflow jetzt ein
  Eingabefeld, Voreinstellung false). Die Installation in ein leeres
  Projekt fand den ersten Fehler: `npx qkern --help` antwortete nur "QKERN
  CLI command failed." und verschluckte die Nutzung. `cli/src/main.ts` ist
  jetzt ein duenner Einstieg, die Befehle liegen in `cli/src/commands.ts`
  (`run(args, io)` liefert den Exit-Code): `help`/`--help`/`-h`/leer zeigen
  die Nutzung auf stdout (0), ein unbekannter oder halber Befehl auf stderr
  (1), jeder andere Fehler nennt seinen Grund. Vertrag
  `tests/cli-usage.test.ts`, Mutation (Help-Zweig entfernt, 1 von 3 faellt).
  CLI auf `1.7.0-alpha.4`; der Workflow ueberspringt Versionen, die npm
  schon hat. Denzil ist einkaufen und hat "autonom weiter testen und fertig
  bauen" gesagt
- Davor: 2.16 Apache 2.0 – Denzils Entscheidung: `@qkern/sdk` und
  `@qkern/cli` unter Apache License 2.0 (`LICENSE` in beiden Paketen, im
  `files`-Feld, `license: "Apache-2.0"`, `private` entfernt, README-Abschnitt).
  Die Plattform selbst (Server, Console, Worker) bleibt unlizenziert. Vertrag
  `tests/developer-experience.test.ts` prueft Lizenz, `LICENSE` und das
  fehlende `private`. Beide Namen sind auf npm frei (404), die Organisation
  `qkern` gehoert Denzil. Naechster Schritt: Probelauf des Publish-Workflows,
  dann erst die echte Veroeffentlichung als 1.7.0-alpha.3 unter Tag `alpha`,
  nach Denzils Okay
- Davor: 2.15 Was der Runner fand – zweiter GitHub-Lauf (Stand
  2.14.0): Developer Experience auf Ubuntu, Windows und macOS gruen
  (`docs/evidence/2026-09-25/github-dx-run-36163798505.json`), damit ist die
  Windows-/macOS-Haelfte von Sprosse 7 erstmals belegt. Zertifizierung:
  Storage (versitygw) und Auth gruen, PostgreSQL 161 von 161 gruen und
  trotzdem exit 1: ein unbehandelter `error` eines Pools, dessen unbenutzte
  Verbindung `DROP DATABASE ... WITH (FORCE)` im Teardown beendete
  (57P01). Produktfehler: `createPostgresPool` in `lib/server/db/pool.ts`
  hatte keinen `error`-Zuhoerer; jetzt protokolliert er `[db] idle
  connection lost` (Vertrag `tests/postgres-pool-idle-error.test.ts`,
  Mutation: Zuhoerer entfernt, 1 von 1 faellt). Dazu
  `.github/workflows/publish.yml` (nur von Hand, Probelauf als
  Voreinstellung, echter Lauf verweigert `private` und `UNLICENSED`) und
  `bin` der CLI ohne `./` (npm 11 verwirft den Pfad sonst). NPM_TOKEN liegt
  als Secret, von Denzil gesetzt. Offen: Lizenz und `private` fuer die
  Veroeffentlichung, Denzils Entscheidung
- Davor: 2.14 Ein Server, der noch da ist – erster Lauf auf GitHub
  (Repo `Denzillax/qkern`, privat, angelegt mit der GitHub CLI; Denzil hat sich
  selbst angemeldet). Zwei rote Jobs: (1) Windows-Runner: `spawnSync npm.cmd
  EINVAL` unter Node 24 in `scripts/verify-package-tarballs.mjs`, jetzt ruft es
  `npm-cli.js` direkt mit `process.execPath`, ohne Shell; (2) der Storage-Stack
  bekam `minio/minio` nicht mehr: das Repository ist von Docker Hub verschwunden,
  quay.io traegt es nicht. Drei Ersatzserver geprueft; nur versitygw v1.8.0
  (Apache 2.0) verhaelt sich wie S3 auf dem Weg des Dienstes (POST-Policy mit
  `x-amz-checksum-sha256`, Summe im HEAD zurueck, falsche Summe 400). RustFS
  1.0.0 gibt im HEAD keine Summe, zwei Faelle fielen. Stack, Dev-Compose
  (Port 9000 auf 7070, ohne UI, `npm run storage:bucket`), Label
  `versitygw und ClamAV` (alte Manifeste bleiben lesbar), Texte in vier
  Sprachen. Lokale Zertifizierung 8/8 zweimal. Sprosse 7 ist damit begonnen,
  nicht belegt: der GitHub-Lauf auf dem neuen Stand steht noch aus
- Davor: 2.13 Eine Schrift – Denzil zur Badge "282 archivierte
  Pruefläufe": die Schriftart ist schrecklich, ueberall aendern. Das war
  JetBrains Mono als Label-Schrift. Jetzt laufen alle Labels, Kicker, Zaehler
  und Kleintexte auf Landing (`app/page.module.css`) und in der Console
  (`app/globals.css`, 41 Regeln) in Manrope 600; Mono nur noch fuer echten
  Code: `<code>` in den Schnittstellen, Editor, Zeilennummern, `pre`, Diff
  (`--qkern-font-mono`)
- Davor: 2.12 Wie Menschen reden – Denzil zur Hero-Zeile
  "Backend-Bausteine, die ihre Zusagen belegen": so reden keine Menschen.
  Neu in `lib/i18n/landing.ts` (hero, meta, footer.tagline, vier Sprachen)
  und `app/layout.tsx`: "Dein Backend. Getestet, bevor du es anfasst." mit
  einem Lead in Alltagswoertern (Login statt Auth, Dateien statt Storage).
  Massstab fuer kuenftige Texte: der humanizer-Skill, Abschnitt F
- Davor: 2.11 Der Q-Orbit – Denzils Referenz nexalead.framer.ai:
  ein Partikelring um das Q, der mit der Maus interagiert.
  `components/hero-orbit.tsx`: Canvas mit rund 1400 Partikeln auf drei
  gleich geneigten Bahnen (innen schneller als aussen, eine Richtung), das
  Q steht still in der Mitte; die Maus kippt den Ring, Partikel in
  Zeigernaehe weichen aus. Ab 961 px steht der Text links und der Orbit
  rechts, der Pruefbericht darunter; auf dem Handy liegt der Orbit hinter
  der Ueberschrift. Das Q-Feld aus 2.10 (`hero-field.tsx`) ist entfernt.
  Zweimal "bewegt sich komisch": erst drei Drehrichtungen und ein
  mitdrehendes Q, dann eine Eigendrehung der Blickachse, die den Ring
  taumeln liess; beides weg
- Davor: 2.10 Das Q-Feld – Denzils Wunsch nach einer
  Hintergrund-Animation mit dem Q, die mit der Maus interagiert.
  `components/hero-field.tsx`: sieben blasse Q-Symbole (Pfad aus dem
  Marken-SVG, inline) an festen Positionen im Hero, treiben per CSS-Keyframe
  (17 bis 34 s), weichen der Maus je Tiefe aus (CSS-Variablen `--mx/--my`,
  ein rAF-Loop mit Gedämpfung, der bei Ruhe stoppt), ein Lichtfleck folgt
  dem Zeiger. Nur mit `hover: hover`-Zeiger; `prefers-reduced-motion`
  schaltet Drift und Parallaxe ab; auf dem Telefon vier Symbole, kleiner.
  Inhalt über dem Feld (`.hero > .shell` z-index 1)
- Davor: 2.9 Trigger aus dem Katalog – erster Schritt von Punkt 2
  (Supabase-Funktionen übertragen): `inspectTriggers` im Data-Plane-Port
  (`lib/server/data-plane/service.ts`, SQL abgeleitet aus
  supabase/postgres-meta `triggers.sql`, Apache 2.0, auf `pg_catalog`
  reduziert: tgtype-Bits, `pg_get_triggerdef` für WHEN, interne Trigger
  draussen, Limit 200), Route `GET /schema/triggers?schema=` durch
  dieselbe Tür wie `/schema`, Console-Ansicht `triggers-view.tsx`
  (`db-triggers` ist REAL_VIEW). Real-DB-Fall
  `tests/data-plane-triggers-postgres.integration.test.ts` (im
  `test:postgres`-Skript und im Modulzähler „Generated Data API“),
  Fake-Client-Fälle, Routen-Fälle. Mutation: Filter `NOT tgisinternal`
  entfernt, 160 von 161, genau der Trigger-Fall. Nächste Objektarten nach
  demselben Muster: Funktionen, Indizes, Enum-Typen, Erweiterungen, Rollen,
  Policies, Publikationen, Spaltenrechte (postgres-meta-Abfragen liegen als
  Vorlage im Scratchpad `pgmeta/`, nicht im Repo)
- Vorheriger Slice: 2.8 Derselbe Fehler, andere Klasse — Befund: die
  Console zeigte „Console-Daten nicht verfügbar" (500) statt zum Login zu
  leiten. Ursache: Die Auth-Laufzeit liegt im Dev-Modus auf `globalThis`
  und überlebt Hot-Reloads, die Klasse `AuthError` nicht; `instanceof` in
  `request-context.ts` und den Auth-Routen fiel durch. Jetzt
  `isAuthError(error, code)` (Name und Code statt Klassenidentität) an
  allen sechs Stellen, Test `tests/auth-error-identity.test.ts` mit einer
  fremden Kopie der Klasse; `/api/v1/console` loggt unerwartete Fehler.
  Dazu Punkt 3 von „mach 1–3": Sidebar-Gruppen in `localStorage`
  (`qkern.console.groups`), Register-Parole ohne Fragmentpaar. Die Notiz
  zu 2.6/2.7 „Memory-Session weg" war nur halb richtig: dazwischen war es
  dieser Fehler
- Vorheriger Slice: 2.7 Drei Ansichten mehr — Migrationen
  (`migrations-view.tsx`: Change Sets aus dem Snapshot, Reviews über
  `/api/v1/migrations/reviews`, Vorfälle über `/api/v1/migrations/incidents`,
  je Umgebung gefiltert), Function-Aufrufe (`invocations-view.tsx`:
  Functions der Umgebung, Aufrufprotokoll je Function über
  `/compute/functions/{id}/invocations`), Realtime-Inspector
  (`realtime-inspector-view.tsx`: reiner Browser-Client für
  `qkern.realtime.v1`, Anmeldung mit Projekt-Key, Abonnieren, Broadcast,
  Protokoll; Server-URL aus `NEXT_PUBLIC_QKERN_REALTIME_URL`, sonst
  `ws://localhost:8788`). Drei Platzhalter weniger (`db-migrations`,
  `compute-invocations`, `realtime-inspector` sind REAL_VIEWS); 85 neue
  Schlüssel je Sprache. Punkt 1 von Denzils „mach 1–3" ist damit erledigt
- Vorheriger Slice: 2.6 Queues in der Console — erster der vier Platzhalter
  mit zertifiziertem Backend. `components/console/queues-view.tsx` liest
  die Admin-Routen unter `/queues`: Liste, Status je Queue (wartend, in
  Bearbeitung, erledigt, Dead Letters, älteste wartet seit), Dead Letters
  mit Wiedereinreihen, Queue anlegen per Prompt, Hinweis auf den
  Metrics-Export. `int-queues` ist jetzt eine echte Ansicht (REAL_VIEWS),
  der Platzhalter ist weg. Der i18n-Vertrag liest seit 2.6 alle `.tsx` in
  `components/console`, nicht nur `console-app.tsx`; 37 neue Schlüssel.
  Sichtprüfung im Browser steht aus: Die App hat den Dev-Server während
  des Slices neu gestartet, die Memory-Session ist damit weg
- Vorheriger Slice: 2.5 Das Flyout — Untermenüs in der eingeklappten
  Sidebar, im Brainstorming gewählt (Variante A gegen zweite Spalte und
  kurz aufklappen; Entwurf in
  `docs/superpowers/specs/2026-09-25-collapsed-sidebar-flyout-design.md`).
  `components/console/sidebar-flyout.tsx`: öffnet nach 150 ms Hover oder
  per Klick, 220 px, per Portal `position: fixed` rechts neben dem Icon,
  rutscht nach oben, wenn es unten aus dem Fenster ragte, scrollt innen;
  schliesst bei Wahl, Escape, Klick ausserhalb und 250 ms nach Verlassen
  (Gnadenfrist). Nur eingeklappt auf Desktop (`collapsed && !isPhone`), auf
  dem Telefon bleibt das Untermenü inline. Vertrag
  `tests/console-flyout-contract.test.ts`
- Vorheriger Slice: 2.4 Knöpfe, die stillhalten — Denzils feste Regel
  (Memory `stable-button-widths`): Buttons ändern ihre Grösse nie, wenn die
  Beschriftung wechselt, weder bei Zustand noch bei Sprache.
  `components/stable-label.tsx` legt alle Varianten in eine Grid-Zelle,
  nur die aktive ist sichtbar; `tAll()` in `console-i18n.ts` liefert einen
  Text in allen Sprachen. Angewandt: Sprachknopf, Anmelden/Projekt
  erstellen, Umgebungsmenü, alle Zustandswechsel der Console
  (Pausieren/Aktivieren, Läuft…/Abfrage ausführen, Speichern…/Regel
  speichern, Status ausblenden/Zustellstatus, Deaktivieren/Aktivieren,
  Wird vorbereitet…/Vorschau erstellen). Das Schliessen-Kreuz der Sidebar
  war auf Desktop sichtbar, weil `.console-brand button` (1.94)
  `.sidebar-close` (1.97) in der Spezifität schlug; jetzt
  `.console-brand .sidebar-close`. Dabei fanden sich fünf Zustandswechsel
  mit nackten deutschen Literalen, die der Scanner von 2.3 übersprungen
  hatte (ein Wort, kein Umlaut): jetzt übersetzt, zehn neue Schlüssel
- Vorheriger Slice: 2.3 Die Console in vier Sprachen — jeder Text in
  `console-app.tsx` steht als `t("deutscher Text")`; `console-i18n.ts`
  hält die aktive Sprache in einer Modulvariablen, die `ConsoleApp` zu
  Beginn des Renderns setzt (bewusst kein Context: rund dreissig kleine
  Komponenten, synchroner Render von oben nach unten). `lib/i18n/console.ts`
  hat 454 Übersetzungen je Sprache, Schlüssel ist der deutsche Text.
  Navigation und Platzhalter übersetzen am Render (`t(group.label)`,
  `t(entry.note)`), die Suche findet Deutsch und Übersetzung. Sprachwahl in
  der Kopfleiste neben der Umgebung; `app/console/page.tsx` liest das
  Cookie. Vertrag `tests/console-i18n-contract.test.ts` liest alle
  `t("…")` und Navigationstexte und verlangt alle drei Sprachen, ohne
  verwaiste Einträge. Der Sprachknopf der Website ist eine Pille mit Globus
  und Kürzel nebeneinander (vorher gestapelt durch das Icon-Button-Raster)
- Vorheriger Slice: 2.2 Vier Sprachen — Website (Landing, Login,
  Registrierung) in DE/EN/FR/IT. `lib/i18n/locales.ts` (Sprachen, Cookie
  `qkern_locale`, `negotiateLocale` aus Accept-Language, `fill`),
  `lib/i18n/server.ts` (`currentLocale`: Cookie, sonst Browser),
  `lib/i18n/landing.ts` und `lib/i18n/auth.ts` (typisierte Wörterbücher,
  Deutsch ist die Vorlage; `names` übersetzt Manifest-Namen und Stacks;
  `formatDate` je Sprache), `components/language-switcher.tsx` (Cookie +
  `router.refresh()`), `<html lang>` im Layout, `generateMetadata` je
  Seite. Console bleibt deutsch. Vertrag `tests/i18n-contract.test.ts`:
  gleiche Struktur, nichts leer, nichts kopiert, gleiche Platzhalter,
  Browser-Erkennung fällt auf Deutsch zurück
- Vorheriger Slice: 2.1 Gruppen, die zugehen — Nutzerbefund: Sidebar-Gruppen
  liessen sich nicht schliessen, Pfeile verschwanden bei langen Namen.
  Ursache eins: der Zustand „geschlossen" war ein leerer String, und der
  fiel in der Bedingung auf „aktive Gruppe ist offen" zurück. Jetzt eine
  `Set<string>` offener Gruppen (`toggleGroup`), die aktive Gruppe öffnet
  sich per Effekt beim Ansichtswechsel. Ursache zwei: `white-space: nowrap`
  ohne Kürzung schob den Pfeil aus der 232-px-Leiste; jetzt `flex: 1`,
  `min-width: 0`, Ellipse, Pfeil `flex: none`
- Vorheriger Slice: 2.0 Das Menü von Supabase — `components/console/navigation.ts`
  bildet das Routen-Verzeichnis von Supabase Studio ab
  (`apps/studio/pages/project/[ref]`, per GitHub-Tree gelesen): 19 Gruppen
  mit Untermenüs, 15 echte Ansichten, 83 Platzhalter je mit
  Supabase-Name, Backend-Urteil (vorhanden/teilweise/fehlt) und
  Erklärung. `PlaceholderView` zeigt das und die Nachbarn der Gruppe;
  Suche findet alle Einträge. Vertrag
  `tests/console-navigation-contract.test.ts`: jedes Studio-Verzeichnis hat
  eine Gruppe, jede Ansicht steht genau einmal, jede Erklärung ≥ 40 Zeichen.
  Nächster Schritt laut Denzil: die Platzhalter nacheinander bauen
- Vorheriger Slice: 1.99 Die Console spricht Deutsch — `console-app.tsx`
  durchgehend deutsch, Produktbegriffe bleiben englisch (Table Editor, SQL
  Editor, Change Set, RLS, Storage, Functions). Erfundene Live-Werte sind
  weg: Deltas der Kacheln, 24-h-Balken, Latenzen, „nova-market-dev", Pool
  12/100, Demo-Tabellen, verbundene Agenten, Nav-Badges; stattdessen
  Platzhalterkarten „Noch nicht verbunden". Freigabe-Badge zählt echte
  offene Freigaben; Projekt-Umschalter zeigt echten Workspace; Statuspille
  „Verbunden" nur bei geladenem Snapshot. `demoTables`, `TableList`,
  `ApiView` entfernt
- Vorheriger Slice: 1.98 Texte ohne Tells — die Prosa der Landingpage
  (`app/page.tsx`) nach dem Skill `humanizer` (Abschnitt F, Deutsch)
  überarbeitet: zwölf Passagen, kein Code, keine Zahlenquelle. Denzil will
  den Skill auf jeden Text angewandt, den ich für ihn schreibe (Memory
  `apply-humanizer-always`)
- Vorheriger Slice: 1.97 Grosse Zahlen, kleines Menü — drei Nutzerbefunde:
  Kennzahlen winzig mit Plus in eigener Zeile (`.stat span` traf den
  `CountUp`-Span; jetzt `.stat > span` fürs Label, Zahl 44–64 px); Website
  ohne Hamburger-Menü unter 1000 px (`components/site-menu.tsx`, Blatt unter
  der Kapsel, Escape/Klick/Breitenwechsel schliessen, Body-Scroll gesperrt);
  Console-Sidebar auf dem Telefon mit sinnlosem Ein-/Ausklapp-Pfeil (jetzt
  Schliessen-Kreuz `.sidebar-close`, `is-collapsed` wird unter 760 px
  neutralisiert)
- Vorheriger Slice: 1.96 Bewegung beim Scrollen — `components/reveal.tsx`
  (`Reveal`: IntersectionObserver, setzt `data-in`; `CountUp`: Kennzahlen
  zählen ab 0.5 Sichtbarkeit hoch, Endwert per Timeout gesichert, weil
  requestAnimationFrame in Hintergrund-Tabs pausiert). Ausblendung nur unter
  `html[data-reveal="on"]`, also erst mit JavaScript; `prefers-reduced-motion`
  schaltet alles ab. Preise wie die Referenz: drei gleiche Karten, „CHF 0 /
  pro Monat", Beschreibung, voller Button, gepunktete Linie, Häkchenliste;
  `plans`-Daten in `app/page.tsx`, kein `SwissFranc`-Icon mehr
- Vorheriger Slice: 1.95 Menüs statt Attrappen — eigenes Umgebungsmenü
  (`EnvironmentMenu`, Listbox mit Status-Punkt, Hinweistext, Escape und
  Klick-ausserhalb) statt nativem `select`; Aufklapp-Pfeil neben dem Symbol
  in der 70-px-Leiste; Sidebar-Zustand in `localStorage`
  (`qkern.console.sidebar`, im Effekt gelesen, damit SSR und Client gleich
  rendern); Kontomenü (`AccountMenu`) mit E-Mail, Workspace, ehrlich
  abgeschalteten Konto-/Workspace-Einstellungen und Abmelden; Krume zeigt
  `displayWorkspaceName()` („Denis Mihaljevic" + Etikett) aus
  `lib/console/workspace-name.ts`; Next-Dev-Anzeige nach unten rechts.
  Achtung: Eine `next.config.ts`-Änderung startet den Dev-Server neu, und
  der Memory-Auth-Adapter (Default ohne `.env.local`) verliert dabei alle
  Konten und Sessions
- Vorheriger Slice: 1.94 Der Weg zurück — Nutzerbefund: die eingeklappte
  Sidebar liess sich nicht wieder öffnen (`.is-collapsed .console-brand
  button { display: none }`), das Logo führte auf `/` statt `/console`, die
  Umgebungswahl war 9-px-Monospace. Jetzt: Aufklapp-Button bleibt in der
  70-px-Leiste sichtbar, Logo verlinkt `/console`, Select in Sans mit
  Status-Punkt und Chevron (`.environment-field`)
- Vorheriger Slice: 1.93 Die Console sagt, was sie nicht kann — Nutzerbefund
  nach dem Redesign: Kopfleiste wieder als volle geblurrte Leiste (die
  transparente Kapsel liess Inhalt darunter durchscrollen), Kicker in Sans und
  Satzschreibung, dünne Scrollleisten, eine Buttonhöhe (40 px), und alle
  Attrappen ehrlich abgeschaltet mit Tooltip; das „Springen" war ein
  `auto 1fr`-Grid ohne Grid-Item-Sidebar (fixed) — Arbeitsbereich im
  `auto`-Track, gemessen 837 von 1208 px bei 1440 px, jetzt `display: block`: Backups und Settings zeigen
  keine erfundenen Daten mehr (Settings liest den echten Projektnamen und die
  echte ID), Team, Glocke, Filter und Beispiel-Endpunkte sind sichtbar
  „noch nicht verbunden"
- Vorheriger Slice: 1.92 Schwebende Flächen — Redesign von Landingpage und
  Console nach der Formensprache einer Framer-SaaS-Referenz (schwebende
  Kapsel-Navigation, vollrunde Bedienelemente, Radien 24px, weiche Schatten,
  pastellene Halos aus dem Markenblau); Farben und beide Modi bleiben die
  Tokens am Anfang von `globals.css`, die Formschicht liegt bewusst am Ende
  der Datei und überschreibt nie Farbe. `app/page.module.css` ist neu; die
  Console ist nur umgestylt, kein Markup geändert
- Vorheriger Slice: 1.91 Die Seite liest, statt abzuschreiben — die Landingpage
  (`app/page.tsx`) liest ihre Prüflauf-Zahlen aus den archivierten Manifesten
  (`lib/server/evidence/certification-summary.ts`, bester grüner Lauf je Stack,
  Datum des jüngsten, Mutationsläufe als Gegenproben); Vertrag
  `tests/landing-numbers-contract.test.ts` verbietet literale Zählwerte und
  bindet die Seite an dieselben Zahlen wie STATUS.md. Fund: Die Seite trug seit
  dem 6. August „85 von 85", während 160 galten; auch `modules`/`gaps` nannten
  längst geschlossene Lücken (Emitter, Cluster-Grenze, DNS-Pinning)
- Vorheriger Slice: 1.90 Platz für jeden Pool — der Zertifizierungs-Postgres
  läuft mit `max_connections=300` (Compose-Parameter), und ein Real-DB-Fall
  prüft `SHOW max_connections` im Lauf. Damit ist die lokal belegbare Liste
  der Paritätsleiter abgearbeitet; offen bleiben nur Sprosse 7 (SDK/CLI über
  CI) und 10 (PITR/Restore, SSL-Postgres) — beide brauchen Infrastruktur
  ausserhalb dieser Maschine
- Vorheriger Slice: 1.89 Was gelaufen ist, steht — Aufrufprotokoll je Function
  (Migration 0045, append-only): Beginn, Dauer, Ausgang, Statuscode oder fester
  Fehlercode; bewusst kein stdout/stderr (Haltung aus 1.22). Ein Protokollfehler
  stürzt den Aufruf nicht (`onLogFailure`). Route
  `compute/functions/[functionId]/invocations`. Befund: Der Zertifizierungs-
  Postgres läuft mit Standard-`max_connections=100` gegen 76 Test-Pools mit
  233 deklarierten Verbindungen — einmal gerissen, als Nächstes zu beheben
- Vorheriger Slice: 1.88 Zeitreihen, bevor sie sich bewegen — `exportMetrics`
  (alle Queues des Scopes, auch leere, aus derselben Wahrheit wie `status`),
  reine Formatierfunktion `renderQueueMetrics` (Prometheus-Text 0.0.4), Route
  `queues/metrics` mit Admin-Session; eine Queue namens `metrics` verliert nur
  diesen einen Pfad
- Vorheriger Slice: 1.87 Die ganze Uhr — Fünf-Feld-Cron in UTC (`*`, `*/N`, `a`,
  `a-b`, `a-b/N`, Listen; dom/dow-ODER-Regel; 7 = Sonntag); `* * * * *` ist
  jetzt gültig. Fund der Mutationsprobe: Der Readiness-Fall im Cron-Stack
  stützte sich auf die Unlesbarkeit von `* * * * *` und bestand seit der
  Grammatik nur per Timing — jetzt mit Stunde 24 als echtem Fehler
- Vorheriger Slice: 1.86 Zählen unter der eigenen Grenze — `aggregateRows`
  (count/sum/avg/min/max, optionale Gruppierungsspalte) unter der RLS des
  Aufrufers; Route `tables/[table]/aggregate` importiert die Fehlergrenze der
  Zeilenliste statt sie zu duplizieren; Zähler/Summen als Dezimalstrings
- Vorheriger Slice: 1.85 Wer bürgt, sagt es — `emailVerification: "required" |
  "trusted"` je OIDC-Provider; trusted akzeptiert einen **fehlenden**
  `email_verified`-Claim (der Operator bürgt), ein explizites `false` bleibt in
  jedem Modus eine Abweisung. Fund: `tests/auth-service.test.ts` mischte
  fixierte Dienst-Uhr und echte Uhr — bestand im August zufällig, fiel im
  September (Kalender-Bombe; behoben, Fixture reicht jetzt `now()` durch).
  Ablage: Das Repo liegt seit dem 24. September unter
  `C:\Projekte\QKERN\code\qkern` (Ordnerregel aus `C:\Projekte\QKERN\README.md`:
  `code/` hält nur Git-Repos). Das leere Git-Gerüst, das `code/` selbst aus
  der Neustrukturierung trug (0 Commits), ist am 24. September entfernt
- Vorheriger Slice: 1.84 Der Login kennt seine Türen — öffentlicher
  Provider-Chooser `GET auth/oidc/providers` hinter derselben pre-auth-Grenze
  wie authorize (Projekt-Key, Origin-Gate, CORS, no-store); fremder Schlüssel
  bekommt 404, nicht 403. Drei Quellscan-Verträge (Zahlen, Routen-Grenzen,
  Erreichbarkeit) tragen jetzt explizite 30s-Budgets — die
  5-Sekunden-Voreinstellung riss unter Volllast (der transiente Einzelfall aus
  1.83 war genau das)
- Vorheriger Slice: 1.83 Die Auswahl wird aufzählbar — `listOidcProviders` als
  Zwei-Felder-Projektion (Slug, Issuer; nie Client-ID oder Secret-Env-Name);
  Admin-Route `auth/admin/providers`, Console zeigt echte Provider; der Katalog
  kannte `list()` seit 1.76, gerufen hat es niemand (zehnter Fund der Klasse
  "gebaut und nie gerufen")
- Vorheriger Slice: 1.82 Rechnungen erreichen den Browser — Console-Karte in
  der Monitoring-Ansicht; der Ladeweg ist als reine Funktion extrahiert
  (`components/console/invoices.ts`) und lokal vertraglich geprueft; die
  Invoices-Route spricht erstmals HTTP (`tests/billing-invoice-routes.test.ts`)
- Vorheriger Slice: 1.81 Der Kreis ohne Luecken — Rechnungsnummern lueckenlos je
  Organisation (Migration 0044): Nummer und Rechnung entstehen in **einem**
  Statement (CTE-Upsert auf billing_invoice_counters), der ON-CONFLICT-Verlierer
  rollt seinen Zaehlerstand per SAVEPOINT zurueck; due_at per DEFAULT
  (timestamptz + interval ist nicht immutable — keine generierte Spalte)
- Vorheriger Slice: 1.80 Das Dokument sagt die Wahrheit — das OpenAPI-Dokument
  der Generated Data API beschreibt Views (nur GET, Pflicht-Sortierspalte, nur
  mit security_invoker) und RPC (nur was callFunction annaehme; Volatilitaet
  steht im Summary); hoechstens 200 Funktionen je Schema
- Vorheriger Slice: 1.79 Deployments stehen im Audit — `deployFunction` schreibt
  den Audit-Eintrag in **derselben** Transaktion wie die Tuer aus 0042; die
  Hash-Kette fuellt der Trigger aus 0002
- Vorheriger Slice: 1.78 Waisen altern weg — `expireLifecycle` raeumt verfallene
  Multipart-Reservierungen und Provider-Waisen; Migration 0043 ersetzt den nie
  erfuellbaren CHECK auf `provider_upload_id` (POSIX-Regex kann keine 1024
  Wiederholungen; jede Multipart-Reservierung gegen echtes PostgreSQL scheiterte
  seit 0041)
- MinIO beantwortet ListMultipartUploads mit Verzeichnis-Praefixen **leer** —
  der Provider filtert deshalb clientseitig ueber einer Seite (max. 1000)
- Die Slices 1.41 bis 1.77 stehen chronologisch in `docs/QA.md`; diese Liste
  hier war seit 1.40 nicht weitergefuehrt worden (Fund aus 1.78)
- Vorheriger Slice: 1.40 Die letzte ungepruefte Zahl — `tests/status-module-counts-contract.test.ts`
- Die Fortschrittstabelle nennt jetzt nur noch Zahlen, die aus den Testdateien zaehlbar sind
- Compute Contracts behauptete 116 Faelle; rekonstruierbar waren 73
- Vorheriger Slice: 1.39 Zahlen pruefen sich — `tests/status-numbers-contract.test.ts`
- Jede Zertifizierungszahl in `STATUS.md` muss dem Maximum der gruenen Manifeste ihres Stacks entsprechen
- `STATUS.md` nennt **keine** Zahl mehr, die kein Manifest belegen kann; die lokalen Vitest-Zahlen stehen in `docs/QA.md`
- Neuer Stack? Dann die Zuordnung in `CLAIMS` ergaenzen, sonst schlaegt der Vertrag laut fehl
- Vorheriger Slice: 1.38 Was noch waechst — `lib/server/compute/webhook-retention-runtime.ts`
- Zugestellte und tote Zustellungen haben getrennte Fenster; **wartende bleiben unberuehrt**
- `usage_events` bekommt bewusst **keinen** Aufraeumer: Trigger und fehlendes DELETE-Recht sind Absicht, die Antwort auf Wachstum ist Export
- Regel fuer Mutationsproben: nie die Parameterzahl oder einen untypisierten Bezug aendern — PostgreSQL wirft dann, und die Probe misst das Werkzeug statt der Zusage
- Vorheriger Slice: 1.37 Aufraeumen laeuft — `lib/server/realtime/retention-runtime.ts`
- Beide `prune`-Pfade hatten bis 1.36 **keinen Aufrufer**; Event-Log und Change-Feed wuchsen unbegrenzt
- Scope-Liste ausdruecklich in `QKERN_REALTIME_RETENTION_SCOPES_JSON` — RLS gibt keine organisationsuebergreifende Suche her
- Aufbewahrt wird nach **Alter**, nicht nach Position: Ein laenger ausgefallener Poller verliert Aenderungen
- Vorheriger Slice: 1.36 Clusterweite Grenze — `lib/server/compute/function-concurrency.ts`, Migration 0035
- Ein Platz ist eine Zeile mit Ablauf; die prozesslokale Zaehlung bleibt als Host-Schutz daneben
- Der Halter steht in der Zeile, aber nicht in der Zaehlbedingung — sonst uebersaehe eine Instanz die fremden Plaetze
- Vorheriger Slice: 1.35 Echte Registry — `registry:2` im Functions-Stack, kein ersetzter Wert mehr in der Kette
- Migration 0034 laesst `host:port` im Image-Bezug zu; der Digest bleibt die bindende Stelle
- `allowLocalImageId` ist **entfernt**: Das Schlupfloch existierte nur, weil das Test-Image lokal gebaut war
- Vorheriger Slice: 1.34 Aenderungen zaehlen mit — `deliverChanges` meldet einmal je zugestellter Aenderung
- Der Soak-Lauf laeuft jetzt **mit** eingeschaltetem Emitter und kleinem Flush-Schwellwert; die Latenzschranken gelten fuer den gemessenen Pfad
- Vorheriger Slice: 1.33 Realtime buendelt — `lib/server/usage/buffered-emitter.ts`
- Alle sechs Metriken melden; `UNENFORCEABLE_USAGE_METRICS` sammelt die drei, fuer die `enforce` nicht setzbar ist
- Der Puffer wird beim Herunterfahren geschrieben (`workers/realtime-runtime.mts`); ein Absturz verliert ihn absichtlich
- Vorheriger Slice: 1.32 Zaehlung an der HTTP-Grenze — `lib/server/usage/api-requests.ts`
- `admitApiRequest` steht am Ende der Kontext-Resolver von Queues, Storage und Generated Data API
- Nicht in `usage/http.ts`: dort steht die HTTP-Flaeche der Usage-Projektion selbst
- Fuenf von sechs Metriken melden; offen bleibt `realtime_messages` (braucht einen buendelnden Emitter)
- Vorheriger Slice: 1.31 Nachtraegliche Metriken — Generated Data API und Storage melden
- `POST_HOC_USAGE_METRICS` in `lib/server/usage/model.ts`: fuer diese Metriken ist `enforce` nicht setzbar
- Vier der sechs Metriken sind live; `api_requests` gehoert an die HTTP-Grenze (71 Routen, kein Chokepoint), `realtime_messages` braucht einen buendelnden Emitter
- Vorheriger Slice: 1.30 Transaktionale Messung — `consume`, `record` und `admit` nehmen eine laufende Transaktion
- `ProjectQueueRepository.enqueue` erhaelt einen `ProjectQueueMeter`, der **in** der Enqueue-Transaktion laeuft
- Eine abgelehnte Messung rollt die bereits geschriebene Nachricht zurueck; Functions bleiben nicht-transaktional, weil sie nichts schreiben
- Vorheriger Slice: 1.29 Usage-Emitter — `lib/server/usage/emitter.ts`
- Ein Port mit **einer** Methode: `admit`. Der Emitter besitzt den `meter`-Principal und baut den Idempotenzschluessel
- Verdrahtet in `ProjectQueueService.enqueue` und `FunctionInvocationService.invoke`; Voreinstellung ist der `DisabledUsageEmitter`
- Messung faellt im Betrieb offen aus (`QKERN_USAGE_EMITTER_ON_FAILURE`), bei Fehlkonfiguration aber beim Start zu
- Vorheriger Slice: 1.28 Echter Empfaenger — `tests/receiver.integration.test.ts`, `tests/support/receiver/`
- Sechster Zertifizierungslauf: `npm run test:receiver:docker` (Node-24-HTTPS-Empfaenger plus PostgreSQL 17)
- Der Stack legt ein Netz mit **oeffentlichem** Subnetz an, damit die Adresspolicy unveraendert gilt
- Vorheriger Slice: 1.27 Egress-Haertung — `lib/server/net/address-policy.ts`, `guarded-fetch.ts`
- Jede Ausgangsverbindung: Namen aufloesen, jede Adresse pruefen, zur geprueften verbinden
- Die gepinnte `lookup` muss `options.all` beachten; sonst scheitert jede echte Verbindung
- Vorheriger Slice: 1.26 Vermittelter Egress — `lib/server/compute/function-egress.ts`
- Der Container behaelt `--network none`; Ausgangsverbindungen laufen zeilenweise ueber stdio
- Vorheriger Slice: 1.25 Signaturschluessel aus dem Vault — `lib/server/compute/webhook-secret-vault.ts`
- Fuenfter Zertifizierungslauf: `npm run test:vault:docker` (HashiCorp Vault 1.18 im Dev-Modus)
- Vorheriger Slice: 1.24 Functions Ende zu Ende — Kette in einem Lauf, `maxConcurrency` durchgesetzt
- Kettenlauf: `tests/function-chain.integration.test.ts` plus `docker-compose.functions-certification.yml`
- Vorheriger Slice: 1.23 Functions aufrufbar — Migration 0033, Verwaltung und `compute/invoke/{name}`
- Aufrufweg: `lib/server/compute/function-invocation.ts`, opt-in ueber `QKERN_FUNCTIONS_ENABLED`
- Vorheriger Slice: 1.22 Functions-Sandbox — `lib/server/compute/function-sandbox-docker.ts`
- Vierter Zertifizierungslauf: `npm run test:functions:docker` (braucht Docker; startet sein eigenes PostgreSQL auf 127.0.0.1:55433)
- Test-Image der Sandbox: `tests/support/function-sandbox/`
- Vorheriger Slice: 1.21 Definitionsflaeche — REST und Console fuer Cron und Webhooks
- Definitionsdienst: `lib/server/compute/definitions.ts` und `definitions-postgres-repository.ts`
- Routen: `app/api/v1/projects/[projectId]/environments/[environment]/compute/`
- Berechtigung: `project_compute_admin` (nur owner und administrator)
- Console: Ansicht `Functions & Jobs` in `components/console/console-app.tsx`
- Vorheriger Slice: 1.20 Zustellprozess — Cron und Webhooks laufen in `workers/compute-runtime.mts`
- Compute-Betrieb: `lib/server/compute/runtime-composition.ts`, `webhook-delivery-runtime.ts`
- Signatur und Transport: `lib/server/compute/webhook-signer.ts`, `webhook-transport.ts`
- Start: `QKERN_COMPUTE_RUNTIME_ENABLED=true npm run worker:compute`
- Poller-Betrieb: `change-poller-runtime.ts`, `change-poller-registry.ts`, `project-connection.ts`
- `changes:` ist opt-in ueber `QKERN_REALTIME_CHANGES_ENABLED`
- Projekt-DB-Migration: `db/project/0003_qkern_change_feed.sql` (gegen echtes PostgreSQL zertifiziert)
- Sechs Zertifizierungslaeufe: `test:postgres:docker`, `test:storage:docker`, `test:auth:docker`, `test:functions:docker`, `test:vault:docker`, `test:receiver:docker`
- Letzte Control-Plane-Migration:
  `db/migrations/0048_project_auth_mfa_enforcement.sql` (`project_auth_settings`
  mit `mfa_required` je Projektumgebung und der neue Token-Zweck
  `mfa_enrollment` fuer den Einrichtungsschein). Davor:
  `db/migrations/0047_audit_chain_order.sql`
  (Kettentrigger setzt `created_at` unter dem Lock, Kettenreihenfolge gleich
  `(created_at, id)`). Davor: `db/migrations/0046_project_auth_audit.sql`
  (SELECT und INSERT auf audit_logs fuer qkern_auth, damit Project Auth in die
  Hash-Kette schreibt). Davor: `db/migrations/0045_project_function_invocations.sql`
  — die eine Tuer fuer Image-Deployments: Wechsel nur zusammen mit der
  append-only Historienzeile. Davor: `db/migrations/0041_project_storage_multipart.sql`
  — `kind` und `provider_upload_id` an der Upload-Reservierung fuer
  fortsetzbare Uploads. Davor: `db/migrations/0040_billing_invoices.sql`
  — append-only Rechnungen ueber abgeschlossene Monatsfenster plus die
  Leserechte des Rechnungslaufs. Davor: `db/migrations/0039_billing_rate_cards.sql`
  — das append-only Preisblatt der sechs Nutzungsmetriken. Davor:
  `db/migrations/0038_runtime_outbox_arbiter_grant.sql`
  — sie erteilt der Laufzeit das Leserecht auf den drei Arbiter-Spalten des
  Einreihungs-`ON CONFLICT`. Ohne dieses Recht konnte seit 0019 kein
  Apply-Auftrag eingereiht werden. Davor:
  `db/migrations/0037_provisioner_binding_returning_grant.sql`
  — sie erteilt dem Provisioner das Leserecht, das `INSERT … RETURNING` auf
  `project_database_bindings` verlangt. Davor: `db/migrations/0036_provisioner_heartbeat_upsert_grant.sql`
  — sie erteilt dem Provisioner das Leserecht auf den Arbiter-Spalten seines
  Heartbeat-`ON CONFLICT`. Ohne dieses Recht scheiterte der erste Aufruf jeder
  Runde, und der Prozess hat seit Migration 0021 nie gearbeitet.
- Webhook-Outbox: `lib/server/compute/webhook-outbox.ts` und `webhook-postgres-repository.ts`
- Cron: `lib/server/compute/cron-scheduler.ts` und `cron-postgres-repository.ts`
- Realtime-Domäne: `lib/server/realtime/` mit `postgres-repository.ts`, `event-bus.ts` und `change-source.ts`
- Evidenz: `docs/evidence/2026-08-04/` bis `2026-08-06/` mit Rohlogs und generierten Manifesten
- Manifestgenerator: `scripts/certification-manifest.mjs`
- SMTP-Delivery: `lib/server/project-auth/smtp-delivery.ts`
- Usage-Domäne: `lib/server/usage/`
- Usage-REST: `app/api/v1/projects/[projectId]/environments/[environment]/usage/route.ts`
- Usage-Vertrag: `docs/USAGE_METERING.md` und `lib/openapi.ts`
- Queue-Domäne: `lib/server/project-queues/`
- PostgreSQL-Adapter: `lib/server/project-queues/postgres-repository.ts`
- REST-Routen: `app/api/v1/projects/[projectId]/environments/[environment]/queues/`
- Vertrag: `docs/PROJECT_QUEUES.md` und `lib/openapi.ts`
- Worker: `lib/server/project-queues/worker.ts` und `worker-runtime.ts`;
  gestartet von `workers/project-queue-runtime.mts` (`npm run worker:queues`).
  Kein neues Modul in `lib/server` ohne Prozesseinstieg — der
  Erreichbarkeitsvertrag faellt sonst um, und das ist Absicht.
- DLQ-Routen: `.../queues/[queue]/dead-letters/`
- Compute-Ports: `lib/server/compute/`
- SDK: `sdk/typescript/src/index.ts`
- CLI: `cli/src/core.ts`, `cli/src/security.ts`, `cli/src/main.ts`
- DX-Gates: `scripts/verify-developer-experience.ts`, `scripts/verify-package-tarballs.mjs`
- Releasevertrag: `.env.example`, `docs/RELEASE_1.10.md`, `STATUS.md`

`ProjectQueueService` besitzt Validierung und Policy. Der vollständige Scope kommt
aus Session beziehungsweise serverseitig aufgelöstem Project Key. Nur
Administratoren verwalten Queues; `service_role` claimt und settlet. MCP exponiert
weiterhin ausschließlich Liste, Status und Enqueue, keine Worker-Leases.

`MemoryProjectQueueRepository` bleibt deterministischer `ephemeral` Test-/Dev-Port.
Bei `QKERN_RUNTIME_MODE=postgres` verdrahtet die Runtime automatisch
`PostgresProjectQueueRepository` über den bestehenden RLS-geprüften Runtime-Pool.
Migration 0026 persistiert Definitionen und Nachrichten mit zusammengesetzten
Tenant-FKs, RLS, enger Spalten-Autorität, verifier-only Dedupe und Leases,
monotoner Claim-Generation, Trigger-gesicherten Übergängen und Retention.

Claims verwenden `FOR UPDATE SKIP LOCKED`. Jeder Claim schreibt Worker,
SHA-256-Lease-Verifier, Ablauf und Generation atomar. Ack, Fail und Renewal müssen
Scope, Queue, Nachricht, Worker, Verifier und aktive Ablaufzeit exakt treffen.
Restart-Persistenz und Multi-Worker-Verteilung sind als vier optionale PostgreSQL-
Integrationstests codiert, konnten hier ohne Docker/PostgreSQL jedoch nicht real
ausgeführt werden.

`ProjectQueueWorker` führt genau einen injizierten Handler pro Claim aus, erneuert
die Lease, erzwingt Timeout/Abort und settlet mit dem ursprünglichen Token.
`ProjectQueueWorkerRuntime` serialisiert Polls und reagiert auf Shutdown. Seine
Ereignisse/Zähler sind redigiert und enthalten keine Payloads, Tokens oder Worker-
IDs. Der Admin-only DLQ-Pfad listet Referenzen ohne Payload und erzeugt über
Migration 0027 genau ein same-tenant Replay pro Dead Letter. Das Replay ist
auditiert und führt im Request keine Arbeit aus.

Alpha 4 ergänzt interne Ports, keine öffentliche Serverless-API. Function-
Definitionen verlangen `nodejs24`, digest-gepinnte Images, bounded Ressourcen,
exakte öffentliche HTTPS-Egress-Origins und Secret-Referenzen. `FunctionInvoker`
begrenzt JSON und Header und erzwingt Timeout/Abort außerhalb der Sandbox.
`WebhookDeliverer` verlangt HTTPS/443 ohne Query/Redirect, Signer-Port, bounded
Payload und Exact-Ack. `CronDispatcher` akzeptiert einen kleinen UTC-Ausdruck und
enqueuet mit deterministischem Occurrence-Dedupe-Key. Details und offene Adapter:
`docs/COMPUTE_CONTRACTS.md`.

Stufe 1.7 Alpha 1 ergänzt `@qkern/sdk`: generischer Database-Typ für Table CRUD,
Schema-, Queue-, Auth- und Storage-Clients, exakte Origin, Header-Credentials,
Timeout/Response-Limit, Redirect-Deny und bounded Fehler. Das SDK wiederholt keine
Writes automatisch und persistiert keine Tokens.

Alpha 2 ergänzt `@qkern/cli`. `init` ist secretfrei und überschreibt nichts;
`schema pull` generiert sortierte Database-Typen ohne sensitive Spalten;
`migration plan` validiert ein Statement und gibt nur Risk/Hash aus; `seed check`
erlaubt bounded INSERTs. Konfiguration und Pfade sind strikt, Project Keys kommen
nur aus `QKERN_PROJECT_KEY`. Kein CLI-Befehl führt SQL aus.

Alpha 3 baut SDK reproduzierbar als ESM/DTS und CLI als eigenständig startbares
Node.js-ESM. Paketmanifeste begrenzen Tarball-Inhalte; `verify:dx:full` kombiniert
Build, Fresh-Project-Smoke und `npm pack --dry-run`. Die Schema-Route verwendet
jetzt dieselbe scope-gebundene Project-Key-Grenze wie Generated Data API, sodass
SDK/CLI Schema Pull ohne Browser-Session funktioniert. Die portable CLI-SQL-Policy
ist durch einen Paritätstest an die Serverpolicy gebunden. Die GitHub-Matrix deckt
Linux, Windows und macOS als ausführbaren Vertrag ab; lokal tatsächlich bestätigt
ist ausschließlich Linux x64/Node 24.

Stufe 1.8 Alpha 1 ergänzt `UsageService` mit sechs festen Metriken, erlaubten
Quelle/Metrik-Paaren, UTC-Monatsfenstern und decimal-string Projektionen. Interne
`meter` erfassen idempotente Events; rohe Schlüssel werden ausschließlich als
SHA-256-Verifier gespeichert. `observe` zählt über Limits weiter, `enforce` lehnt
atomar ab. Auch ein abgelehntes Event bleibt append-only, sodass Retries nach
einem Prozess-/Repository-Neustart dieselbe Entscheidung erhalten.

`MemoryUsageRepository` ist nur Test/Development und in Production verboten.
`PostgresUsageRepository` nutzt die vorhandene tenantgebundene Runtime-
Transaktion. Migration 0028 ergänzt Policy, Counter und Events mit RLS,
zusammengesetzten Projekt-FKs, engen Grants und Triggern für Append-only,
Counter-Monotonie und lückenlose Policy-Revisionen. Vier optionale PostgreSQL-
Tests prüfen Concurrent-Limit, Restart-Replay, Projektion und RLS, wurden hier
ohne Docker/PostgreSQL aber nicht ausgeführt.

Der einzige öffentliche Pfad ist `GET .../usage` über den Session-Kontext. Die
Console-Fläche `Usage & Quotas` zeigt dieselbe no-store Projektion. Event-Ingestion
und `setQuota` bleiben interne Ports; MCP und Browser erhalten keine Mutation.
Automatische Emitter aus Data/Auth/Storage/Realtime/Queues/Compute sind noch nicht
verdrahtet. Es existieren keine Preise, Tarife, Rechnungen oder Payments.

## Ehrlich offene Arbeit

- Datenbank-Webhooks (2.50): Die Bruecke `DatabaseWebhookBridge` ist gebaut,
  einzeln geprueft und im PostgreSQL-Fall über den ganzen Weg belegt, aber
  **kein Dauerprozess ruft sie**. Der Compute-Worker kennt die Scopes und die
  Control Plane, hat aber keine Verbindung zur Projektdatenbank; die braucht
  es fuer `qkern_internal.change_feed`. Der Weg dorthin steht im
  Realtime-Worker vor (`ControlPlaneRealtimeProjectConnection` plus
  `createLocalProjectDatabaseCatalogFromEnv`) und gehoert als naechstes in
  `lib/server/compute/runtime-composition.ts`. Bis dahin entsteht im Betrieb
  keine Zustellung aus einer Tabellenaenderung — dasselbe Muster, das dieser
  Sprint schon beim Realtime-Poller und beim Event-Log gefunden hat;
- konkreter startbarer Handler-Host/Consumer-Vertrag und Sandbox;
- externer Queue-Metrics-Exporter, Tracing, Alerting und Capacity-Grenzen;
- archivierte Real-PostgreSQL-Multi-Instance-, Crash-, Cleanup-, Soak- und Lastläufe;
- Functions-Sandbox, Cron, Webhook Delivery, Vault-Secret-Injektion;
- Egress-/Ressourcenlimits und unabhängige Security-Zertifizierung.
- persistente Compute-Definitionen, Cron-Leases/Catch-up, Webhook-Outbox,
  DNS/IP-Pinning und konkrete Production-Sandbox;
- reale archivierte Windows-/macOS-DX-Läufe, Upgrade-E2E, Registry-Publishing,
  Paket-Signatur/Provenance und Browser-/Bundler-Matrix;
- transaktionale, idempotente Usage-Emitter in allen Produktmodulen und ein
  Reconciliation-/Retention-/Export-Vertrag;
- archivierte Usage-Multi-Instance-/Crash-/Soak-/Last-Races, Metrics und Alerts;
- Tarife, Preisversionen, Credits, Rechnungen, Steuern, Payments und Provider-
  Abgleich; Alpha 1 ist ausdrücklich kein Billing;

Auch die offenen Live-Gates aus 1.3 bis 1.5 bleiben bestehen. Docker, Podman,
`postgres` und `psql` waren in dieser Arbeitsumgebung nicht verfügbar.

## Nächster bounded Slice

`1.21.0`: Flaechen fuer Definitionen. Cron und Webhooks laufen seit 1.20 in
einem startbaren Prozess, aber eine Definition entsteht weiterhin nur ueber
direkten Datenbankzugriff. Es fehlen REST-Endpunkte und eine Console-Flaeche
fuer beide Definitionsarten sowie ein Vault-gestuetzter Provider fuer
Signaturschluessel -- der einzige heutige Provider liest sie aus der Umgebung
und ist in Produktion abgewiesen.

Ebenfalls offen und kleiner: die automatische Entdeckung der zu bedienenden
Scopes (heute `QKERN_COMPUTE_SCOPES_JSON`; eine Suche ueber alle Organisationen
braucht eine Rolle, die RLS nicht einschraenkt), ein Scheduler fuer die beiden
Realtime-`prune`-Pfade und ein gemeinsamer Katalog, damit Generated Data API und
Realtime-Changes nicht je einen eigenen Pool zu denselben Projektdatenbanken
oeffnen.

Danach schliesst nur noch die **Functions-Sandbox** die Stufe 1.6. Sie ist der
groesste verbleibende Brocken, weil sie echte Prozessisolation, Ressourcenlimits
und Egress-Kontrolle verlangt -- und genau diese drei nennt das
Austrittskriterium ausdruecklich. Offene Adapter stehen in
`docs/COMPUTE_CONTRACTS.md`.

## Zwei Muster, die mehrfach aufgetreten sind

**Gebaut, zertifiziert -- und trotzdem wirkungslos, weil niemand es aufruft.**
Release 1.14 fand den Poller, den kein Prozess rief. 1.15 fand, dass die
Realtime-Runtime weiterhin den Memory-Log verwendete, obwohl der dauerhafte
Adapter seit 1.11 zertifiziert war. Beim Anfassen eines Moduls lohnt die Frage:
Ruft der Betrieb das ueberhaupt auf?

**Der Gegenprobe trauen, nicht dem gruenen Haken.** Release 1.20 hat zwei neue
Garantien zertifiziert, die im ersten Lauf sofort gruen waren. Statt das zu
glauben, wurden beide im Adapter einzeln abgeschaltet und der Stack erneut
ausgefuehrt: Genau die zwei zugehoerigen Faelle fielen um, kein anderer. Wer
eine neue Garantie zertifiziert, sollte einmal zeigen, dass ihr Test auch rot
werden kann -- der Lauf dauert Minuten und beantwortet die Frage endgueltig.

**Ausgefuehrt und zufaellig gruen.** Release 1.16 fand drei Wettlaeufe im
gemeinsamen Testaufbau, die seit 1.13 latent waren: Rolle, Schema und Feed
werden von parallel laufenden Integrationstests angelegt, und jedes
`IF NOT EXISTS` davor ist ein Check-dann-Erzeuge ohne Atomaritaet. Die Laeufe zu
1.13 bis 1.15 waren gruen, ohne dass der Aufbau deterministisch war. Ein gruener
Lauf beweist nicht, dass der Aufbau deterministisch ist.

## Sichere Arbeitsregeln

- Keine Organisation, Actor-, User-, Projekt- oder Environment-Identität aus
  Request-Behauptungen übernehmen.
- Keine Keys, Dedupe-Schlüssel, Lease-Tokens, Worker-IDs oder Payloads loggen.
- Worker-Lease-Operationen nicht in MCP oder einen Admin-Bypass übernehmen.
- Retry, Attempt-Limit und Dead-Letter-Status bleiben Serverautorität.
- `ephemeral` niemals als `durable` deklarieren.
- Usage-Idempotency Keys niemals roh speichern oder loggen; Hard-Quota,
  Counter und Evententscheidung müssen atomar bleiben.
- Keine öffentliche Event-Ingestion oder Browser-/MCP-Quota-Mutation ergänzen.
- `usage_events` bleibt append-only. Der Export aus `1.41.0` ersetzt keine
  Aufbewahrung: Ein gelöschtes Ereignis heisst, dass derselbe Schlüssel später
  erneut zählt. Cursor niemals über einen Typ führen, der den Wert der
  Datenbank abschneidet.
- Usage-Zähler nicht als Rechnung darstellen, solange Tarife/Reconciliation fehlen.
- Service Role ist kein PostgreSQL-/RLS-Privilegien-Bypass.
- Der S3-Endpunkt `/s3` (2.96) ruft ausschliesslich `ProjectStorageService`;
  kein eigener Weg zum Provider, keine Admin-Rolle fuer ein Schluesselpaar. Das
  Geheimnis eines Paars liegt nur als AES-GCM-Chiffrat in `secret_ciphertext`,
  der Schluessel dazu nur in `QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY`.
  Keine Route und kein Log gibt Geheimnis oder Chiffrat heraus.
- Historische `docs/RELEASE_*.md` niemals nachträglich ändern.
- Niemals dauerhaft `GRANT qkern_ledger_owner TO …` in einem Test: Die Rolle
  ist clusterweit, und der Migrationszaun verlangt sie ohne jede
  Mitgliedschaft. Ein Grant macht jede Migration im ganzen Lauf unmöglich.
- Worker-Einstiege heissen `.mts`. Ohne `"type": "module"` uebersetzt tsx
  jede `.ts` als CommonJS, und Top-Level-await bricht den Start ab, bevor eine
  eigene Zeile laeuft. Bis `1.44.0` konnte deshalb kein einziger der sieben
  Prozesse starten.

## Pflichtprüfung und Checkpoint

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run verify:dx:full
npm audit --omit=dev --audit-level=moderate
npm run test:postgres:docker
npm run test:storage:docker
```

Ohne Docker die letzten beiden Läufe ausdrücklich als nicht ausgeführt markieren.
Danach ein neues `QKERN_Source_v*.zip` ohne `node_modules`, `.next`, `.git`,
Coverage, Build-Cache und lokale `.env*` erzeugen und versioniert speichern.
