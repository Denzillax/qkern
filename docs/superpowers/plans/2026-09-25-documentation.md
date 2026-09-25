# Dokumentation für drei Zielgruppen: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf deutsche Einstiegsseiten (Was ist QKERN, Schnellstart, Erstes Backend, Für Gründer, Glossar) als Markdown unter `docs/guide/de/`, auf der Website unter `/docs` gerendert, aus Konsole und Landing-Page verlinkt, durch drei Vertragstests und einen gemessenen Schnellstart-Durchlauf abgesichert.

**Architecture:** Markdown ist die einzige Quelle. Ein kleiner eigener Parser (`lib/docs/markdown.ts`) versteht genau die Elemente, die die Doku braucht, und wirft bei allem anderen mit Zeilennummer. Eine statisch gebaute Next-Route liest die Dateien beim Bauen. Damit der Schnellstart in fünfzehn Minuten wahr sein kann, bekommt der Dev-Compose eine lokale Projektdatenbank und ein Skript, das eine Umgebung daran bindet (der Weg, den in Produktion der Provisionierer geht).

**Tech Stack:** Next.js 16 (App Router, `generateStaticParams`), React 19, TypeScript strict, Vitest 4, lucide-react, bestehende i18n (`lib/i18n/landing.ts`, vier Sprachen), Docker Compose (PostgreSQL 17), pg.

**Spec:** `docs/superpowers/specs/2026-09-25-documentation-design.md`

**Regeln, die überall gelten:**
- Texte für Denzil und für Leser: kein Gedankenstrich, keine KI-Floskeln (Sperrliste in Task 10), Schweizer Schreibweise ohne ß in neuen Dateien ist erlaubt, aber innerhalb einer Datei einheitlich.
- Kein Commit ohne grünes `npx tsc --noEmit -p .` und die in der Task genannten Tests.
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Skripte für Massenänderungen mit dem Write-Tool schreiben, nicht als Heredoc (bekannte Stolperfalle auf diesem Windows).

---

## Dateiübersicht

**Neu:**
- `db/docker/998-project-database.sh`: legt im Dev-Cluster die Datenbank `project_database` mit Ledger-Owner und Lese-Login an und gibt `qkern_project_api_app` die Rechte auf `public`.
- `scripts/dev-bind-project-database.mjs`: bindet eine Umgebung (pending) an `managed:database-1`, lokal, als Provisionierer-Login.
- `lib/docs/pages.ts`: Seitenliste (Slug, Datei, Titel, Reihenfolge).
- `lib/docs/markdown.ts`: Parser Markdown zu `GuideDocument`.
- `lib/docs/placeholders.ts`: füllt `{{version}}`, `{{node}}`, `{{postgresCases}}`, `{{stackCount}}`, `{{languageCount}}`.
- `lib/docs/load.ts`: liest eine Seite von der Platte, füllt Platzhalter, parst.
- `components/docs/guide-document.tsx`: zeichnet den Baum.
- `components/docs/copy-button.tsx`: Kopieren-Knopf für Codeblöcke (Client).
- `components/docs/docs-sidebar.tsx`: Seitenleiste mit Seiten und Überschriften (Client, Aufklappmenü unter 760 px).
- `app/docs/layout.tsx`, `app/docs/[[...slug]]/page.tsx`, `app/docs/docs.module.css`.
- `docs/guide/de/WAS_IST_QKERN.md`, `SCHNELLSTART.md`, `ERSTES_BACKEND.md`, `FUER_GRUENDER.md`, `GLOSSAR.md`.
- `tests/docs-markdown.test.ts`, `tests/docs-guide-contract.test.ts`, `tests/docs-quickstart-contract.test.ts`, `tests/docs-founder-numbers-contract.test.ts`, `tests/dev-bind-project-database.test.ts`.
- `docs/RELEASE_2.30.md`, Evidenz `docs/evidence/2026-09-25/quickstart-walkthrough.log` und `.manifest.json`.

**Geändert:**
- `docker-compose.yml`: Mount des neuen Init-Skripts, Passwörter für Ledger-Owner und Reader.
- `.env.example`: Block "Lokaler Schnellstart" mit beiden Katalog-JSONs.
- `package.json`: Skripte `dev:bind-project-database`, Version `2.30.0`.
- `lib/i18n/landing.ts`: Navigationseintrag "Dokumentation" in Header und Footer, Abschnitt `docs` (vier Sprachen).
- `app/page.tsx`: Footer-Link.
- `components/console/console-app.tsx`: Link `/docs`.
- `docs/HANDBUCH.md`, `docs/INDEX.md`, `docs/DOCS_MAINTENANCE.md`, `sdk/typescript/README.md`, `STATUS.md`, `docs/QA.md`, `docs/CLAUDE_HANDOFF.md`, `docs/evidence/README.md`.

---

### Task 1: Lokale Projektdatenbank im Dev-Compose

> Nachtrag nach Review: Der Ledger-Owner ist `NOLOGIN` (der Ledger-Vertrag in
> `db/project/0001_qkern_migration_ledger.sql` verlangt das), es gibt kein
> `QKERN_PROJECT_LEDGER_DB_PASSWORD`. Der Schnellstart legt Tabellen als `qkern`
> mit `SET ROLE qkern_ledger_owner` an. `REVOKE ALL ON DATABASE ... FROM PUBLIC`
> plus `GRANT CONNECT` nur fuer Reader und API-Login. Dev-Compose nutzt den
> Init-Einstiegspunkt `000-certification-init.sh` (Docker Desktop kann keinen
> Mount in den read-only initdb-Mount legen). Vertragstest
> `tests/dev-compose-layout-contract.test.ts`.

Ohne sie kann der Schnellstart keine Tabelle lesen. Heute legt der Dev-Compose nur die Control Plane an; die Data API braucht eine zweite Datenbank mit Ledger-Owner, Reader und dem bestehenden Login `qkern_project_api_app`.

**Files:**
- Create: `db/docker/998-project-database.sh`
- Modify: `docker-compose.yml:1-20`
- Modify: `.env.example` (neuer Block vor Zeile 269)

- [ ] **Step 1: Init-Skript schreiben**

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Lokale Projektdatenbank fuer den Schnellstart (2.30). Nur im Dev-Compose:
# eine zweite Datenbank im selben Cluster, ein Ledger-Owner, ein Lese-Login
# und Rechte fuer den bestehenden Data-API-Login. In Produktion legt der
# Provisionierer das auf einem eigenen Server an; die Grenzen sind dieselben.
: "${QKERN_PROJECT_LEDGER_DB_PASSWORD:?QKERN_PROJECT_LEDGER_DB_PASSWORD is required}"
: "${QKERN_PROJECT_READER_DB_PASSWORD:?QKERN_PROJECT_READER_DB_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set=ledger_password="$QKERN_PROJECT_LEDGER_DB_PASSWORD" \
  --set=reader_password="$QKERN_PROJECT_READER_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_ledger_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'ledger_password';
CREATE ROLE qkern_project_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'reader_password';
CREATE DATABASE project_database OWNER qkern_ledger_owner;
SQL

psql --username "$POSTGRES_USER" --dbname project_database --set ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO qkern_ledger_owner;
GRANT USAGE ON SCHEMA public TO qkern_project_reader, qkern_project_api_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT ON TABLES TO qkern_project_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qkern_project_api_app;
ALTER ROLE qkern_project_reader SET statement_timeout = '10s';
ALTER ROLE qkern_project_api_app IN DATABASE project_database SET statement_timeout = '10s';
SQL
echo "project-database: project_database mit qkern_ledger_owner, qkern_project_reader und qkern_project_api_app angelegt"
```

- [ ] **Step 2: Compose ergänzen**

In `docker-compose.yml` im Dienst `postgres`:

```yaml
    environment:
      # ... bestehende Zeilen bleiben ...
      QKERN_PROJECT_LEDGER_DB_PASSWORD: qkern_ledger_local_only
      QKERN_PROJECT_READER_DB_PASSWORD: qkern_reader_local_only
    volumes:
      - qkern-postgres:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
      - ./db/docker/998-project-database.sh:/docker-entrypoint-initdb.d/998-project-database.sh:ro
      - ./db/docker/999-runtime-login.sh:/docker-entrypoint-initdb.d/999-runtime-login.sh:ro
```

Achtung Reihenfolge: der Entrypoint führt `*.sh` und `*.sql` lexikografisch aus. `998` läuft vor `999`, aber `qkern_project_api_app` entsteht erst in `999`. Deshalb muss das Skript `998-project-database.sh` in `999-runtime-login.sh` am Ende aufgerufen werden statt direkt gemountet zu werden. Also: **nicht** als eigenes Mount, sondern am Ende von `999-runtime-login.sh` diese Zeile anhängen:

```bash
bash /qkern/db/docker/998-project-database.sh
```

und `docker-compose.yml` mountet `./db/docker:/qkern/db/docker:ro` zusätzlich. Der Zertifizierungsstack (`000-certification-init.sh`) ruft `999` auch auf; dort fehlen die beiden Passwörter. Deshalb im `998`-Skript die zwei `:?`-Zeilen ersetzen durch:

```bash
if [[ -z "${QKERN_PROJECT_LEDGER_DB_PASSWORD:-}" || -z "${QKERN_PROJECT_READER_DB_PASSWORD:-}" ]]; then
  echo "project-database: keine Passwoerter gesetzt, lokale Projektdatenbank wird nicht angelegt"
  exit 0
fi
```

- [ ] **Step 3: `.env.example` erweitern**

Vor der Zeile `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG=false` einfügen:

```dotenv
# ---------------------------------------------------------------------------
# Lokaler Schnellstart (docs/guide/de/SCHNELLSTART.md). Der Dev-Compose legt
# die Datenbank `project_database` mit diesen Logins an. Nur lokal gueltig.
# Zum Aktivieren die vier Zeilen darunter auf true setzen und die beiden
# JSON-Zeilen einkommentieren.
# ---------------------------------------------------------------------------
# QKERN_DATA_PLANE_ENABLED=true
# QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG=true
# QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON=[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_reader:qkern_reader_local_only@127.0.0.1:5432/project_database","expectedRole":"qkern_project_reader","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]
# QKERN_GENERATED_DATA_API_ENABLED=true
# QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG=true
# QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON=[{"databaseInstanceRef":"managed:database-1","connectionString":"postgresql://qkern_project_api_app:qkern_project_api_local_only@127.0.0.1:5432/project_database","expectedRole":"qkern_project_api_app","expectedDatabase":"project_database","expectedLedgerOwner":"qkern_ledger_owner"}]
```

- [ ] **Step 4: Frisch hochfahren und prüfen**

```powershell
docker compose down -v
docker compose up -d
docker compose logs postgres | Select-String "project-database"
docker compose exec postgres psql -U qkern -d project_database -tAc "SELECT rolname FROM pg_roles WHERE rolname IN ('qkern_ledger_owner','qkern_project_reader','qkern_project_api_app') ORDER BY 1"
```

Erwartet: die Logzeile `project-database: project_database mit ...` und drei Rollennamen.

**Hinweis:** `docker compose down -v` löscht das lokale Control-Plane-Volume von Denzil. Vorher fragen, oder mit `-p qkern-schnellstart` einen zweiten Projektnamen benutzen, damit sein Volume bleibt.

- [ ] **Step 5: Commit**

```bash
git add db/docker/998-project-database.sh db/docker/999-runtime-login.sh docker-compose.yml .env.example
git commit -m "dev: lokale Projektdatenbank im Dev-Compose fuer den Schnellstart

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Skript, das eine Umgebung an die lokale Datenbank bindet

In Produktion setzt der Provisionierer `database_instance_ref` von `pending:` auf `managed:...` (`bindProvisioned` in `lib/server/db/repositories.ts:865`). Lokal gibt es keinen Provisionierer; das Skript macht genau diese eine UPDATE-Anweisung, einmal, und nichts sonst. Der Trigger `project_environments_database_ref_immutable` sorgt dafür, dass es nur aus `pending:` heraus geht.

**Files:**
- Create: `scripts/dev-bind-project-database.mjs`
- Create: `tests/dev-bind-project-database.test.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Test für Argumentprüfung und SQL schreiben**

```ts
import { describe, expect, it } from "vitest";
import { bindStatement, parseArgs } from "../scripts/dev-bind-project-database.mjs";

describe("dev-bind-project-database", () => {
  it("requires a project id and an environment", () => {
    expect(() => parseArgs([])).toThrow(/project/);
    expect(() => parseArgs(["not-a-uuid", "development"])).toThrow(/uuid/);
    expect(() => parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "prod"])).toThrow(/environment/);
  });

  it("binds only a pending reference and never a production environment", () => {
    const args = parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "development"]);
    const statement = bindStatement(args);
    expect(statement.text).toMatch(/database_instance_ref ~\* '\^pending:'/);
    expect(statement.values).toEqual(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "development", "managed:database-1"]);
    expect(() => parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "production"])).toThrow(/production/);
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/dev-bind-project-database.test.ts`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Skript schreiben**

```js
import { Client } from "pg";

/**
 * Bindet lokal eine Projektumgebung an `managed:database-1` (2.30).
 *
 * In Produktion tut das der Provisionierer nach einem echten Bootstrap. Hier
 * gibt es keinen; das Skript macht dieselbe eine UPDATE-Anweisung wie
 * `bindProvisioned` in lib/server/db/repositories.ts, als Provisionierer-Login,
 * nur aus `pending:` heraus (der Trigger in Migration 0005 verbietet alles
 * andere) und nie fuer production.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = "managed:database-1";

export function parseArgs(argv) {
  const [projectId, environment] = argv;
  if (!projectId) throw new Error("Usage: npm run dev:bind-project-database -- <project-uuid> <development|staging>");
  if (!UUID.test(projectId)) throw new Error(`project id is not a uuid: ${projectId}`);
  if (environment === "production") throw new Error("production is never bound locally");
  if (environment !== "development" && environment !== "staging") throw new Error(`environment must be development or staging, got ${environment}`);
  return { projectId, environment };
}

export function bindStatement({ projectId, environment }) {
  return {
    text: `UPDATE project_environments
       SET database_instance_ref = $3
       WHERE project_id = $1 AND environment = $2
         AND database_instance_ref ~* '^pending:'
       RETURNING organization_id, database_instance_ref`,
    values: [projectId, environment, REF],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.QKERN_PROVISIONER_DATABASE_URL
    ?? "postgresql://qkern_provisioner_app:qkern_provisioner_local_only@localhost:5432/qkern_control";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(bindStatement(args));
    if (result.rowCount === 0) {
      console.error("Keine wartende Umgebung gefunden. Ist die Projekt-ID richtig, und ist die Umgebung noch `pending:`?");
      process.exitCode = 1;
      return;
    }
    console.log(`Gebunden: ${args.environment} von ${args.projectId} an ${result.rows[0].database_instance_ref}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
```

Prüfen, ob `project_environments` Row Level Security mit Mandantenkontext trägt (`grep -n "project_environments" db/migrations/*.sql | grep -i "policy\|row level"`). Falls ja, den Provisionierer-Weg aus `lib/server/provisioning/worker.ts:270-290` nachlesen und dieselbe Sitzungsvariable vor dem UPDATE mit `SET LOCAL` setzen; die Anweisung dann in `BEGIN`/`COMMIT` einschliessen.

- [ ] **Step 4: npm-Skript eintragen**

In `package.json` unter `scripts`:

```json
"dev:bind-project-database": "node scripts/dev-bind-project-database.mjs",
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/dev-bind-project-database.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Gegen den Dev-Compose prüfen**

Voraussetzung: `.env.local` mit `QKERN_RUNTIME_MODE=postgres`, Dev-Server läuft, in der Konsole ein Projekt angelegt. Dann:

```powershell
npm run dev:bind-project-database -- <projekt-id> development
```

Erwartet: `Gebunden: development von <id> an managed:database-1`. Ein zweiter Aufruf endet mit exit 1 und der Meldung "Keine wartende Umgebung gefunden."

- [ ] **Step 7: Commit**

```bash
git add scripts/dev-bind-project-database.mjs tests/dev-bind-project-database.test.ts package.json
git commit -m "dev: Umgebung lokal an die Projektdatenbank binden

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Seitenliste `lib/docs/pages.ts`

**Files:**
- Create: `lib/docs/pages.ts`
- Create: `tests/docs-guide-contract.test.ts` (erster Fall; wächst in Task 10)

- [ ] **Step 1: Test schreiben**

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guidePath, pageBySlug } from "@/lib/docs/pages";

describe("docs guide contract", () => {
  it("lists five pages whose files exist, with unique slugs", () => {
    expect(GUIDE_PAGES.map((page) => page.slug)).toEqual(["", "schnellstart", "erstes-backend", "gruender", "glossar"]);
    for (const page of GUIDE_PAGES) expect(existsSync(guidePath("de", page)), `${page.file} fehlt`).toBe(true);
    expect(pageBySlug("glossar")?.file).toBe("GLOSSAR.md");
    expect(pageBySlug("nicht-da")).toBeUndefined();
    expect(guidePath("de", GUIDE_PAGES[0])).toBe(path.resolve(process.cwd(), "docs/guide/de/WAS_IST_QKERN.md"));
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/docs-guide-contract.test.ts`
Expected: FAIL, Modul `@/lib/docs/pages` nicht gefunden.

- [ ] **Step 3: Seitenliste schreiben**

```ts
import path from "node:path";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Die Einstiegsdoku (2.30): fuenf Seiten, eine Quelle. Route, Seitenleiste,
 * INDEX-Block und Vertragstests lesen diese Liste; wer eine Seite ergaenzt,
 * ergaenzt sie hier und nirgends sonst.
 */
export type GuidePage = {
  /** Leer fuer die Startseite `/docs`. */
  slug: "" | "schnellstart" | "erstes-backend" | "gruender" | "glossar";
  file: string;
  /** Kurztitel fuer Seitenleiste und Metadaten, deutsch; Uebersetzungen kommen mit den Texten. */
  title: string;
  audience: "alle" | "A" | "B" | "C";
};

export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: "", file: "WAS_IST_QKERN.md", title: "Was ist QKERN", audience: "alle" },
  { slug: "schnellstart", file: "SCHNELLSTART.md", title: "Schnellstart", audience: "A" },
  { slug: "erstes-backend", file: "ERSTES_BACKEND.md", title: "Erstes Backend", audience: "B" },
  { slug: "gruender", file: "FUER_GRUENDER.md", title: "Für Gründer", audience: "C" },
  { slug: "glossar", file: "GLOSSAR.md", title: "Glossar", audience: "alle" },
];

export function pageBySlug(slug: string): GuidePage | undefined {
  return GUIDE_PAGES.find((page) => page.slug === slug);
}

export function guidePath(locale: Locale, page: GuidePage): string {
  return path.resolve(process.cwd(), "docs/guide", locale, page.file);
}

/** Welche Sprachen schon Texte haben. Solange eine fehlt, zeigt die Website Deutsch mit Hinweis. */
export const GUIDE_LOCALES_AVAILABLE: readonly Locale[] = ["de"];
```

- [ ] **Step 4: Fünf Platzhalterdateien anlegen**, je nur mit der Überschrift der Ebene 1 (der Text kommt in Task 8 und 9):

```bash
mkdir -p docs/guide/de
printf '# Was ist QKERN\n' > docs/guide/de/WAS_IST_QKERN.md
printf '# Schnellstart\n' > docs/guide/de/SCHNELLSTART.md
printf '# Erstes Backend\n' > docs/guide/de/ERSTES_BACKEND.md
printf '# Für Gründer\n' > docs/guide/de/FUER_GRUENDER.md
printf '# Glossar\n' > docs/guide/de/GLOSSAR.md
```

- [ ] **Step 5: Test laufen lassen**

Run: `npx vitest run tests/docs-guide-contract.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/docs/pages.ts tests/docs-guide-contract.test.ts docs/guide
git commit -m "docs: Seitenliste der Einstiegsdoku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Markdown-Parser `lib/docs/markdown.ts`

Genau diese Knoten: Überschrift 1 bis 3, Absatz, Liste, nummerierte Liste, Codeblock mit Sprache, Tabelle, Zitatblock; im Text fett, kursiv, Inline-Code, Link. Alles andere wirft `GuideSyntaxError` mit Zeilennummer.

**Files:**
- Create: `lib/docs/markdown.ts`
- Create: `tests/docs-markdown.test.ts`

- [ ] **Step 1: Tests schreiben**

```ts
import { describe, expect, it } from "vitest";
import { GuideSyntaxError, parseGuide, slugify } from "@/lib/docs/markdown";

describe("guide markdown parser", () => {
  it("parses headings with anchors, paragraphs and inline marks", () => {
    const doc = parseGuide("# Titel\n\nEin **fetter** und *kursiver* Satz mit `code` und [Link](GLOSSAR.md#tabelle).\n");
    expect(doc.title).toBe("Titel");
    expect(doc.blocks[0]).toEqual({ kind: "heading", level: 1, id: "titel", text: [{ kind: "text", text: "Titel" }] });
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [
      { kind: "text", text: "Ein " }, { kind: "strong", text: "fetter" }, { kind: "text", text: " und " },
      { kind: "em", text: "kursiver" }, { kind: "text", text: " Satz mit " }, { kind: "code", text: "code" },
      { kind: "text", text: " und " }, { kind: "link", text: "Link", href: "GLOSSAR.md#tabelle" }, { kind: "text", text: "." },
    ] });
  });

  it("parses lists, code blocks, tables and quotes", () => {
    const doc = parseGuide([
      "## Schritte", "", "1. Erstens", "2. Zweitens", "", "- eins", "- zwei", "",
      "```powershell", "npm ci", "```", "",
      "| Supabase | QKERN |", "| --- | --- |", "| Studio | Konsole |", "",
      "> Hinweis: nur lokal.", "",
    ].join("\n"));
    expect(doc.blocks.map((block) => block.kind)).toEqual(["heading", "ordered", "list", "code", "table", "quote"]);
    expect(doc.blocks[3]).toEqual({ kind: "code", language: "powershell", code: "npm ci" });
    expect(doc.blocks[4]).toMatchObject({ kind: "table", header: [[{ kind: "text", text: "Supabase" }], [{ kind: "text", text: "QKERN" }]] });
    expect(doc.headings).toEqual([{ level: 2, id: "schritte", text: "Schritte" }]);
  });

  it("rejects what the guide does not use, with a line number", () => {
    expect(() => parseGuide("#### Zu tief\n")).toThrow(GuideSyntaxError);
    expect(() => parseGuide("Absatz\n\n<div>html</div>\n")).toThrow(/Zeile 3/);
    expect(() => parseGuide("![Bild](x.png)\n")).toThrow(/Zeile 1/);
    expect(() => parseGuide("- a\n  - verschachtelt\n")).toThrow(/Zeile 2/);
    expect(() => parseGuide("```\nohne Sprache\n```\n")).toThrow(/Sprache/);
    expect(() => parseGuide("```sh\nnie geschlossen\n")).toThrow(/Zeile 1/);
  });

  it("makes stable anchors from German headings", () => {
    expect(slugify("Row Level Security (RLS)")).toBe("row-level-security-rls");
    expect(slugify("Für Gründer: Kosten")).toBe("fuer-gruender-kosten");
    expect(slugify("Grösse")).toBe("groesse");
  });

  it("gives duplicate headings distinct anchors", () => {
    const doc = parseGuide("## Ehrlich offen\n\nA\n\n## Ehrlich offen\n\nB\n");
    expect(doc.headings.map((h) => h.id)).toEqual(["ehrlich-offen", "ehrlich-offen-2"]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `npx vitest run tests/docs-markdown.test.ts`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Parser schreiben**

```ts
/**
 * Markdown-Parser der Einstiegsdoku (2.30). Absichtlich klein: er versteht
 * genau die Elemente, die die fuenf Seiten brauchen, und wirft bei allem
 * anderen mit Zeilennummer. Der Fehler faellt im Vertragstest auf, nicht beim
 * Leser. Keine Abhaengigkeit, kein HTML, keine Bilder, keine Verschachtelung.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; id: string; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "ordered"; items: Inline[][] }
  | { kind: "code"; language: string; code: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; text: Inline[] };

export type GuideDocument = {
  title: string;
  blocks: Block[];
  headings: Array<{ level: 2 | 3; id: string; text: string }>;
};

export class GuideSyntaxError extends Error {
  constructor(public readonly line: number, message: string) {
    super(`Zeile ${line}: ${message}`);
    this.name = "GuideSyntaxError";
  }
}

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", é: "e", è: "e", à: "a" };

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[äöüßéèà]/g, (ch) => UMLAUTS[ch] ?? ch).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function plain(inlines: Inline[]): string {
  return inlines.map((inline) => inline.text).join("");
}

const INLINE = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(!\[)|(<[a-zA-Z/])/g;

export function parseInline(text: string, line: number): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) });
    const token = match[0];
    if (match[5]) throw new GuideSyntaxError(line, "Bilder sind in der Einstiegsdoku nicht vorgesehen");
    if (match[6]) throw new GuideSyntaxError(line, "HTML ist in der Einstiegsdoku nicht vorgesehen");
    if (match[1]) out.push({ kind: "strong", text: token.slice(2, -2) });
    else if (match[2]) out.push({ kind: "em", text: token.slice(1, -1) });
    else if (match[3]) out.push({ kind: "code", text: token.slice(1, -1) });
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push({ kind: "link", text: link[1], href: link[2] });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function tableCells(row: string, line: number): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) throw new GuideSyntaxError(line, "Tabellenzeile muss mit | beginnen und enden");
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

export function parseGuide(markdown: string): GuideDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const headings: GuideDocument["headings"] = [];
  const seen = new Map<string, number>();
  let title = "";
  let i = 0;

  const anchor = (text: string) => {
    const base = slugify(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === "") { i += 1; continue; }
    if (/^\s+\S/.test(raw)) throw new GuideSyntaxError(line, "eingerueckte Zeilen (verschachtelte Listen, Codeblock ohne Zaun) sind nicht vorgesehen");

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      const level = heading[1].length;
      if (level > 3) throw new GuideSyntaxError(line, "Ueberschriften nur bis Ebene 3");
      const text = parseInline(heading[2], line);
      const id = anchor(plain(text));
      if (level === 1) { if (title) throw new GuideSyntaxError(line, "nur eine Ueberschrift der Ebene 1"); title = plain(text); }
      else headings.push({ level: level as 2 | 3, id, text: plain(text) });
      blocks.push({ kind: "heading", level: level as 1 | 2 | 3, id, text });
      i += 1; continue;
    }

    if (raw.startsWith("```")) {
      const language = raw.slice(3).trim();
      if (!language) throw new GuideSyntaxError(line, "Codeblock ohne Sprache");
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("```")) { code.push(lines[j]); j += 1; }
      if (j >= lines.length) throw new GuideSyntaxError(line, "Codeblock nie geschlossen");
      blocks.push({ kind: "code", language, code: code.join("\n") });
      i = j + 1; continue;
    }

    if (raw.startsWith("|")) {
      const header = tableCells(raw, line).map((cell) => parseInline(cell, line));
      const divider = lines[i + 1] ?? "";
      if (!/^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(divider.trim())) throw new GuideSyntaxError(line + 1, "Tabelle ohne Trennzeile");
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        const cells = tableCells(lines[j], j + 1);
        if (cells.length !== header.length) throw new GuideSyntaxError(j + 1, `Tabellenzeile hat ${cells.length} Zellen, Kopf hat ${header.length}`);
        rows.push(cells.map((cell) => parseInline(cell, j + 1)));
        j += 1;
      }
      blocks.push({ kind: "table", header, rows });
      i = j; continue;
    }

    if (raw.startsWith("> ")) {
      const parts: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].startsWith("> ")) { parts.push(lines[j].slice(2)); j += 1; }
      blocks.push({ kind: "quote", text: parseInline(parts.join(" "), line) });
      i = j; continue;
    }

    const bullet = /^[-*]\s+(.*)$/;
    const number = /^\d+\.\s+(.*)$/;
    if (bullet.test(raw) || number.test(raw)) {
      const ordered = number.test(raw);
      const pattern = ordered ? number : bullet;
      const items: Inline[][] = [];
      let j = i;
      while (j < lines.length && pattern.test(lines[j])) {
        items.push(parseInline(pattern.exec(lines[j])![1], j + 1));
        j += 1;
      }
      if (j < lines.length && /^\s+\S/.test(lines[j])) throw new GuideSyntaxError(j + 1, "verschachtelte Listen sind nicht vorgesehen");
      blocks.push(ordered ? { kind: "ordered", items } : { kind: "list", items });
      i = j; continue;
    }

    if (raw.startsWith("<")) throw new GuideSyntaxError(line, "HTML ist in der Einstiegsdoku nicht vorgesehen");

    const parts: string[] = [];
    let j = i;
    while (j < lines.length && lines[j].trim() !== "" && !/^(#|```|\||> |[-*]\s|\d+\.\s|<)/.test(lines[j])) { parts.push(lines[j].trim()); j += 1; }
    blocks.push({ kind: "paragraph", text: parseInline(parts.join(" "), line) });
    i = j;
  }

  if (!title) throw new GuideSyntaxError(1, "Seite ohne Ueberschrift der Ebene 1");
  return { title, blocks, headings };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/docs-markdown.test.ts`
Expected: 5 passed. Wenn der Fall "eingerückte Zeile" den Fehler an der falschen Zeile meldet, die Reihenfolge der Prüfungen anpassen, nicht den Test.

- [ ] **Step 5: Commit**

```bash
git add lib/docs/markdown.ts tests/docs-markdown.test.ts
git commit -m "docs: Markdown-Parser fuer die Einstiegsdoku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Platzhalter und Laden `lib/docs/placeholders.ts`, `lib/docs/load.ts`

Versionsnummern und Zahlen stehen nicht im Text. `{{version}}` und `{{node}}` kommen aus `package.json`, `{{postgresCases}}` und `{{stackCount}}` aus der Zertifizierungszusammenfassung (`lib/server/evidence/certification-summary.ts`), `{{languageCount}}` aus `LOCALES`.

**Files:**
- Create: `lib/docs/placeholders.ts`
- Create: `lib/docs/load.ts`
- Test: `tests/docs-guide-contract.test.ts` (Fall ergänzen)

- [ ] **Step 1: Test ergänzen**

```ts
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";
import { loadGuidePage } from "@/lib/docs/load";

  it("fills every placeholder from a real source and leaves none behind", async () => {
    const values = await guidePlaceholders();
    expect(values.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(values.node).toMatch(/^\d+\.\d+/);
    expect(Number(values.postgresCases)).toBeGreaterThan(100);
    expect(Number(values.languageCount)).toBe(4);
    expect(fillPlaceholders("QKERN {{version}} auf Node {{node}}", values)).not.toContain("{{");
    expect(() => fillPlaceholders("{{unbekannt}}", values)).toThrow(/unbekannt/);
    for (const page of GUIDE_PAGES) {
      const loaded = await loadGuidePage("de", page);
      expect(JSON.stringify(loaded.document)).not.toContain("{{");
    }
  });
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/docs-guide-contract.test.ts`
Expected: FAIL, Modul nicht gefunden.

- [ ] **Step 3: Platzhalter schreiben**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCALES } from "@/lib/i18n/locales";
import { readArchivedManifests, summarizeCertification } from "@/lib/server/evidence/certification-summary";

/**
 * Zahlen der Einstiegsdoku (2.30) kommen aus denselben Quellen wie STATUS.md
 * und die Landing-Page. Ein Platzhalter, den niemand kennt, ist ein Fehler.
 */
export type GuidePlaceholders = Record<"version" | "node" | "postgresCases" | "stackCount" | "languageCount", string>;

export async function guidePlaceholders(): Promise<GuidePlaceholders> {
  const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { version: string; engines?: { node?: string } };
  const summary = summarizeCertification(await readArchivedManifests());
  const postgres = summary.rows.find((row) => row.name === "Control Plane und Data API");
  return {
    version: pkg.version,
    node: (pkg.engines?.node ?? ">=24.7.0").replace(/^[^\d]*/, ""),
    postgresCases: String(postgres?.passed ?? 0),
    stackCount: String(summary.rows.length),
    languageCount: String(LOCALES.length),
  };
}

export function fillPlaceholders(text: string, values: GuidePlaceholders): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Unbekannter Platzhalter {{${key}}}`);
    return values[key as keyof GuidePlaceholders];
  });
}
```

Falls `package.json` kein `engines.node` hat: `"engines": { "node": ">=24.7.0" }` ergänzen (das Handbuch nennt 24.7 als Minimum).

- [ ] **Step 4: Laden schreiben**

```ts
import { readFile } from "node:fs/promises";
import type { Locale } from "@/lib/i18n/locales";
import { parseGuide, type GuideDocument } from "@/lib/docs/markdown";
import { GUIDE_LOCALES_AVAILABLE, guidePath, type GuidePage } from "@/lib/docs/pages";
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";

export type LoadedGuidePage = { page: GuidePage; locale: Locale; document: GuideDocument; translated: boolean };

/** Liest eine Seite; fehlt die Sprache, kommt Deutsch mit `translated: false`. */
export async function loadGuidePage(locale: Locale, page: GuidePage): Promise<LoadedGuidePage> {
  const available = GUIDE_LOCALES_AVAILABLE.includes(locale) ? locale : "de";
  const raw = await readFile(guidePath(available, page), "utf8");
  const filled = fillPlaceholders(raw, await guidePlaceholders());
  return { page, locale, document: parseGuide(filled), translated: available === locale };
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/docs-guide-contract.test.ts tests/docs-markdown.test.ts`
Expected: alle bestanden.

- [ ] **Step 6: Commit**

```bash
git add lib/docs/placeholders.ts lib/docs/load.ts tests/docs-guide-contract.test.ts package.json
git commit -m "docs: Platzhalter aus echten Quellen, Seiten laden

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Website-Route `/docs`

**Files:**
- Create: `components/docs/guide-document.tsx`
- Create: `components/docs/copy-button.tsx`
- Create: `components/docs/docs-sidebar.tsx`
- Create: `app/docs/layout.tsx`
- Create: `app/docs/[[...slug]]/page.tsx`
- Create: `app/docs/docs.module.css`
- Modify: `lib/i18n/landing.ts` (Typ `LandingDictionary`, Abschnitt `docs` in de, en, fr, it)

- [ ] **Step 1: Wörterbuch erweitern**

Im Typ (Zeile 14 ff.) ergänzen:

```ts
  docs: { title: string; pages: string; onThisPage: string; copy: string; copied: string; translationPending: string; menu: string };
```

und in jeder Sprache:

```ts
  // de
  docs: { title: "Dokumentation", pages: "Seiten", onThisPage: "Auf dieser Seite", copy: "Kopieren", copied: "Kopiert", translationPending: "Diese Seite gibt es bisher nur auf Deutsch. Die Übersetzung folgt.", menu: "Inhalt" },
  // en
  docs: { title: "Documentation", pages: "Pages", onThisPage: "On this page", copy: "Copy", copied: "Copied", translationPending: "This page exists in German only for now. The translation is coming.", menu: "Contents" },
  // fr
  docs: { title: "Documentation", pages: "Pages", onThisPage: "Sur cette page", copy: "Copier", copied: "Copié", translationPending: "Cette page n'existe pour l'instant qu'en allemand. La traduction arrive.", menu: "Sommaire" },
  // it
  docs: { title: "Documentazione", pages: "Pagine", onThisPage: "In questa pagina", copy: "Copia", copied: "Copiato", translationPending: "Questa pagina esiste per ora solo in tedesco. La traduzione arriva.", menu: "Indice" },
```

Run: `npx vitest run tests/i18n-contract.test.ts` muss grün bleiben (gleiche Struktur in allen Sprachen).

- [ ] **Step 2: Kopieren-Knopf**

```tsx
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { StableLabel } from "@/components/stable-label";

/** Kopiert einen Codeblock. Der Knopf wechselt die Beschriftung, nie die Breite. */
export function CopyButton({ code, labels }: { code: string; labels: { copy: string; copied: string } }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ohne Zwischenablage bleibt der Text markierbar */ }
  }
  return (
    <button type="button" className="ghost-button docs-copy" onClick={copy} aria-live="polite">
      {done ? <Check size={13}/> : <Copy size={13}/>}
      <StableLabel current={done ? labels.copied : labels.copy} variants={[labels.copy, labels.copied]}/>
    </button>
  );
}
```

- [ ] **Step 3: Dokument zeichnen**

```tsx
import Link from "next/link";
import type { Block, Inline } from "@/lib/docs/markdown";
import { CopyButton } from "@/components/docs/copy-button";
import styles from "@/app/docs/docs.module.css";

/** Links auf andere Guide-Dateien werden zu Website-Pfaden; alles andere bleibt. */
export function guideHref(href: string): string {
  const match = /^([A-Z_]+)\.md(#.*)?$/.exec(href);
  if (!match) return href;
  const slug = ({ WAS_IST_QKERN: "", SCHNELLSTART: "schnellstart", ERSTES_BACKEND: "erstes-backend", FUER_GRUENDER: "gruender", GLOSSAR: "glossar" } as Record<string, string>)[match[1]];
  if (slug === undefined) return href;
  return `/docs${slug ? `/${slug}` : ""}${match[2] ?? ""}`;
}

function Inlines({ text }: { text: Inline[] }) {
  return <>{text.map((inline, index) => {
    switch (inline.kind) {
      case "strong": return <strong key={index}>{inline.text}</strong>;
      case "em": return <em key={index}>{inline.text}</em>;
      case "code": return <code key={index}>{inline.text}</code>;
      case "link": return <Link key={index} href={guideHref(inline.href)}>{inline.text}</Link>;
      default: return <span key={index}>{inline.text}</span>;
    }
  })}</>;
}

export function GuideDocument({ blocks, labels }: { blocks: Block[]; labels: { copy: string; copied: string } }) {
  return <article className={styles.article}>{blocks.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3";
        return <Tag key={index} id={block.id}><a href={`#${block.id}`} className={styles.anchor}><Inlines text={block.text}/></a></Tag>;
      }
      case "paragraph": return <p key={index}><Inlines text={block.text}/></p>;
      case "list": return <ul key={index}>{block.items.map((item, i) => <li key={i}><Inlines text={item}/></li>)}</ul>;
      case "ordered": return <ol key={index}>{block.items.map((item, i) => <li key={i}><Inlines text={item}/></li>)}</ol>;
      case "code": return <div key={index} className={styles.code}><span className={styles.language}>{block.language}</span><CopyButton code={block.code} labels={labels}/><pre><code>{block.code}</code></pre></div>;
      case "table": return <div key={index} className={styles.tableWrap}><table><thead><tr>{block.header.map((cell, i) => <th key={i}><Inlines text={cell}/></th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Inlines text={cell}/></td>)}</tr>)}</tbody></table></div>;
      case "quote": return <aside key={index} className={styles.note}><Inlines text={block.text}/></aside>;
    }
  })}</article>;
}
```

- [ ] **Step 4: Seitenleiste**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { GuidePage } from "@/lib/docs/pages";
import styles from "@/app/docs/docs.module.css";

export function DocsSidebar({ pages, headings, labels }: {
  pages: ReadonlyArray<Pick<GuidePage, "slug" | "title">>;
  headings: Array<{ level: 2 | 3; id: string; text: string }>;
  labels: { pages: string; onThisPage: string; menu: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <nav className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`} aria-label={labels.menu}>
      <button type="button" className={styles.sidebarToggle} aria-expanded={open} onClick={() => setOpen(!open)}>{labels.menu} <ChevronDown size={14}/></button>
      <div className={styles.sidebarBody}>
        <span className={styles.sidebarLabel}>{labels.pages}</span>
        {pages.map((page) => {
          const href = page.slug ? `/docs/${page.slug}` : "/docs";
          return <Link key={href} href={href} className={pathname === href ? styles.active : undefined} onClick={() => setOpen(false)}>{page.title}</Link>;
        })}
        {headings.filter((h) => h.level === 2).length > 0 && <>
          <span className={styles.sidebarLabel}>{labels.onThisPage}</span>
          {headings.filter((h) => h.level === 2).map((h) => <a key={h.id} href={`#${h.id}`} className={styles.headingLink} onClick={() => setOpen(false)}>{h.text}</a>)}
        </>}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Layout und Seite**

`app/docs/layout.tsx`:

```tsx
import { SiteHeader } from "@/components/site-header";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>
    <SiteHeader />
    <main className="container">{children}</main>
  </>;
}
```

`app/docs/[[...slug]]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { GuideDocument } from "@/components/docs/guide-document";
import { loadGuidePage } from "@/lib/docs/load";
import { GUIDE_PAGES, pageBySlug } from "@/lib/docs/pages";
import { getLandingDictionary } from "@/lib/i18n/landing";
import { currentLocale } from "@/lib/i18n/server";
import styles from "../docs.module.css";

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
  return GUIDE_PAGES.map((page) => ({ slug: page.slug ? [page.slug] : [] }));
}

function resolve(params: Params) {
  if ((params.slug?.length ?? 0) > 1) return undefined;
  return pageBySlug(params.slug?.[0] ?? "");
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = resolve(await params);
  if (!page) return {};
  const t = getLandingDictionary(await currentLocale());
  return { title: `${page.title} · QKERN ${t.docs.title}` };
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const page = resolve(await params);
  if (!page) notFound();
  const locale = await currentLocale();
  const t = getLandingDictionary(locale).docs;
  const loaded = await loadGuidePage(locale, page);
  return (
    <div className={styles.layout}>
      <DocsSidebar pages={GUIDE_PAGES} headings={loaded.document.headings} labels={{ pages: t.pages, onThisPage: t.onThisPage, menu: t.menu }} />
      <div className={styles.content}>
        {!loaded.translated && <p className={styles.pending}>{t.translationPending}</p>}
        <GuideDocument blocks={loaded.document.blocks} labels={{ copy: t.copy, copied: t.copied }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Stil**

`app/docs/docs.module.css`, mit den bestehenden Variablen aus `app/globals.css` (`--qkern-background`, `--qkern-surface-2`, `--qkern-border`, `--qkern-text`, `--qkern-text-muted`, `--radius-pill`; Dunkelmodus kommt über die Variablen mit):

```css
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px; padding: 40px 0 96px; }
.sidebar { position: sticky; top: 96px; align-self: start; display: grid; gap: 4px; font-size: 14px; }
.sidebarToggle { display: none; }
.sidebarLabel { margin: 18px 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--qkern-text-muted); }
.sidebarLabel:first-child { margin-top: 0; }
.sidebar a { padding: 6px 10px; border-radius: 8px; color: var(--qkern-text-muted); }
.sidebar a:hover, .sidebar a.active { color: var(--qkern-text); background: var(--qkern-surface-2); }
.headingLink { font-size: 13px; }
.content { max-width: 68ch; }
.pending { padding: 10px 14px; border: 1px solid var(--qkern-border); border-radius: 12px; background: var(--qkern-surface-2); font-size: 14px; }
.article h1 { font-size: 40px; line-height: 1.1; margin: 0 0 20px; }
.article h2 { font-size: 26px; margin: 48px 0 14px; }
.article h3 { font-size: 19px; margin: 32px 0 10px; }
.article p, .article li { font-size: 16.5px; line-height: 1.65; }
.article ul, .article ol { padding-left: 22px; }
.anchor { color: inherit; text-decoration: none; }
.anchor:hover::after { content: " #"; color: var(--qkern-text-muted); }
.code { position: relative; margin: 18px 0; border: 1px solid var(--qkern-border); border-radius: 14px; background: var(--qkern-surface-2); overflow: hidden; }
.code pre { margin: 0; padding: 40px 18px 16px; overflow-x: auto; font-family: "JetBrains Mono Variable", monospace; font-size: 13.5px; line-height: 1.55; }
.language { position: absolute; top: 10px; left: 16px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--qkern-text-muted); }
.code :global(.docs-copy) { position: absolute; top: 6px; right: 8px; }
.tableWrap { overflow-x: auto; margin: 18px 0; }
.article table { border-collapse: collapse; width: 100%; font-size: 15px; }
.article th, .article td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--qkern-border); vertical-align: top; }
.note { margin: 18px 0; padding: 14px 18px; border-left: 3px solid var(--qkern-text-muted); background: var(--qkern-surface-2); border-radius: 0 12px 12px 0; }
@media (max-width: 760px) {
  .layout { grid-template-columns: 1fr; gap: 16px; padding-top: 16px; }
  .sidebar { position: static; }
  .sidebarToggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 14px; border: 1px solid var(--qkern-border); border-radius: var(--radius-pill); background: transparent; color: var(--qkern-text); font: inherit; }
  .sidebarBody { display: none; padding: 10px 4px; }
  .sidebarOpen .sidebarBody { display: grid; }
  .article h1 { font-size: 30px; }
}
```

Vor dem Schreiben mit `grep -n "^\s*--qkern" app/globals.css | head -30` prüfen, dass genau diese Variablennamen existieren; sonst die vorhandenen nehmen.

- [ ] **Step 7: Typecheck und Sichtprüfung**

```powershell
npx tsc --noEmit -p .
```

Dev-Server läuft schon als `qkern-dev`; im Browser `http://localhost:3000/docs` und `/docs/glossar` öffnen. Erwartet: Seitenleiste, Überschrift der Platzhalterdatei, keine Konsolenfehler. Fensterbreite 375 px prüfen: Seitenleiste ist ein Aufklappknopf.

- [ ] **Step 8: Commit**

```bash
git add app/docs components/docs lib/i18n/landing.ts
git commit -m "docs: Route /docs rendert die Einstiegsdoku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Links in Konsole und Landing-Page

**Files:**
- Modify: `components/console/console-app.tsx:175`
- Modify: `lib/i18n/landing.ts` (Header `nav`, Footer `docs`) in vier Sprachen
- Modify: `app/page.tsx:267-270`
- Modify: `tests/console-navigation-contract.test.ts` (Fall ergänzen)

- [ ] **Step 1: Test ergänzen** in `tests/console-navigation-contract.test.ts`:

```ts
  it("sends the documentation link to /docs, not to a landing anchor", async () => {
    const source = await readFile(path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(source).toContain('<Link href="/docs">');
    expect(source).not.toContain('href="/#developers"');
  });
```

Run: `npx vitest run tests/console-navigation-contract.test.ts`, Expected: der neue Fall FAIL.

- [ ] **Step 2: Konsole** in Zeile 175: `<Link href="/#developers">` durch `<Link href="/docs">` ersetzen.

- [ ] **Step 3: Header und Footer**

In `lib/i18n/landing.ts` je Sprache in `header.nav` als zweiten Eintrag: `["Dokumentation", "/docs"]`, `["Documentation", "/docs"]`, `["Documentation", "/docs"]`, `["Documentazione", "/docs"]`. Im Typ `footer` das Feld `docs: string` ergänzen und je Sprache `docs: "Dokumentation"` / `"Documentation"` / `"Documentation"` / `"Documentazione"`.

In `app/page.tsx` im Footer-Block "Entwickler":

```tsx
            <Link href="/docs">{t.footer.docs}</Link>
```

als erste Zeile vor dem Console-Link.

- [ ] **Step 4: Tests**

Run: `npx vitest run tests/console-navigation-contract.test.ts tests/i18n-contract.test.ts tests/landing-numbers-contract.test.ts`
Expected: alle bestanden. `SHARED` im i18n-Vertrag braucht keinen Zusatz, "Documentation" ist in en und fr gleich; falls der Vertrag "nur die deutsche Vorlage" anschlägt, "Dokumentation" nicht in `SHARED` aufnehmen, sondern prüfen, dass der Fall Wörter vergleicht, die in en/fr/it identisch zu de sind (hier sind sie es nicht).

- [ ] **Step 5: Commit**

```bash
git add components/console/console-app.tsx lib/i18n/landing.ts app/page.tsx tests/console-navigation-contract.test.ts
git commit -m "docs: Dokumentation aus Konsole, Kopfmenue und Fusszeile verlinkt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Die vier Seiten schreiben

Die Texte sind Handarbeit. Diese Task legt Gliederung, Pflichtinhalte und die Kommandos fest, die der Schnellstart-Vertrag (Task 10) prüft. Schreibregeln: Sätze um 20 Wörter, ein Gedanke je Satz, kein Gedankenstrich, keine Sperrlistenwörter, jeder Fachbegriff beim ersten Auftreten als Link `[Begriff](GLOSSAR.md#begriff)`. Jede Seite endet mit `## Ehrlich offen`.

**Files:**
- Modify: `docs/guide/de/WAS_IST_QKERN.md`, `SCHNELLSTART.md`, `ERSTES_BACKEND.md`, `FUER_GRUENDER.md`

- [ ] **Step 1: `WAS_IST_QKERN.md`**

Gliederung:

```markdown
# Was ist QKERN

(3 Absätze: Ein Backend, das man nicht selbst bauen muss. Datenbank, Login,
Dateien, Live-Updates, Hintergrundjobs. Läuft bei dir in Docker oder später
bei einem Hoster. Was QKERN nicht ist: kein Website-Baukasten, kein Hosting.)

## Warum es QKERN gibt
(Jede App braucht dieselben fünf Dinge. QKERN prüft sie gegen echte Dienste
und legt die Prüfprotokolle ins Repository. Verweis {{postgresCases}} Fälle,
{{stackCount}} Prüfstände.)

## Die Bausteine
| Baustein | Was er tut | In der Konsole |
(Konsole, Organisation, Projekt, Umgebung, Datenbank, Data API, Auth,
Storage, Realtime, Queues, Cron und Webhooks, Freigabezentrale, AI Bridge)

## Wie die Teile zusammenhängen
(Ein Absatz: Konsole spricht mit der Control Plane, die Control Plane
verwaltet Projekte, jedes Projekt hat je Umgebung eine eigene Datenbank,
die Data API liest und schreibt dort mit den Rechten des Aufrufers.)

## Drei Türen
- Ich kenne Supabase: [Schnellstart](SCHNELLSTART.md)
- Ich baue mein erstes Backend: [Erstes Backend](ERSTES_BACKEND.md)
- Ich bin kein Entwickler: [Für Gründer](FUER_GRUENDER.md)

## Ehrlich offen
(Version {{version}}, Product MVP, kein Hosting-Angebot, Provisionierung
lokal per Skript, Tabellen anlegen läuft noch über SQL statt über einen
Assistenten.)
```

- [ ] **Step 2: `SCHNELLSTART.md`**

Feste Kommandofolge; genau diese Blöcke prüft der Vertrag. Zeitangaben je Schritt kommen nach dem Durchlauf (Task 11).

```markdown
# Schnellstart

> Für Entwickler, die Supabase kennen. Ziel: QKERN lokal in Docker, ein
> Projekt, eine Tabelle, eine Zeile per REST und per SDK gelesen. Etwa
> fünfzehn Minuten. Am Ende steht, wie lange es beim letzten Durchlauf
> wirklich dauerte.

## Was du brauchst
- Node.js {{node}} oder neuer, Docker Desktop, den QKERN-Quellordner
  (Zip oder git clone), PowerShell oder eine Bash.

## 1. Dienste starten
```powershell
node --version
docker compose up -d
```
Erwartet: `v24.7.0` oder höher; Docker meldet `postgres`, `redis`, `minio`,
`clamav` als started.

## 2. Konfiguration
```powershell
Copy-Item .env.example .env.local
```
Dann in `.env.local`: `QKERN_RUNTIME_MODE=postgres`, die sechs Zeilen des
Blocks "Lokaler Schnellstart" einkommentieren, und die zwei Geheimnisse
setzen (Namen aus `.env.example` übernehmen; welche das sind, steht dort im
Kopf des Blocks "Sicherheit"). Werte erzeugen mit:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. QKERN starten
```powershell
npm ci
npm run dev
```
Erwartet: `Ready` und `http://localhost:3000`.

## 4. Registrieren und Projekt anlegen
(Klickweg: /register, Passwort mindestens 12 Zeichen, "Projekt erstellen",
Name `demo`. Die Projekt-ID steht unter Einstellungen.)

## 5. Umgebung an die Datenbank binden
```powershell
npm run dev:bind-project-database -- <projekt-id> development
```
Erwartet: `Gebunden: development von <projekt-id> an managed:database-1`.

## 6. Eine Tabelle anlegen
```powershell
docker compose exec postgres psql -U qkern -d project_database
```
```sql
SET ROLE qkern_ledger_owner;
CREATE TABLE public.notes (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_read_all ON public.notes FOR SELECT USING (true);
CREATE POLICY notes_write_anon ON public.notes FOR INSERT WITH CHECK (true);
INSERT INTO public.notes (title) VALUES ('Erste Notiz');
```
(Der Ledger-Owner kann sich nicht anmelden, wie in Produktion; deshalb
`SET ROLE`. Die Tabelle gehört danach ihm, und die Data API arbeitet mit den
Rechten des Aufrufers.)

## 7. Einen Projekt-Key holen
(Klickweg: Konsole, API, "Key erzeugen", Art `public`. Einmal kopieren.)

## 8. Per REST lesen
```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers
```
Erwartet: eine Zeile `Erste Notiz`.

## 9. Per SDK lesen
```powershell
mkdir qkern-demo; cd qkern-demo; npm init -y; npm install @qkern/sdk@alpha
```
```js
import { createQkernClient } from "@qkern/sdk";
const qkern = createQkernClient({ baseUrl: "http://localhost:3000", projectId: "<projekt-id>", environment: "development", projectKey: process.env.QKERN_PUBLIC_KEY });
const result = await qkern.from("notes").select({ limit: 10 });
console.log(result);
```
```powershell
node --input-type=module -e "$(Get-Content demo.mjs -Raw)"
```

## 10. Im Table Editor ansehen
(Klickweg: Konsole, Table Editor, `public.notes`.)

## Supabase und QKERN
| Bei Supabase | Bei QKERN |
| --- | --- |
| Studio | Konsole |
| Anon Key | Public Key (RLS gilt) |
| Service Role Key | Service Key (RLS gilt auch hier) |
| PostgREST | Generated Data API |
| GoTrue | Project Auth |
| Storage | Project Storage |
| Realtime | Realtime |
| Edge Functions | Functions |
| supabase-js | @qkern/sdk |
| Supabase CLI | @qkern/cli |
| Migrations | Change Sets mit Freigabezentrale |

## Ehrlich offen
(Bindung per Skript statt Provisionierer; Tabelle per SQL statt Assistent;
Service Key umgeht RLS nicht; Zeit vom letzten Durchlauf.)
```

Vor dem Schreiben prüfen: Tabelle für die REST-Route braucht Rechte für `qkern_project_api_app`; die `ALTER DEFAULT PRIVILEGES` aus Task 1 decken das, wenn der Ledger-Owner die Tabelle anlegt. Das Kopieren des Keys aus der Konsole: die Ansicht heisst `API`, der Knopf im Code `api-keys-view.tsx`; den echten Knopftext übernehmen.

- [ ] **Step 3: `ERSTES_BACKEND.md`**

Dieselben zehn Schritte, dieselben Codeblöcke (wörtlich gleich, der Vertrag prüft beide Dateien). Vor jedem Schritt ein Absatz "Warum" und nach jedem ein Absatz "Was gerade passiert ist". Zusätzlich vorweg `## Was ein Backend ist` (Frontend, Backend, Datenbank, API in je zwei Sätzen mit Glossar-Links) und am Ende `## Wie es weitergeht` (Auth, Storage, Realtime, jeweils Verweis ins Handbuch mit Abschnittsnummer).

- [ ] **Step 4: `FUER_GRUENDER.md`**

```markdown
# Für Gründer

## Was QKERN für dein Produkt bedeutet
## Was man damit bauen lassen kann
(drei Beispiele: Buchungsapp, Mitgliederbereich, interne Verwaltung)
## Was es kostet
(Software Apache 2.0, kostenlos; Kosten sind Hosting und Entwicklerzeit;
kein QKERN-Hosting-Angebot heute)
## Wo die Daten liegen
(dort, wo du QKERN betreibst; keine Schweiz-Aussage ohne Nachweis)
## Was "zertifiziert" hier heisst
({{postgresCases}} Fälle gegen echte PostgreSQL 17, {{stackCount}}
Prüfstände, Protokolle im Repository; was das nicht heisst: keine
Zertifizierung durch Dritte)
## Fragen an deinen Entwickler
(sieben Fragen als Liste, z. B. "Ist Row Level Security auf jeder Tabelle
an?", "Wer darf Production freigeben?")
## Ehrlich offen
```

- [ ] **Step 5: Parser gegen die Texte laufen lassen**

Run: `npx vitest run tests/docs-guide-contract.test.ts`
Expected: bestanden. Jede Syntaxmeldung nennt die Zeile; Text anpassen, nicht den Parser.

- [ ] **Step 6: Commit**

```bash
git add docs/guide/de
git commit -m "docs: Was ist QKERN, Schnellstart, Erstes Backend, Fuer Gruender

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Glossar

**Files:**
- Modify: `docs/guide/de/GLOSSAR.md`

- [ ] **Step 1: Format je Eintrag**

```markdown
## Row Level Security

- **Was es ist:** Eine Regel direkt in der Datenbank, die je Zeile entscheidet, wer sie sehen oder ändern darf.
- **In QKERN:** Pflicht für jede Tabelle, die die Data API freigibt; die Konsole zeigt die Regeln unter Datenbank, Policies.
- **Bei Supabase:** Row Level Security, gleicher Name.
```

Überschrift Ebene 2, dann genau drei Listenpunkte mit den drei fetten Vorspännen `Was es ist:`, `In QKERN:`, `Bei Supabase:`. Ohne Gegenstück: `Kein Gegenstück.` Alphabetisch nach Überschrift, Umlaute wie Grundbuchstaben.

- [ ] **Step 2: Begriffe**

QKERN-eigene: AI Bridge, Anon Key (Verweis auf Public Key), Control Plane, Data Plane, Evidenz, Freigabezentrale, MCP, Memory Mode, Modul, Production Apply, Projekt-Key, Public Key, Q-Orbit, Runtime Mode, Service Key, Stufenplan, Umgebung, Zertifizierung, Zertifizierungsstack.

Allgemein: API, API-Key, Apache 2.0, Audit-Log, Auth, Backend, Backup, Bucket, CLI, Compose, Container, Cron, Datenbank, Docker, Endpunkt, Erweiterung, Fremdschlüssel, Frontend, Funktion (Datenbank), HTTP-Methode, Image, Index, Job, JSON, JWT, Mandant, Migration, Mutationstest, Node.js, npm, OAuth, Objekt, Open Source, Passwort-Hash, Point-in-time Recovery, Policy, Port, PostgreSQL, Primärschlüssel, Provider, Publikation, Queue, Rate Limit, Realtime, Refresh Token, REST, Rolle, Row Level Security, Schema, SDK, Session, Signierte URL, Spalte, SQL, Storage, Tabelle, TLS, Token, Trigger, Umgebungsvariable, Volume, WAL, Webhook, WebSocket, Worker, Zeile, Zertifikat.

Nur bei Supabase: Edge Functions, GoTrue, PostgREST, Service Role Key, Studio, supabase-js.

- [ ] **Step 3: Vertrag laufen lassen** (Task 10 liefert die Glossarprüfung; bis dahin nur Parser):

Run: `npx vitest run tests/docs-guide-contract.test.ts`

- [ ] **Step 4: Commit**

```bash
git add docs/guide/de/GLOSSAR.md
git commit -m "docs: Glossar mit QKERN-, Backend- und Supabase-Begriffen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Die drei Vertragstests vervollständigen

**Files:**
- Modify: `tests/docs-guide-contract.test.ts`
- Create: `tests/docs-quickstart-contract.test.ts`
- Create: `tests/docs-founder-numbers-contract.test.ts`

- [ ] **Step 1: Guide-Vertrag: Links, Glossar, Sprache**

```ts
import { readFile } from "node:fs/promises";
import { parseGuide, plain, type Block } from "@/lib/docs/markdown";

const BANNED = ["nahtlos", "robust", "leistungsstark", "revolutionär", "tauchen wir ein", "es ist wichtig zu beachten", "in der heutigen zeit", "spielt eine entscheidende rolle", "zusammenfassend", "—", "–"];

function walk(blocks: Block[], visit: (text: string, inlines: import("@/lib/docs/markdown").Inline[]) => void) {
  for (const block of blocks) {
    if (block.kind === "code") continue;
    if (block.kind === "table") { for (const cell of [...block.header, ...block.rows.flat()]) visit(plain(cell), cell); continue; }
    if (block.kind === "list" || block.kind === "ordered") { for (const item of block.items) visit(plain(item), item); continue; }
    visit(plain(block.text), block.text);
  }
}

  it("links only to existing pages, anchors and glossary entries", async () => {
    const docs = new Map<string, ReturnType<typeof parseGuide>>();
    for (const page of GUIDE_PAGES) docs.set(page.file, parseGuide(await readFile(guidePath("de", page), "utf8")));
    const anchors = new Map([...docs].map(([file, doc]) => [file, new Set(doc.headings.map((h) => h.id))]));
    for (const [file, doc] of docs) {
      walk(doc.blocks, (_, inlines) => {
        for (const inline of inlines) {
          if (inline.kind !== "link") continue;
          if (/^https?:\/\//.test(inline.href)) return;
          const [target, hash] = inline.href.split("#");
          const targetFile = target === "" ? file : target;
          expect(docs.has(targetFile), `${file}: Link auf ${inline.href} zeigt ins Leere`).toBe(true);
          if (hash) expect(anchors.get(targetFile)?.has(hash), `${file}: Anker ${inline.href} gibt es nicht`).toBe(true);
        }
      });
    }
  });

  it("gives every glossary entry exactly three lines with the three lead-ins", async () => {
    const doc = parseGuide(await readFile(guidePath("de", pageBySlug("glossar")!), "utf8"));
    const entries = doc.blocks.filter((b) => b.kind === "heading" && b.level === 2);
    expect(entries.length).toBeGreaterThanOrEqual(80);
    const titles = entries.map((b) => (b.kind === "heading" ? plain(b.text) : ""));
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    expect(titles).toEqual([...titles].sort(collator.compare));
    for (let i = 0; i < doc.blocks.length; i += 1) {
      const block = doc.blocks[i];
      if (block.kind !== "heading" || block.level !== 2) continue;
      const list = doc.blocks[i + 1];
      expect(list?.kind, `${plain(block.text)}: nach der Ueberschrift muss die Liste kommen`).toBe("list");
      if (list?.kind !== "list") continue;
      expect(list.items.length, `${plain(block.text)}: genau drei Zeilen`).toBe(3);
      expect(list.items.map((item) => item[0]?.kind === "strong" ? item[0].text : "")).toEqual(["Was es ist:", "In QKERN:", "Bei Supabase:"]);
    }
  });

  it("reads like a person wrote it", async () => {
    for (const page of GUIDE_PAGES) {
      const doc = parseGuide(await readFile(guidePath("de", page), "utf8"));
      walk(doc.blocks, (text) => {
        const lower = text.toLowerCase();
        for (const word of BANNED) expect(lower, `${page.file}: "${word}" in "${text.slice(0, 60)}"`).not.toContain(word);
      });
    }
  });
```

- [ ] **Step 2: Schnellstart-Vertrag**

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuide } from "@/lib/docs/markdown";
import { guidePath, pageBySlug } from "@/lib/docs/pages";
import { USAGE } from "../cli/src/commands";
import { openApiDocument } from "@/lib/openapi";

/**
 * Jedes Kommando im Schnellstart existiert wirklich. Ein Leser, der einen
 * Befehl abtippt, den es nicht gibt, verliert das Vertrauen an Schritt 3.
 */
describe("docs quickstart contract", () => {
  async function codeBlocks(slug: string) {
    const doc = parseGuide(await readFile(guidePath("de", pageBySlug(slug)!), "utf8"));
    return doc.blocks.flatMap((b) => (b.kind === "code" ? [b] : []));
  }

  it("uses the same commands in Schnellstart and Erstes Backend", async () => {
    const a = (await codeBlocks("schnellstart")).map((b) => b.code);
    const b = (await codeBlocks("erstes-backend")).map((b) => b.code);
    expect(b).toEqual(a);
  });

  it("names only npm scripts, files, CLI commands and API paths that exist", async () => {
    const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    const cli = new Set([...USAGE.matchAll(/^\s{2}(\w+(?: \w+)?)/gm)].map((m) => m[1]));
    const apiPaths = Object.keys(openApiDocument.paths);
    for (const block of await codeBlocks("schnellstart")) {
      for (const m of block.code.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts, `npm run ${m[1]} gibt es nicht`).toHaveProperty(m[1]);
      for (const m of block.code.matchAll(/npm run qkern -- (\w+(?: \w+)?)/g)) expect(cli.has(m[1]), `CLI-Befehl ${m[1]} gibt es nicht`).toBe(true);
      for (const m of block.code.matchAll(/(?:Copy-Item|cat|cp) ([\w./-]+)/g)) expect(existsSync(path.resolve(process.cwd(), m[1])), `${m[1]} fehlt`).toBe(true);
      for (const m of block.code.matchAll(/\/api(\/v1\/projects\/<projekt-id>\/environments\/development\/tables\/\w+\/rows)/g)) {
        const generic = m[1].replace("<projekt-id>", "{projectId}").replace("/development/", "/{environment}/").replace(/\/tables\/\w+\//, "/tables/{table}/");
        expect(apiPaths, `${generic} steht nicht in der OpenAPI`).toContain(generic);
      }
    }
  });

  it("keeps versions as placeholders", async () => {
    const raw = await readFile(guidePath("de", pageBySlug("schnellstart")!), "utf8");
    expect(raw).toContain("{{node}}");
    expect(raw).not.toMatch(/Node\.js \d/);
    expect(raw).not.toMatch(/\b2\.\d\d\.\d\b/);
  });
});
```

`openApiDocument` heisst in `lib/openapi.ts` vielleicht anders; den exportierten Namen mit `grep -n "^export" lib/openapi.ts` nachsehen und einsetzen.

- [ ] **Step 3: Gründer-Zahlen-Vertrag**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { guidePath, pageBySlug } from "@/lib/docs/pages";

/** Die Gruenderseite nennt keine Zahl, die nicht aus einem Platzhalter kommt. */
describe("docs founder numbers contract", () => {
  it("has no literal count in the founder page", async () => {
    const raw = await readFile(guidePath("de", pageBySlug("gruender")!), "utf8");
    const withoutCode = raw.replace(/```[\s\S]*?```/g, "");
    expect(withoutCode).toContain("{{postgresCases}}");
    expect(withoutCode).toContain("{{stackCount}}");
    expect(withoutCode).not.toMatch(/\b\d{2,} (Fälle|Tests|Prüfstände|Module)\b/);
  });
});
```

- [ ] **Step 4: Alle Doku-Tests laufen lassen**

Run: `npx vitest run tests/docs-`
Expected: alle bestanden. Rote Fälle sind Textfehler; den Text ändern.

- [ ] **Step 5: Commit**

```bash
git add tests/docs-guide-contract.test.ts tests/docs-quickstart-contract.test.ts tests/docs-founder-numbers-contract.test.ts docs/guide/de
git commit -m "docs: Vertraege fuer Links, Glossar, Kommandos und Zahlen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Den Schnellstart wirklich durchlaufen

**Files:**
- Create: `docs/evidence/2026-09-25/quickstart-walkthrough.log`
- Create: `docs/evidence/2026-09-25/quickstart-walkthrough.manifest.json`
- Modify: `docs/guide/de/SCHNELLSTART.md` (gemessene Zeit im Zitatblock oben und unter "Ehrlich offen")

- [ ] **Step 1: Frischer Ordner, eigener Compose-Projektname**

Damit Denzils Volumes bleiben: Quellordner in den Scratchpad kopieren (ohne `node_modules`, `.next`, `.git`), dort `docker compose -p qkern-schnellstart up -d` mit Port 5433 statt 5432 (Override-Datei im Scratchpad, nicht im Repo) und `PORT=3100 npm run dev`. Stoppuhr: `Get-Date` vor Schritt 1 und nach Schritt 10.

- [ ] **Step 2: Jeden Schritt exakt wie geschrieben ausführen**, Ausgaben in `quickstart-walkthrough.log` mitschreiben. Registrierung und Key-Erzeugung macht Denzil oder werden mit dem in `.env.example` beschriebenen Weg umgangen; wenn ein Klickweg anders heisst als im Text, den Text ändern.

- [ ] **Step 3: Manifest**

```json
{
  "stack": "Schnellstart-Durchlauf (Windows, Docker Desktop)",
  "log": "quickstart-walkthrough.log",
  "commit": "<HEAD>",
  "commitSubject": "<subject>",
  "workingTreeClean": false,
  "exitCode": 0,
  "steps": 10,
  "minutes": <gemessen>,
  "images": ["postgres:17-alpine", "redis:8-alpine", "versity/versitygw:v1.8.0", "clamav/clamav:1.4.5"]
}
```

- [ ] **Step 4: Zeit in den Text**, Stack `qkern-schnellstart` mit `docker compose -p qkern-schnellstart down -v` abräumen.

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/2026-09-25/quickstart-walkthrough.log docs/evidence/2026-09-25/quickstart-walkthrough.manifest.json docs/guide/de/SCHNELLSTART.md docs/guide/de/ERSTES_BACKEND.md
git commit -m "docs: Schnellstart einmal komplett durchlaufen, Zeit gemessen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Bestehende Dokumente anschliessen

**Files:**
- Modify: `docs/HANDBUCH.md:1-3`
- Modify: `docs/INDEX.md:1-5`
- Modify: `docs/DOCS_MAINTENANCE.md` (neuer Abschnitt am Ende)
- Modify: `sdk/typescript/README.md:3-6`

- [ ] **Step 1: Handbuch-Verweis** unter der ersten Zeile:

```markdown
> Neu hier? Beginne mit [Was ist QKERN](guide/de/WAS_IST_QKERN.md). Dieses
> Handbuch ist die Fassung für Fortgeschrittene.
```

- [ ] **Step 2: INDEX-Block** vor der bestehenden Tabelle:

```markdown
## Einstieg

| Seite | Für wen |
| --- | --- |
| [Was ist QKERN](guide/de/WAS_IST_QKERN.md) | alle |
| [Schnellstart](guide/de/SCHNELLSTART.md) | Entwickler, die Supabase kennen |
| [Erstes Backend](guide/de/ERSTES_BACKEND.md) | Entwickler, die ihr erstes Backend bauen |
| [Für Gründer](guide/de/FUER_GRUENDER.md) | Gründer ohne Entwicklerhintergrund |
| [Glossar](guide/de/GLOSSAR.md) | alle |

## Referenz
```

- [ ] **Step 3: Pflegeabschnitt** in `DOCS_MAINTENANCE.md`:

```markdown
## Einstiegsdoku bei jedem Release prüfen

Die fünf Seiten unter `docs/guide/de/` gehören zum Release-Doc-Sweep:

1. `npx vitest run tests/docs-` muss grün sein; rote Fälle sind Textfehler.
2. Kommt ein Kommando, ein Klickweg oder ein Begriff dazu, den der Schnellstart
   berührt, wird der Text geändert und der Durchlauf wiederholt (Manifest
   `quickstart-walkthrough.manifest.json` mit neuem Commit).
3. Neue Fachbegriffe in Code oder Konsole bekommen einen Glossareintrag mit
   den drei Zeilen.
4. Zahlen kommen aus Platzhaltern (`lib/docs/placeholders.ts`), nie aus dem Text.
```

- [ ] **Step 4: SDK-README** korrigieren: `@qkern/sdk` ist seit 2.17 auf npm (`npm install @qkern/sdk@alpha`), Apache 2.0; den Satz "This Alpha package is private and is not published" ersetzen.

- [ ] **Step 5: Vertragstests**

Run: `npx vitest run tests/documentation-contract.test.ts tests/docs-`
Expected: bestanden.

- [ ] **Step 6: Commit**

```bash
git add docs/HANDBUCH.md docs/INDEX.md docs/DOCS_MAINTENANCE.md sdk/typescript/README.md
git commit -m "docs: Handbuch, Index, Pflege und SDK-README an die Einstiegsdoku angeschlossen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Release 2.30 "Drei Türen"

Nach dem Muster der bisherigen Releases (Skript im Scratchpad mit `sub()`/`append()`, siehe `docs-228.py` aus der Sitzung).

**Files:**
- Modify: `STATUS.md`, `package.json`, `docs/HANDBUCH.md`, `docs/INDEX.md`, `docs/CLAUDE_HANDOFF.md`, `docs/QA.md`, `docs/evidence/README.md`
- Create: `docs/RELEASE_2.30.md`

- [ ] **Step 1: Lokale Suite zweimal**

```powershell
npx vitest run 2>&1 | Tee-Object "$env:SC\local-2.30-run1.log"
npx vitest run 2>&1 | Tee-Object "$env:SC\local-2.30-run2.log"
npm run build
```

Expected: beide Läufe gleiche Zahl bestanden, 0 fehlgeschlagen; Build grün. Zahl aus dem Log lesen, nicht raten.

- [ ] **Step 2: Mutation**

`GLOSSAR.md`: einen Eintrag auf zwei Zeilen kürzen. `npx vitest run tests/docs-guide-contract.test.ts` muss genau einen Fall rot zeigen. Datei mit `cp` aus der Scratchpad-Kopie zurück, nie mit `git checkout`.

- [ ] **Step 3: Doc-Sweep-Skript** (`docs-230.py` im Scratchpad, Write-Tool): Version `2.30.0` in `package.json`, `STATUS.md` Release-Zeile, Handbuch-Version, INDEX-Tabelle (RELEASE_2.30 oben, 2.29 wird "Backup und Restore lokal" oder wie 2.29 heisst), CLAUDE_HANDOFF "Aktueller Slice: 2.30 Drei Türen", QA-Abschnitt mit Checkpoint-Zahlen, evidence README mit Zeile für `quickstart-walkthrough.log`, `RELEASE_2.30.md` mit Abschnitten "Was neu ist", "Belege", "Ehrlich offen" (Übersetzungen fehlen; Bindung per Skript; Tabelle per SQL; Repo privat, Quellordner kommt als Zip).

- [ ] **Step 4: Commit und Push**

```bash
git add -A
git commit -m "release: 2.30.0 Drei Tueren

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
gh run list --limit 3
```

Beide Workflows (`certification`, `developer-experience`) abwarten und grün lesen.

---

## Selbstprüfung gegen den Spec

- Fünf Dateien unter `docs/guide/de/`: Task 3, 8, 9.
- Glossar drei Zeilen, drei Sorten, Supabase-Gegenstücke, alphabetisch: Task 9, geprüft in Task 10.
- Route `/docs` mit fünf Pfaden, statisch, Parser mit Fehler je Zeile, Seitenleiste, Handy, Dunkelmodus, "Übersetzung folgt": Task 4, 5, 6.
- Links Konsole, Kopfmenü, Fusszeile in vier Sprachen: Task 7.
- Drei Vertragstests inklusive Sperrliste und Platzhalter: Task 10, Platzhalter Task 5.
- Schnellstart-Durchlauf mit Log und Manifest: Task 11.
- HANDBUCH-Verweis, INDEX-Block, DOCS_MAINTENANCE: Task 12.
- Reihenfolge Schritt 1 (dieser Plan), Schritt 2 Übersetzungen und Schritt 3 Pflege: Schritt 3 ist in Task 12 vorgezogen, weil er klein ist; Schritt 2 bekommt einen eigenen Plan nach der Abnahme.
- Nicht im Spec, aber nötig, damit der Schnellstart wahr ist: Task 1 und 2 (lokale Projektdatenbank, Bindungsskript). Sie sind im Spec unter "Ehrlich offen" der Seiten vorgesehen und werden in `RELEASE_2.30.md` genannt.
