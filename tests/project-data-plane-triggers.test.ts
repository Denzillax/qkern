import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

/**
 * Trigger-Liste (2.9) am Fake-Client: Decodierung der tgtype-Bits, Grenzen
 * und Fail-closed-Verhalten. Was nur ein echter Server belegt, steht in
 * `data-plane-triggers-postgres.integration.test.ts`.
 */
const context = { organizationId: "org-1", actorRef: "console@qkern.test" };
const scope = { projectId: "project-1", environment: "development" as const };

class FakeClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  constructor(private readonly response: (text: string) => Record<string, unknown>[] | Error) {}
  async query<Row extends Record<string, unknown>>(text: string, values?: readonly SqlValue[]): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.response(text);
    if (response instanceof Error) throw response;
    return { rows: response as Row[], rowCount: response.length };
  }
  release = vi.fn();
}

function fixture(response: (text: string) => Record<string, unknown>[] | Error) {
  const client = new FakeClient((text) => text.includes("FROM pg_catalog.pg_roles AS role") ? [{
    role_name: "qkern_project_reader", session_name: "qkern_project_reader", database_name: "project_database",
    read_only: true, can_login: true, superuser: false, bypass_rls: false, create_database: false,
    create_role: false, replication: false, has_memberships: false,
  }] : response(text));
  const pool: SqlPool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn(), end: vi.fn() };
  const targets: ProjectDataPlaneTargetResolver = { resolveTarget: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) };
  const connections = { resolve: vi.fn().mockResolvedValue({ pool, expectedRole: "qkern_project_reader", expectedDatabase: "project_database", expectedLedgerOwner: "qkern_ledger_owner" }) };
  return { service: new ProjectDataPlaneService(targets, connections), client };
}

const row = (overrides: Record<string, unknown>) => ({
  trigger_name: "accounts_touch", table_name: "accounts", enabled_mode: "O",
  is_row: true, is_before: true, is_instead: false, on_insert: true, on_update: true, on_delete: false, on_truncate: false,
  function_schema: "public", function_name: "touch", condition: null, ...overrides,
});

describe("project data plane triggers", () => {
  it("decodes timing, events, orientation and state from the catalog row", async () => {
    const built = fixture((text) => text.includes("pg_catalog.pg_trigger") ? [
      row({}),
      row({ trigger_name: "orders_big", table_name: "orders", enabled_mode: "D", is_before: false, on_insert: false, condition: "new.total > 100" }),
      row({ trigger_name: "view_redirect", table_name: "order_totals", is_instead: true, is_before: false, on_update: false }),
      row({ trigger_name: "audit", is_row: false, is_before: false, on_insert: false, on_update: false, on_truncate: true, enabled_mode: "A" }),
    ] : []);
    const result = await built.service.inspectTriggers(context, scope, "public");
    expect(result).toMatchObject({ source: "postgres", schema: "public", truncated: false });
    expect(result.triggers.map((trigger) => [trigger.name, trigger.timing, trigger.events, trigger.orientation, trigger.enabled, trigger.condition])).toEqual([
      ["accounts_touch", "before", ["insert", "update"], "row", "origin", null],
      ["orders_big", "after", ["update"], "row", "disabled", "new.total > 100"],
      ["view_redirect", "instead_of", ["insert"], "row", "origin", null],
      ["audit", "after", ["truncate"], "statement", "always", null],
    ]);
    expect(built.client.calls.map((call) => call.text)).toEqual(expect.arrayContaining(["BEGIN READ ONLY", "COMMIT"]));
    expect(built.client.calls.find((call) => call.text.includes("pg_catalog.pg_trigger"))?.values).toEqual(["public", 201]);
    expect(built.client.release).toHaveBeenCalledOnce();
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = fixture((text) => text.includes("pg_catalog.pg_trigger") ? Array.from({ length: 201 }, (_, index) => row({ trigger_name: `t_${index}` })) : []);
    const result = await many.service.inspectTriggers(context, scope, "public");
    expect(result.triggers).toHaveLength(200);
    expect(result.truncated).toBe(true);

    const drifted = fixture((text) => text.includes("pg_catalog.pg_trigger") ? [row({ enabled_mode: "X" })] : []);
    await expect(drifted.service.inspectTriggers(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
  });

  it("refuses reserved schemas before any database call and stays closed while disabled", async () => {
    const built = fixture(() => []);
    for (const schema of ["pg_catalog", "information_schema", "qkern_internal", "pg_Shop", 'Shop"', "S".repeat(64)]) {
      await expect(built.service.inspectTriggers(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    }
    expect(built.client.calls).toHaveLength(0);
    await expect(new DisabledProjectDataPlane().inspectTriggers(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
  });
});
