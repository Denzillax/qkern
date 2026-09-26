import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

const context = { organizationId: "org-1", actorRef: "agent@example.ch" };
const scope = { projectId: "project-1", environment: "development" as const };

type Response = Record<string, unknown>[] | Error;

class FakeClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];

  constructor(private readonly response: (text: string) => Response) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.response(text);
    if (response instanceof Error) throw response;
    return { rows: response as Row[], rowCount: response.length };
  }

  release = vi.fn();
}

function boundary(overrides: Record<string, unknown> = {}) {
  return [{
    role_name: "qkern_project_reader",
    session_name: "qkern_project_reader",
    database_name: "project_database",
    read_only: true,
    can_login: true,
    superuser: false,
    bypass_rls: false,
    create_database: false,
    create_role: false,
    replication: false,
    has_memberships: false,
    ...overrides,
  }];
}

function fixture(response: (text: string) => Response) {
  const client = new FakeClient((text) => text.includes("FROM pg_catalog.pg_roles AS role")
    ? boundary()
    : response(text));
  const pool: SqlPool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
    end: vi.fn(),
  };
  const targets: ProjectDataPlaneTargetResolver = {
    resolveTarget: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }),
  };
  const connections = {
    resolve: vi.fn().mockResolvedValue({
      pool,
      expectedRole: "qkern_project_reader",
      expectedDatabase: "project_database",
      expectedLedgerOwner: "qkern_ledger_owner",
    }),
  };
  return { service: new ProjectDataPlaneService(targets, connections), client, pool, targets, connections };
}

describe("project data plane", () => {
  it("returns bounded real schema metadata and marks sensitive columns", async () => {
    const built = fixture((text) => text.includes("pg_catalog.pg_namespace") ? [
      {
        table_name: "accounts", relation_kind: "r", row_security_enabled: true,
        ordinal_position: 1, column_name: "id", data_type: "uuid", not_null: true,
        identity_kind: "", generated_kind: "",
      },
      {
        table_name: "accounts", relation_kind: "r", row_security_enabled: true,
        ordinal_position: 2, column_name: "password_hash", data_type: "text", not_null: true,
        identity_kind: "", generated_kind: "",
      },
      {
        table_name: "products", relation_kind: "p", row_security_enabled: false,
        ordinal_position: 1, column_name: "id", data_type: "bigint", not_null: true,
        identity_kind: "d", generated_kind: "",
      },
    ] : []);

    await expect(built.service.inspectSchema(context, scope, "public")).resolves.toEqual({
      source: "postgres",
      schema: "public",
      truncated: false,
      tables: [
        {
          name: "accounts", kind: "table", rowSecurityEnabled: true, truncated: false,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, identity: false, generated: false, sensitive: false },
            { name: "password_hash", dataType: "text", nullable: false, identity: false, generated: false, sensitive: true },
          ],
        },
        {
          name: "products", kind: "partitioned_table", rowSecurityEnabled: false, truncated: false,
          columns: [
            { name: "id", dataType: "bigint", nullable: false, identity: true, generated: false, sensitive: false },
          ],
        },
      ],
    });
    expect(built.client.calls.map((call) => call.text)).toEqual(expect.arrayContaining([
      "BEGIN READ ONLY",
      "SET LOCAL row_security = on",
      "COMMIT",
    ]));
    expect(built.client.release).toHaveBeenCalledOnce();
  });

  it("executes one bounded read in a read-only transaction and redacts values", async () => {
    const built = fixture((text) => text.startsWith("SELECT * FROM (") ? [
      { id: "1", email: "first@example.ch", password: "canary-one" },
      { id: "2", email: "second@example.ch", password: "canary-two" },
      { id: "3", email: "third@example.ch", password: "canary-three" },
    ] : []);

    const result = await built.service.queryReadOnly(
      context,
      scope,
      "SELECT id, email, password FROM accounts",
      2,
    );
    expect(result).toEqual({
      source: "postgres",
      columns: ["id", "email", "password"],
      rows: [
        { id: "1", email: "first@example.ch", password: "[REDACTED]" },
        { id: "2", email: "second@example.ch", password: "[REDACTED]" },
      ],
      rowCount: 2,
      truncated: true,
      maxRows: 2,
    });
    expect(built.client.calls.some((call) =>
      call.text.includes("LIMIT 3") && call.text.includes("SELECT id, email, password FROM accounts"),
    )).toBe(true);
  });

  it("accepts schema names with capitals and refuses system schemas and escaping names (2.33)", async () => {
    const built = fixture(() => []);
    await expect(built.service.inspectSchema(context, scope, "Shop")).resolves.toMatchObject({ schema: "Shop", tables: [] });
    // Der Name geht exakt als Parameter hinaus, nicht kleingeschrieben.
    expect(built.client.calls.find((call) => call.text.includes("pg_catalog.pg_namespace"))?.values?.[0]).toBe("Shop");

    const refused = fixture(() => []);
    for (const schema of ["pg_Shop", "pg_catalog", "information_schema", "qkern_internal", 'Shop"', "S".repeat(64), "shop.x", ""]) {
      await expect(refused.service.inspectSchema(context, scope, schema))
        .rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    }
    expect(refused.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects writes, reserved schemas and pending targets before a database call", async () => {
    const built = fixture(() => []);
    await expect(built.service.queryReadOnly(context, scope, "DELETE FROM products", 20))
      .rejects.toMatchObject({ code: "READ_ONLY_QUERY_REQUIRED" });
    await expect(built.service.inspectSchema(context, scope, "qkern_internal"))
      .rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    expect(built.pool.connect).not.toHaveBeenCalled();

    vi.mocked(built.targets.resolveTarget).mockResolvedValueOnce({
      databaseInstanceRef: "pending:project-1-development",
    });
    await expect(built.service.inspectSchema(context, scope, "public"))
      .rejects.toMatchObject({ code: "DATA_PLANE_NOT_READY" });
    expect(built.connections.resolve).not.toHaveBeenCalled();
  });

  it("fails closed on role drift and never retains driver causes", async () => {
    const built = fixture(() => []);
    const original = built.client.query.bind(built.client);
    built.client.query = async <Row extends Record<string, unknown>>(
      text: string,
      values?: readonly SqlValue[],
    ): Promise<SqlQueryResult<Row>> => {
      if (text.includes("FROM pg_catalog.pg_roles AS role")) {
        return { rows: boundary({ bypass_rls: true }) as unknown as Row[], rowCount: 1 };
      }
      return original<Row>(text, values);
    };
    const error = await built.service.inspectSchema(context, scope, "public").catch((cause) => cause);
    expect(error).toBeInstanceOf(ProjectDataPlaneError);
    expect(error).toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toMatch(/qkern_project_reader|project_database|bypass/i);
    expect(built.client.calls.some((call) => call.text === "ROLLBACK")).toBe(true);
  });

  it("rolls back query failures and exposes only a fixed unavailable error", async () => {
    const built = fixture((text) => text.startsWith("SELECT * FROM (")
      ? new Error("postgres://admin:secret@private-host/database")
      : []);
    const error = await built.service.queryReadOnly(context, scope, "SELECT id FROM products", 20)
      .catch((cause) => cause);
    expect(error).toMatchObject({ code: "DATA_PLANE_UNAVAILABLE" });
    expect(error.cause).toBeUndefined();
    expect(error.message).toBe("The project data plane is unavailable.");
    expect(JSON.stringify(error)).not.toMatch(/secret|private-host|postgres/i);
    expect(built.client.calls.some((call) => call.text === "ROLLBACK")).toBe(true);
    expect(built.client.release).toHaveBeenCalledOnce();
  });

  it("stays fail-closed while disabled", async () => {
    const disabled = new DisabledProjectDataPlane();
    await expect(disabled.inspectSchema(context, scope, "public"))
      .rejects.toMatchObject({ code: "DATA_PLANE_DISABLED" });
    await expect(disabled.queryReadOnly(context, scope, "SELECT 1", 1))
      .rejects.toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });
});
