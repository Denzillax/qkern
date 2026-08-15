import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Das Rückgrat des SQL-Editors — gegen echtes PostgreSQL.
 *
 * `queryReadOnly` war bis Release 1.75 ausschliesslich mit Mocks getestet,
 * und seine Zusagen sind genau die Sorte, die nur eine echte Datenbank
 * belegen kann: der Parser-Wächter, `BEGIN READ ONLY` dahinter, das
 * Zeilenlimit mit ehrlichem `truncated` und die Redaktion sensibler Spalten.
 *
 * Die Console-Fläche darüber war bis 1.75 eine Attrappe, die vorbereitete
 * Beispielzeilen zeigte und die Route nie rief — die Signatur-Fehlerklasse
 * dieser Sprint, ein weiteres Mal.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("Data-plane read query PostgreSQL certification", () => {
  const schema = `readquery_${randomUUID().replaceAll("-", "_")}`;
  const scope = { projectId: "certification-project", environment: "development" as const };
  const context = { organizationId: randomUUID(), actorRef: "console@qkern.test" };

  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: ProjectDataPlaneService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TABLE "${schema}".orders (
      id integer PRIMARY KEY,
      status text NOT NULL,
      api_key text NOT NULL
    )`);
    await owner.query(`INSERT INTO "${schema}".orders (id, status, api_key)
      VALUES (1, 'paid', 'qk_live_secret_a'), (2, 'open', 'qk_live_secret_b'), (3, 'paid', 'qk_live_secret_c')`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT, UPDATE ON "${schema}".orders TO qkern_project_api_app`);
    service = new ProjectDataPlaneService(
      { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
      { resolve: async () => ({
        pool: projectApi,
        expectedRole: "qkern_project_api_app",
        expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
        expectedLedgerOwner: "qkern",
      }) },
    );
  }, 120_000);

  afterAll(async () => {
    if (owner) await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.allSettled([owner?.end(), projectApi?.end()]);
  });

  it("returns real rows, honest truncation and redacted secrets", async () => {
    const result = await service.queryReadOnly(context, scope,
      `SELECT id, status, api_key FROM "${schema}".orders ORDER BY id`, 2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.columns).toEqual(["id", "status", "api_key"]);
    expect(result.rows[0]).toMatchObject({ id: 1, status: "paid" });
    // Eine Spalte, die wie ein Geheimnis heisst, verlaesst QKERN nie im
    // Klartext — auch nicht ueber den SQL-Editor.
    expect(result.rows.every((row) => row.api_key === "[REDACTED]")).toBe(true);
    expect(JSON.stringify(result.rows)).not.toContain("qk_live_secret");
  }, 30_000);

  it("refuses writes disguised as queries and changes nothing", async () => {
    // Der Parser-Waechter weist ab — und selbst wenn er fiele, stuende
    // BEGIN READ ONLY dahinter. Die Mutationsprobe dieses Releases nimmt den
    // Waechter heraus und belegt, dass dieser Fall dann genau daran faellt.
    await expect(service.queryReadOnly(context, scope,
      `UPDATE "${schema}".orders SET status = 'hacked'`, 10,
    )).rejects.toMatchObject({ code: "READ_ONLY_QUERY_REQUIRED" });
    await expect(service.queryReadOnly(context, scope,
      `SELECT 1; DROP TABLE "${schema}".orders`, 10,
    )).rejects.toMatchObject({ code: "READ_ONLY_QUERY_REQUIRED" });

    const untouched = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schema}".orders WHERE status = 'hacked'`);
    expect(untouched.rows[0]?.n).toBe(0);
  }, 30_000);
});
