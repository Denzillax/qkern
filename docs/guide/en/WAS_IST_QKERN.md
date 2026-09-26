# What is QKERN

QKERN is a [backend](GLOSSAR.md#backend) you don't have to build yourself. An app almost always needs the same things behind the scenes: a [database](GLOSSAR.md#database) for the data, a login for the users, a place for files, live updates for everyone who is watching, and tasks that run in the background. QKERN brings these parts already wired together, and you operate them through a web interface, the [Console](GLOSSAR.md#console).

It runs wherever you put it: on your own machine in [Docker](GLOSSAR.md#docker), later with a hosting provider of your choice. QKERN is [open source](GLOSSAR.md#open-source) under [Apache 2.0](GLOSSAR.md#apache-2-0). The software costs nothing. What costs money is hosting and the work an app needs.

What QKERN is not: a website builder, a finished product for end customers, or a hosting service. QKERN is the foundation a developer builds an app on.

## Why QKERN exists

If you know Supabase, you know the idea: a Postgres with everything around it. QKERN takes the same path with one difference that matters to us. Every building block is tested against real services, not against mocks. A real [PostgreSQL](GLOSSAR.md#postgresql) 17, a real object store, a real mail server, a real identity provider. The test logs live in the repository with date, commit and result, and the numbers on the home page come from exactly these logs.

Today that is {{postgresCases}} cases against PostgreSQL 17 and {{stackCount}} test stacks in total. When a number appears in these docs, it comes from a file, not from memory.

## The building blocks

| Building block | What it does | In the Console |
| --- | --- | --- |
| [Console](GLOSSAR.md#console) | The web interface where you see and configure everything | Everything |
| [Organization](GLOSSAR.md#organization) | Your workspace; everything belongs to an organization | Header |
| [Project](GLOSSAR.md#project) | One app with its own data, users and keys | Project picker, top left |
| [Environment](GLOSSAR.md#environment) | development, staging, production; each with its own database | Environment picker, top right |
| [Database](GLOSSAR.md#database) | PostgreSQL 17 with tables, rules and everything that goes with them | Database, Table Editor, SQL Editor |
| [Data API](GLOSSAR.md#data-api) | Reading and writing over [REST](GLOSSAR.md#rest), with the caller's permissions | API |
| [Auth](GLOSSAR.md#auth) | Login for the users of your app, with password, providers and multi-factor | Auth |
| [Storage](GLOSSAR.md#storage) | Files in [buckets](GLOSSAR.md#bucket), private, with virus scanning | Storage |
| [Realtime](GLOSSAR.md#realtime) | Changes pushed live to everyone watching | Realtime |
| [Queues](GLOSSAR.md#queue) | Tasks that a [worker](GLOSSAR.md#worker) processes later | Integrations, Queues |
| [Cron](GLOSSAR.md#cron) and [webhooks](GLOSSAR.md#webhook) | Scheduled tasks and messages to other services | Functions & Jobs |
| [Approval Center](GLOSSAR.md#approval-center) | Every schema change is reviewed before it runs | Approval center |
| [AI Bridge](GLOSSAR.md#ai-bridge) | An AI agent prepares changes, people approve them | AI Bridge |

## How the parts fit together

The Console talks to the [Control Plane](GLOSSAR.md#control-plane). That is the part of QKERN that manages organizations, projects, users and approvals. Each project has its own database per environment, the [Data Plane](GLOSSAR.md#data-plane). That is where your app's data lives. The Data API reads and writes in this database with the permissions of whoever is asking. A [Public Key](GLOSSAR.md#public-key) sees only what [Row Level Security](GLOSSAR.md#row-level-security) allows an anonymous caller, and a signed-in user sees their own rows.

A change to the structure of the database, such as a new table, does not go straight through. It becomes a [Change Set](GLOSSAR.md#change-set), lands in the Approval Center, and QKERN runs it only after approval. For production it also needs a signature from outside. That is slower than running SQL directly, on purpose, and it is the reason every change stays traceable.

## Three doors

- I know Supabase and want to see something in fifteen minutes: [Quickstart](SCHNELLSTART.md)
- I'm building my first backend and want to understand what I'm doing: [First backend](ERSTES_BACKEND.md)
- I'm not a developer and want to know what this means for my product: [For founders](FUER_GRUENDER.md)

The [glossary](GLOSSAR.md) explains the terms you meet along the way, each in three lines.

## Honestly open

- These docs cover QKERN {{version}}. QKERN is a product MVP, not a finished hosting service.
- There is no provider where you get QKERN with one click. You run it yourself or have someone run it for you.
- Today you create a new table with SQL, not through a wizard in the Console.
- In production a provisioner binds a project to its database. Locally a small script does it, and the quickstart shows how.
- These pages exist in German, English, French and Italian. The German version is the original; where a translation differs, the German text applies.
