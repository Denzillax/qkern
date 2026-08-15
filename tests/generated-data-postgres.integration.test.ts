import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && projectApiUrl);

describe.runIf(enabled)("generated Data API PostgreSQL RLS certification", () => {
  let owner: SqlPool;
  let projectApi: SqlPool;
  let service: GeneratedDataApiService;
  const schema = `generated_${randomUUID().replaceAll("-", "_")}`;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const rowA = randomUUID();
  const rowB = randomUUID();
  const scope = { projectId: "certification-project", environment: "development" as const };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`CREATE TABLE "${schema}".items (
      id uuid PRIMARY KEY,
      owner_id text NOT NULL,
      name text NOT NULL,
      api_token text
    )`);
    await owner.query(`ALTER TABLE "${schema}".items ENABLE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY generated_owner_isolation ON "${schema}".items
      USING (owner_id = current_setting('request.jwt.claim.sub', true))
      WITH CHECK (owner_id = current_setting('request.jwt.claim.sub', true))`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}".items TO qkern_project_api_app`);
    service = new GeneratedDataApiService(
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
    if (owner) await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([owner?.end(), projectApi?.end()]);
  });

  const context = (subject: string) => ({
    organizationId: randomUUID(),
    actorRef: `certification:${subject}`,
    claims: { role: "authenticated" as const, subject },
  });

  it("enforces RLS across insert, list, update and delete", async () => {
    await service.insertRows(context(ownerA), scope, {
      schema, table: "items", rows: [{ id: rowA, owner_id: ownerA, name: "A" }],
    });
    await service.insertRows(context(ownerB), scope, {
      schema, table: "items", rows: [{ id: rowB, owner_id: ownerB, name: "B" }],
    });
    const visibleA = await service.listRows(context(ownerA), scope, { schema, table: "items" });
    expect(visibleA.rows).toEqual([{ id: rowA, owner_id: ownerA, name: "A" }]);
    expect(JSON.stringify(visibleA)).not.toContain("api_token");

    const hiddenUpdate = await service.updateRow(context(ownerA), scope, {
      schema, table: "items", match: { id: rowB }, values: { name: "stolen" },
    });
    expect(hiddenUpdate.rowCount).toBe(0);
    const hiddenDelete = await service.deleteRow(context(ownerA), scope, {
      schema, table: "items", match: { id: rowB },
    });
    expect(hiddenDelete.rowCount).toBe(0);
    const visibleB = await service.listRows(context(ownerB), scope, { schema, table: "items" });
    expect(visibleB.rows[0]).toMatchObject({ id: rowB, name: "B" });
  });

  it("rejects identifier and column injection before PostgreSQL execution", async () => {
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items; DROP SCHEMA public", select: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items", filters: [{ column: "name) OR true --", operator: "eq", value: "x" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
  });

  /**
   * Views — Sprosse 4 der Paritaetsleiter, erste Haelfte.
   *
   * Nur ein View mit `security_invoker` laesst die RLS der Basistabellen fuer
   * den **Aufrufer** gelten; alle anderen laufen mit den Rechten ihres
   * Eigentuemers und wuerden die Mandantengrenze aushebeln. Genau diese
   * Bedingung nimmt die Mutationsprobe dieses Releases heraus.
   */
  it("serves security-invoker views read-only under the caller's RLS", async () => {
    await owner.query(`CREATE VIEW "${schema}".items_named
      WITH (security_invoker = true)
      AS SELECT id, owner_id, name FROM "${schema}".items`);
    await owner.query(`CREATE VIEW "${schema}".items_leaky
      AS SELECT id, owner_id, name FROM "${schema}".items`);
    await owner.query(`GRANT SELECT ON "${schema}".items_named, "${schema}".items_leaky
      TO qkern_project_api_app`);
    await owner.query(`INSERT INTO "${schema}".items (id, owner_id, name)
      VALUES ($1, $2, 'view-a'), ($3, $4, 'view-b')`,
    [randomUUID(), ownerA, randomUUID(), ownerB]);

    // Durch den View gilt die RLS des Aufrufers: A sieht nur A.
    const listed = await service.listRows(context(ownerA), scope, {
      schema, table: "items_named", order: { column: "name", direction: "asc" },
    });
    expect(listed.table.kind).toBe("view");
    expect(listed.rows.length).toBeGreaterThan(0);
    expect(listed.rows.every((row) => row.owner_id === ownerA)).toBe(true);
    // Kein Cursor auf einem View: Ohne eindeutige Ordnung wuerde er still
    // Zeilen ueberspringen oder doppeln.
    expect(listed.nextCursor).toBeNull();
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items_named", order: { column: "name", direction: "asc" },
      cursor: "irgendein-cursor",
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items_named",
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });

    // Ein View ist eine Leseflaeche.
    await expect(service.insertRows(context(ownerA), scope, {
      schema, table: "items_named", rows: [{ id: randomUUID(), owner_id: ownerA, name: "nope" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_READ_ONLY" });

    // Ohne security_invoker laeuft der View mit den Rechten des Eigentuemers —
    // er wuerde beide Mandanten zeigen. Er wird abgewiesen, nicht bedient.
    await expect(service.listRows(context(ownerA), scope, {
      schema, table: "items_leaky", order: { column: "name", direction: "asc" },
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });
  });

  /**
   * RPC — Sprosse 4, zweite Haelfte.
   *
   * Bedient werden nur SECURITY-INVOKER-Funktionen: Ihr Rumpf laeuft als
   * Aufrufer, die RLS der beruehrten Tabellen gilt. Eine DEFINER-Funktion
   * liefe mit den Rechten ihres Eigentuemers und wird abgewiesen — genau
   * diese Bedingung nimmt die Mutationsprobe dieses Releases heraus.
   */
  it("calls security-invoker functions under the caller's RLS", async () => {
    await owner.query(`CREATE FUNCTION "${schema}".items_like(prefix text)
      RETURNS SETOF "${schema}".items
      LANGUAGE sql STABLE SECURITY INVOKER
      AS $$ SELECT * FROM "${schema}".items WHERE name LIKE prefix || '%' $$`);
    await owner.query(`CREATE FUNCTION "${schema}".items_like_definer(prefix text)
      RETURNS SETOF "${schema}".items
      LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ SELECT * FROM "${schema}".items WHERE name LIKE prefix || '%' $$`);
    await owner.query(`CREATE FUNCTION "${schema}".add_item(item_name text, item_owner text)
      RETURNS uuid
      LANGUAGE sql VOLATILE SECURITY INVOKER
      AS $$ INSERT INTO "${schema}".items (id, owner_id, name)
            VALUES (gen_random_uuid(), item_owner, item_name) RETURNING id $$`);
    await owner.query(`GRANT EXECUTE ON FUNCTION
      "${schema}".items_like(text), "${schema}".items_like_definer(text),
      "${schema}".add_item(text, text) TO qkern_project_api_app`);
    await owner.query(`INSERT INTO "${schema}".items (id, owner_id, name)
      VALUES ($1, $2, 'rpc-a'), ($3, $4, 'rpc-b')`,
    [randomUUID(), ownerA, randomUUID(), ownerB]);

    // Die Set-Funktion sieht durch die RLS des Aufrufers: A findet nur A.
    const listed = await service.callFunction(context(ownerA), scope, {
      schema, function: "items_like", args: { prefix: "rpc-" },
    });
    expect(listed.function.returnsSet).toBe(true);
    expect(listed.rows.length).toBeGreaterThan(0);
    expect(listed.rows.every((row) => row.owner_id === ownerA)).toBe(true);

    // Eine fluechtige Funktion schreibt — als Aufrufer, mit dessen WITH CHECK.
    const inserted = await service.callFunction(context(ownerA), scope, {
      schema, function: "add_item", args: { item_name: "rpc-added", item_owner: ownerA },
    });
    expect(inserted.function.volatile).toBe(true);
    expect(String(inserted.rows[0]?.result)).toMatch(/^[0-9a-f-]{36}$/);
    // Ein Schreibversuch fuer einen fremden Mandanten scheitert an der RLS.
    await expect(service.callFunction(context(ownerA), scope, {
      schema, function: "add_item", args: { item_name: "rpc-foreign", item_owner: ownerB },
    })).rejects.toBeDefined();

    // DEFINER laeuft mit fremden Rechten und wird nicht bedient.
    await expect(service.callFunction(context(ownerA), scope, {
      schema, function: "items_like_definer", args: { prefix: "rpc-" },
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });

    // Unbekannte Funktion und fehlendes Pflichtargument sind Aufruffehler.
    await expect(service.callFunction(context(ownerA), scope, {
      schema, function: "no_such_function",
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_TABLE_NOT_FOUND" });
    await expect(service.callFunction(context(ownerA), scope, {
      schema, function: "items_like",
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
  }, 30_000);
});