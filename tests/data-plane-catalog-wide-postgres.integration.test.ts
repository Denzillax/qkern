import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";

/**
 * Erweiterungen, Rollen, Publikationen und Spaltenrechte gegen echtes
 * PostgreSQL (2.20). Was `pg_available_extensions` liefert, wie `pg_roles`
 * die Projekt-API-Rolle zeigt, wie eine Publikation ihre Tabellen und
 * Flags traegt und wie `aclexplode` Spaltenrechte entfaltet, laesst sich nur
 * gegen den Server belegen.
 */
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("Data-plane database-wide catalog views PostgreSQL certification", () => {
  const schema = `wide_${randomUUID().replaceAll("-", "_")}`;
  const publication = `pub_${randomUUID().replaceAll("-", "_").slice(0, 12)}`;
  const scope = { projectId: "certification-project", environment: "development" as const };
  const context = { organizationId: randomUUID(), actorRef: "console@qkern.test" };

  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: ProjectDataPlaneService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TABLE "${schema}".accounts (id integer PRIMARY KEY, owner text NOT NULL, email text NOT NULL, note text)`);
    await owner.query(`CREATE TABLE "${schema}".orders (id integer PRIMARY KEY, total integer NOT NULL)`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT (id, owner) ON "${schema}".accounts TO qkern_project_api_app`);
    await owner.query(`GRANT UPDATE (note) ON "${schema}".accounts TO qkern_project_api_app WITH GRANT OPTION`);
    await owner.query(`GRANT SELECT (id) ON "${schema}".orders TO PUBLIC`);
    await owner.query(`CREATE PUBLICATION "${publication}" FOR TABLE "${schema}".accounts, "${schema}".orders WITH (publish = 'insert, update')`);
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
    if (owner) {
      await owner.query(`DROP PUBLICATION IF EXISTS "${publication}"`);
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await Promise.all([owner?.end(), projectApi?.end()]);
  });

  it("lists available extensions with the installed ones first and their version", async () => {
    const result = await service.inspectExtensions(context, scope);
    expect(result.truncated).toBe(false);
    const plpgsql = result.extensions.find((extension) => extension.name === "plpgsql");
    expect(plpgsql).toMatchObject({ defaultVersion: expect.any(String), schema: "pg_catalog" });
    expect(plpgsql?.installedVersion).toBe(plpgsql?.defaultVersion);
    const trgm = result.extensions.find((extension) => extension.name === "pg_trgm");
    expect(trgm).toMatchObject({ installedVersion: null, schema: null });
    expect(trgm?.comment).toContain("trigram");
    // Installierte zuerst, dann alphabetisch.
    const firstUninstalled = result.extensions.findIndex((extension) => extension.installedVersion === null);
    expect(result.extensions.slice(firstUninstalled).every((extension) => extension.installedVersion === null)).toBe(true);
  });

  it("lists roles without the predefined pg_ roles and with the project API role as it is", async () => {
    const result = await service.inspectRoles(context, scope);
    expect(result.roles.some((role) => role.name.startsWith("pg_"))).toBe(false);
    const api = result.roles.find((role) => role.name === "qkern_project_api_app");
    expect(api).toMatchObject({ login: true, superuser: false, bypassRowSecurity: false, createDatabase: false, createRole: false, replication: false, connectionLimit: null, validUntil: null });
  });

  it("lists publications with owner, operations and their tables", async () => {
    const result = await service.inspectPublications(context, scope);
    const found = result.publications.find((entry) => entry.name === publication);
    expect(found).toMatchObject({ publishInsert: true, publishUpdate: true, publishDelete: false, publishTruncate: false, allTables: false, tables: [`${schema}.accounts`, `${schema}.orders`] });
    expect(found?.owner).toBe("qkern");
  });

  it("lists column privileges grouped per column and grantee, PUBLIC included", async () => {
    const result = await service.inspectColumnPrivileges(context, scope, schema);
    expect(result.truncated).toBe(false);
    expect(result.privileges).toEqual([
      { table: "accounts", column: "id", grantee: "qkern_project_api_app", privileges: [{ type: "select", grantable: false }] },
      { table: "accounts", column: "owner", grantee: "qkern_project_api_app", privileges: [{ type: "select", grantable: false }] },
      { table: "accounts", column: "note", grantee: "qkern_project_api_app", privileges: [{ type: "update", grantable: true }] },
      { table: "orders", column: "id", grantee: "public", privileges: [{ type: "select", grantable: false }] },
    ]);
  });
});
