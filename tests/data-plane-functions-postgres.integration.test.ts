import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";

/**
 * Funktionsliste gegen echtes PostgreSQL (2.18).
 *
 * Signatur und Rueckgabe kommen aus `pg_get_function_arguments`,
 * `pg_get_function_identity_arguments` und `pg_get_function_result`; wie der
 * Server Vorgaben, OUT-Parameter, SETOF und Prozeduren darstellt, laesst sich
 * nur gegen ihn belegen (erster Lauf: die Identitaets-Signatur behaelt
 * OUT-Parameter, anders als angenommen). Dazu: ein Aggregat darf nicht erscheinen, ein
 * Nachbarschema auch nicht.
 */
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("Data-plane function inspection PostgreSQL certification", () => {
  const schema = `functions_${randomUUID().replaceAll("-", "_")}`;
  const other = `${schema}_other`;
  const scope = { projectId: "certification-project", environment: "development" as const };
  const context = { organizationId: randomUUID(), actorRef: "console@qkern.test" };

  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: ProjectDataPlaneService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE SCHEMA "${other}"`);
    await owner.query(`CREATE FUNCTION "${schema}".square(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT x * x $$`);
    await owner.query(`CREATE FUNCTION "${schema}".total_for(account integer, since date DEFAULT now()::date, OUT total bigint) RETURNS bigint LANGUAGE plpgsql STABLE AS $$ BEGIN total := account; END $$`);
    await owner.query(`CREATE FUNCTION "${schema}".numbers(upto integer) RETURNS SETOF integer LANGUAGE sql AS $$ SELECT generate_series(1, upto) $$`);
    await owner.query(`CREATE FUNCTION "${schema}".rows_of(upto integer) RETURNS TABLE (n integer, twice integer) LANGUAGE sql AS $$ SELECT g, g * 2 FROM generate_series(1, upto) AS g $$`);
    await owner.query(`CREATE FUNCTION "${schema}".privileged() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'x' $$`);
    await owner.query(`CREATE PROCEDURE "${schema}".archive(before date) LANGUAGE plpgsql AS $$ BEGIN NULL; END $$`);
    await owner.query(`CREATE FUNCTION "${schema}".touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
    await owner.query(`CREATE AGGREGATE "${schema}".my_sum(integer) (SFUNC = int4pl, STYPE = integer, INITCOND = '0')`);
    await owner.query(`CREATE FUNCTION "${other}".elsewhere() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
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
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await owner.query(`DROP SCHEMA IF EXISTS "${other}" CASCADE`);
    }
    await Promise.all([owner?.end(), projectApi?.end()]);
  });

  it("lists functions and procedures with signature, return, volatility and security, and hides aggregates and other schemas", async () => {
    const result = await service.inspectFunctions(context, scope, schema);
    expect(result.source).toBe("postgres");
    expect(result.truncated).toBe(false);
    const byName = Object.fromEntries(result.functions.map((fn) => [fn.name, fn]));
    expect(Object.keys(byName).sort()).toEqual(["archive", "numbers", "privileged", "rows_of", "square", "total_for", "touch"]);

    expect(byName.square).toMatchObject({ kind: "function", language: "sql", arguments: "x integer", identityArguments: "x integer", returnType: "integer", returnsSet: false, volatility: "immutable", securityDefiner: false });
    expect(byName.total_for).toMatchObject({ language: "plpgsql", volatility: "stable", returnType: "bigint", returnsSet: false });
    expect(byName.total_for.arguments).toContain("since date DEFAULT");
    expect(byName.total_for.arguments).toContain("OUT total bigint");
    // Die Identitaets-Signatur laesst Vorgaben weg, behaelt aber OUT-Parameter (so stellt es der Server dar).
    expect(byName.total_for.identityArguments).toBe("account integer, since date, OUT total bigint");
    expect(byName.numbers).toMatchObject({ returnType: "SETOF integer", returnsSet: true, volatility: "volatile" });
    expect(byName.rows_of).toMatchObject({ returnsSet: true });
    expect(byName.rows_of.returnType).toContain("TABLE(n integer, twice integer)");
    expect(byName.privileged).toMatchObject({ securityDefiner: true, returnType: "text" });
    expect(byName.archive).toMatchObject({ kind: "procedure", returnType: null, arguments: "IN before date", returnsSet: false });
    expect(byName.touch).toMatchObject({ returnType: "trigger", arguments: "" });
    expect(result.functions.some((fn) => fn.name === "my_sum" || fn.name === "elsewhere")).toBe(false);
  });
});
