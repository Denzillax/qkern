import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";

/**
 * Trigger-Liste gegen echtes PostgreSQL (2.9).
 *
 * Die Abfrage decodiert die Bits in `pg_trigger.tgtype` und liest die
 * WHEN-Bedingung aus `pg_get_triggerdef`. Beides laesst sich nur gegen einen
 * echten Server belegen: ein Trigger mit drei Ereignissen, einer mit
 * INSTEAD OF auf einem View, einer mit Bedingung, einer abgeschaltet — und ein
 * Fremdschluessel, dessen interner Trigger nicht erscheinen darf.
 */
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("Data-plane trigger inspection PostgreSQL certification", () => {
  const schema = `triggers_${randomUUID().replaceAll("-", "_")}`;
  const scope = { projectId: "certification-project", environment: "development" as const };
  const context = { organizationId: randomUUID(), actorRef: "console@qkern.test" };

  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: ProjectDataPlaneService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TABLE "${schema}".accounts (id integer PRIMARY KEY, name text NOT NULL, updated_at timestamptz)`);
    await owner.query(`CREATE TABLE "${schema}".orders (id integer PRIMARY KEY, account_id integer NOT NULL REFERENCES "${schema}".accounts (id), total integer NOT NULL)`);
    await owner.query(`CREATE VIEW "${schema}".order_totals AS SELECT id, total FROM "${schema}".orders`);
    await owner.query(`CREATE FUNCTION "${schema}".touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$`);
    await owner.query(`CREATE FUNCTION "${schema}".audit_statement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await owner.query(`CREATE FUNCTION "${schema}".redirect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
    await owner.query(`CREATE TRIGGER accounts_touch BEFORE INSERT OR UPDATE OR DELETE ON "${schema}".accounts FOR EACH ROW EXECUTE FUNCTION "${schema}".touch()`);
    await owner.query(`CREATE TRIGGER accounts_audit AFTER TRUNCATE ON "${schema}".accounts FOR EACH STATEMENT EXECUTE FUNCTION "${schema}".audit_statement()`);
    await owner.query(`CREATE TRIGGER orders_big AFTER UPDATE ON "${schema}".orders FOR EACH ROW WHEN (NEW.total > 100) EXECUTE FUNCTION "${schema}".audit_statement()`);
    await owner.query(`ALTER TABLE "${schema}".orders DISABLE TRIGGER orders_big`);
    await owner.query(`CREATE TRIGGER order_totals_redirect INSTEAD OF INSERT ON "${schema}".order_totals FOR EACH ROW EXECUTE FUNCTION "${schema}".redirect()`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    service = new ProjectDataPlaneService(
      { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
      { resolve: async () => ({
        pool: projectApi,
        expectedRole: "qkern_project_api_app",
        expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
        expectedLedgerOwner: "qkern",
      }) },
    );
  });

  afterAll(async () => {
    if (owner) await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([owner?.end(), projectApi?.end()]);
  });

  it("lists user triggers with timing, events, orientation, state and condition, and hides internal ones", async () => {
    const result = await service.inspectTriggers(context, scope, schema);
    expect(result.source).toBe("postgres");
    expect(result.truncated).toBe(false);
    const byName = Object.fromEntries(result.triggers.map((trigger) => [trigger.name, trigger]));
    expect(Object.keys(byName).sort()).toEqual(["accounts_audit", "accounts_touch", "order_totals_redirect", "orders_big"]);

    expect(byName.accounts_touch).toMatchObject({
      table: "accounts", timing: "before", events: ["insert", "update", "delete"], orientation: "row",
      enabled: "origin", functionSchema: schema, functionName: "touch", condition: null,
    });
    expect(byName.accounts_audit).toMatchObject({ timing: "after", events: ["truncate"], orientation: "statement" });
    expect(byName.orders_big).toMatchObject({ table: "orders", timing: "after", events: ["update"], enabled: "disabled" });
    expect(byName.orders_big.condition).toContain("total > 100");
    expect(byName.order_totals_redirect).toMatchObject({ table: "order_totals", timing: "instead_of", events: ["insert"] });
    // Der Fremdschluessel orders -> accounts legt interne Trigger an (RI_ConstraintTrigger_*).
    expect(result.triggers.some((trigger) => trigger.name.startsWith("RI_"))).toBe(false);
  });
});
