import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledGeneratedDataApi,
  GeneratedDataApiError,
  GeneratedDataApiService,
  type GeneratedDataContext,
} from "@/lib/server/data-plane/generated-api";
import type { ProjectDataPlaneTargetResolver } from "@/lib/server/data-plane/service";

const context: GeneratedDataContext = {
  organizationId: "org-1",
  actorRef: "agent@example.ch",
  claims: { role: "authenticated", subject: "user-1" },
};
const scope = { projectId: "project-1", environment: "development" as const };

type Response = Record<string, unknown>[] | Error;

class FakeClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  constructor(private readonly response: (text: string, values?: readonly SqlValue[]) => Response) {}
  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.response(text, values);
    if (response instanceof Error) throw response;
    return { rows: response as Row[], rowCount: response.length };
  }
  release = vi.fn();
}

function boundary(overrides: Record<string, unknown> = {}) {
  return [{
    role_name: "qkern_project_api", session_name: "qkern_project_api",
    database_name: "project_database", read_only: true, can_login: true,
    superuser: false, bypass_rls: false, create_database: false, create_role: false,
    replication: false, has_memberships: false, ...overrides,
  }];
}

function metadata(overrides: Record<string, unknown> = {}) {
  const common = {
    table_name: "orders", relation_kind: "r", row_security_enabled: true,
    force_row_security: false, owned_by_current_role: false,
    can_select_table: true, can_insert_table: true, can_update_table: true, can_delete_table: true,
    not_null: true, identity_kind: "", generated_kind: "",
    can_select_column: true, can_insert_column: true, can_update_column: true,
  };
  return [
    { ...common, ordinal_position: 1, column_name: "id", data_type: "uuid", primary_key_position: 1, ...overrides },
    { ...common, ordinal_position: 2, column_name: "status", data_type: "text", primary_key_position: null, ...overrides },
    { ...common, ordinal_position: 3, column_name: "total", data_type: "numeric(12,2)", primary_key_position: null, ...overrides },
    { ...common, ordinal_position: 4, column_name: "api_token", data_type: "text", primary_key_position: null, ...overrides },
    { ...common, ordinal_position: 5, column_name: "created_at", data_type: "timestamp with time zone", primary_key_position: null, ...overrides },
  ];
}

function fixture(operation: (text: string, values?: readonly SqlValue[]) => Response, metadataRows = metadata()) {
  let readOnly = true;
  const client: FakeClient = new FakeClient((text, values): Response => {
    if (text.includes("FROM pg_catalog.pg_roles AS role WHERE")) {
      return boundary({ read_only: readOnly });
    }
    if (text.includes("FROM pg_catalog.pg_namespace AS namespace")) return metadataRows;
    if (text.includes("set_config('request.jwt.claims'")) return [{}];
    if (text === "BEGIN") { readOnly = false; return []; }
    if (text === "BEGIN READ ONLY") { readOnly = true; return []; }
    if (["COMMIT", "ROLLBACK"].includes(text) || text.startsWith("SET LOCAL")) return [];
    return operation(text, values);
  });
  const pool: SqlPool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn(), end: vi.fn() };
  const targets: ProjectDataPlaneTargetResolver = {
    resolveTarget: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }),
  };
  const connections = {
    resolve: vi.fn().mockResolvedValue({
      pool, expectedRole: "qkern_project_api", expectedDatabase: "project_database",
      expectedLedgerOwner: "qkern_ledger_owner",
    }),
  };
  return { service: new GeneratedDataApiService(targets, connections), client, pool, targets, connections };
}

describe("generated project data API", () => {
  it("lists only allowlisted columns with parameterized filters and an opaque cursor", async () => {
    const built = fixture((text) => text.startsWith("SELECT \"id\"") ? [
      { id: "00000000-0000-4000-8000-000000000001", status: "paid", total: "10.00" },
      { id: "00000000-0000-4000-8000-000000000002", status: "paid", total: "20.00" },
      { id: "00000000-0000-4000-8000-000000000003", status: "paid", total: "30.00" },
    ] : []);
    const first = await built.service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["id", "status", "total"],
      filters: [{ column: "status", operator: "eq", value: "paid" }], limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.table.primaryKey).toEqual(["id"]);
    const dataCall = built.client.calls.find((call) => call.text.startsWith("SELECT \"id\""));
    expect(dataCall?.text).toContain('WHERE "status" = $1');
    expect(dataCall?.text).toContain('ORDER BY "id" ASC');
    expect(dataCall?.values).toEqual(["paid"]);
    expect(built.client.calls.find((call) => call.text.includes("request.jwt.claims"))?.values?.[0])
      .toContain('"role":"authenticated"');

    await built.service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["id", "status"], limit: 2,
      cursor: first.nextCursor!,
    });
    const cursorCall = built.client.calls.filter((call) => call.text.startsWith("SELECT \"id\"")).at(-1);
    expect(cursorCall?.text).toContain('("id") > ($1)');
    expect(cursorCall?.values).toEqual(["00000000-0000-4000-8000-000000000002"]);
  });

  it("parameterizes inserts and requires an exact primary-key match for updates and deletes", async () => {
    const built = fixture((text, values) => {
      if (text.startsWith("INSERT INTO")) return [{ id: values?.[0], status: values?.[1], total: null }];
      if (text.startsWith("UPDATE")) return [{ id: values?.[1], status: values?.[0], total: null }];
      if (text.startsWith("DELETE")) return [{ id: values?.[0], status: "paid", total: null }];
      return [];
    });
    const inserted = await built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000001", status: "paid" }],
    });
    expect(inserted.rowCount).toBe(1);
    const insertCall = built.client.calls.find((call) => call.text.startsWith("INSERT INTO"));
    expect(insertCall?.text).not.toContain("paid");
    expect(insertCall?.values).toEqual(["00000000-0000-4000-8000-000000000001", "paid"]);

    await expect(built.service.updateRow(context, scope, {
      schema: "public", table: "orders", match: { status: "paid" }, values: { total: 12 },
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    const updated = await built.service.updateRow(context, scope, {
      schema: "public", table: "orders",
      match: { id: "00000000-0000-4000-8000-000000000001" }, values: { status: "shipped" },
    });
    expect(updated.rows[0]).toMatchObject({ status: "shipped" });
    await built.service.deleteRow(context, scope, {
      schema: "public", table: "orders",
      match: { id: "00000000-0000-4000-8000-000000000001" },
    });
    expect(built.client.calls.some((call) => call.text.startsWith("UPDATE") && call.text.includes('WHERE "id" = $2'))).toBe(true);
    expect(built.client.calls.some((call) => call.text.startsWith("DELETE") && call.text.includes('WHERE "id" = $1'))).toBe(true);
  });

  it("normalizes timestamp cursor values without exposing or skipping rows", async () => {
    const built = fixture((text) => text.startsWith("SELECT \"id\"") ? [
      { id: "00000000-0000-4000-8000-000000000001", created_at: new Date("2026-08-03T10:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000002", created_at: new Date("2026-08-03T11:00:00Z") },
    ] : []);
    const result = await built.service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["id"],
      order: { column: "created_at", direction: "asc" }, limit: 1,
    });
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = JSON.parse(Buffer.from(result.nextCursor!, "base64url").toString("utf8"));
    expect(decoded.values).toEqual(["2026-08-03T10:00:00.000Z", "00000000-0000-4000-8000-000000000001"]);
  });

  it("fails closed for sensitive columns, missing RLS, missing primary keys and identifier injection", async () => {
    const built = fixture(() => []);
    await expect(built.service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["api_token"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    await expect(built.service.listRows(context, scope, {
      schema: "public", table: "orders;drop_table", select: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });

    const noRls = fixture(() => [], metadata({ row_security_enabled: false }));
    await expect(noRls.service.listRows(context, scope, { schema: "public", table: "orders" }))
      .rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });
    const noPrimaryKey = fixture(() => [], metadata({ primary_key_position: null }));
    await expect(noPrimaryKey.service.listRows(context, scope, { schema: "public", table: "orders" }))
      .rejects.toMatchObject({ code: "GENERATED_DATA_API_PRIMARY_KEY_REQUIRED" });
  });

  it("reads a schema with capitals through a quoted name and refuses system or escaping schemas (2.33)", async () => {
    const built = fixture(() => []);
    await built.service.listRows(context, scope, { schema: "Shop", table: "orders", select: ["id"] });
    expect(built.client.calls.find((call) => call.text.includes("FROM pg_catalog.pg_namespace AS namespace"))?.values?.[0]).toBe("Shop");
    expect(built.client.calls.some((call) => call.text.includes('FROM "Shop"."orders"'))).toBe(true);

    const refused = fixture(() => []);
    for (const schema of ["pg_Shop", "pg_catalog", "information_schema", "qkern_internal", 'Shop"', "S".repeat(64)]) {
      await expect(refused.service.listRows(context, scope, { schema, table: "orders" }))
        .rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
      await expect(refused.service.generateOpenApi(context, scope, schema))
        .rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    }
    expect(refused.client.calls).toHaveLength(0);
  });

  it("generates a live schema-derived OpenAPI document without sensitive columns", async () => {
    const built = fixture(() => []);
    const document = await built.service.generateOpenApi(context, scope, "public");
    expect(document).toMatchObject({ openapi: "3.1.0", info: { version: "1.6.0-alpha.1" } });
    expect(JSON.stringify(document)).toContain("orders");
    expect(JSON.stringify(document)).not.toContain("api_token");
  });

  it("never retains database causes and remains disabled by default", async () => {
    const built = fixture((text) => text.startsWith("SELECT \"id\"")
      ? new Error("postgresql://admin:secret@private-host/database") : []);
    const error = await built.service.listRows(context, scope, { schema: "public", table: "orders" })
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(GeneratedDataApiError);
    expect(error).toMatchObject({ code: "GENERATED_DATA_API_UNAVAILABLE" });
    expect(JSON.stringify(error)).not.toMatch(/secret|private-host/i);
    expect(built.client.calls.some((call) => call.text === "ROLLBACK")).toBe(true);

    const disabled = new DisabledGeneratedDataApi();
    await expect(disabled.listRows(context, scope, { schema: "public", table: "orders" }))
      .rejects.toMatchObject({ code: "GENERATED_DATA_API_DISABLED" });
  });
});
