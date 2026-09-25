import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";
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
    // Eine Tabelle, wie Prisma sie anlegt: Grossbuchstaben in Tabellen- und Spaltenname (2.26).
    await owner.query(`CREATE TABLE "${schema}"."Order" (id uuid PRIMARY KEY, owner_id text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "totalCents" integer NOT NULL)`);
    await owner.query(`ALTER TABLE "${schema}"."Order" ENABLE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY order_owner_isolation ON "${schema}"."Order"
      USING (owner_id = current_setting('request.jwt.claim.sub', true))
      WITH CHECK (owner_id = current_setting('request.jwt.claim.sub', true))`);
    // Ein Pflichtargument, das wie ein Schluessel von Object.prototype heisst (Review 2.28).
    await owner.query(`CREATE FUNCTION "${schema}".echo_value("valueOf" jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT "valueOf" $$`);
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}".items TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}"."Order" TO qkern_project_api_app`);
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

  /**
   * Aggregate unter der RLS des Aufrufers — die Luecke "Aggregate" der
   * Paritaetsleiter. Die Zeilen von A und B liegen aus dem ersten Fall vor;
   * A zaehlt nur seine eigene, auch gruppiert und gefiltert. Ein Geheimnis
   * laesst sich auch per min() nicht lesen — genau diese Pruefung nimmt die
   * Mutationsprobe dieses Releases heraus.
   */
  it("aggregates only the caller's rows and refuses sensitive columns", async () => {
    const counted = await service.aggregateRows(context(ownerA), scope, {
      schema, table: "items", aggregates: [{ fn: "count" }, { fn: "min", column: "name" }],
    });
    expect(counted.groups).toEqual([{ count: "1", min_name: "A" }]);
    expect(counted.truncated).toBe(false);

    const grouped = await service.aggregateRows(context(ownerB), scope, {
      schema, table: "items", aggregates: [{ fn: "count" }], groupBy: "owner_id",
    });
    expect(grouped.groups).toEqual([{ owner_id: ownerB, count: "1" }]);

    const filtered = await service.aggregateRows(context(ownerA), scope, {
      schema, table: "items", aggregates: [{ fn: "count" }],
      filters: [{ column: "name", operator: "eq", value: "B" }],
    });
    expect(filtered.groups).toEqual([{ count: "0" }]);

    // api_token ist text und damit sortierbar — nur die Sensibel-Pruefung
    // steht zwischen min() und dem Geheimnis.
    await expect(service.aggregateRows(context(ownerA), scope, {
      schema, table: "items", aggregates: [{ fn: "min", column: "api_token" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    await expect(service.aggregateRows(context(ownerA), scope, {
      schema, table: "items", aggregates: [{ fn: "sum", column: "name" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
  });

  it("serves a quoted, camel-cased table under RLS and lists it in the schema", async () => {
    const orderA = randomUUID();
    await service.insertRows(context(ownerA), scope, {
      schema, table: "Order", rows: [{ id: orderA, owner_id: ownerA, totalCents: 1250 }],
    });
    await service.insertRows(context(ownerB), scope, {
      schema, table: "Order", rows: [{ id: randomUUID(), owner_id: ownerB, totalCents: 9 }],
    });
    const mine = await service.listRows(context(ownerA), scope, {
      schema, table: "Order", select: ["id", "totalCents", "createdAt"],
      filters: [{ column: "totalCents", operator: "gte", value: 1000 }], order: { column: "createdAt", direction: "desc" },
    });
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({ id: orderA, totalCents: 1250 });
    expect(typeof mine.rows[0].createdAt).toBe("string");
    const updated = await service.updateRow(context(ownerA), scope, { schema, table: "Order", match: { id: orderA }, values: { totalCents: 1300 } });
    expect(updated.rowCount).toBe(1);

    const dataPlane = new ProjectDataPlaneService(
      { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
      { resolve: async () => ({ pool: projectApi, expectedRole: "qkern_project_api_app", expectedDatabase: new URL(projectApiUrl!).pathname.slice(1), expectedLedgerOwner: "qkern" }) },
    );
    const inspected = await dataPlane.inspectSchema({ organizationId: randomUUID(), actorRef: "console@qkern.test" }, scope, schema);
    const order = inspected.tables.find((table) => table.name === "Order");
    expect(order?.columns.map((column) => column.name)).toEqual(["id", "owner_id", "createdAt", "totalCents"]);
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

  /**
   * Das OpenAPI-Dokument sagt, was die Flaeche wirklich bedient — die offenen
   * Punkte aus 1.71 und 1.72.
   *
   * Ein View erscheint nur mit `security_invoker` und nur mit GET samt
   * Pflicht-Sortierspalte; eine Funktion nur, wenn `callFunction` sie auch
   * annaehme — SECURITY INVOKER, nicht ueberladen, benannte sichere Argumente.
   * Die Mutationsprobe dieses Releases nimmt die `security_invoker`-Bedingung
   * aus dem Views-Filter — dann bewirbt das Dokument einen View, den die
   * Flaeche abweist, und genau dieser Fall faellt.
   */
  it("does not treat an inherited Object.prototype key as a supplied argument", async () => {
    const missing = service.callFunction(context(ownerA), scope, { schema, function: "echo_value", args: {} });
    await expect(missing).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    const result = await service.callFunction(context(ownerA), scope, { schema, function: "echo_value", args: { valueOf: { ok: true } } });
    expect(result.rows[0]?.result).toEqual({ ok: true });
  });

  it("documents views read-only and only callable functions as RPC", async () => {
    await owner.query(`CREATE VIEW "${schema}".doc_view WITH (security_invoker = true)
      AS SELECT id, name FROM "${schema}".items`);
    await owner.query(`CREATE VIEW "${schema}".doc_leaky
      AS SELECT id, name FROM "${schema}".items`);
    await owner.query(`GRANT SELECT ON "${schema}".doc_view TO qkern_project_api_app`);
    await owner.query(`GRANT SELECT ON "${schema}".doc_leaky TO qkern_project_api_app`);
    await owner.query(`CREATE FUNCTION "${schema}".doc_count(prefix text DEFAULT '')
      RETURNS bigint LANGUAGE sql STABLE
      AS $$ SELECT count(*) FROM "${schema}".items WHERE name LIKE prefix || '%' $$`);
    await owner.query(`CREATE FUNCTION "${schema}".doc_prune(item_name text)
      RETURNS void LANGUAGE sql VOLATILE
      AS $$ DELETE FROM "${schema}".items WHERE name = item_name $$`);
    await owner.query(`CREATE FUNCTION "${schema}".doc_secret(prefix text)
      RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ SELECT count(*) FROM "${schema}".items WHERE name LIKE prefix || '%' $$`);
    await owner.query(`CREATE FUNCTION "${schema}".doc_dup(a integer)
      RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT a $$`);
    await owner.query(`CREATE FUNCTION "${schema}".doc_dup(a text)
      RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT a $$`);

    const document = await service.generateOpenApi(context(ownerA), scope, schema) as {
      paths: Record<string, {
        get?: { parameters?: Array<{ name: string; required: boolean }> };
        post?: { summary: string; requestBody: { required: boolean } };
      } | undefined>;
    };
    const tablesBase = "/v1/projects/certification-project/environments/development/tables/";
    const rpcBase = "/v1/projects/certification-project/environments/development/rpc/";

    // Der invoker-View: nur GET, mit Pflicht-Sortierspalte. Der leaky-View
    // fehlt ganz — was die Flaeche abweist, wird nicht beworben.
    const viewPath = document.paths[`${tablesBase}doc_view/rows`];
    expect(viewPath).toBeDefined();
    expect(Object.keys(viewPath!)).toEqual(["get"]);
    expect(viewPath!.get!.parameters).toMatchObject([{ name: "order", required: true }]);
    expect(document.paths[`${tablesBase}doc_leaky/rows`]).toBeUndefined();

    // Die Tabelle selbst bleibt mit allen gewaehrten Verben beschrieben.
    expect(Object.keys(document.paths[`${tablesBase}items/rows`] ?? {}).sort())
      .toEqual(["delete", "get", "patch", "post"]);

    // RPC: stabil heisst read-only, volatile heisst Schreibtransaktion;
    // DEFINER und Ueberladung fehlen — genau wie beim Aufruf selbst.
    expect(document.paths[`${rpcBase}doc_count`]?.post?.summary).toContain("read-only");
    expect(document.paths[`${rpcBase}doc_count`]?.post?.requestBody.required).toBe(false);
    expect(document.paths[`${rpcBase}doc_prune`]?.post?.summary).toContain("write transaction");
    expect(document.paths[`${rpcBase}doc_prune`]?.post?.requestBody.required).toBe(true);
    expect(document.paths[`${rpcBase}doc_secret`]).toBeUndefined();
    expect(document.paths[`${rpcBase}doc_dup`]).toBeUndefined();
  }, 30_000);
});