# First backend

> For developers setting up a [backend](GLOSSAR.md#backend) for the first time. You follow the same path as the [Quickstart](SCHNELLSTART.md), but here each step first says why it is needed and afterwards what just happened. Plan on half an hour if you read everything.

## What a backend is

An app has two halves. The [frontend](GLOSSAR.md#frontend) is what the user sees: the page in the browser, the app on the phone. The backend is everything behind it: the [database](GLOSSAR.md#database) where the data lives, the login, the files, the rules about who may do what.

Frontend and backend talk through an [API](GLOSSAR.md#api), a fixed language of requests and responses. At QKERN that is [REST](GLOSSAR.md#rest) over HTTP. The frontend asks "give me the rows of the table notes", and the backend answers with [JSON](GLOSSAR.md#json).

QKERN is such a backend, already built. Your work is to start it, tell it which tables exist and who may see them, and then talk to it from the frontend.

## What you need

- [Node.js](GLOSSAR.md#node-js) {{node}} or newer, with [npm](GLOSSAR.md#npm). Node runs JavaScript outside the browser. QKERN itself is written in TypeScript and runs on Node.
- Docker Desktop. [Docker](GLOSSAR.md#docker) starts programs in sealed boxes, the [containers](GLOSSAR.md#container), without you having to install them. That way you get PostgreSQL, Redis, the object store and the virus scanner with one command.
- Git, to fetch the source code.
- PowerShell or a Bash shell; the examples here are PowerShell.

First fetch the source code. All further commands run in this folder, where `package.json` lives. `git clone` downloads the repository, meaning the source code with its history, to your machine:

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Start the services

Why: QKERN consists of the program itself and four services it needs. The services come from Docker, and you start the program in step 3.

```powershell
node --version
docker compose up -d
```

What happened: `node --version` shows `v{{node}}` or higher; if not, update Node. [Compose](GLOSSAR.md#compose) reads the file `docker-compose.yml` and starts `postgres`, `redis`, `minio` and `clamav` in the background, plus four short check containers that exit right away. On the first start PostgreSQL creates two databases. One belongs to the [Control Plane](GLOSSAR.md#control-plane), where QKERN keeps its own data. The other is `project_database`, where your app's data will live. That takes half a minute.

> The project database is only created on a fresh volume. A [volume](GLOSSAR.md#volume) is a container's storage that survives restarts. If you have started QKERN before, `docker compose down -v` deletes all local data and you start clean.

## 2. Configuration

Why: QKERN reads its settings from [environment variables](GLOSSAR.md#environment-variable). The file `.env.example` lists all of them with explanations. Your own copy is called `.env.local` and holds values that concern only you.

```powershell
Copy-Item .env.example .env.local
```

Open `.env.local` and change six things:

- `QKERN_RUNTIME_MODE=postgres` is already set; leave it. It tells QKERN to use the real database instead of a store that is empty after a restart.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` and `QKERN_STATEMENT_ENCRYPTION_KEY`: enter a separate random value for each. A pepper is a secret QKERN mixes into every [password hash](GLOSSAR.md#password-hash). Without it a stolen database would be easier to crack. The third value encrypts stored SQL statements in the Control Plane. Generate them with the command below, run it three times.
- In the block "Lokaler Schnellstart" (local quickstart), uncomment the two commented-out JSON lines (remove the `# ` at the start). They tell QKERN where `project_database` lives and which logins it uses to reach it.
- Further down, set the four switches to `true`: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`. They are off on purpose, so nobody exposes a database by accident.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

What happened: you told QKERN where its databases are and what it uses to protect passwords. The file `.env.local` stays with you. It is listed in `.gitignore` and never goes into a repository.

## 3. Start QKERN

Why: `npm ci` fetches the libraries QKERN needs, in exactly the versions from the lock file. `npm run dev` starts the program in development mode, where changes to the code show up right away.

```powershell
npm ci
npm run dev
```

What happened: a line with `Ready` and `http://localhost:3000`. `localhost` is your own machine, and `3000` is the [port](GLOSSAR.md#port) QKERN listens on. Open the page in the browser: that is the QKERN home page. The terminal stays open as long as QKERN runs. The next commands go into a second terminal in the same folder.

## 4. Register

Why: the [Console](GLOSSAR.md#console) is the interface you use to operate QKERN. It needs an account so it is clear later who changed what.

Click "Create a project" or open `http://localhost:3000/register`. Enter an email address and a password with at least twelve characters. The address doesn't have to be real; locally QKERN sends no mail.

What happened: QKERN created your account, plus an [organization](GLOSSAR.md#organization) (your workspace) and a [project](GLOSSAR.md#project) called "First Project". A project is one app: it has its own data, its own users, its own keys. Every project has three [environments](GLOSSAR.md#environment), development, staging and production, so you can try things out without touching real data.

Open "Settings" at the bottom left, then "General": you'll find the Project ID and the Organization ID there. You need both in a moment, so copy them somewhere.

## 5. Bind the environment to the database

Why: a fresh project doesn't know yet where its database is. In production a [provisioner](GLOSSAR.md#provisioner) creates a database server and records the connection. Locally there is none, so a script makes exactly this one entry.

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

What happened: `Gebunden: development von <projekt-id> an managed:database-1`. `managed:database-1` is the name your `.env.local` uses for the project database. The script signs in with the provisioner's login and changes one row only, and only while the environment is still waiting. A second call ends with "Keine wartende Umgebung gefunden" (no waiting environment found), which is correct: a bound environment cannot be redirected.

The script needs the Organization ID because [Row Level Security](GLOSSAR.md#row-level-security) would otherwise show the provisioner no rows. It is the same protection that later keeps your users apart, and it applies to QKERN itself too.

## 6. Create a table

Why: data lives in [tables](GLOSSAR.md#table), with [columns](GLOSSAR.md#column) for the fields and [rows](GLOSSAR.md#row) for the entries. We build a table for notes. To do that you talk to PostgreSQL directly in its own language, [SQL](GLOSSAR.md#sql).

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

What happened, line by line:

- `SET ROLE qkern_ledger_owner`: from now on you work as the owner of all tables, the [ledger owner](GLOSSAR.md#ledger-owner). It cannot sign in itself, just as in production, which is why you go through `SET ROLE`.
- `CREATE TABLE`: the table `notes` with a number as [primary key](GLOSSAR.md#primary-key), a title and a checkbox.
- `ENABLE ROW LEVEL SECURITY`: from now on the database decides per row who may see it. Without this line QKERN won't expose the table through the API at all.
- The two `CREATE POLICY` lines: the [rules](GLOSSAR.md#policy). Everyone may read, everyone may insert. For a real app you would write "only the owner of the row" here.
- `INSERT`: the first row.

Type `\q` to leave psql.

## 7. Get a project key

Why: whoever talks to the database through the API has to identify themselves. An [API key](GLOSSAR.md#api-key) is a long secret that QKERN assigns to a project.

In the Console, open "API" and under "Project API keys" click "Public key". The browser asks for a name; `demo` is enough. The key appears exactly once with the note "Copy now, shown only once". QKERN stores only a checksum of it. Copy it into an environment variable in the second terminal:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

What happened: you now have a [Public Key](GLOSSAR.md#public-key). "Public" means it may sit in a frontend where anyone can see it, because it can do only what Row Level Security allows an anonymous caller. Our two rules above allow reading and inserting. A [Service Key](GLOSSAR.md#service-key) is meant for servers. At QKERN it doesn't bypass the rules either.

## 8. Read over REST

Why: this is the path your frontend will take later. An HTTP request to an address, the key in the header, JSON back.

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

What happened: a response with `data`, containing `rows` with exactly one row, where `title` is `Erste Notiz`. Read the address from left to right: project, environment, table, rows. The same address with `select=id,title` returns only those two columns, and `filter=done:eq:false` filters. QKERN builds this [Data API](GLOSSAR.md#data-api) from what is in the database, so you write no code for it.

## 9. Read with the SDK

Why: in a real app you don't want to assemble addresses by hand. The [SDK](GLOSSAR.md#sdk) is a library that does it for you and gives you types for your tables.

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

What happened: an array with one object, `title: 'Erste Notiz'`. The SDK sent the same request you sent in step 8, only with the key as the header `x-qkern-key`. It never ends up in a URL, where it could show up in logs.

## 10. Look in the Table Editor

Why: the Console shows the same data through the same API, with the same rules. There is no back door.

Back in the Console: open "Table Editor" and pick `public.notes`. The row is there, and "Insert row" adds a second one.

You now have QKERN running locally, a project with a bound database, a table with Row Level Security, a key, and the row read three ways.

## Where to go next

- Users for your app: [Auth](GLOSSAR.md#auth) in the handbook, section 6. A signed-in user gets a [JWT](GLOSSAR.md#jwt), and your rules can say "only the owner of the row".
- Files: [Storage](GLOSSAR.md#storage) in the handbook, section 7. Buckets are private, and uploads are scanned for viruses.
- Live updates: [Realtime](GLOSSAR.md#realtime) in the handbook, section 8.
- Background tasks: [queues](GLOSSAR.md#queue), cron and webhooks in the handbook, sections 9 to 9b.

The handbook is in the repository at `docs/HANDBUCH.md`.

## Honestly open

- Last measured run of the same path: September 26, 2026, 31 minutes in one go, about seven of them pure commands. Details are under `docs/evidence/2026-09-26/`.
- The binding in step 5 is done by a script instead of a provisioner. It runs only that one UPDATE and creates no job.
- The table is created with SQL, not through a wizard. The path through Change Set and Approval Center needs the migration worker with its connection catalog, and that is not set up in the local quickstart.
- The two rules in step 6 allow everyone everything. For a real app they are too generous; the handbook shows rules per user.
