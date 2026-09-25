import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

/**
 * Erweiterungen, Rollen, Publikationen und Spaltenrechte (2.20) am
 * Fake-Client: Abbildung, Gruppierung, Grenzen und Fail-closed-Verhalten.
 * Was nur ein echter Server belegt, steht in
 * `data-plane-catalog-wide-postgres.integration.test.ts`.
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

const extensionRow = (o: Record<string, unknown>) => ({ name: "plpgsql", default_version: "1.0", installed_version: "1.0", schema: "pg_catalog", comment: "PL/pgSQL procedural language", ...o });
const roleRow = (o: Record<string, unknown>) => ({ role_name: "app_user", superuser: false, create_database: false, create_role: false, inherit: true, login: true, replication: false, bypass_rls: false, connection_limit: -1, valid_until: null, ...o });
const publicationRow = (o: Record<string, unknown>) => ({ publication_name: "changes", owner: "qkern", publish_insert: true, publish_update: true, publish_delete: false, publish_truncate: false, all_tables: false, tables: ["public.accounts"], ...o });
const privilegeRow = (o: Record<string, unknown>) => ({ table_name: "accounts", column_name: "email", grantee: "app_user", privilege_type: "SELECT", is_grantable: false, ...o });

describe("project data plane database-wide catalog views", () => {
  it("maps extensions, roles and publications and groups column privileges per column and grantee", async () => {
    const built = fixture((text) => text.includes("pg_available_extensions()") ? [extensionRow({}), extensionRow({ name: "pg_trgm", default_version: "1.6", installed_version: null, schema: null })]
      : text.includes("pg_catalog.starts_with(account.rolname, 'pg_')") ? [roleRow({}), roleRow({ role_name: "admin", superuser: true, connection_limit: 5, valid_until: "2027-01-01T00:00:00Z" })]
      : text.includes("pg_catalog.pg_publication AS publication") ? [publicationRow({}), publicationRow({ publication_name: "everything", all_tables: true, tables: [], publish_truncate: true }), publicationRow({ publication_name: "by_schema", tables: ["audit.*", "public.accounts"] })]
      : text.includes("pg_catalog.aclexplode(attribute.attacl)") ? [
        privilegeRow({}), privilegeRow({ privilege_type: "UPDATE", is_grantable: true }),
        privilegeRow({ column_name: "id", grantee: "public" }), privilegeRow({ table_name: "orders", column_name: "total", grantee: "app_user", privilege_type: "REFERENCES" }),
      ] : []);

    const extensions = await built.service.inspectExtensions(context, scope);
    expect(extensions.extensions).toEqual([
      { name: "plpgsql", defaultVersion: "1.0", installedVersion: "1.0", schema: "pg_catalog", comment: "PL/pgSQL procedural language" },
      { name: "pg_trgm", defaultVersion: "1.6", installedVersion: null, schema: null, comment: "PL/pgSQL procedural language" },
    ]);
    const roles = await built.service.inspectRoles(context, scope);
    expect(roles.roles.map((role) => [role.name, role.superuser, role.login, role.connectionLimit, role.validUntil])).toEqual([
      ["app_user", false, true, null, null], ["admin", true, true, 5, "2027-01-01T00:00:00Z"],
    ]);
    const publications = await built.service.inspectPublications(context, scope);
    expect(publications.publications.map((p) => [p.name, p.allTables, p.tables, p.publishTruncate])).toEqual([["changes", false, ["public.accounts"], false], ["everything", true, [], true], ["by_schema", false, ["audit.*", "public.accounts"], false]]);
    const privileges = await built.service.inspectColumnPrivileges(context, scope, "public");
    expect(privileges.privileges).toEqual([
      { table: "accounts", column: "email", grantee: "app_user", privileges: [{ type: "select", grantable: false }, { type: "update", grantable: true }] },
      { table: "accounts", column: "id", grantee: "public", privileges: [{ type: "select", grantable: false }] },
      { table: "orders", column: "total", grantee: "app_user", privileges: [{ type: "references", grantable: false }] },
    ]);
    expect(built.client.calls.find((call) => call.text.includes("pg_available_extensions()"))?.values).toEqual([401]);
    expect(built.client.calls.find((call) => call.text.includes("attribute.attacl IS NOT NULL"))?.values).toEqual(["public", 2001]);
    expect(built.client.release).toHaveBeenCalledTimes(4);
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = fixture((text) => text.includes("pg_catalog.pg_publication AS publication") ? Array.from({ length: 101 }, (_, i) => publicationRow({ publication_name: `p_${i}` })) : []);
    const result = await many.service.inspectPublications(context, scope);
    expect(result.publications).toHaveLength(100);
    expect(result.truncated).toBe(true);

    const manyColumns = fixture((text) => text.includes("aclexplode") ? Array.from({ length: 501 }, (_, i) => privilegeRow({ column_name: `c_${i}` })) : []);
    const grouped = await manyColumns.service.inspectColumnPrivileges(context, scope, "public");
    expect(grouped.privileges).toHaveLength(500);
    expect(grouped.truncated).toBe(true);

    const badExtension = fixture((text) => text.includes("pg_available_extensions()") ? [extensionRow({ default_version: "1.0; DROP" })] : []);
    await expect(badExtension.service.inspectExtensions(context, scope)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const badRole = fixture((text) => text.includes("starts_with(account.rolname") ? [roleRow({ connection_limit: -2 })] : []);
    await expect(badRole.service.inspectRoles(context, scope)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const badPublication = fixture((text) => text.includes("pg_catalog.pg_publication AS publication") ? [publicationRow({ tables: "public.accounts" })] : []);
    await expect(badPublication.service.inspectPublications(context, scope)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    const badPrivilege = fixture((text) => text.includes("aclexplode") ? [privilegeRow({ privilege_type: "TRUNCATE" })] : []);
    const nullGrantee = fixture((text) => text.includes("aclexplode") ? [privilegeRow({ grantee: null })] : []);
    await expect(nullGrantee.service.inspectColumnPrivileges(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
    await expect(badPrivilege.service.inspectColumnPrivileges(context, scope, "public")).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
  });

  it("refuses reserved schemas for column privileges and stays closed while disabled", async () => {
    const built = fixture(() => []);
    for (const schema of ["pg_catalog", "information_schema", "qkern_internal", "Public"]) {
      await expect(built.service.inspectColumnPrivileges(context, scope, schema)).rejects.toMatchObject({ code: "DATA_PLANE_INVALID_INPUT" });
    }
    expect(built.client.calls).toHaveLength(0);
    const disabled = new DisabledProjectDataPlane();
    await expect(disabled.inspectExtensions(context, scope)).rejects.toBeInstanceOf(ProjectDataPlaneError);
    await expect(disabled.inspectRoles(context, scope)).rejects.toBeInstanceOf(ProjectDataPlaneError);
    await expect(disabled.inspectPublications(context, scope)).rejects.toBeInstanceOf(ProjectDataPlaneError);
    await expect(disabled.inspectColumnPrivileges(context, scope, "public")).rejects.toBeInstanceOf(ProjectDataPlaneError);
  });
});
