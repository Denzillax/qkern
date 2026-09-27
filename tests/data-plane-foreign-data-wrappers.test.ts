import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

/**
 * Fremde Datenquellen (2.72) am Fake-Client: Abbildung, die Entscheidung ueber
 * die Optionswerte, die Grenzen und das Fail-closed-Verhalten.
 *
 * Was nur ein echter Server belegt, naemlich dass die Lesung an einer echten
 * Zuordnung mit echtem Passwort vorbeigeht, steht als Fall (2.72) in
 * `postgres.integration.test.ts`.
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

const wrapperRow = (o: Record<string, unknown>) => ({ wrapper_name: "postgres_fdw", owner: "qkern", handler: "postgres_fdw_handler", validator: "postgres_fdw_validator", ...o });
const serverRow = (o: Record<string, unknown>) => ({
  server_name: "shop", wrapper_name: "postgres_fdw", owner: "qkern", server_type: null, server_version: null,
  options: ["host=remote.example", "port=5432", "dbname=shop"], ...o,
});
const mappingRow = (o: Record<string, unknown>) => ({ server_name: "shop", user_name: "qkern_project_reader", ...o });
const tableRow = (o: Record<string, unknown>) => ({ schema_name: "public", table_name: "orders", server_name: "shop", ...o });

function answer(rows: {
  wrappers?: Record<string, unknown>[];
  servers?: Record<string, unknown>[];
  mappings?: Record<string, unknown>[];
  tables?: Record<string, unknown>[];
}) {
  return (text: string) =>
    text.includes("pg_catalog.pg_foreign_data_wrapper AS wrapper\n") ? rows.wrappers ?? []
    : text.includes("pg_catalog.pg_foreign_server AS server\n") ? rows.servers ?? []
    : text.includes("pg_catalog.pg_user_mappings AS mapping") ? rows.mappings ?? []
    : text.includes("pg_catalog.pg_foreign_table AS foreign_table") ? rows.tables ?? []
    : [];
}

describe("project data plane foreign data wrappers", () => {
  it("maps wrappers, servers, mappings and foreign tables and shows only the option keys on the list", async () => {
    const built = fixture(answer({
      wrappers: [wrapperRow({}), wrapperRow({ wrapper_name: "bare_fdw", handler: null, validator: null })],
      servers: [
        serverRow({}),
        serverRow({
          server_name: "legacy", wrapper_name: "bare_fdw", server_type: "oracle", server_version: "19c",
          // Ein Wrapper ohne Validator nimmt jede Option an. Genau diese Zeile
          // ist der Grund fuer die Liste des Erlaubten.
          options: ["password=hunter2", "host=legacy.example", "api_key=abc", "sslmode=require"],
        }),
      ],
      mappings: [mappingRow({}), mappingRow({ server_name: "legacy", user_name: "public" })],
      tables: [tableRow({}), tableRow({ schema_name: "audit", table_name: "events", server_name: "legacy" })],
    }));

    const result = await built.service.inspectForeignDataWrappers(context, scope);
    expect(result.source).toBe("postgres");
    expect(result.truncated).toBe(false);
    expect(result.wrappers).toEqual([
      { name: "postgres_fdw", owner: "qkern", handler: "postgres_fdw_handler", validator: "postgres_fdw_validator" },
      { name: "bare_fdw", owner: "qkern", handler: null, validator: null },
    ]);
    expect(result.servers[0]).toEqual({
      name: "shop", wrapper: "postgres_fdw", owner: "qkern", type: null, version: null,
      options: [{ key: "dbname", value: "shop" }, { key: "host", value: "remote.example" }, { key: "port", value: "5432" }],
    });
    // Der Schluessel steht da, der Wert nicht: Dass eine Option gesetzt ist,
    // darf man sehen, was drinsteht nicht.
    expect(result.servers[1]!.options).toEqual([
      { key: "api_key", value: null },
      { key: "host", value: "legacy.example" },
      { key: "password", value: null },
      { key: "sslmode", value: "require" },
    ]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("abc");
    expect(result.userMappings).toEqual([
      { server: "shop", user: "qkern_project_reader" },
      { server: "legacy", user: "public" },
    ]);
    expect(result.tables).toEqual([
      { schema: "public", name: "orders", server: "shop" },
      { schema: "audit", name: "events", server: "legacy" },
    ]);

    // Die Spalte mit den Zugangsdaten wird nicht einmal ausgewaehlt, und die
    // gesperrte Katalogtabelle nicht angefasst.
    const statements = built.client.calls.map((call) => call.text).join("\n");
    expect(statements).not.toContain("umoptions");
    expect(statements).not.toContain("pg_user_mapping AS");
    expect(statements).not.toContain("ftoptions");
    expect(statements).not.toContain("fdwoptions");
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = Array.from({ length: 201 }, (_, index) => serverRow({ server_name: `server_${index}` }));
    const truncating = fixture(answer({ wrappers: [wrapperRow({})], servers: many }));
    const truncated = await truncating.service.inspectForeignDataWrappers(context, scope);
    expect(truncated.servers).toHaveLength(200);
    expect(truncated.truncated).toBe(true);

    // Ein Eintrag ohne `=` ist kein Grund zum Raten.
    const broken = fixture(answer({ servers: [serverRow({ options: ["hostremote.example"] })] }));
    await expect(broken.service.inspectForeignDataWrappers(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Ein Optionsname ausserhalb der Bezeichner-Grammatik ebenso.
    const oddKey = fixture(answer({ servers: [serverRow({ options: ["ho st=remote.example"] })] }));
    await expect(oddKey.service.inspectForeignDataWrappers(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Und ein Servername, den PostgreSQL so nie schreibt.
    const oddName = fixture(answer({ servers: [serverRow({ server_name: "x".repeat(64) })] }));
    await expect(oddName.service.inspectForeignDataWrappers(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);
  });

  it("stays closed while the data plane is disabled", async () => {
    await expect(new DisabledProjectDataPlane().inspectForeignDataWrappers(context, scope))
      .rejects.toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });
});
