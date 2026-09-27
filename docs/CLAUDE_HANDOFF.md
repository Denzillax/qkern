# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `2.54.0`. Sie wird
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

- Neu in diesem Zweig: 2.53 Die Webhook-Bruecke laeuft als Prozess – das
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
- Paketversion: `2.54.0`
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
  speiste sich die Quelle aus ihrer eigenen Wirkung. **Ehrlich offen**: Der
  Sammler fuehrt seinen Stand im Prozess (wie die Webhook-Bruecke vor `0050`)
  und hat noch keinen dauerhaften Aufrufer; das Cron-Log ist keine Quelle, weil
  es rekonstruiert und nicht gespeichert wird. PostgreSQL-Fall "(2.63) forwards
  only the fields the console already shows". Im Browser nicht gesehen
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
