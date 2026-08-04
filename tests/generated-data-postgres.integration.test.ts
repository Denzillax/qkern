import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("generated Data API PostgreSQL RLS certification", () => {
  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: GeneratedDataApiService;
  const schema = `generated_${randomUUID().replaceAll("-", "_")}`;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const rowA = randomUUID();
  const rowB = randomUUID();
  const scope = { projectId: "certification-project", environment: "development" as const };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TABLE "${schema}".items (
      id uuid PRIMARY KEY,
      owner_id text NOT NULL,
      name text NOT NULL,
      api_token text
    )`);
    await owner.query(`ALTER TABLE "${schema}".items ENABLE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY generated_owner_isolation ON "${schema}".items
      USING (owner_id = current_setting('request.jwt.claim.sub', true))
      WITH CHECK (owner_id = current_setting('request.jwt.claim.sub', true))`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}".items TO qkern_project_api_app`);
    service = new GeneratedDataApiService(
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

  const context = (subject: string) => ({
    organizationId: randomUUID(),
    actorRef: `certification:${subject}`,
    claims: { role: "authenticated" as const, subject },
  });

  it("enforces RLS across insert, list, update and delete", async () => {
    await service.insertRows(context(ownerA), scope, {
      schema, table: "items", rows: [{ id: rowA, owner_id: ownerA, name: "A" }],
    });
    await service.insertRows(context(ownerB), scope, {
      schema, table: "items", rows: [{ id: rowB, owner_id: ownerB, name: "B" }],
    });
    const visibleA = await service.listRows(context(ownerA), scope, { schema, table: "items" });
    expect(visibleA.rows).toEqual([{ id: rowA, owner_id: ownerA, name: "A" }]);
    expect(JSON.stringify(visibleA)).not.toContain("api_token");

    const hiddenUpdate = await service.updateRow(context(ownerA), scope, {
      schema, table: "items", match: { id: rowB }, values: { name: "stolen" },
    });
    expect(hiddenUpdate.rowCount).toBe(0);
    const hiddenDelete = await service.deleteRow(context(ownerA), scope, {
      schema, table: "items", match: { id: rowB },
    });
    expect(hiddenDelete.rowCount).toBe(0);
    const visibleB = await service.listRows(context(ownerB), scope, { schema, table: "items" });
    expect(visibleB.rows[0]).toMatchObject({ id: rowB, name: "B" });
  });

  it("rejects identifier and column injection before PostgreSQL execution", async () => {
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items; DROP SCHEMA public", select: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items", filters: [{ column: "name) OR true --", operator: "eq", value: "x" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
  });
});
