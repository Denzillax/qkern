import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

/**
 * Indizes, Policies und Enum-Typen (2.19) am Fake-Client: Abbildung der
 * Katalogzeilen, Grenzen und Fail-closed-Verhalten. Was nur ein echter Server
 * belegt, steht in `data-plane-catalog-postgres.integration.test.ts`.
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

const indexRow = (o: Record<string, unknown>) => ({ index_name: "accounts_pkey", table_name: "accounts", access_method: "btree", is_unique: true, is_primary: true, is_valid: true, columns: ["id"], definition: "CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id)", predicate: null, ...o });
const policyRow = (o: Record<string, unknown>) => ({ policy_name: "own_rows", table_name: "accounts", permissive: true, command: "r", roles: ["public"], using_expression: "(owner = current_user)", check_expression: null, ...o });
const enumRow = (o: Record<string, unknown>) => ({ type_name: "mood", labels: ["sad", "ok", "happy"], ...o });

describe("project data plane catalog views", () => {
  it("maps indexes, policies and enum types from their catalog rows", async () => {
    const built = fixture((text) => text.includes("pg_catalog.pg_index ") ? [
      indexRow({}),
      indexRow({ index_name: "orders_open", table_name: "orders", is_unique: false, is_primary: false, columns: ["account_id", "total"], definition: "CREATE INDEX orders_open ON public.orders USING btree (account_id, total) WHERE (total > 0)", predicate: "(total > 0)" }),
      indexRow({ index_name: "orders_lower", table_name: "orders", access_method: "gin", is_unique: false, is_primary: false, is_valid: false, columns: [], definition: "CREATE INDEX orders_lower ON public.orders USING gin (lower(note))" }),
    ] : text.includes("pg_catalog.pg_policy ") ? [
      policyRow({}),
      policyRow({ policy_name: "insert_own", command: "a", permissive: false, roles: ["app_user", "app_admin"], using_expression: null, check_expression: "(owner = current_user)" }),
      policyRow({ policy_name: "everything", command: "*" }),
      // Supabase Studios Vorlage heisst genau so (2.23).
      policyRow({ policy_name: "Enable read access for all users", table_name: "Order" }),
    ] : text.includes("pg_catalog.pg_enum ") ? [enumRow({}), enumRow({ type_name: "empty", labels: [] })] : []);

    const indexes = await built.service.inspectIndexes(context, scope, "public");
    expect(indexes.indexes.map((i) => [i.name, i.table, i.accessMethod, i.unique, i.primary, i.valid, i.columns, i.predicate])).toEqual([
      ["accounts_pkey", "accounts", "btree", true, true, true, ["id"], null],
      ["orders_open", "orders", "btree", false, false, true, ["account_id", "total"], "(total > 0)"],
      ["orders_lower", "orders", "gin", false, false, false, [], null],
    ]);
    const policies = await built.service.inspectPolicies(context, scope, "public");
    expect(policies.policies.map((p) => [p.name, p.command, p.permissive, p.roles, p.usingExpression, p.checkExpression])).toEqual([
      ["own_rows", "select", true, ["public"], "(owner = current_user)", null],
      ["insert_own", "insert", false, ["app_user", "app_admin"], null, "(owner = current_user)"],
      ["everything", "all", true, ["public"], "(owner = current_user)", null],
      ["Enable read access for all users", "select", true, ["public"], "(owner = current_user)", null],
    ]);
    const enums = await built.service.inspectEnumTypes(context, scope, "public");
    expect(enums.types).toEqual([{ name: "mood", labels: ["sad", "ok", "happy"] }, { name: "empty", labels: [] }]);
    for (const [needle, values] of [["pg_catalog.pg_index ", ["public", 201]], ["pg_catalog.pg_policy ", ["public", 201]], ["pg_catalog.pg_enum ", ["public", 201]]] as const) {
      expect(built.client.calls.find((call) => call.text.includes(needle))?.values).toEqual(values);
    }
    expect(built.client.release).toHaveBeenCalledTimes(3);
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = fixture((text) => text.includes("pg_catalog.pg_index ") ? Array.from({ length: 201 }, (_, i) => indexRow({ index_name: `i_${i}` })) : []);
    const result = await many.service.inspectIndexes(context, scope, "public");
    expect(result.indexes).toHaveLength(200);
    expect(result.truncated).toBe(true);

    const badIndex = fixture((text) => text.includes("pg_catalog.pg_index ") ? [indexRow({ columns: "id" })] : []);
    const longIndex = fixture((text) => text.includes("pg_catalog.pg_index ") ? [indexRow({ index_name: "i".repeat(64) })] : []);
    await expect(longIndex.service.inspectIndexes(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    await expect(badIndex.service.inspectIndexes(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const badPolicy = fixture((text) => text.includes("pg_catalog.pg_policy ") ? [policyRow({ command: "x" })] : []);
    await expect(badPolicy.service.inspectPolicies(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const noRoles = fixture((text) => text.includes("pg_catalog.pg_policy ") ? [policyRow({ roles: [] })] : []);
    await expect(noRoles.service.inspectPolicies(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const badEnum = fixture((text) => text.includes("pg_catalog.pg_enum ") ? [enumRow({ labels: Array.from({ length: 201 }, (_, i) => `l${i}`) })] : []);
    await expect(badEnum.service.inspectEnumTypes(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
  });

  it("refuses reserved schemas before any database call and stays closed while disabled", async () => {
    const built = fixture(() => []);
    for (const schema of ["pg_catalog", "information_schema", "qkern_internal", "pg_Shop", 'Shop"', "S".repeat(64)]) {
      await expect(built.service.inspectIndexes(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
      await expect(built.service.inspectPolicies(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
      await expect(built.service.inspectEnumTypes(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    }
    expect(built.client.calls).toHaveLength(0);
    const disabled = new DisabledProjectDataPlane();
    await expect(disabled.inspectIndexes(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
    await expect(disabled.inspectPolicies(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
    await expect(disabled.inspectEnumTypes(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
  });
});
