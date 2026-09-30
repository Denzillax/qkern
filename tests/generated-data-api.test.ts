import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledGeneratedDataApi,
  GeneratedDataApiError,
  GeneratedDataApiService,
  parseGeneratedSelect,
  type GeneratedDataContext,
} from "@/lib/server/data-plane/generated-api";
import { DATA_API_LIMITS } from "@/lib/data-api-limits";
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

type MetadataRows = Record<string, unknown>[] | ((table: string | null) => Record<string, unknown>[]);

function fixture(operation: (text: string, values?: readonly SqlValue[]) => Response, metadataRows: MetadataRows = metadata()) {
  let readOnly = true;
  const client: FakeClient = new FakeClient((text, values): Response => {
    if (text.includes("FROM pg_catalog.pg_roles AS role WHERE")) {
      return boundary({ read_only: readOnly });
    }
    if (text.includes("FROM pg_catalog.pg_namespace AS namespace")) {
      return typeof metadataRows === "function" ? metadataRows((values?.[1] as string | null) ?? null) : metadataRows;
    }
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

  it("builds an upsert only from a unique key the catalogue holds, with the key out of the assignment (2.105)", async () => {
    // Der Konfliktschluessel kommt aus `pg_index` und nicht aus der Anfrage.
    // Diese Tabelle hat zwei eindeutige Schluessel: den Primaerschluessel auf
    // `id` und einen Index auf `status`.
    const uniqueKeys = [
      { index_name: "orders_pkey", columns: ["id"] },
      { index_name: "orders_status_key", columns: ["status"] },
    ];
    const built = fixture((text, values) => {
      if (text.includes("FROM pg_catalog.pg_index AS unique_index")) return uniqueKeys;
      if (text.startsWith("INSERT INTO")) return [{ id: values?.[0], status: values?.[1], total: values?.[2] ?? null }];
      return [];
    });
    const upserted = await built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000001", status: "paid", total: 12 }],
      onConflict: ["id"],
    });
    expect(upserted.rowCount).toBe(1);
    const call = built.client.calls.find((entry) => entry.text.startsWith("INSERT INTO"));
    // Die Schluesselspalte steht in der Bedingung und nicht in der Zuweisung:
    // Sie zu setzen, waere ein Aendern des Primaerschluessels.
    expect(call?.text).toContain('ON CONFLICT ("id")');
    expect(call?.text).toContain('DO UPDATE SET "status" = EXCLUDED."status", "total" = EXCLUDED."total"');
    expect(call?.text).not.toContain('"id" = EXCLUDED."id"');
    // Werte bleiben Parameter, auch am Upsert.
    expect(call?.values).toEqual(["00000000-0000-4000-8000-000000000001", "paid", 12]);
    // Der Katalog wird gelesen, bevor die Zeile geschrieben ist.
    const order = built.client.calls.map((entry) => entry.text);
    expect(order.findIndex((text) => text.includes("FROM pg_catalog.pg_index AS unique_index")))
      .toBeLessThan(order.findIndex((text) => text.startsWith("INSERT INTO")));

    // Ein Schluessel, den es nicht gibt: eigener Code, und keine Zeile.
    await expect(built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000002", status: "paid" }],
      onConflict: ["total"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN" });
    // Auch eine Teilmenge eines Schluessels ist keiner: `ON CONFLICT` leitet den
    // Index ueber die ganze Spaltenmenge ab.
    await expect(built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000002", status: "paid" }],
      onConflict: ["id", "status"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN" });

    // Eine Schluesselspalte, die nicht in der Zeile steht: Dann entschiede ein
    // DEFAULT, auf welche Zeile der Upsert trifft.
    await expect(built.service.insertRows(context, scope, {
      schema: "public", table: "orders", rows: [{ status: "paid" }], onConflict: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    // Eine Zeile nur aus dem Schluessel hat nichts zu aendern; still ein
    // DO NOTHING daraus zu machen waere eine andere Zusage.
    await expect(built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000002" }], onConflict: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    // Die Form vor der Datenbank: kein leerer Schluessel, keine doppelte Spalte,
    // kein Name ausserhalb der Grammatik.
    for (const onConflict of [[], ["id", "id"], ['id"'], ["ID; DROP"]]) {
      await expect(built.service.insertRows(context, scope, {
        schema: "public", table: "orders",
        rows: [{ id: "00000000-0000-4000-8000-000000000002", status: "paid" }], onConflict,
      })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    }
  });

  it("refuses an upsert without the right to update and never assigns a column an update may not set (2.105)", async () => {
    const uniqueKeys = [{ index_name: "orders_pkey", columns: ["id"] }];
    // Dieselbe Tabelle, aber die Rolle darf nur einfuegen. Ein Upsert aendert
    // eine vorhandene Zeile, also faellt er am fehlenden Recht — und zwar mit
    // demselben Code wie ein Aendern ohne Recht.
    const noUpdate = metadata({ can_update_table: false, can_update_column: false });
    const built = fixture((text) => {
      if (text.includes("FROM pg_catalog.pg_index AS unique_index")) return uniqueKeys;
      if (text.startsWith("INSERT INTO")) return [{ id: "x", status: "paid", total: null }];
      return [];
    }, noUpdate);
    // Ohne `onConflict` geht das Einfuegen durch: Es aendert nichts.
    await built.service.insertRows(context, scope, {
      schema: "public", table: "orders", rows: [{ status: "paid" }],
    });
    await expect(built.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000001", status: "paid" }], onConflict: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_FORBIDDEN" });

    // Eine sensible Spalte kommt weder ins Einfuegen noch in die Zuweisung.
    const withToken = fixture((text) => {
      if (text.includes("FROM pg_catalog.pg_index AS unique_index")) return uniqueKeys;
      return [];
    });
    await expect(withToken.service.insertRows(context, scope, {
      schema: "public", table: "orders",
      rows: [{ id: "00000000-0000-4000-8000-000000000001", api_token: "neu" }], onConflict: ["id"],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
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

  /**
   * Drei Tabellen fuer die Einbettungen (2.66): `orders` zeigt mit
   * `customer_id` auf `customers`, `items` zeigt mit `order_id` auf `orders`,
   * und `open_notes` hat keine Zeilensicherheit.
   */
  function embedMetadata(overrides: Record<string, Record<string, unknown>> = {}) {
    const common = {
      relation_kind: "r", row_security_enabled: true, force_row_security: false, owned_by_current_role: false,
      can_select_table: true, can_insert_table: false, can_update_table: false, can_delete_table: false,
      not_null: true, identity_kind: "", generated_kind: "",
      can_select_column: true, can_insert_column: false, can_update_column: false,
    };
    const column = (table: string, position: number, name: string, type: string, pk: number | null) => ({
      ...common, table_name: table, ordinal_position: position, column_name: name, data_type: type,
      primary_key_position: pk, ...(overrides[table] ?? {}),
    });
    const tables: Record<string, Record<string, unknown>[]> = {
      orders: [column("orders", 1, "id", "uuid", 1), column("orders", 2, "customer_id", "uuid", null),
        column("orders", 3, "status", "text", null), column("orders", 4, "api_token", "text", null)],
      customers: [column("customers", 1, "id", "uuid", 1), column("customers", 2, "name", "text", null),
        column("customers", 3, "api_token", "text", null)],
      items: [column("items", 1, "id", "integer", 1), column("items", 2, "order_id", "uuid", null),
        column("items", 3, "sku", "text", null)],
      open_notes: [column("open_notes", 1, "id", "uuid", 1), column("open_notes", 2, "order_id", "uuid", null)],
    };
    return (table: string | null) => table === null ? Object.values(tables).flat() : tables[table] ?? [];
  }
  const embedForeignKeys = [
    { constraint_name: "orders_customer_id_fkey", table_name: "orders", referenced_table: "customers",
      columns: ["customer_id"], referenced_columns: ["id"] },
    { constraint_name: "items_order_id_fkey", table_name: "items", referenced_table: "orders",
      columns: ["order_id"], referenced_columns: ["id"] },
    { constraint_name: "open_notes_order_id_fkey", table_name: "open_notes", referenced_table: "orders",
      columns: ["order_id"], referenced_columns: ["id"] },
  ];
  const order1 = "00000000-0000-4000-8000-000000000001";
  const order2 = "00000000-0000-4000-8000-000000000002";
  const customer1 = "00000000-0000-4000-8000-00000000000a";

  it("reads the select grammar with embeds one level deep and refuses what does not belong to it (2.66)", () => {
    expect(parseGeneratedSelect("id,status")).toEqual({ select: ["id", "status"], embed: [] });
    expect(parseGeneratedSelect("*")).toEqual({ embed: [] });
    expect(parseGeneratedSelect("id, customer:customers(name), items()")).toEqual({
      select: ["id"],
      embed: [{ alias: "customer", relation: "customers", columns: ["name"] }, { alias: "items", relation: "items" }],
    });
    expect(parseGeneratedSelect("*,items(*)")).toEqual({ embed: [{ alias: "items", relation: "items" }] });
    // Nur eine Einbettung und keine Spalte: die Spalten der Tabelle kommen alle.
    expect(parseGeneratedSelect("items(sku)")).toEqual({ embed: [{ alias: "items", relation: "items", columns: ["sku"] }] });
    for (const invalid of [
      "", "id,", ",id", "items(sku,)", "items(order(id))", "items(sku", "items)sku(", "*,id", "id,id",
      "items(sku),items(id)", "id,items(sku,sku)", "items(sku);drop", "items (sku)",
    ]) {
      expect(parseGeneratedSelect(invalid), invalid).toBeNull();
    }
  });

  it("embeds a one and a many relation through the foreign keys, in the same transaction and with bounded rows (2.66)", async () => {
    const built = fixture((text, values) => {
      if (text.includes("pg_catalog.pg_constraint AS fk")) return embedForeignKeys;
      if (text.includes('FROM "public"."customers"')) return [{ id: values?.[0], name: "Anna" }];
      if (text.includes('FROM "public"."items"')) {
        return Array.from({ length: DATA_API_LIMITS.maxEmbedRows + 1 }, (_, index) => ({
          id: index + 1, order_id: order1, sku: `sku-${index + 1}`, __qkern_embed_rank: index + 1,
        }));
      }
      if (text.includes('FROM "public"."orders"')) {
        return [{ id: order1, status: "paid", customer_id: customer1 }, { id: order2, status: "open", customer_id: null }];
      }
      return [];
    }, embedMetadata());
    const result = await built.service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["id", "status"],
      embed: [{ alias: "customer", relation: "customers", columns: ["name"] }, { alias: "items", relation: "items", columns: ["sku"] }],
    });
    expect(result.rows).toHaveLength(2);
    // Die erste Bestellung hat einen Kunden und mehr Positionen als die Grenze;
    // die zweite hat keinen Kunden und keine Positionen.
    expect(result.rows[0]).toMatchObject({ id: order1, status: "paid", customer: { name: "Anna" } });
    expect(result.rows[0]!.items).toHaveLength(DATA_API_LIMITS.maxEmbedRows);
    expect((result.rows[0]!.items as Array<Record<string, unknown>>)[0]).toEqual({ sku: "sku-1" });
    expect(result.rows[1]).toEqual({ id: order2, status: "open", customer: null, items: [] });
    // Die Schluesselspalte wurde mitgelesen, steht aber nicht in der Antwort.
    expect(Object.keys(result.rows[0]!)).toEqual(["id", "status", "customer", "items"]);
    expect(result.embeds).toEqual([
      { alias: "customer", relation: "customers", kind: "one", constraint: "orders_customer_id_fkey", truncated: false },
      { alias: "items", relation: "items", kind: "many", constraint: "items_order_id_fkey", truncated: true },
    ]);
    // Alles in einer Transaktion: BEGIN READ ONLY zuerst, COMMIT zuletzt, kein zweites BEGIN.
    const texts = built.client.calls.map((call) => call.text);
    expect(texts.filter((text) => text.startsWith("BEGIN"))).toEqual(["BEGIN READ ONLY"]);
    expect(texts.at(-1)).toBe("COMMIT");
    const base = built.client.calls.find((call) => call.text.includes('FROM "public"."orders"'));
    expect(base?.text).toContain('"customer_id"');
    const customers = built.client.calls.find((call) => call.text.includes('FROM "public"."customers"'));
    expect(customers?.text).toContain('WHERE "id" IN ($1)');
    expect(customers?.values).toEqual([customer1]);
    const items = built.client.calls.find((call) => call.text.includes('FROM "public"."items"'));
    expect(items?.text).toContain('PARTITION BY "order_id"');
    expect(items?.text).toContain(`"__qkern_embed_rank" <= ${DATA_API_LIMITS.maxEmbedRows + 1}`);
    expect(items?.values).toEqual([order1, order2]);
    // Nichts vom Aufrufer steht im SQL: Alias und Werte nicht.
    for (const call of built.client.calls) {
      expect(call.text).not.toContain(order1);
      expect(call.text).not.toContain("Anna");
    }
  });

  it("refuses an unknown relation, an embed over the limit, a neighbour without row security and an alias on a column (2.66)", async () => {
    const build = () => fixture((text) => {
      if (text.includes("pg_catalog.pg_constraint AS fk")) return embedForeignKeys;
      if (text.includes('FROM "public"."orders"')) return [{ id: order1, status: "paid", customer_id: customer1 }];
      return [];
    }, embedMetadata());

    // Unbekannt: Es gibt keinen Schluessel zwischen orders und invoices.
    await expect(build().service.listRows(context, scope, {
      schema: "public", table: "orders", embed: [{ alias: "invoices", relation: "invoices" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });

    // Ueber der Grenze: faellt vor der Datenbank, kein einziger Aufruf.
    const over = build();
    await expect(over.service.listRows(context, scope, {
      schema: "public", table: "orders",
      embed: Array.from({ length: DATA_API_LIMITS.maxEmbeds + 1 }, (_, index) => ({ alias: `c${index}`, relation: "customers" })),
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    expect(over.client.calls).toHaveLength(0);
    // Genau an der Grenze geht dieselbe Anfrage durch: Die Grenze liegt an der Zahl.
    const at = await build().service.listRows(context, scope, {
      schema: "public", table: "orders",
      embed: Array.from({ length: DATA_API_LIMITS.maxEmbeds }, (_, index) => ({ alias: `c${index}`, relation: "customers" })),
    });
    expect(at.embeds).toHaveLength(DATA_API_LIMITS.maxEmbeds);

    // Die Nachbartabelle ohne Zeilensicherheit: derselbe Code wie fuer die Tabelle selbst.
    const noRls = fixture((text) => text.includes("pg_catalog.pg_constraint AS fk") ? embedForeignKeys : [],
      embedMetadata({ open_notes: { row_security_enabled: false } }));
    await expect(noRls.service.listRows(context, scope, {
      schema: "public", table: "orders", embed: [{ alias: "notes", relation: "open_notes" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });
    expect(noRls.client.calls.some((call) => call.text.includes('FROM "public"."open_notes"'))).toBe(false);

    // Ein Alias auf einer Spalte wuerde den Wert ueberschreiben.
    await expect(build().service.listRows(context, scope, {
      schema: "public", table: "orders", select: ["id", "status"], embed: [{ alias: "status", relation: "customers" }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
    // Eine sensible Spalte der Nachbartabelle bleibt auch in der Klammer verboten.
    await expect(build().service.listRows(context, scope, {
      schema: "public", table: "orders", embed: [{ alias: "customer", relation: "customers", columns: ["name", "api_token"] }],
    })).rejects.toMatchObject({ code: "GENERATED_DATA_API_INVALID_INPUT" });
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
