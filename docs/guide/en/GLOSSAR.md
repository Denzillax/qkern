# Glossary

About ninety terms, in alphabetical order, each in three lines: what it is, where it shows up in QKERN, and what Supabase calls it. Technical words in the explanations have their own entry.

## AI Bridge

- **What it is:** A way for an AI agent such as Claude Code or Codex to prepare changes to your project without running them itself.
- **In QKERN:** The AI Bridge view in the Console. The agent reads the schema and creates previews; approval follows the project's rule.
- **At Supabase:** No direct counterpart; the closest is the Supabase MCP server.

## Anon Key

- **What it is:** The Supabase name for the key that may sit in a frontend and sees only what the rules allow an anonymous caller.
- **In QKERN:** At QKERN it is called Public Key; see there.
- **At Supabase:** Anon Key.

## Apache 2.0

- **What it is:** An open source license: you may use, change and pass on the code, including commercially, without having to publish your own code.
- **In QKERN:** The license of QKERN, the SDK and the CLI; the file LICENSE in the repository.
- **At Supabase:** Supabase is under Apache 2.0 and partly under other licenses.

## API

- **What it is:** A fixed language of requests and responses that two programs use to talk to each other, such as your frontend and the backend.
- **In QKERN:** Everything QKERN offers to the outside is an API; the API view shows the Data API and the keys.
- **At Supabase:** API.

## API key

- **What it is:** A long secret that a program sends with every request, so the backend knows which project the request belongs to.
- **In QKERN:** Public Key and Service Key, created in the API view. The secret appears once; QKERN stores only a checksum.
- **At Supabase:** Anon Key and Service Role Key.

## Approval Center

- **What it is:** The place where changes wait until a person or a rule approves them.
- **In QKERN:** The Approval center view. Rules: manual, safeguarded, autonomous; production also needs a signature from outside.
- **At Supabase:** No counterpart.

## Audit log

- **What it is:** A record of who changed what and when, which cannot be changed afterwards without anyone noticing.
- **In QKERN:** The Logs view, Audit. The entries are hashed into a chain; a restore drill recomputes the chain.
- **At Supabase:** Audit Logs under Authentication, with a narrower scope.

## Auth

- **What it is:** Everything around signing in: accounts, passwords, sign-in through other providers, multi-factor, sessions.
- **In QKERN:** Project Auth for the users of your app, in the Auth view. Separate from the login of the Console itself.
- **At Supabase:** Auth, technically GoTrue.

## Backend

- **What it is:** The invisible part of an app: database, login, files, rules. The frontend shows, the backend knows.
- **In QKERN:** QKERN is a backend you don't have to build yourself.
- **At Supabase:** Supabase is one too.

## Backup

- **What it is:** A copy of the data you can restore from after an error or an outage.
- **In QKERN:** A drill proves backup and restore to a point in time against real PostgreSQL; the Console still shows a placeholder under Backups.
- **At Supabase:** Backups under Database, with point-in-time recovery on the paid plan.

## Bucket

- **What it is:** A container for files in the object store, with its own rules about who may put things in and take them out.
- **In QKERN:** The Storage view, Buckets. Buckets are private, and uploads are scanned for viruses.
- **At Supabase:** Bucket.

## Certificate

- **What it is:** A server's pass for TLS, issued by an authority you trust.
- **In QKERN:** The backup drill creates its own and checks against it with verify-full.
- **At Supabase:** The same.

## Certification

- **What it is:** At QKERN: a test against real services whose log is kept in the repository. Not a test by a third party.
- **In QKERN:** The numbers on the home page come from these logs; a test forbids numbers typed in by hand.
- **At Supabase:** No counterpart.

## Certification stack

- **What it is:** A throwaway setup of containers where a test against real services runs, and which disappears afterwards.
- **In QKERN:** docker-compose.*-certification.yml; npm run test:postgres:docker and related scripts.
- **At Supabase:** No counterpart.

## Change Set

- **What it is:** A proposed change to the structure of the database that is reviewed and approved before it runs.
- **In QKERN:** Created from writing SQL in the SQL Editor or through the AI Bridge; it waits in the Approval Center.
- **At Supabase:** Migrations, though without built-in approval.

## CLI

- **What it is:** A program for the command line that gets tasks done without an interface.
- **In QKERN:** The package @qkern/cli: set up a project, pull the schema, check migrations.
- **At Supabase:** Supabase CLI.

## Column

- **What it is:** A field of a table, such as title or done, with a fixed type.
- **In QKERN:** The Table Editor shows columns; the Data API hides sensitive columns such as passwords.
- **At Supabase:** Column.

## Compose

- **What it is:** A Docker tool that starts several containers together from one file.
- **In QKERN:** docker-compose.yml starts PostgreSQL, Redis, the object store and the virus scanner; the certification stacks are separate Compose files.
- **At Supabase:** The local Supabase setup uses Compose as well.

## Console

- **What it is:** The QKERN web interface where you see and operate projects, data, users and rules.
- **In QKERN:** At /console after signing in. Many views are real, and some say honestly that they are placeholders.
- **At Supabase:** Studio.

## Container

- **What it is:** A program in a sealed box with everything it needs, started by Docker.
- **In QKERN:** The services in the dev Compose and the Functions run in containers.
- **At Supabase:** The same.

## Control Plane

- **What it is:** The part of QKERN that manages organizations, projects, Console users and approvals.
- **In QKERN:** Its own PostgreSQL database qkern_control; the Console talks to it.
- **At Supabase:** The Supabase dashboard and its management API.

## Cron

- **What it is:** Tasks on a schedule, such as every night at three.
- **In QKERN:** The Integrations view, Cron. Every run lands as a message in a queue, so two schedulers produce exactly one message.
- **At Supabase:** pg_cron.

## Data API

- **What it is:** The interface your frontend uses to read and write rows, with the caller's permissions.
- **In QKERN:** Built automatically from your tables; the address is tables, the table name and rows, under project and environment. It exposes only tables with Row Level Security.
- **At Supabase:** PostgREST.

## Data Plane

- **What it is:** A project's database per environment, where your app's data lives.
- **In QKERN:** Separate from the Control Plane; locally the database project_database.
- **At Supabase:** The project database.

## Database

- **What it is:** A program that stores data in tables, finds it again quickly and enforces rules.
- **In QKERN:** PostgreSQL 17, one per project and environment.
- **At Supabase:** PostgreSQL.

## Docker

- **What it is:** A tool that starts programs in containers without installing them.
- **In QKERN:** The dev Compose and all certification stacks run in Docker.
- **At Supabase:** The same.

## Edge Functions

- **What it is:** The Supabase name for your own code that runs in the backend on request.
- **In QKERN:** At QKERN they are called Functions; they run in containers with egress control.
- **At Supabase:** Edge Functions.

## Endpoint

- **What it is:** A single address of an API, such as the rows of a table.
- **In QKERN:** All endpoints are listed in the OpenAPI at /api/openapi.json and in the API view.
- **At Supabase:** Endpoint.

## Environment

- **What it is:** A separate copy of a project: development for building, staging for testing, production for customers.
- **In QKERN:** The picker at the top right of the Console; each one has its own database, and production has stricter rules.
- **At Supabase:** Branches, roughly.

## Environment variable

- **What it is:** A setting a program reads from its environment at startup, such as an address or a secret.
- **In QKERN:** All QKERN settings; the template is .env.example, your copy is .env.local.
- **At Supabase:** The same.

## Evidence

- **What it is:** Proof that cannot be forged afterwards: signed, dated, verifiable.
- **In QKERN:** The logs and manifests under docs/evidence and the signed backup evidence that the verifier reads.
- **At Supabase:** No counterpart.

## Extension

- **What it is:** An add-on module for PostgreSQL, for example for encryption or schedules.
- **In QKERN:** The Database view, Extensions shows which ones are active in the project database.
- **At Supabase:** Extensions.

## Foreign key

- **What it is:** A column that points to a row in another table, such as the customer number in an order.
- **In QKERN:** Normal PostgreSQL foreign keys; the schema visualizer that draws them is still a placeholder.
- **At Supabase:** Foreign Key.

## Frontend

- **What it is:** The visible part of an app: the page in the browser, the app on the phone.
- **In QKERN:** QKERN delivers no frontend; it delivers what a frontend talks to.
- **At Supabase:** The same.

## Function (database)

- **What it is:** A piece of logic that runs inside the database and can be called with SQL or through the API.
- **In QKERN:** The Database view, Functions; called through the Data API under rpc and the function name.
- **At Supabase:** Database Functions, called through rpc.

## GoTrue

- **What it is:** The service that handles sign-in at Supabase.
- **In QKERN:** At QKERN it is called Project Auth; see Auth.
- **At Supabase:** GoTrue.

## HTTP method

- **What it is:** The verb of a request: GET reads, POST creates, PATCH changes, DELETE deletes.
- **In QKERN:** The Data API uses exactly these four for rows.
- **At Supabase:** The same.

## Image

- **What it is:** The template Docker starts a container from, such as postgres:17-alpine.
- **In QKERN:** The manifests under docs/evidence name the images of every run.
- **At Supabase:** The same.

## Index

- **What it is:** A lookup structure in the database that makes searching large tables fast.
- **In QKERN:** The Database view, Indexes.
- **At Supabase:** Indexes.

## Job

- **What it is:** A single task in a queue that a worker picks up.
- **In QKERN:** Messages in Project Queues; the Integrations view, Queues.
- **At Supabase:** Message in pgmq.

## JSON

- **What it is:** A text format for data that programs read easily: curly braces, names, values.
- **In QKERN:** Every API response is JSON; so is the configuration in the block Lokaler Schnellstart (local quickstart).
- **At Supabase:** The same.

## JWT

- **What it is:** A signed pass that a signed-in user sends with every request; the backend checks the signature instead of asking the database.
- **In QKERN:** Project Auth issues JWTs; the Settings view, JWT keys shows the keys for them.
- **At Supabase:** JWT.

## Ledger owner

- **What it is:** The database role that owns all tables of a project. It cannot sign in; you switch to it with SET ROLE.
- **In QKERN:** qkern_ledger_owner in the project database; the migration bookkeeping requires that it has no login.
- **At Supabase:** No direct counterpart; Supabase works with the role postgres.

## MCP

- **What it is:** A protocol AI agents use to call tools, for example to read the schema.
- **In QKERN:** QKERN offers an MCP server for agents; handbook section 10.
- **At Supabase:** Supabase MCP.

## Memory Mode

- **What it is:** An operating mode in which QKERN keeps everything in memory; after a restart everything is gone.
- **In QKERN:** QKERN_RUNTIME_MODE=memory, only for trying out the interface. The quickstart uses postgres.
- **At Supabase:** No counterpart.

## Migration

- **What it is:** A change to the structure of the database, written down as SQL with a number, so it runs everywhere in the same order.
- **In QKERN:** The Control Plane has numbered migrations under db/migrations; project changes run as Change Sets.
- **At Supabase:** Migrations.

## Module

- **What it is:** A separate part of QKERN with its own task and its own boundary, such as Storage or Queues.
- **In QKERN:** The boundaries are described in docs/MODULES.md.
- **At Supabase:** No counterpart.

## Mutation test

- **What it is:** You plant a bug on purpose and check that the tests find it. If they stay green, they are worthless.
- **In QKERN:** Every release has one; the result is in docs/evidence as Mutation.
- **At Supabase:** No counterpart.

## Node.js

- **What it is:** The runtime that runs JavaScript outside the browser.
- **In QKERN:** QKERN needs Node.js 24.7 or newer.
- **At Supabase:** The same, for supabase-js.

## npm

- **What it is:** The package manager of Node.js: it fetches libraries and runs scripts.
- **In QKERN:** npm ci installs, npm run dev starts, npm install @qkern/sdk fetches the SDK.
- **At Supabase:** The same.

## OAuth

- **What it is:** A method where a user signs in through another provider, for example with their Google account.
- **In QKERN:** A sign-in method in Project Auth, certified against real OIDC providers.
- **At Supabase:** Social Login.

## Object

- **What it is:** A file in the object store, together with its name and metadata.
- **In QKERN:** Whatever sits in a bucket.
- **At Supabase:** Object.

## Open Source

- **What it is:** The source code is public and may be used and changed under a license.
- **In QKERN:** QKERN is open source under Apache 2.0.
- **At Supabase:** The same.

## Organization

- **What it is:** The workspace that everything belongs to: projects, Console users, invoices.
- **In QKERN:** Created at registration; the ID is under Settings, General.
- **At Supabase:** Organization.

## Password hash

- **What it is:** A password is turned into a checksum that cannot be reversed, and only the checksum is stored.
- **In QKERN:** Argon2id with a pepper from the configuration, separate for the Console and Project Auth.
- **At Supabase:** bcrypt in GoTrue.

## Point-in-time Recovery

- **What it is:** Restoring to a specific point in time, not only to the last backup.
- **In QKERN:** Proven against real PostgreSQL with a WAL archive; still a placeholder in the Console.
- **At Supabase:** PITR on the paid plan.

## Policy

- **What it is:** A rule in the database that says who may see or change which rows.
- **In QKERN:** The Database view, Policies. Without policies, Row Level Security exposes nothing.
- **At Supabase:** Policies.

## Port

- **What it is:** A number under which a program can be reached on a machine.
- **In QKERN:** QKERN listens on 3000, PostgreSQL on 5432.
- **At Supabase:** The same.

## PostgreSQL

- **What it is:** A free and very widely used database, maintained for thirty years.
- **In QKERN:** Version 17, for the Control Plane and for every project database.
- **At Supabase:** The same.

## PostgREST

- **What it is:** The service that turns tables into a REST API at Supabase.
- **In QKERN:** At QKERN it is called Data API and is part of the program itself.
- **At Supabase:** PostgREST.

## Primary key

- **What it is:** The column that makes every row unique, usually a number or a UUID.
- **In QKERN:** Required for every table the Data API exposes.
- **At Supabase:** Primary Key.

## Production Apply

- **What it is:** Running an approved change in the production environment.
- **In QKERN:** Besides the approval it needs a signature from an external signer; the runbook is in docs.
- **At Supabase:** No counterpart.

## Project

- **What it is:** One app with its own data, users, files and keys.
- **In QKERN:** Registration creates First Project; the ID is under Settings, General.
- **At Supabase:** Project.

## Project key

- **What it is:** The umbrella term for a project's Public Key and Service Key.
- **In QKERN:** The API view.
- **At Supabase:** API Keys.

## Provider

- **What it is:** A service users sign in through, such as Google or a company login.
- **In QKERN:** The Auth view, Sign-in methods; certified against Dex and Mailpit.
- **At Supabase:** Auth Providers.

## Provisioner

- **What it is:** The service that creates a database for a new project and records the connection.
- **In QKERN:** A separate worker that talks to an HTTPS broker; locally npm run dev:bind-project-database replaces it.
- **At Supabase:** At Supabase it works out of sight in the background.

## Public Key

- **What it is:** The key that may sit in a frontend. It can do only what the rules allow an anonymous caller.
- **In QKERN:** The API view, Public key for the browser. It sets the claim anon; Row Level Security applies.
- **At Supabase:** Anon Key.

## Publication

- **What it is:** A list of tables whose changes PostgreSQL reports to the outside, for example for live updates.
- **In QKERN:** The Database view, Publications; the basis for Realtime.
- **At Supabase:** Publications.

## Q-Orbit

- **What it is:** The animation on the home page: building blocks circling the core.
- **In QKERN:** Design only, no function.
- **At Supabase:** No counterpart.

## Queue

- **What it is:** A waiting line for tasks that don't have to be done right away; a worker picks them up one after another.
- **In QKERN:** Project Queues in PostgreSQL, in the Integrations view, Queues; with dedupe, leases and dead letters.
- **At Supabase:** pgmq.

## Rate Limit

- **What it is:** An upper limit on how often something may happen per time period, such as sign-in attempts per minute.
- **In QKERN:** Built in for registration and sign-in; a per-project setting is still a placeholder.
- **At Supabase:** Rate Limits under Authentication.

## Realtime

- **What it is:** Sending changes to data right away to everyone who is watching, without reloading.
- **In QKERN:** The Realtime view, Inspector; over WebSocket, certified against real PostgreSQL.
- **At Supabase:** Realtime.

## Refresh Token

- **What it is:** A second pass that renews an expired JWT without signing in again.
- **In QKERN:** Part of Project Auth; it is replaced on every renewal.
- **At Supabase:** Refresh Token.

## REST

- **What it is:** A way to build APIs: addresses for things, HTTP methods for actions, JSON for data.
- **In QKERN:** The whole QKERN API is REST, described in the OpenAPI.
- **At Supabase:** The same.

## Role

- **What it is:** A user account in PostgreSQL with specific permissions, such as read only.
- **In QKERN:** QKERN works with many narrowly scoped roles; the Database view, Roles shows those of the project database.
- **At Supabase:** Roles.

## Row

- **What it is:** One entry in a table, such as a note.
- **In QKERN:** The Table Editor shows, inserts, changes and deletes rows, always with Row Level Security.
- **At Supabase:** Row.

## Row Level Security

- **What it is:** A rule directly in the database that decides per row who may see or change it.
- **In QKERN:** Required for every table the Data API exposes; the rules are under Database, Policies. Even the Service Key does not bypass it.
- **At Supabase:** Row Level Security, same name.

## Runtime Mode

- **What it is:** The switch that decides whether QKERN uses real databases or keeps everything in memory.
- **In QKERN:** QKERN_RUNTIME_MODE=postgres or memory in .env.local.
- **At Supabase:** No counterpart.

## Schema

- **What it is:** Two meanings: the structure of a database (which tables, which columns) and a namespace inside it, such as public.
- **In QKERN:** The Data API works in the schema public; the Database view shows the structure.
- **At Supabase:** The same.

## SDK

- **What it is:** A library that makes an API easy to use in the developer's language, with types and functions instead of addresses.
- **In QKERN:** @qkern/sdk for TypeScript and JavaScript; npm install @qkern/sdk@alpha.
- **At Supabase:** supabase-js.

## Service Key

- **What it is:** The key for servers, never for a frontend.
- **In QKERN:** The API view, Service key for the server. It sets the claim service_role; Row Level Security still applies.
- **At Supabase:** Service Role Key, which bypasses the rules at Supabase.

## Service Role Key

- **What it is:** The Supabase key that bypasses Row Level Security.
- **In QKERN:** At QKERN it is called Service Key and does not bypass the rules; if someone should see everything, they get a rule that says so.
- **At Supabase:** Service Role Key.

## Session

- **What it is:** The time between signing in and signing out, during which the backend recognizes a user.
- **In QKERN:** The Console and Project Auth each keep their own sessions.
- **At Supabase:** Session.

## Signed URL

- **What it is:** A link to a file that is valid only for a limited time and carries a signature.
- **In QKERN:** This is how Storage releases private files for a short time.
- **At Supabase:** Signed URL.

## SQL

- **What it is:** The language you use to talk to a database: CREATE TABLE, SELECT, INSERT.
- **In QKERN:** The SQL Editor in the Console (read-only); anything that writes becomes a Change Set.
- **At Supabase:** The same.

## Stage plan

- **What it is:** The plan for the order in which QKERN grows, with entry and exit criteria for each stage.
- **In QKERN:** docs/STUFENPLAN.md.
- **At Supabase:** No counterpart.

## Storage

- **What it is:** A place for files: images, documents, uploads.
- **In QKERN:** Project Storage, in the Storage view; S3-compatible, private, with virus scanning by ClamAV.
- **At Supabase:** Storage.

## Studio

- **What it is:** The Supabase web interface.
- **In QKERN:** At QKERN it is called Console.
- **At Supabase:** Studio.

## supabase-js

- **What it is:** The Supabase JavaScript library.
- **In QKERN:** At QKERN it is called @qkern/sdk.
- **At Supabase:** supabase-js.

## Table

- **What it is:** Data in rows and columns, like a table in a spreadsheet, only with fixed types and rules.
- **In QKERN:** The Table Editor in the Console; created with SQL, exposed with Row Level Security and a primary key.
- **At Supabase:** Table.

## Tenant

- **What it is:** A customer or organization whose data is kept apart from everyone else's, even though they use the same software.
- **In QKERN:** Every organization is a tenant; Row Level Security in the Control Plane keeps them apart, for QKERN itself too.
- **At Supabase:** Every Supabase project is its own instance.

## TLS

- **What it is:** Encryption for connections; the padlock in the browser.
- **In QKERN:** Required in production between QKERN and its databases; the backup drill enforces it locally too.
- **At Supabase:** The same.

## Token

- **What it is:** A pass in text form that a program sends to identify itself; JWT and refresh token are tokens.
- **In QKERN:** Project Auth issues them; API keys are a different kind of pass.
- **At Supabase:** The same.

## Trigger

- **What it is:** A piece of logic the database runs by itself when something happens, for example when a row is inserted.
- **In QKERN:** The Database view, Triggers.
- **At Supabase:** Triggers.

## Volume

- **What it is:** A container's storage that survives restarts.
- **In QKERN:** qkern-postgres holds the databases of the dev Compose; docker compose down -v deletes it.
- **At Supabase:** The same.

## WAL

- **What it is:** The log PostgreSQL writes every change to before it takes effect; any point in time can be restored from it.
- **In QKERN:** The backup drill archives WAL segments and restores from them.
- **At Supabase:** The same, out of sight.

## Webhook

- **What it is:** A message the backend sends to an outside address when something happens.
- **In QKERN:** The Functions & Jobs view; message signing certified against a real Vault.
- **At Supabase:** Database Webhooks.

## WebSocket

- **What it is:** A connection that stays open so the backend can send messages on its own.
- **In QKERN:** Realtime uses WebSocket; the protocol is in docs/REALTIME_PROTOCOL.md.
- **At Supabase:** The same.

## Worker

- **What it is:** A program in the background that works through tasks from a queue.
- **In QKERN:** Seven separate processes: queues, compute, migrations, incidents, realtime, apply, provisioner.
- **At Supabase:** At Supabase it works out of sight in the background.
