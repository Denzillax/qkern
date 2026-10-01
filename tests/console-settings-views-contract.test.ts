import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, NAV_ENTRIES, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  BINDING_FIELDS,
  ORDER_FIELDS,
  PROVISIONING_ERROR_TEXTS,
  PROVISIONING_JOB_STATE_TEXTS,
  PROVISIONING_ORDER_STATES,
  PROVISIONING_ORDER_TEXTS,
} from "@/lib/console/provisioning-order-texts";
import {
  INTEGRATIONS_INVISIBLE,
  INTEGRATIONS_MISSING,
  INTEGRATIONS_TEXTS,
  INTEGRATION_SERVICES,
  INTEGRATION_SERVICE_IDS,
} from "@/lib/console/integrations-services-texts";
import { ADDONS_TEXTS, INVOICE_SHAPE } from "@/lib/console/addons-texts";
import { USAGE_SERIES_METRIC_IDS } from "@/lib/console/usage-series-texts";

/**
 * Die drei letzten Platzhalter der Einstellungen aus 2.88 am Quelltext
 * geprueft.
 *
 * Gleiche Bauart wie `console-missing-log-views-contract` (2.84), und aus
 * demselben Grund: Der Vertrag prueft nicht bloss, dass die Saetze dastehen,
 * sondern dass sie **stimmen**. Er liest die Stellen im Backend, ueber die
 * die Seiten eine Aussage machen, und faellt, sobald eine Aussage nicht mehr
 * zur Lage passt. Eine Groessenspalte in der Provisionierung, ein siebtes
 * Feld im Schluesselsatz der Bindung, ein Modul, das mit GitHub spricht, eine
 * siebte abrechenbare Metrik oder ein Leserecht der Web-Laufzeit auf die
 * Bindungen laesst hier einen Fall scheitern, statt eine Seite
 * stillschweigend zur Luege zu machen.
 *
 * Der Fall gegen die echte Datenbank ist `(2.88)` in
 * `tests/postgres.integration.test.ts`. Er belegt die eine neue Lesung dieses
 * Schnitts, den Zustand des Provisionierungsauftrags, unter der
 * Zeilensicherheit und mit einem Nachbarmandanten. Die uebrigen Lesungen der
 * drei Seiten kommen aus Routen, die es schon gibt und die schon belegt sind.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

async function exists(file: string) {
  try { await stat(path.resolve(process.cwd(), file)); return true; } catch { return false; }
}

/**
 * Dieselbe Datei ohne ihre Kommentare.
 *
 * Die Ansichten erklaeren in ihrem Kopf, warum es keine Groesse und keine
 * Deploy-Plattform gibt. Eine Zusicherung „kommt nicht vor" muss diese
 * Erklaerung meinen duerfen, ohne an ihr zu scheitern.
 */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const COMPUTE_VIEW = "components/console/provisioning-order-view.tsx";
const INTEGRATIONS_VIEW = "components/console/integrations-services-view.tsx";
const ADDONS_VIEW = "components/console/addons-view.tsx";
const VIEWS = [COMPUTE_VIEW, INTEGRATIONS_VIEW, ADDONS_VIEW] as const;
const TEXTS = [
  "lib/console/provisioning-order-texts.ts",
  "lib/console/integrations-services-texts.ts",
  "lib/console/addons-texts.ts",
] as const;

const PROVISIONING_MIGRATION = "db/migrations/0020_project_database_provisioning.sql";

describe("console settings views contract", () => {
  it("makes all three pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["set-compute", "set-integrations", "set-addons"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
      // Genau einmal in der Navigation, nicht null- und nicht zweimal.
      expect(NAV_ENTRIES.filter((entry) => entry.id === id)).toHaveLength(1);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "set-compute": return <ProvisioningOrderView');
    expect(app).toContain('case "set-integrations": return <IntegrationsServicesView');
    expect(app).toContain('case "set-addons": return <AddonsView');
    // Die alten Versprechen stehen nirgends mehr.
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "Grösse der Instanz und der Platte. Die Provisionierung ist noch nicht verbunden.",
      "Verknüpfte Dienste wie Git-Hosting oder Deploy-Plattformen.",
      "Zusatzleistungen wie eigene Domain oder mehr Backups.",
    ]) {
      expect(navigation, claim).not.toContain(claim);
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][claim], `${locale}: ${claim}`).toBeUndefined();
      }
    }
    // Und die Einstellungen fuehren ueberhaupt keinen Platzhalter mehr.
    const settings = NAV_ENTRIES.filter((entry) => entry.group === "Einstellungen");
    expect(settings.length).toBeGreaterThan(8);
    for (const entry of settings) expect(isPlaceholder(entry.id as never), entry.id).toBe(false);
  });

  it("only reads and never writes", async () => {
    for (const view of VIEWS) {
      const src = await source(view);
      expect(src, view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
      expect(src, view).not.toContain("<input");
      expect(src, view).not.toContain("<form");
      // Jede Ansicht bricht eine alte Ladung ab und hat genau einen Knopf.
      expect(src, view).toContain("AbortController");
      expect(src, view).toContain("StableLabel");
      expect(src, view).toContain('tAll("Lädt…", "Neu laden")');
    }
    // Die Darstellung laeuft ueber console-display, nicht ueber Intl.
    for (const view of VIEWS) {
      const src = await source(view);
      for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
        expect(src, `${view}: ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Die Textmodule sind rein: keine Datenbank, kein React, kein fetch.
    for (const file of TEXTS) {
      const src = await source(file);
      expect(src, file).not.toContain("fetch(");
      expect(src, file).not.toContain("use client");
      expect(src, file).not.toContain("import ");
    }
  });

  it("carries no address and no secret on any of the three paths", async () => {
    for (const file of [...VIEWS, ...TEXTS]) {
      const src = await code(file);
      for (const forbidden of [
        "postgres://", "postgresql://", "connectionString", "sslmode", "5432", "localhost", "127.0.0.1",
      ]) {
        expect(src, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // ---------------------------------------------------------------- //
  // Compute und Disk: bestellt wird keine Groesse                     //
  // ---------------------------------------------------------------- //

  it("says why there is no size, and the reason matches migration 0020", async () => {
    const view = await source(COMPUTE_VIEW);
    for (const key of ["noSize", "closedShape", "scope", "orderMeaning", "bindingUnreadable"] as const) {
      expect(view, key).toContain(`PROVISIONING_ORDER_TEXTS.${key}`);
    }
    const migration = await source(PROVISIONING_MIGRATION);

    // Keine der beiden Tabellen fuehrt eine Groesse. Gelesen werden die
    // Spaltennamen der beiden CREATE TABLE, nicht der ganze Text: Ein
    // Kommentar oder ein GRANT darf das Wort enthalten.
    const table = (name: string) => {
      const start = migration.indexOf(`CREATE TABLE ${name} (`);
      expect(start, name).toBeGreaterThan(-1);
      const end = migration.indexOf("\n);", start);
      expect(end, name).toBeGreaterThan(start);
      return migration.slice(start, end);
    };
    for (const name of ["project_database_provisioning_jobs", "project_database_bindings"]) {
      const columns = [...table(name).matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|integer|bigint|timestamptz|qkern_)/gm)]
        .map((match) => match[1]);
      expect(columns.length, name).toBeGreaterThan(4);
      for (const column of columns) {
        expect(/size|cpu|memory|ram|disk|storage|plan|tier|class|instance_type/.test(column), `${name}.${column}`)
          .toBe(false);
      }
    }

    // Die Bestellung traegt genau die sechs Felder, die die Seite nennt, und
    // der Quelltext des Arbeiters fuehrt dieselben.
    const worker = await source("lib/server/provisioning/worker.ts");
    const request = worker.slice(
      worker.indexOf("export type ProjectDatabaseProvisioningRequest"),
      worker.indexOf("export type ProvisionedProjectDatabaseBinding"),
    );
    // Ziffern gehoeren dazu: `bootstrapContractSha256` faellt sonst heraus.
    const requestFields = [...request.matchAll(/^\s{2}([A-Za-z0-9]+)[?]?:/gm)].map((match) => match[1]);
    expect(requestFields).toEqual(ORDER_FIELDS.map((entry) => entry.field));

    // Und der Schluesselsatz der Antwort ist geschlossen: genau die neun
    // Namen, die die Seite als Felder einer Bindung nennt. Ein zehnter macht
    // die Antwort ungueltig, und genau das behauptet `closedShape`.
    const broker = await source("lib/server/provisioning/broker-adapter.ts");
    const expected = broker.slice(broker.indexOf("const expectedKeys = ["), broker.indexOf("].sort().join"));
    const keys = [...expected.matchAll(/"([A-Za-z0-9]+)"/g)].map((match) => match[1]);
    expect(keys.slice().sort()).toEqual(BINDING_FIELDS.map((entry) => entry.field).sort());
    expect(broker).toContain('throw new Error("Invalid binding")');
  });

  it("is right that the web runtime cannot read a binding", async () => {
    const migration = await source(PROVISIONING_MIGRATION);
    // Erst genommen, dann nie wieder erteilt: Die Web-Laufzeit hat auf beide
    // Tabellen kein Recht. Das ist die Aussage von `bindingUnreadable`.
    expect(migration).toContain(
      "REVOKE ALL ON project_database_provisioning_jobs, project_database_bindings\n  FROM PUBLIC, qkern_runtime");
    const grants = [...migration.matchAll(
      /^GRANT [^;]*ON (?:TABLE )?project_database_bindings TO (\w+);/gm)].map((match) => match[1]);
    expect(grants).not.toContain("qkern_runtime");
    // Auch keine spaetere Migration erteilt es. 0037 erteilt SELECT, aber dem
    // Provisionierer; ohne diese Pruefung waere der Satz irgendwann falsch.
    const directory = path.resolve(process.cwd(), "db/migrations");
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".sql"))) {
      const sql = await readFile(path.join(directory, name), "utf8");
      for (const match of sql.matchAll(/GRANT [^;]*ON (?:TABLE )?project_database_bindings TO ([^;]+);/g)) {
        expect(match[1], `${name}: ${match[0]}`).not.toContain("qkern_runtime");
      }
    }

    // Und die einzige Funktion, die die Laufzeit befragen darf, gibt kein
    // Feld der Bindung heraus, nicht einmal deren Kennung.
    const status = migration.slice(
      migration.indexOf("CREATE FUNCTION qkern_project_database_provisioning_status"),
      migration.indexOf("REVOKE UPDATE ON projects"),
    );
    const returned = status.slice(status.indexOf("RETURNS TABLE ("), status.indexOf(")\nLANGUAGE sql"));
    for (const field of ["binding_id", "lease_owner", "lease_token", "lease_expires_at", "requested_by"]) {
      expect(returned, field).not.toContain(field);
    }
    // Die Gegenprobe: Die Felder, auf die sich die Seite beruft, stehen darin.
    for (const field of ["job_status", "attempt_count", "max_attempts", "retry_cycle_count", "last_error_code"]) {
      expect(returned, field).toContain(field);
    }

    // Die Projektion des Dienstes gibt ebenfalls keines dieser Felder heraus.
    const services = await source("lib/server/provisioning/services.ts");
    const projection = services.slice(services.indexOf("function publicStatus("), services.indexOf("function key("));
    for (const field of ["bindingId", "leaseOwner", "leaseToken", "requestedBy", "startedAt", "finishedAt"]) {
      expect(projection, field).not.toContain(field);
    }
  });

  it("names exactly the five failure classes the migration allows", async () => {
    const migration = await source(PROVISIONING_MIGRATION);
    const check = migration.slice(
      migration.indexOf("last_error_code text CHECK"),
      migration.indexOf("binding_id uuid"),
    );
    const codes = [...check.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    expect(codes.slice().sort()).toEqual(Object.keys(PROVISIONING_ERROR_TEXTS).slice().sort());
    const view = await source(COMPUTE_VIEW);
    expect(view).toContain("PROVISIONING_ERROR_TEXTS");
    // Die vier Zustaende, und keinen fuenften.
    expect(Object.keys(PROVISIONING_JOB_STATE_TEXTS))
      .toEqual(["pending", "running", "succeeded", "failed"]);
    expect(migration).toContain(
      "AS ENUM ('pending', 'running', 'succeeded', 'failed')");
    for (const key of Object.keys(PROVISIONING_ORDER_STATES)) {
      expect(view, key).toContain(`PROVISIONING_ORDER_STATES.${key}`);
    }
  });

  it("reads the provisioning route and nothing else", async () => {
    const src = await code(COMPUTE_VIEW);
    const urls = [...src.matchAll(/`\/api\/v1\/[^`]*`/g)].map((match) => match[0]);
    expect(urls).toEqual(["`/api/v1/projects/${projectId}/environments/${environment}/provisioning`"]);
    expect(await exists("app/api/v1/projects/[projectId]/environments/[environment]/provisioning/route.ts"))
      .toBe(true);
  });

  // ---------------------------------------------------------------- //
  // Integrationen: andere Dienste als die versprochenen               //
  // ---------------------------------------------------------------- //

  it("is right that no module speaks to a git host or a deploy platform", async () => {
    const view = await source(INTEGRATIONS_VIEW);
    for (const key of ["noGitNoDeploy", "noValues", "whatConfiguredMeans"] as const) {
      expect(view, key).toContain(`INTEGRATIONS_TEXTS.${key}`);
    }
    // Nachgezaehlt statt behauptet: Kein Modul unter lib/ oder app/ nennt
    // einen dieser Anbieter. Faellt das hier, ist der Satz der Seite falsch
    // geworden und nicht dieser Vertrag.
    const forbidden = /github|gitlab|bitbucket|vercel|netlify|fly\.io|heroku|render\.com/i;
    const roots = ["lib", "app", "workers", "sdk", "cli", "mcp"];
    /**
     * Die zwei Dateien, die die Namen nennen duerfen: der Satz dieser Seite
     * selbst und seine Uebersetzungen. Sie nennen die Anbieter, um zu sagen,
     * dass es sie nicht gibt. Eine dritte Datei waere ein Befund.
     */
    const allowed = new Set(["lib/console/integrations-services-texts.ts", "lib/i18n/console.ts"]);
    const offenders: string[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(path.resolve(process.cwd(), directory), { withFileTypes: true })) {
        const next = `${directory}/${entry.name}`;
        if (entry.isDirectory()) { await walk(next); continue; }
        if (!/\.(ts|tsx|mts)$/.test(entry.name) || allowed.has(next)) continue;
        // Kommentare duerfen die Namen nennen: Diese Seite tut es selbst.
        const body = await code(next);
        if (forbidden.test(body)) offenders.push(next);
      }
    };
    for (const root of roots) await walk(root);
    expect(offenders, "ein Modul spricht doch mit einem dieser Anbieter").toEqual([]);
    // Und die Ausnahmeliste bleibt ehrlich: Beide Dateien nennen die Namen
    // wirklich, sonst stuende hier eine Ausnahme fuer nichts.
    for (const file of allowed) expect(forbidden.test(await source(file)), file).toBe(true);
  });

  it("shows seven services, each with a source that exists", async () => {
    expect(INTEGRATION_SERVICE_IDS).toHaveLength(7);
    expect(Object.keys(INTEGRATION_SERVICES).slice().sort())
      .toEqual([...INTEGRATION_SERVICE_IDS].slice().sort());
    for (const id of INTEGRATION_SERVICE_IDS) {
      const service = INTEGRATION_SERVICES[id];
      // Jeder Dienst sagt, wofuer er da ist, woher QKERN es weiss und was die
      // Auskunft nicht sagt. Keine leere Kachel, kein leerer Satz.
      for (const [name, text] of Object.entries(service)) {
        expect(text.length, `${id}.${name}`).toBeGreaterThan(name === "label" || name === "managedAt" ? 5 : 80);
      }
    }
    const src = await code(INTEGRATIONS_VIEW);
    // Genau die sechs Routen, die die Seite nennt, und jede gibt es.
    const urls = [...src.matchAll(/\$\{base\}(\/[a-z/-]+)`/g)].map((match) => match[1]);
    expect(urls.slice().sort()).toEqual([
      "/advisors/health", "/auth/admin/mail", "/auth/admin/providers",
      "/auth/admin/third-party", "/compute/log-drains", "/compute/webhooks",
    ]);
    for (const url of urls) {
      expect(
        await exists(`app/api/v1/projects/[projectId]/environments/[environment]${url}/route.ts`),
        url,
      ).toBe(true);
    }
  });

  it("reads only a mode and counts, never a value", async () => {
    const src = await code(INTEGRATIONS_VIEW);
    // Aus der Mail-Auskunft nur die Betriebsart. Host, Absender, Port und
    // Benutzername tragen Werte und kommen in dieser Ansicht nicht vor.
    for (const field of ["host", "sender", "port", "username", "actionBaseUrl"]) {
      expect(src, `mail.${field}`).not.toContain(`mailData?.${field}`);
    }
    // Aus den drei Listen nur die Laenge. Ein Name eines Anbieters oder einer
    // Adresse waere hier ein Wert, und Werte zeigt diese Seite nicht.
    for (const field of ["issuer", "jwksUri", "url", "signingSecretRef", "clientId", "name"]) {
      expect(src, field).not.toContain(`.${field}`);
    }
    expect(src).toContain("fromCount");
    // Die drei Dienste ohne Auskunft stehen mit Grund da, nicht als Kachel.
    expect(INTEGRATIONS_INVISIBLE).toHaveLength(3);
    for (const note of INTEGRATIONS_INVISIBLE) expect(note.body.length, note.title).toBeGreaterThan(120);
    expect(INTEGRATIONS_MISSING).toHaveLength(3);
    for (const note of INTEGRATIONS_MISSING) expect(note.body.length, note.title).toBeGreaterThan(120);
  });

  // ---------------------------------------------------------------- //
  // Add-ons: was extra kosten kann, und wer es festlegt               //
  // ---------------------------------------------------------------- //

  it("is right that the measured catalogue is still closed at six metrics", async () => {
    const view = await source(ADDONS_VIEW);
    for (const key of ["addons", "noSelfService", "closedList", "scope", "catalogMeaning"] as const) {
      expect(view, key).toContain(`ADDONS_TEXTS.${key}`);
    }
    expect(USAGE_SERIES_METRIC_IDS).toHaveLength(6);
    const metrics = [...USAGE_SERIES_METRIC_IDS].slice().sort();

    // Dieselben sechs an den Stellen, die die Seite nennt. Eine siebte
    // Kennung an einer davon macht den Satz `closedList` falsch.
    const rateCards = await source("db/migrations/0039_billing_rate_cards.sql");
    const invoices = await source("db/migrations/0040_billing_invoices.sql");
    for (const [name, sql] of [["0039", rateCards], ["0040", invoices]] as const) {
      const check = sql.slice(sql.indexOf("metric text"), sql.indexOf("metric text") + 400);
      const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
      expect(listed.slice().sort(), name).toEqual(metrics);
    }
    const model = await source("lib/server/usage/model.ts");
    const definitions = model.slice(
      model.indexOf("USAGE_METRIC_DEFINITIONS"), model.indexOf("USAGE_METRIC_DEFINITIONS") + 900);
    const defined = [...definitions.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((match) => match[1]);
    expect(defined.slice().sort()).toEqual(metrics);
  });

  it("is right that a position now has a label, a stable key and no entered amount", async () => {
    const positions = await source("db/migrations/0080_billing_invoice_positions.sql");

    // Die Bezeichnung und der stabile Schluessel: Das ist der Satz, mit dem
    // die Seite seit 0080 etwas anderes behauptet als in 2.62.
    expect(positions).toContain("ADD COLUMN line_key text");
    expect(positions).toContain("ADD COLUMN label text");
    expect(positions).toContain("UNIQUE (invoice_id, line_key)");
    // Und die alte Eindeutigkeit je Metrik ist weg, sonst waere eine Rechnung
    // weiterhin auf sechs Zeilen begrenzt.
    expect(positions).toContain("DROP CONSTRAINT billing_invoice_lines_invoice_id_metric_key");

    // Der Betrag bleibt gerechnet. `quantity` ist weiterhin NOT NULL, also
    // gibt es keine Position ohne Menge und damit keinen eingetragenen Betrag:
    // Das ist der Satz „Kein Betrag, der nicht gerechnet ist".
    const invoices = await source("db/migrations/0040_billing_invoices.sql");
    expect(invoices).toContain("quantity bigint NOT NULL");
    expect(positions).not.toMatch(/ALTER COLUMN quantity DROP NOT NULL/);
    // Und kein Feld fuer freien Zusatztext neben der Bezeichnung.
    for (const column of ["description", "note", "comment"]) {
      expect(positions, column).not.toContain(`ADD COLUMN ${column}`);
    }

    // Die Idempotenz des Laufs haengt weiterhin an der Rechnung, nicht an der
    // Position: Das ist der Satz „Zweimal derselbe Lauf, einmal dieselbe
    // Rechnung", und 0080 laesst sie unberuehrt.
    expect(invoices).toContain("UNIQUE (organization_id, project_id, environment, period_start)");
    expect(positions).not.toContain("billing_invoices_organization_id_project_id");

    expect(INVOICE_SHAPE).toHaveLength(6);

    // Weder im Preisblatt noch im Pauschalenblatt laesst sich eine Zeile
    // aendern oder loeschen: Es gibt keine Politik dafuer. Das ist der Satz
    // `whoSetsHistory`.
    const rateCards = await source("db/migrations/0039_billing_rate_cards.sql");
    const rateCardPolicies = [...rateCards.matchAll(/CREATE POLICY \w+ ON billing_rate_cards\s+FOR (\w+)/g)]
      .map((match) => match[1]);
    expect(rateCardPolicies.slice().sort()).toEqual(["INSERT", "SELECT"]);
    const chargePolicies = [...positions.matchAll(/CREATE POLICY \w+ ON billing_charges\s+FOR (\w+)/g)]
      .map((match) => match[1]);
    expect(chargePolicies.slice().sort()).toEqual(["INSERT", "SELECT"]);
    // Eine Pauschale haengt an einer echten Umgebung — der eigene Weg, sie
    // einem Projekt zuzuordnen, den 2.62 vermisst hat.
    expect(positions).toContain("REFERENCES project_environments (organization_id, project_id, environment)");

    // Und es gibt keine Zahlungsanbindung. Ein Modul dafuer waere hier zu
    // sehen, bevor der Satz der Seite still falsch wird.
    for (const name of ["stripe", "paypal", "adyen", "braintree"]) {
      const packageJson = await source("package.json");
      expect(packageJson.toLowerCase(), name).not.toContain(name);
    }
  });

  it("reads the billing route and nothing else", async () => {
    const src = await code(ADDONS_VIEW);
    const urls = [...src.matchAll(/`\/api\/v1\/[^`]*`/g)].map((match) => match[0]);
    expect(urls).toEqual(["`/api/v1/projects/${projectId}/environments/${environment}/usage/billing`"]);
    // Geld laeuft ueber das Ledgerformat, nicht ueber eine eigene Rechnung.
    expect(src).toContain('from "@/lib/console/money"');
    expect(src).not.toMatch(/CHF|EUR|USD/);
  });
});
