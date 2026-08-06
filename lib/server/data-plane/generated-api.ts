import { randomUUID } from "node:crypto";
import type { Environment } from "@/lib/types";
import type { SqlPoolClient, SqlValue } from "@/lib/server/db/sql";
import { DisabledUsageEmitter, type UsageEmitterPort } from "@/lib/server/usage/emitter";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";
import type {
  ProjectDataPlaneScope,
  ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SENSITIVE_COLUMN = /(?:password|secret|token|cookie|private.?key|authorization|api.?key)/i;
const MAX_ROWS = 100;
const MAX_INSERT_ROWS = 25;
const MAX_COLUMNS = 100;
const MAX_FILTERS = 10;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;

export type ProjectDataClaims = {
  role: "authenticated" | "anon" | "service_role";
  subject: string;
  keyId?: string;
  email?: string;
  emailVerified?: boolean;
  assurance?: "aal1" | "aal2";
  sessionId?: string;
  userMetadata?: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
};

export type GeneratedDataContext = {
  organizationId: string;
  actorRef: string;
  claims: ProjectDataClaims;
};

export type GeneratedDataFilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";
export type GeneratedDataFilter = {
  column: string;
  operator: GeneratedDataFilterOperator;
  value: unknown;
};

export type GeneratedTableColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  identity: boolean;
  generated: boolean;
  sensitive: boolean;
  primaryKeyPosition: number | null;
  selectable: boolean;
  insertable: boolean;
  updateable: boolean;
};

export type GeneratedTable = {
  schema: string;
  name: string;
  rowSecurityEnabled: boolean;
  primaryKey: string[];
  columns: GeneratedTableColumn[];
};

export type GeneratedListInput = {
  schema: string;
  table: string;
  select?: string[];
  filters?: GeneratedDataFilter[];
  order?: { column: string; direction: "asc" | "desc" };
  cursor?: string;
  limit?: number;
};

export type GeneratedListResult = {
  source: "postgres";
  table: GeneratedTable;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  maxRows: number;
};

export type GeneratedMutationResult = {
  source: "postgres";
  table: GeneratedTable;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
};

export interface GeneratedDataApiPort {
  listRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedListInput,
  ): Promise<GeneratedListResult>;
  insertRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; rows: Array<Record<string, unknown>> },
  ): Promise<GeneratedMutationResult>;
  updateRow(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; match: Record<string, unknown>; values: Record<string, unknown> },
  ): Promise<GeneratedMutationResult>;
  deleteRow(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; match: Record<string, unknown> },
  ): Promise<GeneratedMutationResult>;
  generateOpenApi(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<Record<string, unknown>>;
}

export type GeneratedDataApiErrorCode =
  | "GENERATED_DATA_API_DISABLED"
  | "GENERATED_DATA_API_INVALID_INPUT"
  | "GENERATED_DATA_API_NOT_READY"
  | "GENERATED_DATA_API_UNAVAILABLE"
  | "GENERATED_DATA_API_BOUNDARY_REJECTED"
  | "GENERATED_DATA_API_TABLE_NOT_FOUND"
  | "GENERATED_DATA_API_RLS_REQUIRED"
  | "GENERATED_DATA_API_PRIMARY_KEY_REQUIRED"
  | "GENERATED_DATA_API_FORBIDDEN";

/** Cause-free by design: connection details, SQL and driver diagnostics stay internal. */
export class GeneratedDataApiError extends Error {
  /**
   * The message stays fixed and content-free. `cause` is internal: routes and
   * MCP serialise `code` only, and the route contract tests assert that no
   * cause reaches a client.
   */
  constructor(readonly code: GeneratedDataApiErrorCode, options?: { cause?: unknown }) {
    super("The generated project data API is unavailable.", options);
    this.name = "GeneratedDataApiError";
  }
}

/**
 * Returns the name of the violated boundary predicate, or null when the
 * introspection row is acceptable. Only predicate names are returned, never
 * schema content.
 */
function metadataRowRejection(row: MetadataRow): string | null {
  if (!IDENTIFIER.test(row.table_name)) return "table_name";
  if (!IDENTIFIER.test(row.column_name)) return "column_name";
  if (!["r", "p"].includes(row.relation_kind)) return "relation_kind";
  if (typeof row.data_type !== "string" || row.data_type.length > 160) return "data_type";
  if (!Number.isSafeInteger(row.ordinal_position) || row.ordinal_position < 1) {
    return `ordinal_position:${typeof row.ordinal_position}`;
  }
  if (row.primary_key_position !== null
    && (!Number.isSafeInteger(row.primary_key_position) || row.primary_key_position < 1)) {
    return `primary_key_position:${typeof row.primary_key_position}`;
  }
  return null;
}

type MetadataRow = {
  table_name: string;
  relation_kind: "r" | "p";
  row_security_enabled: boolean;
  force_row_security: boolean;
  owned_by_current_role: boolean;
  can_select_table: boolean;
  can_insert_table: boolean;
  can_update_table: boolean;
  can_delete_table: boolean;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  not_null: boolean;
  identity_kind: string;
  generated_kind: string;
  primary_key_position: number | null;
  can_select_column: boolean;
  can_insert_column: boolean;
  can_update_column: boolean;
};

const METADATA_SQL = `
  SELECT relation.relname AS table_name,
         relation.relkind AS relation_kind,
         relation.relrowsecurity AS row_security_enabled,
         relation.relforcerowsecurity AS force_row_security,
         relation.relowner = role.oid AS owned_by_current_role,
         has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select_table,
         has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert_table,
         has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update_table,
         has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete_table,
         attribute.attnum::integer AS ordinal_position,
         attribute.attname AS column_name,
         pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
         attribute.attnotnull AS not_null,
         attribute.attidentity AS identity_kind,
         attribute.attgenerated AS generated_kind,
         -- pg_index.indkey is an int2vector and therefore zero-based, unlike an
         -- ordinary PostgreSQL array. array_position returns the raw subscript,
         -- so the first primary key column yields 0. Normalising against
         -- array_lower makes the position one-based for any lower bound.
         array_position(primary_index.indkey::smallint[], attribute.attnum::smallint)
           - array_lower(primary_index.indkey::smallint[], 1) + 1 AS primary_key_position,
         has_column_privilege(current_user, relation.oid, attribute.attname, 'SELECT') AS can_select_column,
         has_column_privilege(current_user, relation.oid, attribute.attname, 'INSERT') AS can_insert_column,
         has_column_privilege(current_user, relation.oid, attribute.attname, 'UPDATE') AS can_update_column
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid
  JOIN pg_catalog.pg_roles AS role ON role.rolname = current_user
  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_catalog.pg_index AS primary_index
    ON primary_index.indrelid = relation.oid AND primary_index.indisprimary
  WHERE namespace.nspname = $1
    AND ($2::text IS NULL OR relation.relname = $2)
    AND relation.relkind IN ('r', 'p')
    AND relation.relpersistence <> 't'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
  ORDER BY relation.relname ASC, attribute.attnum ASC
  LIMIT $3`;

type InternalTable = GeneratedTable & {
  canSelect: boolean;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  ownedByCurrentRole: boolean;
  forceRowSecurity: boolean;
};

export class GeneratedDataApiService implements GeneratedDataApiPort {
  private readonly usage: UsageEmitterPort;

  constructor(
    private readonly targets: ProjectDataPlaneTargetResolver,
    private readonly connections: ProjectDatabaseConnectionResolver,
    /** Ohne Emitter zählt nichts — und nichts ändert sich am Verhalten. */
    usage: UsageEmitterPort = new DisabledUsageEmitter(),
  ) {
    this.usage = usage;
  }

  /**
   * Meldet gelesene Zeilen — **ohne zu gaten**.
   *
   * Die Menge steht erst fest, wenn die Abfrage gelaufen ist. Eine Antwort
   * abzulehnen, deren Arbeit bereits getan ist, würde die Kosten nicht sparen
   * und den Aufrufer um ein Ergebnis bringen, für das er schon bezahlt hat.
   *
   * Dass das Ignorieren der Antwort hier sicher ist, ist keine Nachlässigkeit,
   * sondern abgesichert: `enforce` lässt sich für diese Metrik gar nicht
   * setzen (siehe `UNENFORCEABLE_USAGE_METRICS`). Das Ledger kann sie also nicht
   * ablehnen.
   *
   * Ein Lesen ohne Zeilen zählt nicht. Die Metrik heisst `database_row_reads`.
   */
  private async meterRowReads(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    rowCount: number,
  ): Promise<void> {
    if (rowCount < 1) return;
    await this.usage.admit({
      organizationId: context.organizationId,
      projectId: scope.projectId,
      environment: scope.environment,
    }, { metric: "database_row_reads", quantity: rowCount, reference: randomUUID() });
  }

  async listRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedListInput,
  ): Promise<GeneratedListResult> {
    assertRequest(context, scope, input.schema, input.table);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROWS ||
        (input.select?.length ?? 0) > MAX_COLUMNS ||
        (input.filters?.length ?? 0) > MAX_FILTERS) {
      throw invalidInput();
    }

    return this.run(context, scope, false, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "select");
      if (table.primaryKey.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_PRIMARY_KEY_REQUIRED");
      }
      const byName = new Map(table.columns.map((column) => [column.name, column]));
      const selectedNames = input.select?.length
        ? uniqueIdentifiers(input.select)
        : table.columns.filter((column) => column.selectable && !column.sensitive).map((column) => column.name);
      if (selectedNames.length === 0 || selectedNames.some((name) => {
        const column = byName.get(name);
        return !column?.selectable || column.sensitive;
      })) throw invalidInput();

      const filters = input.filters ?? [];
      for (const filter of filters) {
        const column = byName.get(filter.column);
        if (!column?.selectable || column.sensitive || !isFilter(filter)) throw invalidInput();
      }

      const direction = input.order?.direction ?? "asc";
      const primaryOrder = input.order?.column ?? table.primaryKey[0];
      const primaryOrderColumn = byName.get(primaryOrder);
      if (!primaryOrderColumn?.selectable || primaryOrderColumn.sensitive ||
          !isSortableDataType(primaryOrderColumn.dataType)) throw invalidInput();
      const orderColumns = [primaryOrder, ...table.primaryKey.filter((name) => name !== primaryOrder)];
      if (orderColumns.some((name) => !isSortableDataType(byName.get(name)!.dataType))) throw invalidInput();

      const values: SqlValue[] = [];
      const where: string[] = [];
      for (const filter of filters) {
        where.push(filterSql(filter, values));
      }
      if (input.cursor) {
        const cursorValues = decodeCursor(input.cursor, input.schema, input.table, orderColumns, direction);
        const placeholders = cursorValues.map((value) => {
          values.push(value as SqlValue);
          return `$${values.length}`;
        });
        const comparator = direction === "asc" ? ">" : "<";
        where.push(`(${orderColumns.map(quoted).join(", ")}) ${comparator} (${placeholders.join(", ")})`);
      }

      const queryColumns = [...new Set([...selectedNames, ...orderColumns])];
      const sql = `SELECT ${queryColumns.map(quoted).join(", ")}
        FROM ${qualified(input.schema, input.table)}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${orderColumns.map((name) => `${quoted(name)} ${direction.toUpperCase()}`).join(", ")}
        LIMIT ${limit + 1}`;
      const result = await client.query<Record<string, unknown>>(sql, values);
      const selected = result.rows.slice(0, limit);
      const rows = boundedRows(selected.map((row) => projectRow(row, selectedNames)), MAX_RESPONSE_BYTES);
      if (selected.length > 0 && rows.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      const hasMore = result.rows.length > limit || rows.length < selected.length;
      const cursorSource = rows.length > 0 ? selected[rows.length - 1] : undefined;
      // Gemessen wird, was der Aufrufer tatsächlich bekommt — nicht, was die
      // Abfrage geholt hat. Die eine Zeile über dem Limit dient nur dazu,
      // `hasMore` zu bestimmen, und verlässt QKERN nie.
      await this.meterRowReads(context, scope, rows.length);
      return {
        source: "postgres",
        table: publicTable(table),
        rows,
        rowCount: rows.length,
        hasMore,
        nextCursor: hasMore && cursorSource
          ? encodeCursor(input.schema, input.table, orderColumns, direction,
            orderColumns.map((name) => normalizeDataValue(cursorSource[name])))
          : null,
        maxRows: limit,
      };
    });
  }

  async insertRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; rows: Array<Record<string, unknown>> },
  ): Promise<GeneratedMutationResult> {
    assertRequest(context, scope, input.schema, input.table);
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > MAX_INSERT_ROWS ||
        byteLength(input.rows) > MAX_INPUT_BYTES || input.rows.some((row) => !isPlainRecord(row))) {
      throw invalidInput();
    }
    return this.run(context, scope, true, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "insert");
      const byName = new Map(table.columns.map((column) => [column.name, column]));
      const columns = Object.keys(input.rows[0]).sort();
      if (columns.length > MAX_COLUMNS || input.rows.some((row) => Object.keys(row).sort().join("\0") !== columns.join("\0")) ||
          columns.some((name) => {
            const column = byName.get(name);
            return !column?.insertable || column.sensitive || column.identity || column.generated;
          }) || input.rows.some((row) => columns.some((name) => !isDataValue(row[name])))) {
        throw invalidInput();
      }
      const returning = safeReturningColumns(table);
      let result;
      if (columns.length === 0) {
        if (input.rows.length !== 1) throw invalidInput();
        result = await client.query<Record<string, unknown>>(
          `INSERT INTO ${qualified(input.schema, input.table)} DEFAULT VALUES RETURNING ${returning.map(quoted).join(", ")}`,
        );
      } else {
        const values: SqlValue[] = [];
        const tuples = input.rows.map((row) => `(${columns.map((name) => {
          values.push(row[name] as SqlValue);
          return `$${values.length}`;
        }).join(", ")})`);
        result = await client.query<Record<string, unknown>>(
          `INSERT INTO ${qualified(input.schema, input.table)} (${columns.map(quoted).join(", ")})
           VALUES ${tuples.join(", ")}
           RETURNING ${returning.map(quoted).join(", ")}`,
          values,
        );
      }
      return mutationResult(table, result.rows, MAX_INSERT_ROWS);
    });
  }

  async updateRow(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; match: Record<string, unknown>; values: Record<string, unknown> },
  ): Promise<GeneratedMutationResult> {
    assertRequest(context, scope, input.schema, input.table);
    if (!isPlainRecord(input.match) || !isPlainRecord(input.values) || byteLength(input) > MAX_INPUT_BYTES) {
      throw invalidInput();
    }
    return this.run(context, scope, true, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "update");
      assertPrimaryKeyMatch(table, input.match);
      const byName = new Map(table.columns.map((column) => [column.name, column]));
      const columns = Object.keys(input.values).sort();
      if (columns.length < 1 || columns.length > MAX_COLUMNS || columns.some((name) => {
        const column = byName.get(name);
        return !column?.updateable || column.sensitive || column.identity || column.generated ||
          column.primaryKeyPosition !== null || !isDataValue(input.values[name]);
      })) throw invalidInput();
      const values: SqlValue[] = [];
      const assignments = columns.map((name) => {
        values.push(input.values[name] as SqlValue);
        return `${quoted(name)} = $${values.length}`;
      });
      const match = primaryKeySql(table, input.match, values);
      const returning = safeReturningColumns(table);
      const result = await client.query<Record<string, unknown>>(
        `UPDATE ${qualified(input.schema, input.table)} SET ${assignments.join(", ")}
         WHERE ${match} RETURNING ${returning.map(quoted).join(", ")}`,
        values,
      );
      return mutationResult(table, result.rows, 1);
    });
  }

  async deleteRow(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; match: Record<string, unknown> },
  ): Promise<GeneratedMutationResult> {
    assertRequest(context, scope, input.schema, input.table);
    if (!isPlainRecord(input.match) || byteLength(input) > MAX_INPUT_BYTES) throw invalidInput();
    return this.run(context, scope, true, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "delete");
      assertPrimaryKeyMatch(table, input.match);
      const values: SqlValue[] = [];
      const match = primaryKeySql(table, input.match, values);
      const returning = safeReturningColumns(table);
      const result = await client.query<Record<string, unknown>>(
        `DELETE FROM ${qualified(input.schema, input.table)} WHERE ${match}
         RETURNING ${returning.map(quoted).join(", ")}`,
        values,
      );
      return mutationResult(table, result.rows, 1);
    });
  }

  async generateOpenApi(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<Record<string, unknown>> {
    assertRequest(context, scope, schema);
    return this.run(context, scope, false, async (client) => {
      const tables = (await this.loadTables(client, schema))
        .filter((table) => table.rowSecurityEnabled && (!table.ownedByCurrentRole || table.forceRowSecurity) &&
          table.primaryKey.length > 0 && table.canSelect &&
          table.columns.some((column) => column.selectable && !column.sensitive));
      const paths: Record<string, unknown> = {};
      const schemas: Record<string, unknown> = {};
      for (const table of tables) {
        const componentName = `Row_${table.name}`;
        const properties = Object.fromEntries(table.columns
          .filter((column) => column.selectable && !column.sensitive)
          .map((column) => [column.name, openApiType(column.dataType, column.nullable)]));
        schemas[componentName] = { type: "object", additionalProperties: false, properties };
        const path = `/v1/projects/${scope.projectId}/environments/${scope.environment}/tables/${table.name}/rows`;
        paths[path] = {
          get: generatedOperation(`list_${table.name}`, "List RLS-filtered rows", componentName),
          ...(table.canInsert ? { post: generatedOperation(`insert_${table.name}`, "Insert RLS-checked rows", componentName) } : {}),
          ...(table.canUpdate ? { patch: generatedOperation(`update_${table.name}`, "Update one row by primary key", componentName) } : {}),
          ...(table.canDelete ? { delete: generatedOperation(`delete_${table.name}`, "Delete one row by primary key", componentName) } : {}),
        };
      }
      return {
        openapi: "3.1.0",
        info: {
          title: `QKERN Generated Data API — ${schema}`,
          version: "1.6.0-alpha.1",
          description: "Live schema-derived, RLS-enforced table API. Sensitive-name columns are excluded.",
        },
        servers: [{ url: "/api", description: "Current QKERN deployment" }],
        security: [{ projectApiKey: [] }],
        paths,
        components: {
          securitySchemes: {
            projectApiKey: { type: "http", scheme: "bearer", bearerFormat: "QKERN project API key" },
            projectAuthAccess: { type: "http", scheme: "bearer", bearerFormat: "QKERN Project Auth Ed25519 JWT" },
            sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-qkern_session" },
          },
          schemas,
        },
      };
    });
  }

  private async loadTable(client: SqlPoolClient, schema: string, table: string): Promise<InternalTable> {
    const tables = await this.loadTables(client, schema, table);
    if (tables.length !== 1) throw new GeneratedDataApiError("GENERATED_DATA_API_TABLE_NOT_FOUND");
    return tables[0];
  }

  private async loadTables(client: SqlPoolClient, schema: string, table?: string): Promise<InternalTable[]> {
    const result = await client.query<MetadataRow>(METADATA_SQL, [schema, table ?? null, 50 * MAX_COLUMNS + 1]);
    if (result.rows.length > 50 * MAX_COLUMNS) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
    }
    const tables = new Map<string, InternalTable>();
    for (const row of result.rows) {
      const rejected = metadataRowRejection(row);
      if (rejected) {
        // The name of the violated predicate stays internal: it identifies the
        // boundary that fired without exposing any schema content. Without it a
        // rejection against a real database is impossible to diagnose.
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
          cause: new Error(`introspection row rejected by ${rejected}`),
        });
      }
      let mapped = tables.get(row.table_name);
      if (!mapped) {
        mapped = {
          schema,
          name: row.table_name,
          rowSecurityEnabled: row.row_security_enabled === true,
          primaryKey: [],
          columns: [],
          canSelect: row.can_select_table === true,
          canInsert: row.can_insert_table === true,
          canUpdate: row.can_update_table === true,
          canDelete: row.can_delete_table === true,
          ownedByCurrentRole: row.owned_by_current_role === true,
          forceRowSecurity: row.force_row_security === true,
        };
        tables.set(row.table_name, mapped);
      }
      if (mapped.columns.length >= MAX_COLUMNS) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      const sensitive = SENSITIVE_COLUMN.test(row.column_name);
      mapped.columns.push({
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.not_null !== true,
        identity: Boolean(row.identity_kind),
        generated: Boolean(row.generated_kind),
        sensitive,
        primaryKeyPosition: row.primary_key_position,
        selectable: mapped.canSelect && row.can_select_column === true,
        insertable: mapped.canInsert && row.can_insert_column === true,
        updateable: mapped.canUpdate && row.can_update_column === true,
      });
    }
    for (const mapped of tables.values()) {
      mapped.primaryKey = mapped.columns
        .filter((column) => column.primaryKeyPosition !== null)
        .sort((left, right) => left.primaryKeyPosition! - right.primaryKeyPosition!)
        .map((column) => column.name);
    }
    return [...tables.values()];
  }

  private async run<T>(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    write: boolean,
    operation: (client: SqlPoolClient) => Promise<T>,
  ): Promise<T> {
    let resolved: ResolvedProjectDatabaseConnection;
    try {
      const target = await this.targets.resolveTarget(
        { organizationId: context.organizationId, actorRef: context.actorRef },
        scope,
      );
      if (!isCatalogReference(target.databaseInstanceRef)) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_NOT_READY");
      }
      resolved = await this.connections.resolve(target.databaseInstanceRef);
      assertResolvedBoundary(resolved);
    } catch (error) {
      if (error instanceof GeneratedDataApiError) throw error;
      throw new GeneratedDataApiError("GENERATED_DATA_API_UNAVAILABLE");
    }

    let client: SqlPoolClient;
    try {
      client = await resolved.pool.connect();
    } catch {
      throw new GeneratedDataApiError("GENERATED_DATA_API_UNAVAILABLE");
    }
    let started = false;
    try {
      await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
      started = true;
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await client.query("SET LOCAL row_security = on");
      const boundary = await client.query<{
        role_name: string; session_name: string; database_name: string; read_only: boolean;
        can_login: boolean; superuser: boolean; bypass_rls: boolean; create_database: boolean;
        create_role: boolean; replication: boolean; has_memberships: boolean;
      }>(`SELECT role.rolname AS role_name, session_user::text AS session_name,
                 current_database() AS database_name,
                 current_setting('transaction_read_only') = 'on' AS read_only,
                 role.rolcanlogin AS can_login, role.rolsuper AS superuser,
                 role.rolbypassrls AS bypass_rls, role.rolcreatedb AS create_database,
                 role.rolcreaterole AS create_role, role.rolreplication AS replication,
                 EXISTS (
                   SELECT 1 FROM pg_catalog.pg_auth_members AS membership
                   WHERE membership.member = role.oid
                 ) AS has_memberships
          FROM pg_catalog.pg_roles AS role WHERE role.rolname = current_user`);
      const checked = boundary.rows[0];
      if (!checked || checked.role_name !== resolved.expectedRole ||
          checked.session_name !== resolved.expectedRole || checked.database_name !== resolved.expectedDatabase ||
          checked.read_only !== !write || !checked.can_login || checked.superuser || checked.bypass_rls ||
          checked.create_database || checked.create_role || checked.replication || checked.has_memberships) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      const claims = JSON.stringify({
        role: context.claims.role,
        sub: context.claims.subject,
        ...(context.claims.keyId ? { key_id: context.claims.keyId } : {}),
        ...(context.claims.email ? { email: context.claims.email } : {}),
        ...(context.claims.emailVerified !== undefined ? { email_verified: context.claims.emailVerified } : {}),
        ...(context.claims.assurance ? { aal: context.claims.assurance } : {}),
        ...(context.claims.sessionId ? { session_id: context.claims.sessionId } : {}),
        ...(context.claims.userMetadata ? { user_metadata: context.claims.userMetadata } : {}),
        ...(context.claims.appMetadata ? { app_metadata: context.claims.appMetadata } : {}),
      });
      if (Buffer.byteLength(claims, "utf8") > 2_000) throw invalidInput();
      await client.query(
        `SELECT set_config('request.jwt.claims', $1, true),
                set_config('request.jwt.claim.role', $2, true),
                set_config('request.jwt.claim.sub', $3, true),
                set_config('qkern.actor_ref', $4, true)`,
        [claims, context.claims.role, context.claims.subject, context.actorRef.slice(0, 200)],
      );
      const output = await operation(client);
      await client.query("COMMIT");
      started = false;
      return output;
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof GeneratedDataApiError) throw error;
      throw new GeneratedDataApiError("GENERATED_DATA_API_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}

export class DisabledGeneratedDataApi implements GeneratedDataApiPort {
  private disabled(): never { throw new GeneratedDataApiError("GENERATED_DATA_API_DISABLED"); }
  async listRows(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedListInput,
  ): Promise<GeneratedListResult> { return this.disabled(); }
  async insertRows(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope,
    _input: { schema: string; table: string; rows: Array<Record<string, unknown>> },
  ): Promise<GeneratedMutationResult> { return this.disabled(); }
  async updateRow(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope,
    _input: { schema: string; table: string; match: Record<string, unknown>; values: Record<string, unknown> },
  ): Promise<GeneratedMutationResult> { return this.disabled(); }
  async deleteRow(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope,
    _input: { schema: string; table: string; match: Record<string, unknown> },
  ): Promise<GeneratedMutationResult> { return this.disabled(); }
  async generateOpenApi(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _schema: string,
  ): Promise<Record<string, unknown>> { return this.disabled(); }
}

function assertRequest(
  context: GeneratedDataContext,
  scope: ProjectDataPlaneScope,
  schema: string,
  table?: string,
): void {
  if (!context.organizationId || context.organizationId.length > 128 ||
      !context.actorRef || context.actorRef.length > 320 ||
      !context.claims.subject || context.claims.subject.length > 320 ||
      (context.claims.email !== undefined && context.claims.email.length > 320) ||
      (context.claims.assurance !== undefined && !["aal1", "aal2"].includes(context.claims.assurance)) ||
      (context.claims.sessionId !== undefined && context.claims.sessionId.length > 128) ||
      !["authenticated", "anon", "service_role"].includes(context.claims.role) ||
      !scope.projectId || scope.projectId.length > 128 ||
      !(["development", "staging", "production"] satisfies Environment[]).includes(scope.environment) ||
      !safeSchema(schema) || (table !== undefined && !safeIdentifier(table))) {
    throw invalidInput();
  }
}

function safeSchema(value: string): boolean {
  return safeIdentifier(value) && !value.startsWith("pg_") &&
    value !== "information_schema" && value !== "qkern_internal";
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function uniqueIdentifiers(values: string[]): string[] {
  if (!values.every(safeIdentifier) || new Set(values).size !== values.length) throw invalidInput();
  return values;
}

function assertResolvedBoundary(resolved: ResolvedProjectDatabaseConnection): void {
  if (!resolved || !safeIdentifier(resolved.expectedRole) || !safeIdentifier(resolved.expectedDatabase) ||
      !resolved.pool || typeof resolved.pool.connect !== "function") {
    throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
  }
}

function assertTableBoundary(table: InternalTable, action: "select" | "insert" | "update" | "delete"): void {
  if (!table.rowSecurityEnabled) throw new GeneratedDataApiError("GENERATED_DATA_API_RLS_REQUIRED");
  if (table.ownedByCurrentRole && !table.forceRowSecurity) {
    throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
  }
  const allowed = action === "select" ? table.canSelect
    : action === "insert" ? table.canInsert
      : action === "update" ? table.canUpdate : table.canDelete;
  if (!allowed) throw new GeneratedDataApiError("GENERATED_DATA_API_FORBIDDEN");
}

/**
 * Projects a table for a client response.
 *
 * Sensitive-name columns are dropped here as well, not only from rows, filters,
 * ordering, mutations and the generated OpenAPI. Returning the descriptor
 * unfiltered disclosed the existence and the name of a column such as
 * `api_token` to every holder of a public project key, which contradicts the
 * documented contract that sensitive-name columns are excluded.
 */
function publicTable(table: InternalTable): GeneratedTable {
  return {
    schema: table.schema,
    name: table.name,
    rowSecurityEnabled: table.rowSecurityEnabled,
    primaryKey: [...table.primaryKey],
    columns: table.columns.filter((column) => !column.sensitive).map((column) => ({ ...column })),
  };
}

function qualified(schema: string, table: string): string {
  return `${quoted(schema)}.${quoted(table)}`;
}

function quoted(identifier: string): string {
  if (!safeIdentifier(identifier)) throw invalidInput();
  return `"${identifier}"`;
}

function isFilter(value: GeneratedDataFilter): boolean {
  if (!safeIdentifier(value.column) ||
      !["eq", "neq", "gt", "gte", "lt", "lte", "in"].includes(value.operator)) return false;
  if (value.operator === "in") {
    return Array.isArray(value.value) && value.value.length >= 1 && value.value.length <= 20 &&
      value.value.every(isScalarDataValue);
  }
  return isScalarDataValue(value.value);
}

function filterSql(filter: GeneratedDataFilter, values: SqlValue[]): string {
  const column = quoted(filter.column);
  if (filter.operator === "in") {
    const placeholders = (filter.value as unknown[]).map((value) => {
      values.push(value as SqlValue);
      return `$${values.length}`;
    });
    return `${column} IN (${placeholders.join(", ")})`;
  }
  if (filter.value === null) {
    if (filter.operator === "eq") return `${column} IS NULL`;
    if (filter.operator === "neq") return `${column} IS NOT NULL`;
    throw invalidInput();
  }
  const operator = {
    eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
  }[filter.operator];
  values.push(filter.value as SqlValue);
  return `${column} ${operator} $${values.length}`;
}

function isScalarDataValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" ||
    (typeof value === "string" && value.length <= 4_000) ||
    (typeof value === "number" && Number.isFinite(value));
}

function isDataValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (isScalarDataValue(value)) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((entry) => isDataValue(entry, depth + 1));
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    return entries.length <= 100 && entries.every(([key, entry]) =>
      key.length <= 128 && isDataValue(entry, depth + 1));
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; }
}

function normalizeDataValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[BINARY:${value.byteLength}]`;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => normalizeDataValue(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 100)) {
      output[key] = normalizeDataValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function projectRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((name) => [name, normalizeDataValue(row[name])]));
}

function boundedRows(rows: Array<Record<string, unknown>>, maxBytes: number): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (const row of rows) {
    const encoded = JSON.stringify(row);
    const size = Buffer.byteLength(encoded, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    output.push(row);
  }
  return output;
}

function safeReturningColumns(table: InternalTable): string[] {
  const columns = table.columns.filter((column) => column.selectable && !column.sensitive).map((column) => column.name);
  if (columns.length === 0) throw new GeneratedDataApiError("GENERATED_DATA_API_FORBIDDEN");
  return columns;
}

function mutationResult(table: InternalTable, raw: Array<Record<string, unknown>>, maximum: number): GeneratedMutationResult {
  if (raw.length > maximum) throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
  const columns = safeReturningColumns(table);
  const rows = boundedRows(raw.map((row) => projectRow(row, columns)), MAX_RESPONSE_BYTES);
  if (rows.length !== raw.length) throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
  return { source: "postgres", table: publicTable(table), rows, rowCount: rows.length };
}

function assertPrimaryKeyMatch(table: InternalTable, match: Record<string, unknown>): void {
  if (table.primaryKey.length === 0) throw new GeneratedDataApiError("GENERATED_DATA_API_PRIMARY_KEY_REQUIRED");
  const keys = Object.keys(match).sort();
  const expected = [...table.primaryKey].sort();
  if (keys.join("\0") !== expected.join("\0") || keys.some((key) => !isScalarDataValue(match[key]))) {
    throw invalidInput();
  }
}

function primaryKeySql(table: InternalTable, match: Record<string, unknown>, values: SqlValue[]): string {
  return table.primaryKey.map((name) => {
    const value = match[name];
    if (value === null) return `${quoted(name)} IS NULL`;
    values.push(value as SqlValue);
    return `${quoted(name)} = $${values.length}`;
  }).join(" AND ");
}

type Cursor = { v: 1; schema: string; table: string; order: string[]; direction: "asc" | "desc"; values: unknown[] };

function encodeCursor(
  schema: string,
  table: string,
  order: string[],
  direction: "asc" | "desc",
  values: unknown[],
): string {
  if (!values.every(isScalarDataValue)) {
    throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
  }
  return Buffer.from(JSON.stringify({ v: 1, schema, table, order, direction, values } satisfies Cursor), "utf8")
    .toString("base64url");
}

function decodeCursor(
  encoded: string,
  schema: string,
  table: string,
  order: string[],
  direction: "asc" | "desc",
): Array<string | number | boolean | null> {
  if (encoded.length < 4 || encoded.length > 4_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalidInput();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw invalidInput(); }
  if (!isPlainRecord(parsed) || parsed.v !== 1 || parsed.schema !== schema || parsed.table !== table ||
      parsed.direction !== direction || !Array.isArray(parsed.order) || !Array.isArray(parsed.values) ||
      parsed.order.join("\0") !== order.join("\0") || parsed.values.length !== order.length ||
      !parsed.values.every(isScalarDataValue)) throw invalidInput();
  return parsed.values as Array<string | number | boolean | null>;
}

function isSortableDataType(type: string): boolean {
  return !/(?:json|bytea|xml|array|\[\]|geometry|geography|tsvector|tsquery)/i.test(type);
}

function openApiType(dataType: string, nullable: boolean): Record<string, unknown> {
  let schema: Record<string, unknown>;
  if (/^(?:smallint|integer|bigint)/.test(dataType)) schema = { type: "integer" };
  else if (/^(?:numeric|decimal|real|double precision)/.test(dataType)) schema = { type: "number" };
  else if (dataType === "boolean") schema = { type: "boolean" };
  else if (dataType === "uuid") schema = { type: "string", format: "uuid" };
  else if (/timestamp/.test(dataType)) schema = { type: "string", format: "date-time" };
  else if (dataType === "date") schema = { type: "string", format: "date" };
  else if (/json/.test(dataType)) schema = {};
  else schema = { type: "string" };
  return nullable ? { anyOf: [schema, { type: "null" }] } : schema;
}

function generatedOperation(operationId: string, summary: string, componentName: string): Record<string, unknown> {
  return {
    operationId,
    summary,
    security: [{ projectApiKey: [], projectAuthAccess: [] }, { projectApiKey: [] }, { sessionCookie: [] }],
    responses: {
      "200": {
        description: "RLS-filtered result",
        content: { "application/json": { schema: { type: "object", properties: {
          data: { type: "object", properties: { rows: { type: "array", items: { $ref: `#/components/schemas/${componentName}` } } } },
        } } } },
      },
    },
  };
}

function invalidInput(): GeneratedDataApiError {
  return new GeneratedDataApiError("GENERATED_DATA_API_INVALID_INPUT");
}
