# Schnellstart

> Für Entwickler, die Supabase kennen. Ziel: QKERN lokal in [Docker](GLOSSAR.md#docker), ein [Projekt](GLOSSAR.md#projekt), eine [Tabelle](GLOSSAR.md#tabelle), eine Zeile per [REST](GLOSSAR.md#rest) und per [SDK](GLOSSAR.md#sdk) gelesen. Etwa fünfzehn Minuten. Am Ende steht, wie lange es beim letzten Durchlauf wirklich dauerte.

## Was du brauchst

- [Node.js](GLOSSAR.md#node-js) {{node}} oder neuer, mit [npm](GLOSSAR.md#npm)
- Docker Desktop, gestartet
- den QKERN-Quellordner, als Zip oder per `git clone`
- PowerShell oder eine Bash; die Beispiele hier sind PowerShell

Alle Kommandos laufen im Quellordner, dort wo `package.json` liegt.

## 1. Dienste starten

```powershell
node --version
docker compose up -d
```

Erwartet: `v{{node}}` oder höher. Docker meldet `postgres`, `redis`, `minio` und `clamav` als gestartet, dazu vier kurze Prüfcontainer, die gleich wieder enden. Beim ersten Start legt PostgreSQL die Datenbank der [Control Plane](GLOSSAR.md#control-plane) und die Projektdatenbank `project_database` an; das dauert eine halbe Minute.

> Die Projektdatenbank entsteht nur auf einem frischen Volume. Wenn du QKERN schon einmal gestartet hast, löscht `docker compose down -v` alle lokalen Daten und du beginnst sauber.

## 2. Konfiguration

```powershell
Copy-Item .env.example .env.local
```

Öffne `.env.local` und ändere fünf Dinge:

- `QKERN_RUNTIME_MODE=postgres` steht schon so; lass es.
- `QKERN_PASSWORD_PEPPER` und `QKERN_PROJECT_AUTH_PASSWORD_PEPPER`: je einen eigenen Zufallswert eintragen. Erzeugen mit dem Kommando unten, zweimal ausführen.
- Im Block "Lokaler Schnellstart" die zwei auskommentierten JSON-Zeilen freischalten (das `# ` am Anfang entfernen).
- Weiter unten die vier Schalter auf `true` setzen: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Die Datei `.env.local` bleibt bei dir; sie steht in `.gitignore` und geht nie in ein Repository.

## 3. QKERN starten

```powershell
npm ci
npm run dev
```

Erwartet: eine Zeile mit `Ready` und `http://localhost:3000`. Die Seite im Browser öffnen: das ist die Startseite von QKERN.

## 4. Registrieren

Klicke auf "Projekt erstellen" oder öffne `http://localhost:3000/register`. Trage eine E-Mail-Adresse und ein Passwort mit mindestens zwölf Zeichen ein. Die Adresse muss nicht echt sein; lokal verschickt QKERN keine Mails.

Nach der Registrierung landest du in der [Konsole](GLOSSAR.md#konsole). QKERN hat für dich eine [Organisation](GLOSSAR.md#organisation) und ein Projekt namens "First Project" angelegt. Öffne links unten "Einstellungen", dann "Allgemein": dort stehen die Projekt-ID und die Organisations-ID. Beide brauchst du gleich; kopiere sie irgendwohin.

## 5. Umgebung an die Datenbank binden

In Produktion bindet ein [Provisionierer](GLOSSAR.md#provisionierer) jede [Umgebung](GLOSSAR.md#umgebung) an ihre Datenbank. Lokal gibt es keinen; ein Skript macht genau diesen einen Schritt, in einem zweiten Terminal im Quellordner:

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Erwartet: `Gebunden: development von <projekt-id> an managed:database-1`. Das Skript meldet sich als Provisionierer-Login an und ändert nur eine Zeile, und nur, solange die Umgebung noch wartet. Ein zweiter Aufruf endet mit "Keine wartende Umgebung gefunden", das ist richtig so.

Die Organisations-ID braucht es, weil [Row Level Security](GLOSSAR.md#row-level-security) dem Provisionierer sonst keine Zeile zeigt, genau wie in Produktion.

## 6. Eine Tabelle anlegen

Öffne eine SQL-Sitzung in der Projektdatenbank:

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

`SET ROLE` ist nötig, weil der Besitzer aller Tabellen, der [Ledger-Owner](GLOSSAR.md#ledger-owner), sich nicht selbst anmelden kann, wie in Produktion. Die Data API arbeitet danach mit den Rechten des Aufrufers, und ohne Row Level Security gibt sie eine Tabelle gar nicht erst frei. Mit `\q` verlässt du psql.

## 7. Einen Projekt-Key holen

In der Konsole "API" öffnen. Unter "Public Keys" einen Namen eintragen, etwa `demo`, und "Public Key für den Browser" klicken. Der Schlüssel erscheint genau einmal; QKERN speichert nur eine Prüfsumme davon. Kopiere ihn in eine Umgebungsvariable des zweiten Terminals:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Ein [Public Key](GLOSSAR.md#public-key) darf nur, was die Row Level Security einem Anonymen erlaubt. Unsere zwei Regeln oben erlauben Lesen und Einfügen.

## 8. Per REST lesen

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Erwartet: eine Antwort mit `data`, darin `rows` mit genau einer Zeile, `title` ist `Erste Notiz`. Dieselbe Adresse mit `select=id,title` liefert nur die zwei Spalten; `filter=done:eq:false` filtert. Die Regeln dafür stehen in der [Data API](GLOSSAR.md#data-api).

## 9. Per SDK lesen

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

Erwartet: ein Array mit einem Objekt, `title: 'Erste Notiz'`. Das SDK schickt den Key als Kopfzeile `x-qkern-key`; er landet nie in einer URL.

## 10. Im Table Editor ansehen

Zurück in der Konsole: "Table Editor" öffnen und `public.notes` wählen. Die Zeile steht da, mit "Zeile einfügen" kommt eine zweite dazu. Der Table Editor spricht dieselbe Data API wie dein Skript, mit denselben Regeln.

Damit hast du: QKERN lokal, ein Projekt mit gebundener Datenbank, eine Tabelle mit Row Level Security, einen Schlüssel, und die Zeile über drei Wege gelesen.

## Supabase und QKERN

| Bei Supabase | Bei QKERN |
| --- | --- |
| Studio | Konsole |
| Anon Key | Public Key; Row Level Security gilt |
| Service Role Key | Service Key; Row Level Security gilt auch hier |
| PostgREST | Data API |
| GoTrue | Project Auth |
| Storage | Project Storage, privat, mit Virenprüfung |
| Realtime | Realtime |
| Edge Functions | Functions in Containern |
| supabase-js | @qkern/sdk |
| Supabase CLI | @qkern/cli |
| Migrations | Change Sets mit Freigabezentrale |
| Dashboard-SQL | SQL Editor, lesend; Schreibendes wird ein Change Set |

Der grösste Unterschied im Alltag: bei QKERN umgeht auch der Service Key die Row Level Security nicht. Wer alles sehen soll, bekommt eine Regel, die das sagt.

## Ehrlich offen

- Der letzte gemessene Durchlauf dieses Schnellstarts steht mit Zeit und Datum in `docs/evidence/`; solange dort kein Eintrag ist, ist die Viertelstunde eine Schätzung.
- Die Bindung in Schritt 5 macht ein Skript statt ein Provisionierer. Es führt nur das eine UPDATE aus und legt keinen Auftrag an.
- Die Tabelle entsteht per SQL, nicht über einen Assistenten. Der Weg über Change Set und Freigabezentrale braucht den Migrations-Worker mit seinem Verbindungskatalog, und der ist im lokalen Schnellstart nicht eingerichtet.
- Das Repository ist heute privat; deshalb "Zip oder git clone" statt eines Links.
- Der Service Key umgeht Row Level Security nicht, auch wenn der Name das nahelegt.
