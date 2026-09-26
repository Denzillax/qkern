# For founders

> For people who are having a product built and want to know what role QKERN plays in it. No command line, no code. Where a technical term is needed, it links to the [glossary](GLOSSAR.md).

## What QKERN means for your product

Every app has a visible part and an invisible one. The visible part is the interface your customers use. The invisible part is the [backend](GLOSSAR.md#backend): that is where the data lives, where accounts are created, files are stored and permissions are checked. Developers usually build this invisible part anew for every product, and it typically takes half the time.

QKERN is this invisible part, ready to use. [Database](GLOSSAR.md#database), login, files, live updates, background tasks, with an interface called the [Console](GLOSSAR.md#console) where you can see what is going on. Your developer builds the interface of your product and connects it to QKERN, instead of pouring the foundation themselves.

The comparison developers know: QKERN does what Supabase does. The difference is in how it is tested, more on that below.

## What you can have built with it

Three examples, all with the same building blocks:

- **A booking app.** Customers create an account (login), see open slots (database), book (database plus rules about who may see which booking), get a confirmation (background task), and a calendar in the office shows new bookings right away (live updates).
- **A members area.** Paying members sign in, upload documents (files with virus scanning) and see only their own; an admin sees all of them. The rule "only your own" lives in the database itself, not somewhere in the code where someone could forget it.
- **An internal admin tool.** Staff maintain customers and orders in tables that the Console shows directly. To start with, the built-in table editor is enough. Your own interface comes once it is clear what is needed.

What QKERN is not: a builder you use to click an app together yourself without a developer. It is the developer's tool.

## What it costs

The software costs nothing. QKERN is [open source](GLOSSAR.md#open-source) under the [Apache 2.0 license](GLOSSAR.md#apache-2-0): free to use, including commercially, with no license fee and no duty to publish your own code.

Two things cost money:

- **Operation.** QKERN has to run somewhere. On a rented server or in a cloud; the cost depends on size and provider and starts at a few dozen francs a month. Today there is no offer where you rent QKERN as a hosted service. That is on the plan, but it isn't there yet.
- **Developer time.** The interface of your product and the connection to QKERN. This time is smaller than without QKERN, but it isn't zero.

## Where the data lives

Wherever QKERN runs. QKERN sends no data to us or to third parties, and there is no central service that anything flows through. If QKERN runs on a server in Zurich, the data is in Zurich.

QKERN is developed in Switzerland. Today there is no audited proof of data location or hosting, because there is no hosting offer. If you need a statement on data protection or location, you get it from whoever operates the server, not from QKERN.

## What "certified" means here

The home page and these docs show numbers like "{{postgresCases}} cases passed". This means:

- Every building block is tested against real services, not against mocks. A real [PostgreSQL](GLOSSAR.md#postgresql), a real file store, a real mail server. Today there are {{stackCount}} such test stacks.
- The tests run automatically on every change, and the logs with date and result are kept in the repository, the place where the source code is managed.
- The numbers on the home page are read from these logs. If it says {{postgresCases}}, there is a file that says {{postgresCases}}. A test prevents anyone from typing a number in by hand.
- This includes a counter-test: someone deliberately plants a bug and checks that the tests catch it. A test that stays green with a planted bug is worthless.

What it does not mean: no certification by an authority or an inspection body, no seal of quality, no liability. "Certified" is a word here for "proven against real services, and anyone can look at the proof".

## What is missing today

QKERN calls itself a product MVP: the foundation stands, and many views in the Console are still placeholders that say honestly what they cannot do yet. There is no hosting offer, no billing and no team management in the Console. If you build with QKERN today, you build with a tool that is still moving.

## Questions for your developer

Seven questions you can use to talk about the backend without building one yourself:

1. Is [Row Level Security](GLOSSAR.md#row-level-security) turned on for every table, and what does the rule say for a customer who is not signed in?
2. Which keys are inside the app that customers download, and what can they do?
3. Who may approve a database change for production, and where can I see afterwards who it was?
4. Where do [backups](GLOSSAR.md#backup) run, how far back can we restore, and when was that last tried?
5. Which services does QKERN need in operation, and what happens if one of them fails?
6. How do we get the data out again if we switch tools?
7. Of what we need, what is still a placeholder in QKERN today?


## Honestly open

- This page describes QKERN {{version}}, a product MVP. A lot is still moving.
- There is no hosting offer and no proof of data location. Both are on the plan.
- Operating costs are rough orders of magnitude, not a quote.
- "Certified" is a word for documented tests, not an audit by a third party.
