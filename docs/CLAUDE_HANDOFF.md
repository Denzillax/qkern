# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `2.21.0`. Sie wird
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

- Paketversion: `2.21.0`
- Aktueller Slice: 2.21 Drei, die es schon gab – die drei Platzhalter mit
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
- Vorheriger Slice: 2.20 Der Rest des Katalogs – Erweiterungen, Rollen,
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
- Letzte Control-Plane-Migration: `db/migrations/0045_project_function_invocations.sql`
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
