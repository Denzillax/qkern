# Glossar

Rund neunzig Begriffe, alphabetisch, je in drei Zeilen: was es ist, wo es in QKERN vorkommt, und wie es bei Supabase heisst. Fachwörter in den Erklärungen haben ihren eigenen Eintrag.

## AI Bridge

- **Was es ist:** Ein Weg, auf dem ein KI-Agent wie Claude Code oder Codex Änderungen an deinem Projekt vorbereitet, aber nicht selbst ausführt.
- **In QKERN:** Ansicht AI Bridge in der Konsole. Der Agent liest das Schema und erstellt Vorschauen; die Freigabe folgt der Regel des Projekts.
- **Bei Supabase:** Kein direktes Gegenstück; am nächsten kommt der MCP-Server von Supabase.

## Anon Key

- **Was es ist:** Der Supabase-Name für den Schlüssel, der in einem Frontend liegen darf und nur sieht, was Regeln einem Anonymen erlauben.
- **In QKERN:** Heisst bei QKERN Public Key; siehe dort.
- **Bei Supabase:** Anon Key.

## Apache 2.0

- **Was es ist:** Eine Open-Source-Lizenz: frei nutzen, ändern und weitergeben, auch geschäftlich, ohne eigenen Code offenlegen zu müssen.
- **In QKERN:** Die Lizenz von QKERN, dem SDK und der CLI; die Datei LICENSE im Repository.
- **Bei Supabase:** Supabase steht unter Apache 2.0 und teils unter anderen Lizenzen.

## API

- **Was es ist:** Eine feste Sprache aus Anfragen und Antworten, über die zwei Programme miteinander reden, etwa dein Frontend und das Backend.
- **In QKERN:** Alles, was QKERN nach aussen anbietet, ist eine API; die Ansicht API zeigt die Data API und die Schlüssel.
- **Bei Supabase:** API.

## API-Key

- **Was es ist:** Ein langes Geheimnis, das ein Programm bei jeder Anfrage mitschickt, damit das Backend weiss, zu welchem Projekt sie gehört.
- **In QKERN:** Public Key und Service Key, angelegt in der Ansicht API. Das Geheimnis erscheint einmal; QKERN speichert nur eine Prüfsumme.
- **Bei Supabase:** Anon Key und Service Role Key.

## Audit-Log

- **Was es ist:** Ein Protokoll, in dem steht, wer wann was geändert hat, und das sich nachträglich nicht unbemerkt ändern lässt.
- **In QKERN:** Ansicht Logs, Audit. Die Einträge sind zu einer Kette verhasht; ein Restore-Drill rechnet die Kette nach.
- **Bei Supabase:** Audit Logs unter Authentication, mit engerem Umfang.

## Auth

- **Was es ist:** Alles rund um Anmeldung: Konten, Passwörter, Anmeldung über andere Anbieter, Mehrfaktor, Sitzungen.
- **In QKERN:** Project Auth für die Nutzer deiner App, Ansicht Auth. Getrennt vom Login der Konsole selbst.
- **Bei Supabase:** Auth, technisch GoTrue.

## Backend

- **Was es ist:** Der unsichtbare Teil einer App: Datenbank, Login, Dateien, Regeln. Das Frontend zeigt, das Backend weiss.
- **In QKERN:** QKERN ist ein Backend, das man nicht selbst bauen muss.
- **Bei Supabase:** Supabase ist auch eines.

## Backup

- **Was es ist:** Eine Kopie der Daten, aus der man nach einem Fehler oder Ausfall wiederherstellen kann.
- **In QKERN:** Ein Drill beweist Backup und Wiederherstellung bis zu einem Zeitpunkt gegen echtes PostgreSQL. Die Konsole liest unter Backups den Stand der Sicherungen; bestellen und zurückspielen kann sie nichts.
- **Bei Supabase:** Backups unter Database, mit Point-in-time Recovery im bezahlten Plan.

## Bucket

- **Was es ist:** Ein Behälter für Dateien im Objektspeicher, mit eigenen Regeln, wer hinein- und hinausdarf.
- **In QKERN:** Ansicht Storage, Buckets. Buckets sind privat, Uploads werden auf Viren geprüft.
- **Bei Supabase:** Bucket.

## Change Set

- **Was es ist:** Eine vorgeschlagene Änderung am Aufbau der Datenbank, die geprüft und freigegeben wird, bevor sie läuft.
- **In QKERN:** Entsteht aus schreibender SQL im SQL Editor oder über die AI Bridge; wartet in der Freigabezentrale.
- **Bei Supabase:** Migrations, allerdings ohne eingebaute Freigabe.

## CLI

- **Was es ist:** Ein Programm für die Kommandozeile, das Aufgaben ohne Oberfläche erledigt.
- **In QKERN:** Das Paket @qkern/cli: Projekt einrichten, Schema ziehen, Migrationen prüfen.
- **Bei Supabase:** Supabase CLI.

## Compose

- **Was es ist:** Ein Werkzeug von Docker, das mehrere Container nach einer Datei zusammen startet.
- **In QKERN:** docker-compose.yml startet PostgreSQL, Redis, Objektspeicher und Virenscanner; die Zertifizierungsstacks sind eigene Compose-Dateien.
- **Bei Supabase:** Die lokale Supabase-Umgebung nutzt ebenfalls Compose.

## Container

- **Was es ist:** Ein Programm in einer abgeschlossenen Kiste mit allem, was es braucht, gestartet von Docker.
- **In QKERN:** Die Dienste im Dev-Compose und die Functions laufen in Containern.
- **Bei Supabase:** Gleich.

## Control Plane

- **Was es ist:** Der Teil von QKERN, der Organisationen, Projekte, Nutzer der Konsole und Freigaben verwaltet.
- **In QKERN:** Eine eigene PostgreSQL-Datenbank qkern_control; die Konsole spricht mit ihr.
- **Bei Supabase:** Das Supabase-Dashboard und seine Verwaltungs-API.

## Cron

- **Was es ist:** Aufgaben nach Zeitplan, etwa jede Nacht um drei.
- **In QKERN:** Ansicht Integrationen, Cron. Jeder Termin landet als Nachricht in einer Queue, damit zwei Scheduler genau eine Nachricht erzeugen.
- **Bei Supabase:** pg_cron.

## Data API

- **Was es ist:** Die Schnittstelle, über die dein Frontend Zeilen liest und schreibt, mit den Rechten des Aufrufers.
- **In QKERN:** Automatisch aus deinen Tabellen gebaut; Adresse tables, Tabellenname, rows unter Projekt und Umgebung. Gibt nur Tabellen mit Row Level Security frei.
- **Bei Supabase:** PostgREST.

## Data Plane

- **Was es ist:** Die Datenbank eines Projekts je Umgebung, in der die Daten deiner App liegen.
- **In QKERN:** Getrennt von der Control Plane; lokal die Datenbank project_database.
- **Bei Supabase:** Die Projektdatenbank.

## Datenbank

- **Was es ist:** Ein Programm, das Daten in Tabellen ablegt, sie schnell wiederfindet und Regeln durchsetzt.
- **In QKERN:** PostgreSQL 17, eine je Projekt und Umgebung.
- **Bei Supabase:** PostgreSQL.

## Docker

- **Was es ist:** Ein Werkzeug, das Programme in Containern startet, ohne dass man sie installiert.
- **In QKERN:** Der Dev-Compose und alle Zertifizierungsstacks laufen in Docker.
- **Bei Supabase:** Gleich.

## Edge Functions

- **Was es ist:** Der Supabase-Name für eigenen Code, der auf Anfrage im Backend läuft.
- **In QKERN:** Heisst bei QKERN Functions; sie laufen in Containern mit Egress-Kontrolle.
- **Bei Supabase:** Edge Functions.

## Endpunkt

- **Was es ist:** Eine einzelne Adresse einer API, etwa die Zeilen einer Tabelle.
- **In QKERN:** Alle Endpunkte stehen in der OpenAPI unter /api/openapi.json und in der Ansicht API.
- **Bei Supabase:** Endpoint.

## Erweiterung

- **Was es ist:** Ein Zusatzmodul für PostgreSQL, etwa für Verschlüsselung oder Zeitpläne.
- **In QKERN:** Ansicht Datenbank, Erweiterungen zeigt, welche in der Projektdatenbank aktiv sind.
- **Bei Supabase:** Extensions.

## Evidenz

- **Was es ist:** Ein Beleg, der nachträglich nicht zu fälschen ist: signiert, mit Datum, prüfbar.
- **In QKERN:** Die Logs und Manifeste unter docs/evidence und die signierte Backup-Evidenz, die der Verifier liest.
- **Bei Supabase:** Kein Gegenstück.

## Freigabezentrale

- **Was es ist:** Der Ort, an dem Änderungen warten, bis jemand oder eine Regel sie freigibt.
- **In QKERN:** Ansicht Freigabezentrale. Regeln: manuell, abgesichert, autonom; production braucht zusätzlich eine Signatur von aussen.
- **Bei Supabase:** Kein Gegenstück.

## Fremdschlüssel

- **Was es ist:** Eine Spalte, die auf die Zeile einer anderen Tabelle zeigt, etwa die Kundennummer in einer Bestellung.
- **In QKERN:** Normale PostgreSQL-Fremdschlüssel. Der Schema-Visualizer zeichnet sie aus dem Katalog, und die Reiter einer Tabelle zeigen unter Beziehungen dasselbe in Worten.
- **Bei Supabase:** Foreign Key.

## Frontend

- **Was es ist:** Der sichtbare Teil einer App: die Seite im Browser, die App auf dem Telefon.
- **In QKERN:** QKERN liefert kein Frontend; es liefert das, womit ein Frontend redet.
- **Bei Supabase:** Gleich.

## Funktion (Datenbank)

- **Was es ist:** Ein Stück Logik, das in der Datenbank selbst läuft und sich per SQL oder über die API aufrufen lässt.
- **In QKERN:** Ansicht Datenbank, Funktionen; Aufruf über die Data API unter rpc und dem Funktionsnamen.
- **Bei Supabase:** Database Functions, Aufruf über rpc.

## GoTrue

- **Was es ist:** Der Dienst, der bei Supabase die Anmeldung erledigt.
- **In QKERN:** Heisst bei QKERN Project Auth; siehe Auth.
- **Bei Supabase:** GoTrue.

## HTTP-Methode

- **Was es ist:** Das Verb einer Anfrage: GET liest, POST legt an, PATCH ändert, DELETE löscht.
- **In QKERN:** Die Data API nutzt genau diese vier für Zeilen.
- **Bei Supabase:** Gleich.

## Image

- **Was es ist:** Die Vorlage, aus der Docker einen Container startet, etwa postgres:17-alpine.
- **In QKERN:** Die Manifeste unter docs/evidence nennen die Images jedes Laufs.
- **Bei Supabase:** Gleich.

## Index

- **Was es ist:** Ein Nachschlagewerk in der Datenbank, das Suchen in grossen Tabellen schnell macht.
- **In QKERN:** Ansicht Datenbank, Indizes.
- **Bei Supabase:** Indexes.

## Job

- **Was es ist:** Eine einzelne Aufgabe in einer Queue, die ein Worker abholt.
- **In QKERN:** Nachrichten in Project Queues; Ansicht Integrationen, Queues.
- **Bei Supabase:** Message in pgmq.

## JSON

- **Was es ist:** Ein Textformat für Daten, das Programme leicht lesen: geschweifte Klammern, Namen, Werte.
- **In QKERN:** Alle Antworten der API sind JSON; die Konfiguration im Block Lokaler Schnellstart auch.
- **Bei Supabase:** Gleich.

## JWT

- **Was es ist:** Ein signierter Ausweis, den ein angemeldeter Nutzer bei jeder Anfrage mitschickt; das Backend prüft die Unterschrift statt die Datenbank zu fragen.
- **In QKERN:** Project Auth stellt JWTs aus; die Schlüssel dafür zeigt die Ansicht Einstellungen, JWT-Schlüssel.
- **Bei Supabase:** JWT.

## Konsole

- **Was es ist:** Die Web-Oberfläche von QKERN, in der du Projekte, Daten, Nutzer und Regeln siehst und bedienst.
- **In QKERN:** Unter /console nach der Anmeldung, in zwei Anordnungen derselben Ansichten: Easy mit neun Gruppen, Advanced mit allen. Leere Platzhalterseiten gibt es keine mehr; wo QKERN eine Sache nicht hat, sagt die Seite das und zeigt, was sie stattdessen lesen kann.
- **Bei Supabase:** Studio.

## Ledger-Owner

- **Was es ist:** Die Datenbankrolle, der alle Tabellen eines Projekts gehören. Sie kann sich nicht anmelden; man wechselt mit SET ROLE zu ihr.
- **In QKERN:** qkern_ledger_owner in der Projektdatenbank; die Migrations-Buchführung verlangt, dass sie kein Login hat.
- **Bei Supabase:** Kein direktes Gegenstück; Supabase arbeitet mit der Rolle postgres.

## Mandant

- **Was es ist:** Eine Kundin oder Organisation, deren Daten von allen anderen getrennt sind, obwohl sie dieselbe Software nutzen.
- **In QKERN:** Jede Organisation ist ein Mandant; Row Level Security in der Control Plane trennt sie, auch für QKERN selbst.
- **Bei Supabase:** Jedes Supabase-Projekt ist eine eigene Instanz.

## MCP

- **Was es ist:** Ein Protokoll, über das KI-Agenten Werkzeuge aufrufen, etwa das Schema lesen.
- **In QKERN:** QKERN bietet einen MCP-Server für Agenten; Handbuch Abschnitt 10.
- **Bei Supabase:** Supabase MCP.

## Memory Mode

- **Was es ist:** Ein Betriebsmodus, in dem QKERN alles im Arbeitsspeicher hält; beim Neustart ist alles weg.
- **In QKERN:** QKERN_RUNTIME_MODE=memory, nur zum Ausprobieren der Oberfläche. Der Schnellstart nutzt postgres.
- **Bei Supabase:** Kein Gegenstück.

## Migration

- **Was es ist:** Eine Änderung am Aufbau der Datenbank, aufgeschrieben als SQL, mit Nummer, damit sie überall in derselben Reihenfolge läuft.
- **In QKERN:** Die Control Plane hat nummerierte Migrationen unter db/migrations; Projektänderungen laufen als Change Sets.
- **Bei Supabase:** Migrations.

## Modul

- **Was es ist:** Ein abgegrenzter Teil von QKERN mit eigener Aufgabe und eigener Grenze, etwa Storage oder Queues.
- **In QKERN:** Die Grenzen stehen in docs/MODULES.md.
- **Bei Supabase:** Kein Gegenstück.

## Mutationstest

- **Was es ist:** Man baut absichtlich einen Fehler ein und prüft, dass die Tests ihn finden. Bleiben sie grün, taugen sie nichts.
- **In QKERN:** Jeder Release hat einen; das Ergebnis steht in docs/evidence als Mutation.
- **Bei Supabase:** Kein Gegenstück.

## Node.js

- **Was es ist:** Die Laufzeit, die JavaScript ausserhalb des Browsers ausführt.
- **In QKERN:** QKERN braucht Node.js 24.7 oder neuer.
- **Bei Supabase:** Gleich, für supabase-js.

## npm

- **Was es ist:** Der Paketmanager von Node.js: holt Bibliotheken und führt Skripte aus.
- **In QKERN:** npm ci installiert, npm run dev startet, npm install @qkern/sdk holt das SDK.
- **Bei Supabase:** Gleich.

## OAuth

- **Was es ist:** Ein Verfahren, bei dem sich ein Nutzer über einen anderen Anbieter anmeldet, etwa mit seinem Google-Konto.
- **In QKERN:** Anmeldeverfahren in Project Auth, gegen echte OIDC-Anbieter zertifiziert.
- **Bei Supabase:** Social Login.

## Objekt

- **Was es ist:** Eine Datei im Objektspeicher, samt Name und Metadaten.
- **In QKERN:** Was in einem Bucket liegt.
- **Bei Supabase:** Object.

## Open Source

- **Was es ist:** Der Quellcode ist öffentlich und darf unter einer Lizenz genutzt und verändert werden.
- **In QKERN:** QKERN ist Open Source unter Apache 2.0.
- **Bei Supabase:** Gleich.

## Organisation

- **Was es ist:** Der Arbeitsbereich, dem alles gehört: Projekte, Nutzer der Konsole, Rechnungen.
- **In QKERN:** Bei der Registrierung angelegt; die ID steht unter Einstellungen, Allgemein.
- **Bei Supabase:** Organization.

## Passwort-Hash

- **Was es ist:** Aus einem Passwort wird eine Prüfsumme, die man nicht zurückrechnen kann; nur sie wird gespeichert.
- **In QKERN:** Argon2id mit einem Pepper aus der Konfiguration, für Konsole und Project Auth getrennt.
- **Bei Supabase:** bcrypt in GoTrue.

## Point-in-time Recovery

- **Was es ist:** Wiederherstellung auf einen bestimmten Zeitpunkt, nicht nur auf das letzte Backup.
- **In QKERN:** Gegen echtes PostgreSQL mit WAL-Archiv bewiesen. Die Konsole zeigt unter Point-in-time Recovery den Stand und die Belege des Drills; auslösen kann sie keine Wiederherstellung.
- **Bei Supabase:** PITR im bezahlten Plan.

## Policy

- **Was es ist:** Eine Regel in der Datenbank, die sagt, wer welche Zeilen sehen oder ändern darf.
- **In QKERN:** Ansicht Datenbank, Policies. Ohne Policies gibt Row Level Security nichts frei.
- **Bei Supabase:** Policies.

## Port

- **Was es ist:** Eine Nummer, unter der ein Programm auf einem Rechner erreichbar ist.
- **In QKERN:** QKERN lauscht auf 3000, PostgreSQL auf 5432.
- **Bei Supabase:** Gleich.

## PostgreSQL

- **Was es ist:** Eine freie, sehr verbreitete Datenbank, seit dreissig Jahren gepflegt.
- **In QKERN:** Version 17, für die Control Plane und für jede Projektdatenbank.
- **Bei Supabase:** Gleich.

## PostgREST

- **Was es ist:** Der Dienst, der bei Supabase aus Tabellen eine REST-API macht.
- **In QKERN:** Heisst bei QKERN Data API und ist Teil des Programms selbst.
- **Bei Supabase:** PostgREST.

## Primärschlüssel

- **Was es ist:** Die Spalte, die jede Zeile eindeutig macht, meist eine Nummer oder eine UUID.
- **In QKERN:** Pflicht für jede Tabelle, die die Data API freigibt.
- **Bei Supabase:** Primary Key.

## Production Apply

- **Was es ist:** Das Ausführen einer freigegebenen Änderung in der Umgebung production.
- **In QKERN:** Braucht neben der Freigabe eine Signatur eines externen Signers; Runbook in docs.
- **Bei Supabase:** Kein Gegenstück.

## Projekt

- **Was es ist:** Eine App mit eigenen Daten, Nutzern, Dateien und Schlüsseln.
- **In QKERN:** Bei der Registrierung entsteht First Project; die ID steht unter Einstellungen, Allgemein.
- **Bei Supabase:** Project.

## Projekt-Key

- **Was es ist:** Sammelbegriff für Public Key und Service Key eines Projekts.
- **In QKERN:** Ansicht API.
- **Bei Supabase:** API Keys.

## Provider

- **Was es ist:** Ein Anbieter, über den sich Nutzer anmelden, etwa Google oder ein Firmen-Login.
- **In QKERN:** Ansicht Auth, Anmeldeverfahren; gegen Dex und Mailpit zertifiziert.
- **Bei Supabase:** Auth Providers.

## Provisionierer

- **Was es ist:** Der Dienst, der für ein neues Projekt eine Datenbank anlegt und die Verbindung einträgt.
- **In QKERN:** Ein eigener Worker gegen einen HTTPS-Broker; lokal ersetzt ihn npm run dev:bind-project-database.
- **Bei Supabase:** Bei Supabase unsichtbar im Hintergrund.

## Public Key

- **Was es ist:** Der Schlüssel, der in einem Frontend liegen darf. Er darf nur, was die Regeln einem Anonymen erlauben.
- **In QKERN:** Ansicht API, Public Key für den Browser. Setzt den Claim anon; Row Level Security gilt.
- **Bei Supabase:** Anon Key.

## Publikation

- **Was es ist:** Eine Liste von Tabellen, deren Änderungen PostgreSQL nach aussen meldet, etwa für Live-Updates.
- **In QKERN:** Ansicht Datenbank, Publikationen; Grundlage für Realtime.
- **Bei Supabase:** Publications.

## Q-Orbit

- **Was es ist:** Die Animation auf der Startseite: Bausteine, die um den Kern kreisen.
- **In QKERN:** Nur Gestaltung, keine Funktion.
- **Bei Supabase:** Kein Gegenstück.

## Queue

- **Was es ist:** Eine Warteschlange für Aufgaben, die nicht sofort erledigt werden müssen; ein Worker holt sie nacheinander ab.
- **In QKERN:** Project Queues in PostgreSQL, Ansicht Integrationen, Queues; mit Dedupe, Leases und Dead Letters.
- **Bei Supabase:** pgmq.

## Rate Limit

- **Was es ist:** Eine Obergrenze, wie oft etwas pro Zeit passieren darf, etwa Anmeldeversuche pro Minute.
- **In QKERN:** Fest eingebaut bei Registrierung und Anmeldung der Konsole. Für die Nutzer deiner App stellst du sie unter Auth, Rate Limits je Umgebung ein, und die Seite schreibt sie wirklich.
- **Bei Supabase:** Rate Limits unter Authentication.

## Realtime

- **Was es ist:** Änderungen an Daten sofort an alle schicken, die gerade zuschauen, ohne Neuladen.
- **In QKERN:** Ansicht Realtime, Inspector; über WebSocket, gegen echtes PostgreSQL zertifiziert.
- **Bei Supabase:** Realtime.

## Refresh Token

- **Was es ist:** Ein zweiter Ausweis, mit dem sich ein abgelaufenes JWT erneuern lässt, ohne neu einzuloggen.
- **In QKERN:** Teil von Project Auth; wird bei jedem Erneuern ausgetauscht.
- **Bei Supabase:** Refresh Token.

## REST

- **Was es ist:** Eine Art, APIs zu bauen: Adressen für Dinge, HTTP-Methoden für Handlungen, JSON für Daten.
- **In QKERN:** Die ganze QKERN-API ist REST; beschrieben in der OpenAPI.
- **Bei Supabase:** Gleich.

## Rolle

- **Was es ist:** Ein Benutzerkonto in PostgreSQL mit bestimmten Rechten, etwa nur lesen.
- **In QKERN:** QKERN arbeitet mit vielen eng geschnittenen Rollen; Ansicht Datenbank, Rollen zeigt die der Projektdatenbank.
- **Bei Supabase:** Roles.

## Row Level Security

- **Was es ist:** Eine Regel direkt in der Datenbank, die je Zeile entscheidet, wer sie sehen oder ändern darf.
- **In QKERN:** Pflicht für jede Tabelle, die die Data API freigibt; die Regeln stehen unter Datenbank, Policies. Auch der Service Key umgeht sie nicht.
- **Bei Supabase:** Row Level Security, gleicher Name.

## Runtime Mode

- **Was es ist:** Der Schalter, ob QKERN echte Datenbanken nutzt oder alles im Arbeitsspeicher hält.
- **In QKERN:** QKERN_RUNTIME_MODE=postgres oder memory in .env.local.
- **Bei Supabase:** Kein Gegenstück.

## Schema

- **Was es ist:** Zwei Bedeutungen: der Aufbau einer Datenbank (welche Tabellen, welche Spalten) und ein Namensraum darin, etwa public.
- **In QKERN:** Die Data API arbeitet im Schema public; die Ansicht Datenbank zeigt den Aufbau.
- **Bei Supabase:** Gleich.

## SDK

- **Was es ist:** Eine Bibliothek, die eine API in der Sprache des Entwicklers bequem macht, mit Typen und Funktionen statt Adressen.
- **In QKERN:** @qkern/sdk für TypeScript und JavaScript; npm install @qkern/sdk@alpha.
- **Bei Supabase:** supabase-js.

## Service Key

- **Was es ist:** Der Schlüssel für Server, nie für ein Frontend.
- **In QKERN:** Ansicht API, Service Key für den Server. Setzt den Claim service_role; Row Level Security gilt trotzdem.
- **Bei Supabase:** Service Role Key, der bei Supabase die Regeln umgeht.

## Service Role Key

- **Was es ist:** Der Supabase-Schlüssel, der Row Level Security umgeht.
- **In QKERN:** Heisst bei QKERN Service Key und umgeht die Regeln nicht; wer alles sehen soll, bekommt eine Regel, die das sagt.
- **Bei Supabase:** Service Role Key.

## Session

- **Was es ist:** Die Zeit zwischen Anmeldung und Abmeldung, in der das Backend einen Nutzer wiedererkennt.
- **In QKERN:** Konsole und Project Auth führen je eigene Sitzungen.
- **Bei Supabase:** Session.

## Signierte URL

- **Was es ist:** Ein Link zu einer Datei, der nur eine begrenzte Zeit gilt und eine Unterschrift trägt.
- **In QKERN:** So gibt Storage private Dateien für kurze Zeit frei.
- **Bei Supabase:** Signed URL.

## Spalte

- **Was es ist:** Ein Feld einer Tabelle, etwa title oder done, mit einem festen Typ.
- **In QKERN:** Der Table Editor zeigt Spalten; sensible Spalten wie Passwörter blendet die Data API aus.
- **Bei Supabase:** Column.

## SQL

- **Was es ist:** Die Sprache, in der man mit einer Datenbank redet: CREATE TABLE, SELECT, INSERT.
- **In QKERN:** SQL Editor in der Konsole (lesend); Schreibendes wird ein Change Set.
- **Bei Supabase:** Gleich.

## Storage

- **Was es ist:** Ablage für Dateien: Bilder, Dokumente, Uploads.
- **In QKERN:** Project Storage, Ansicht Storage; S3-kompatibel, privat, mit Virenprüfung durch ClamAV.
- **Bei Supabase:** Storage.

## Studio

- **Was es ist:** Die Web-Oberfläche von Supabase.
- **In QKERN:** Heisst bei QKERN Konsole.
- **Bei Supabase:** Studio.

## Stufenplan

- **Was es ist:** Der Plan, in welcher Reihenfolge QKERN wächst, mit Ein- und Austrittskriterien je Stufe.
- **In QKERN:** docs/STUFENPLAN.md.
- **Bei Supabase:** Kein Gegenstück.

## supabase-js

- **Was es ist:** Die JavaScript-Bibliothek von Supabase.
- **In QKERN:** Heisst bei QKERN @qkern/sdk.
- **Bei Supabase:** supabase-js.

## Tabelle

- **Was es ist:** Daten in Zeilen und Spalten, wie eine Tabelle in einem Tabellenblatt, nur mit festen Typen und Regeln.
- **In QKERN:** Table Editor in der Konsole; angelegt per SQL, freigegeben mit Row Level Security und Primärschlüssel.
- **Bei Supabase:** Table.

## TLS

- **Was es ist:** Verschlüsselung für Verbindungen; das Schloss im Browser.
- **In QKERN:** Zwischen QKERN und seinen Datenbanken Pflicht in Produktion; der Backup-Drill erzwingt es auch lokal.
- **Bei Supabase:** Gleich.

## Token

- **Was es ist:** Ein Ausweis in Textform, den ein Programm mitschickt, um sich auszuweisen; JWT und Refresh Token sind Tokens.
- **In QKERN:** Project Auth stellt sie aus; API-Keys sind eine andere Art Ausweis.
- **Bei Supabase:** Gleich.

## Trigger

- **Was es ist:** Ein Stück Logik, das die Datenbank selbst ausführt, wenn etwas passiert, etwa beim Einfügen einer Zeile.
- **In QKERN:** Ansicht Datenbank, Trigger.
- **Bei Supabase:** Triggers.

## Umgebung

- **Was es ist:** Eine getrennte Ausgabe eines Projekts: development zum Bauen, staging zum Prüfen, production für Kunden.
- **In QKERN:** Wahl oben rechts in der Konsole; jede hat eine eigene Datenbank, und production hat strengere Regeln.
- **Bei Supabase:** Branches, in etwa.

## Umgebungsvariable

- **Was es ist:** Eine Einstellung, die ein Programm beim Start aus seiner Umgebung liest, etwa eine Adresse oder ein Geheimnis.
- **In QKERN:** Alle Einstellungen von QKERN; Vorlage .env.example, deine Kopie .env.local.
- **Bei Supabase:** Gleich.

## Volume

- **Was es ist:** Der Speicher eines Containers, der Neustarts überlebt.
- **In QKERN:** qkern-postgres hält die Datenbanken des Dev-Compose; docker compose down -v löscht ihn.
- **Bei Supabase:** Gleich.

## WAL

- **Was es ist:** Das Protokoll, in das PostgreSQL jede Änderung schreibt, bevor sie gilt; daraus lässt sich jeder Zeitpunkt wiederherstellen.
- **In QKERN:** Der Backup-Drill archiviert WAL-Segmente und stellt daraus wieder her.
- **Bei Supabase:** Gleich, unsichtbar.

## Webhook

- **Was es ist:** Eine Nachricht, die das Backend an eine fremde Adresse schickt, wenn etwas passiert.
- **In QKERN:** Ansicht Functions & Jobs; Signatur der Nachrichten gegen echten Vault zertifiziert.
- **Bei Supabase:** Database Webhooks.

## WebSocket

- **Was es ist:** Eine Verbindung, die offen bleibt, damit das Backend von sich aus Nachrichten schicken kann.
- **In QKERN:** Realtime nutzt WebSocket; Protokoll in docs/REALTIME_PROTOCOL.md.
- **Bei Supabase:** Gleich.

## Worker

- **Was es ist:** Ein Programm im Hintergrund, das Aufgaben aus einer Queue abarbeitet.
- **In QKERN:** Sieben eigene Prozesse: Queues, Compute, Migrationen, Incidents, Realtime, Apply, Provisionierer.
- **Bei Supabase:** Bei Supabase unsichtbar im Hintergrund.

## Zeile

- **Was es ist:** Ein Eintrag in einer Tabelle, etwa eine Notiz.
- **In QKERN:** Der Table Editor zeigt, einfügt, ändert und löscht Zeilen, immer mit Row Level Security.
- **Bei Supabase:** Row.

## Zertifikat

- **Was es ist:** Der Ausweis eines Servers für TLS, ausgestellt von einer Stelle, der man vertraut.
- **In QKERN:** Der Backup-Drill erzeugt sein eigenes und prüft mit verify-full dagegen.
- **Bei Supabase:** Gleich.

## Zertifizierung

- **Was es ist:** Bei QKERN: eine Prüfung gegen echte Dienste, deren Protokoll im Repository liegt. Keine Prüfung durch Dritte.
- **In QKERN:** Die Zahlen auf der Startseite kommen aus diesen Protokollen; ein Test verbietet Zahlen von Hand.
- **Bei Supabase:** Kein Gegenstück.

## Zertifizierungsstack

- **Was es ist:** Ein Wegwerf-Aufbau aus Containern, in dem eine Prüfung gegen echte Dienste läuft und der danach verschwindet.
- **In QKERN:** docker-compose.*-certification.yml; npm run test:postgres:docker und Verwandte.
- **Bei Supabase:** Kein Gegenstück.
