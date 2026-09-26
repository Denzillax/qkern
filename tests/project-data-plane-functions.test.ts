import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

/**
 * Funktionsliste (2.18) am Fake-Client: Abbildung von `prokind` und
 * `provolatile`, Grenzen und Fail-closed-Verhalten. Was nur ein echter Server
 * belegt, steht in `data-plane-functions-postgres.integration.test.ts`.
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
  function_name: "touch", kind: "f", language: "plpgsql", arguments: "", identity_arguments: "",
  return_type: "trigger", returns_set: false, volatility: "v", security_definer: false, ...overrides,
});

describe("project data plane functions", () => {
  it("maps kind, volatility, signature and security from the catalog row", async () => {
    const built = fixture((text) => text.includes("pg_catalog.pg_proc") ? [
      row({}),
      row({ function_name: "total_for", language: "sql", arguments: "account integer, since date DEFAULT now()", identity_arguments: "account integer, since date", return_type: "SETOF integer", returns_set: true, volatility: "s" }),
      row({ function_name: "archive", kind: "p", return_type: null, security_definer: true }),
      row({ function_name: "square", language: "sql", arguments: "x integer", identity_arguments: "x integer", return_type: "integer", volatility: "i" }),
      // Katalognamen mit Grossbuchstaben sind legitim (2.23).
      row({ function_name: "camelCaseHelper", language: "plv8" }),
    ] : []);
    const result = await built.service.inspectFunctions(context, scope, "public");
    expect(result).toMatchObject({ source: "postgres", schema: "public", truncated: false });
    expect(result.functions.map((fn) => [fn.name, fn.kind, fn.volatility, fn.returnType, fn.returnsSet, fn.securityDefiner])).toEqual([
      ["touch", "function", "volatile", "trigger", false, false],
      ["total_for", "function", "stable", "SETOF integer", true, false],
      ["archive", "procedure", "volatile", null, false, true],
      ["square", "function", "immutable", "integer", false, false],
      ["camelCaseHelper", "function", "volatile", "trigger", false, false],
    ]);
    expect(result.functions[1]).toMatchObject({ arguments: "account integer, since date DEFAULT now()", identityArguments: "account integer, since date", language: "sql" });
    expect(built.client.calls.map((call) => call.text)).toEqual(expect.arrayContaining(["BEGIN READ ONLY", "COMMIT"]));
    expect(built.client.calls.find((call) => call.text.includes("pg_catalog.pg_proc"))?.values).toEqual(["public", 201]);
    expect(built.client.release).toHaveBeenCalledOnce();
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = fixture((text) => text.includes("pg_catalog.pg_proc") ? Array.from({ length: 201 }, (_, index) => row({ function_name: `f_${index}` })) : []);
    const result = await many.service.inspectFunctions(context, scope, "public");
    expect(result.functions).toHaveLength(200);
    expect(result.truncated).toBe(true);

    for (const bad of [{ kind: "a" }, { volatility: "x" }, { language: "pl\u0000pgsql" }, { function_name: "f".repeat(64) }, { arguments: "x".repeat(2001) }, { returns_set: "yes" }]) {
      const drifted = fixture((text) => text.includes("pg_catalog.pg_proc") ? [row(bad)] : []);
      await expect(drifted.service.inspectFunctions(context, scope, "public"), JSON.stringify(bad)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    }
  });

  it("refuses reserved schemas before any database call and stays closed while disabled", async () => {
    const built = fixture(() => []);
    for (const schema of ["pg_catalog", "information_schema", "qkern_internal", "pg_Shop", 'Shop"', "S".repeat(64)]) {
      await expect(built.service.inspectFunctions(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    }
    expect(built.client.calls).toHaveLength(0);
    await expect(new DisabledProjectDataPlane().inspectFunctions(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
  });
});
