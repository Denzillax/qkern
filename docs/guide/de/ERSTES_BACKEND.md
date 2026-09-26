# Erstes Backend

> Für Entwickler, die zum ersten Mal ein [Backend](GLOSSAR.md#backend) aufsetzen. Du gehst denselben Weg wie der [Schnellstart](SCHNELLSTART.md), nur steht hier vor jedem Schritt, warum er nötig ist, und danach, was gerade passiert ist. Rechne mit einer halben Stunde, wenn du alles liest.

## Was ein Backend ist

Eine App hat zwei Hälften. Das [Frontend](GLOSSAR.md#frontend) ist das, was der Nutzer sieht: die Seite im Browser, die App auf dem Telefon. Das Backend ist alles dahinter: die [Datenbank](GLOSSAR.md#datenbank), in der die Daten liegen, das Login, die Dateien, die Regeln, wer was darf.

Frontend und Backend reden über eine [API](GLOSSAR.md#api), eine feste Sprache aus Anfragen und Antworten. Bei QKERN ist das [REST](GLOSSAR.md#rest) über HTTP: das Frontend fragt "gib mir die Zeilen der Tabelle notes", das Backend antwortet mit [JSON](GLOSSAR.md#json).

QKERN ist so ein Backend, fertig gebaut. Deine Arbeit ist: es starten, ihm sagen, welche Tabellen es gibt und wer sie sehen darf, und dann vom Frontend aus damit reden.

## Was du brauchst

- [Node.js](GLOSSAR.md#node-js) {{node}} oder neuer, mit [npm](GLOSSAR.md#npm). Node führt JavaScript ausserhalb des Browsers aus; QKERN selbst ist in TypeScript geschrieben und läuft auf Node.
- Docker Desktop. [Docker](GLOSSAR.md#docker) startet Programme in abgeschlossenen Kisten, den [Containern](GLOSSAR.md#container), ohne dass du sie installieren musst. PostgreSQL, Redis, den Objektspeicher und den Virenscanner bekommst du so mit einem Kommando.
- Den QKERN-Quellordner, als Zip oder per `git clone`.
- PowerShell oder eine Bash; die Beispiele hier sind PowerShell.

Alle Kommandos laufen im Quellordner, dort wo `package.json` liegt.

## 1. Dienste starten

Warum: QKERN besteht aus dem Programm selbst und aus vier Diensten, die es braucht. Die Dienste kommen aus Docker, das Programm startest du in Schritt 3.

```powershell
node --version
docker compose up -d
```

Was passiert ist: `node --version` zeigt `v{{node}}` oder höher; sonst Node aktualisieren. [Compose](GLOSSAR.md#compose) liest die Datei `docker-compose.yml` und startet `postgres`, `redis`, `minio` und `clamav` im Hintergrund, dazu vier kurze Prüfcontainer, die gleich wieder enden. Beim ersten Start legt PostgreSQL zwei Datenbanken an: die der [Control Plane](GLOSSAR.md#control-plane), in der QKERN seine eigenen Daten hält, und `project_database`, in der die Daten deiner App liegen werden. Das dauert eine halbe Minute.

> Die Projektdatenbank entsteht nur auf einem frischen Volume. Ein [Volume](GLOSSAR.md#volume) ist der Speicher eines Containers, der Neustarts überlebt. Wenn du QKERN schon einmal gestartet hast, löscht `docker compose down -v` alle lokalen Daten und du beginnst sauber.

## 2. Konfiguration

Warum: QKERN liest seine Einstellungen aus [Umgebungsvariablen](GLOSSAR.md#umgebungsvariable). Die Datei `.env.example` listet alle mit Erklärung; deine eigene Kopie heisst `.env.local` und enthält Werte, die nur dich etwas angehen.

```powershell
Copy-Item .env.example .env.local
```

Öffne `.env.local` und ändere fünf Dinge:

- `QKERN_RUNTIME_MODE=postgres` steht schon so; lass es. Es sagt QKERN, dass es die echte Datenbank benutzt statt eines Speichers, der beim Neustart leer ist.
- `QKERN_PASSWORD_PEPPER` und `QKERN_PROJECT_AUTH_PASSWORD_PEPPER`: je einen eigenen Zufallswert eintragen. Ein Pepper ist ein Geheimnis, das QKERN in jeden [Passwort-Hash](GLOSSAR.md#passwort-hash) mischt; ohne ihn liesse sich eine gestohlene Datenbank leichter knacken. Erzeugen mit dem Kommando unten, zweimal ausführen.
- Im Block "Lokaler Schnellstart" die zwei auskommentierten JSON-Zeilen freischalten (das `# ` am Anfang entfernen). Sie sagen QKERN, wo `project_database` liegt und mit welchen Logins es sie erreicht.
- Weiter unten die vier Schalter auf `true` setzen: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`. Sie sind absichtlich aus, damit niemand aus Versehen eine Datenbank freigibt.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Was passiert ist: du hast QKERN gesagt, wo seine Datenbanken sind und womit es Passwörter schützt. Die Datei `.env.local` bleibt bei dir; sie steht in `.gitignore` und geht nie in ein Repository.

## 3. QKERN starten

Warum: `npm ci` holt die Bibliotheken, die QKERN braucht, in genau den Versionen aus der Sperrdatei. `npm run dev` startet das Programm im Entwicklungsmodus, in dem Änderungen am Code sofort sichtbar sind.

```powershell
npm ci
npm run dev
```

Was passiert ist: eine Zeile mit `Ready` und `http://localhost:3000`. `localhost` ist dein eigener Rechner, `3000` der [Port](GLOSSAR.md#port), an dem QKERN lauscht. Die Seite im Browser öffnen: das ist die Startseite von QKERN. Das Terminal bleibt offen, solange QKERN läuft; die weiteren Kommandos gehören in ein zweites Terminal im selben Ordner.

## 4. Registrieren

Warum: die [Konsole](GLOSSAR.md#konsole) ist die Oberfläche, mit der du QKERN bedienst. Sie braucht ein Konto, damit später klar ist, wer was geändert hat.

Klicke auf "Projekt erstellen" oder öffne `http://localhost:3000/register`. Trage eine E-Mail-Adresse und ein Passwort mit mindestens zwölf Zeichen ein. Die Adresse muss nicht echt sein; lokal verschickt QKERN keine Mails.

Was passiert ist: QKERN hat dein Konto angelegt, dazu eine [Organisation](GLOSSAR.md#organisation) (dein Arbeitsbereich) und ein [Projekt](GLOSSAR.md#projekt) namens "First Project". Ein Projekt ist eine App: es hat eigene Daten, eigene Nutzer, eigene Schlüssel. Jedes Projekt hat drei [Umgebungen](GLOSSAR.md#umgebung), development, staging und production, damit du ausprobieren kannst, ohne echte Daten anzufassen.

Öffne links unten "Einstellungen", dann "Allgemein": dort stehen die Projekt-ID und die Organisations-ID. Beide brauchst du gleich; kopiere sie irgendwohin.

## 5. Umgebung an die Datenbank binden

Warum: ein frisches Projekt weiss noch nicht, wo seine Datenbank ist. In Produktion legt ein [Provisionierer](GLOSSAR.md#provisionierer) einen Datenbankserver an und trägt die Verbindung ein. Lokal gibt es keinen; ein Skript macht genau diesen einen Eintrag.

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Was passiert ist: `Gebunden: development von <projekt-id> an managed:database-1`. `managed:database-1` ist der Name, unter dem deine `.env.local` die Projektdatenbank kennt. Das Skript meldet sich mit dem Login des Provisionierers an und ändert nur eine Zeile, und nur, solange die Umgebung noch wartet. Ein zweiter Aufruf endet mit "Keine wartende Umgebung gefunden", das ist richtig so: eine gebundene Umgebung lässt sich nicht umbiegen.

Die Organisations-ID braucht es, weil [Row Level Security](GLOSSAR.md#row-level-security) dem Provisionierer sonst keine Zeile zeigt. Das ist derselbe Schutz, der später deine Nutzer voneinander trennt, und er gilt auch für QKERN selbst.

## 6. Eine Tabelle anlegen

Warum: Daten liegen in [Tabellen](GLOSSAR.md#tabelle), mit [Spalten](GLOSSAR.md#spalte) für die Felder und [Zeilen](GLOSSAR.md#zeile) für die Einträge. Wir bauen eine Tabelle für Notizen. Dazu sprichst du direkt mit PostgreSQL in seiner Sprache, [SQL](GLOSSAR.md#sql).

```powershell
docker compose exec postgres psql -U qkern -d project_database
```

Und lege die Tabelle an:

```sql
SET ROLE qkern_ledger_owner;
CREATE TABLE public.notes (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_read_all ON public.notes FOR SELECT USING (true);
CREATE POLICY notes_write_anon ON public.notes FOR INSERT WITH CHECK (true);
INSERT INTO public.notes (title) VALUES ('Erste Notiz');
```

Was passiert ist, Zeile für Zeile:

- `SET ROLE qkern_ledger_owner`: du arbeitest ab jetzt als der Besitzer aller Tabellen, der [Ledger-Owner](GLOSSAR.md#ledger-owner). Er kann sich nicht selbst anmelden, wie in Produktion; deshalb der Umweg über `SET ROLE`.
- `CREATE TABLE`: die Tabelle `notes` mit einer Nummer als [Primärschlüssel](GLOSSAR.md#primaerschluessel), einem Titel und einem Häkchen.
- `ENABLE ROW LEVEL SECURITY`: ab jetzt entscheidet die Datenbank je Zeile, wer sie sehen darf. Ohne diese Zeile gibt QKERN die Tabelle gar nicht über die API frei.
- Die zwei `CREATE POLICY`: die [Regeln](GLOSSAR.md#policy). Alle dürfen lesen, alle dürfen einfügen. Für eine echte App würdest du hier "nur der Besitzer der Zeile" schreiben.
- `INSERT`: die erste Zeile.

Mit `\q` verlässt du psql.

## 7. Einen Projekt-Key holen

Warum: wer über die API mit der Datenbank redet, muss sich ausweisen. Ein [API-Key](GLOSSAR.md#api-key) ist ein langes Geheimnis, das QKERN einem Projekt zuordnet.

In der Konsole "API" öffnen. Unter "Public Keys" einen Namen eintragen, etwa `demo`, und "Public Key für den Browser" klicken. Der Schlüssel erscheint genau einmal; QKERN speichert nur eine Prüfsumme davon. Kopiere ihn in eine Umgebungsvariable des zweiten Terminals:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Was passiert ist: du hast einen [Public Key](GLOSSAR.md#public-key). "Public" heisst: er darf in einem Frontend liegen, wo ihn jeder sehen kann, denn er darf nur, was die Row Level Security einem Anonymen erlaubt. Unsere zwei Regeln oben erlauben Lesen und Einfügen. Ein [Service Key](GLOSSAR.md#service-key) ist für Server gedacht; auch er umgeht die Regeln bei QKERN nicht.

## 8. Per REST lesen

Warum: das ist der Weg, den später dein Frontend geht. Eine HTTP-Anfrage an eine Adresse, den Key in der Kopfzeile, JSON zurück.

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Was passiert ist: eine Antwort mit `data`, darin `rows` mit genau einer Zeile, `title` ist `Erste Notiz`. Lies die Adresse von links nach rechts: Projekt, Umgebung, Tabelle, Zeilen. Dieselbe Adresse mit `select=id,title` liefert nur die zwei Spalten; `filter=done:eq:false` filtert. QKERN baut diese [Data API](GLOSSAR.md#data-api) aus dem, was in der Datenbank steht; du schreibst dafür keinen Code.

## 9. Per SDK lesen

Warum: in einer echten App willst du keine Adressen zusammenbauen. Das [SDK](GLOSSAR.md#sdk) ist eine Bibliothek, die das für dich tut und dir Typen für deine Tabellen gibt.

In einem leeren Ordner ausserhalb des Quellordners:

```powershell
mkdir qkern-demo; cd qkern-demo; npm init -y; npm install @qkern/sdk@alpha
```

Datei `demo.mjs` anlegen:

```js
import { createQkernClient } from "@qkern/sdk";
const qkern = createQkernClient({ baseUrl: "http://localhost:3000", projectId: "<projekt-id>", environment: "development", projectKey: process.env.QKERN_PUBLIC_KEY });
const result = await qkern.from("notes").select({ limit: 10 });
console.log(result.rows);
```

Und ausführen:

```powershell
node demo.mjs
```

Was passiert ist: ein Array mit einem Objekt, `title: 'Erste Notiz'`. Das SDK hat dieselbe Anfrage geschickt wie du in Schritt 8, nur mit dem Key als Kopfzeile `x-qkern-key`; er landet nie in einer URL, wo er in Logs auftauchen könnte.

## 10. Im Table Editor ansehen

Warum: die Konsole zeigt dieselben Daten über dieselbe API, mit denselben Regeln; einen Hintereingang gibt es nicht.

Zurück in der Konsole: "Table Editor" öffnen und `public.notes` wählen. Die Zeile steht da, mit "Zeile einfügen" kommt eine zweite dazu.

Damit hast du: QKERN lokal, ein Projekt mit gebundener Datenbank, eine Tabelle mit Row Level Security, einen Schlüssel, und die Zeile über drei Wege gelesen.

## Wie es weitergeht

- Nutzer für deine App: [Auth](GLOSSAR.md#auth) im Handbuch, Abschnitt 6. Ein angemeldeter Nutzer bekommt ein [JWT](GLOSSAR.md#jwt), und deine Regeln können sagen "nur der Besitzer der Zeile".
- Dateien: [Storage](GLOSSAR.md#storage) im Handbuch, Abschnitt 7. Buckets sind privat, Uploads werden auf Viren geprüft.
- Live-Updates: [Realtime](GLOSSAR.md#realtime) im Handbuch, Abschnitt 8.
- Aufgaben im Hintergrund: [Queues](GLOSSAR.md#queue), Cron und Webhooks im Handbuch, Abschnitte 9 bis 9b.

Das Handbuch liegt im Repository unter `docs/HANDBUCH.md`.

## Ehrlich offen

- Der letzte gemessene Durchlauf dieses Weges steht mit Zeit und Datum in `docs/evidence/`; solange dort kein Eintrag ist, ist die halbe Stunde eine Schätzung.
- Die Bindung in Schritt 5 macht ein Skript statt ein Provisionierer. Es führt nur das eine UPDATE aus und legt keinen Auftrag an.
- Die Tabelle entsteht per SQL, nicht über einen Assistenten. Der Weg über Change Set und Freigabezentrale braucht den Migrations-Worker mit seinem Verbindungskatalog, und der ist im lokalen Schnellstart nicht eingerichtet.
- Die zwei Regeln in Schritt 6 erlauben jedem alles. Für eine echte App sind sie zu grosszügig; das Handbuch zeigt Regeln je Nutzer.
- Das Repository ist heute privat; deshalb "Zip oder git clone" statt eines Links.
