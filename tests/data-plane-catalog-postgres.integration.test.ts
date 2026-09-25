import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";

/**
 * Indizes, Policies und Enum-Typen gegen echtes PostgreSQL (2.19).
 *
 * Wie der Server Spalten aus `indkey`, Ausdrucksindizes, partielle Indizes,
 * PUBLIC in `polroles`, USING und WITH CHECK und die Sortierung von
 * Enum-Werten (auch nach `ADD VALUE ... BEFORE`) darstellt, laesst sich nur
 * gegen ihn belegen.
 */
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("Data-plane catalog views PostgreSQL certification", () => {
  const schema = `catalog_${randomUUID().replaceAll("-", "_")}`;
  const scope = { projectId: "certification-project", environment: "development" as const };
  const context = { organizationId: randomUUID(), actorRef: "console@qkern.test" };

  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: ProjectDataPlaneService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TYPE "${schema}".mood AS ENUM ('sad', 'happy')`);
    await owner.query(`ALTER TYPE "${schema}".mood ADD VALUE 'ok' BEFORE 'happy'`);
    await owner.query(`CREATE TABLE "${schema}".accounts (id integer PRIMARY KEY, owner text NOT NULL, email text NOT NULL, note text, current_mood "${schema}".mood)`);
    await owner.query(`CREATE UNIQUE INDEX accounts_email_lower ON "${schema}".accounts (lower(email))`);
    await owner.query(`CREATE INDEX accounts_open ON "${schema}".accounts (owner, id) WHERE note IS NOT NULL`);
    await owner.query(`CREATE INDEX accounts_note_gin ON "${schema}".accounts USING gin (to_tsvector('simple', note))`);
    await owner.query(`ALTER TABLE "${schema}".accounts ENABLE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY own_rows ON "${schema}".accounts FOR SELECT USING (owner = current_user)`);
    await owner.query(`CREATE POLICY insert_own ON "${schema}".accounts AS RESTRICTIVE FOR INSERT TO qkern_project_api_app WITH CHECK (owner = current_user)`);
    await owner.query(`CREATE POLICY everything ON "${schema}".accounts FOR ALL USING (true) WITH CHECK (true)`);
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

  it("lists indexes with method, uniqueness, columns, expression and predicate", async () => {
    const result = await service.inspectIndexes(context, scope, schema);
    expect(result.truncated).toBe(false);
    const byName = Object.fromEntries(result.indexes.map((index) => [index.name, index]));
    expect(Object.keys(byName).sort()).toEqual(["accounts_email_lower", "accounts_note_gin", "accounts_open", "accounts_pkey"]);
    expect(byName.accounts_pkey).toMatchObject({ table: "accounts", accessMethod: "btree", unique: true, primary: true, valid: true, columns: ["id"], predicate: null });
    expect(byName.accounts_email_lower).toMatchObject({ unique: true, primary: false, columns: [] });
    expect(byName.accounts_email_lower.definition).toContain("lower(email)");
    expect(byName.accounts_open).toMatchObject({ unique: false, columns: ["owner", "id"], predicate: "(note IS NOT NULL)" });
    expect(byName.accounts_note_gin).toMatchObject({ accessMethod: "gin", columns: [] });
  });

  it("lists policies with command, kind, roles, USING and WITH CHECK", async () => {
    const result = await service.inspectPolicies(context, scope, schema);
    const byName = Object.fromEntries(result.policies.map((policy) => [policy.name, policy]));
    expect(Object.keys(byName).sort()).toEqual(["everything", "insert_own", "own_rows"]);
    expect(byName.own_rows).toMatchObject({ table: "accounts", command: "select", permissive: true, roles: ["public"], usingExpression: "(owner = CURRENT_USER)", checkExpression: null });
    expect(byName.insert_own).toMatchObject({ command: "insert", permissive: false, roles: ["qkern_project_api_app"], usingExpression: null, checkExpression: "(owner = CURRENT_USER)" });
    expect(byName.everything).toMatchObject({ command: "all", usingExpression: "true", checkExpression: "true" });
  });

  it("lists enum types with their labels in sort order, including a value added before another", async () => {
    const result = await service.inspectEnumTypes(context, scope, schema);
    expect(result.types).toEqual([{ name: "mood", labels: ["sad", "ok", "happy"] }]);
  });
});
