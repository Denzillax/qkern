# Quickstart

> For developers who know Supabase. Goal: QKERN running locally in [Docker](GLOSSAR.md#docker), one [project](GLOSSAR.md#project), one [table](GLOSSAR.md#table), and one row read over [REST](GLOSSAR.md#rest) and with the [SDK](GLOSSAR.md#sdk). The commands take about seven minutes, fifteen with reading and clicking. "Honestly open" at the end says how long the last measured run took.

## What you need

- [Node.js](GLOSSAR.md#node-js) {{node}} or newer, with [npm](GLOSSAR.md#npm)
- Docker Desktop, running
- Git, to fetch the source code
- PowerShell or a Bash shell; the examples here are PowerShell

First fetch the source code. All further commands run in this folder, where `package.json` lives:

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Start the services

```powershell
node --version
docker compose up -d
```

Expected: `v{{node}}` or higher. Docker reports `postgres`, `redis`, `minio` and `clamav` as started, plus four short check containers that exit right away. On the first start PostgreSQL creates the [Control Plane](GLOSSAR.md#control-plane) database and the project database `project_database`. That takes half a minute.

> The project database is only created on a fresh volume. If you have started QKERN before, `docker compose down -v` deletes all local data and you start clean.

## 2. Configuration

```powershell
Copy-Item .env.example .env.local
```

Open `.env.local` and change six things:

- `QKERN_RUNTIME_MODE=postgres` is already set; leave it.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` and `QKERN_STATEMENT_ENCRYPTION_KEY`: enter a separate random value for each. Generate them with the command below, run it three times.
- In the block "Lokaler Schnellstart" (local quickstart), uncomment the two commented-out JSON lines (remove the `# ` at the start).
- Further down, set the four switches to `true`: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The file `.env.local` stays with you. It is listed in `.gitignore` and never goes into a repository.

## 3. Start QKERN

```powershell
npm ci
npm run dev
```

Expected: a line with `Ready` and `http://localhost:3000`. Open the page in the browser: that is the QKERN home page.

## 4. Register

Click "Create a project" or open `http://localhost:3000/register`. Enter an email address and a password with at least twelve characters. The address doesn't have to be real; locally QKERN sends no mail.

After registering you land in the [Console](GLOSSAR.md#console). QKERN has created an [organization](GLOSSAR.md#organization) for you and a project called "First Project". Open "Settings" at the bottom left, then "General": you'll find the Project ID and the Organization ID there. You need both in a moment, so copy them somewhere.

## 5. Bind the environment to the database

In production a [provisioner](GLOSSAR.md#provisioner) binds every [environment](GLOSSAR.md#environment) to its database. Locally there is none, so a script does exactly this one step. Run it in a second terminal in the source folder:

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Expected: `Gebunden: development von <projekt-id> an managed:database-1`. The script signs in as the provisioner login and changes one row only, and only while the environment is still waiting. A second call ends with "Keine wartende Umgebung gefunden" (no waiting environment found), which is correct.

The script needs the Organization ID because [Row Level Security](GLOSSAR.md#row-level-security) would otherwise show the provisioner no rows, just as in production.

## 6. Create a table

Open an SQL session in the project database:

```powershell
docker compose exec postgres psql -U qkern -d project_database
```

And create the table:

```sql
SET ROLE qkern_ledger_owner;
CREATE TABLE public.notes (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_read_all ON public.notes FOR SELECT USING (true);
CREATE POLICY notes_write_anon ON public.notes FOR INSERT WITH CHECK (true);
INSERT INTO public.notes (title) VALUES ('Erste Notiz');
```

You need `SET ROLE` because the owner of all tables, the [ledger owner](GLOSSAR.md#ledger-owner), cannot sign in itself, just as in production. After that the Data API works with the caller's permissions, and without Row Level Security it won't expose a table at all. Type `\q` to leave psql.

## 7. Get a project key

In the Console, open "API" and under "Project API keys" click "Public key". The browser asks for a name; `demo` is enough. The key appears exactly once with the note "Copy now, shown only once". QKERN stores only a checksum of it. Copy it into an environment variable in the second terminal:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

A [Public Key](GLOSSAR.md#public-key) can do only what Row Level Security allows an anonymous caller. Our two rules above allow reading and inserting.

## 8. Read over REST

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Expected: a response with `data`, containing `rows` with exactly one row, where `title` is `Erste Notiz`. The same address with `select=id,title` returns only those two columns, and `filter=done:eq:false` filters. The rules for this are in the [Data API](GLOSSAR.md#data-api).

## 9. Read with the SDK

In an empty folder outside the source folder:

```powershell
mkdir qkern-demo; cd qkern-demo; npm init -y; npm install @qkern/sdk@alpha
```

Create the file `demo.mjs`:

```js
import { createQkernClient } from "@qkern/sdk";
const qkern = createQkernClient({ baseUrl: "http://localhost:3000", projectId: "<projekt-id>", environment: "development", projectKey: process.env.QKERN_PUBLIC_KEY });
const result = await qkern.from("notes").select({ limit: 10 });
console.log(result.rows);
```

And run it:

```powershell
node demo.mjs
```

Expected: an array with one object, `title: 'Erste Notiz'`. The SDK sends the key as the header `x-qkern-key`, so it never ends up in a URL.

## 10. Look in the Table Editor

Back in the Console: open "Table Editor" and pick `public.notes`. The row is there, and "Insert row" adds a second one. The Table Editor talks to the same Data API as your script, with the same rules.

You now have QKERN running locally, a project with a bound database, a table with Row Level Security, a key, and the row read three ways.

## Supabase and QKERN

| At Supabase | At QKERN |
| --- | --- |
| Studio | Console |
| Anon Key | Public Key; Row Level Security applies |
| Service Role Key | Service Key; Row Level Security applies here too |
| PostgREST | Data API |
| GoTrue | Project Auth |
| Storage | Project Storage, private, with virus scanning |
| Realtime | Realtime |
| Edge Functions | Functions in containers |
| supabase-js | @qkern/sdk |
| Supabase CLI | @qkern/cli |
| Migrations | Change Sets with the Approval Center |
| Dashboard SQL | SQL Editor, read-only; anything that writes becomes a Change Set |

The biggest difference in daily use: at QKERN even the Service Key does not bypass Row Level Security. If someone should see everything, they get a rule that says so.

## Honestly open

- Last measured run: September 26, 2026, fresh folder, 31 minutes in one go. About 24 of those minutes went to two text errors that were found and fixed along the way, and to a detour through a second account. The commands themselves ran in about seven minutes. Log and manifest are under `docs/evidence/2026-09-26/`.
- The binding in step 5 is done by a script instead of a provisioner. It runs only that one UPDATE and creates no job.
- The table is created with SQL, not through a wizard. The path through Change Set and Approval Center needs the migration worker with its connection catalog, and that is not set up in the local quickstart.
- The Service Key does not bypass Row Level Security, even though the name suggests it.
