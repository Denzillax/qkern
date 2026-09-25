import { isReadOnlySql, redactSensitive } from "@/lib/security";
import type { Environment } from "@/lib/types";
import type { SqlPoolClient } from "@/lib/server/db/sql";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SENSITIVE_COLUMN = /(?:password|secret|token|cookie|private.?key|authorization|api.?key)/i;
const MAX_TABLES = 100;
const MAX_COLUMNS_PER_TABLE = 200;
const MAX_QUERY_ROWS = 100;
const MAX_QUERY_BYTES = 256 * 1024;

export type ProjectDataPlaneContext = {
  organizationId: string;
  actorRef: string;
};

export type ProjectDataPlaneScope = {
  projectId: string;
  environment: Environment;
};

export type ProjectDataPlaneTarget = {
  databaseInstanceRef: string;
};

export interface ProjectDataPlaneTargetResolver {
  resolveTarget(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDataPlaneTarget>;
}

export type ProjectSchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  identity: boolean;
  generated: boolean;
  sensitive: boolean;
};

export type ProjectSchemaTable = {
  name: string;
  kind: "table" | "partitioned_table" | "view" | "materialized_view";
  rowSecurityEnabled: boolean;
  columns: ProjectSchemaColumn[];
  truncated: boolean;
};

export type ProjectSchemaResult = {
  source: "postgres";
  schema: string;
  tables: ProjectSchemaTable[];
  truncated: boolean;
};

export type ProjectTrigger = {
  name: string;
  table: string;
  /** BEFORE, AFTER oder INSTEAD OF */
  timing: "before" | "after" | "instead_of";
  events: Array<"insert" | "update" | "delete" | "truncate">;
  /** FOR EACH ROW oder FOR EACH STATEMENT */
  orientation: "row" | "statement";
  enabled: "origin" | "always" | "replica" | "disabled";
  functionSchema: string;
  functionName: string;
  condition: string | null;
};

export type ProjectTriggerResult = {
  source: "postgres";
  schema: string;
  triggers: ProjectTrigger[];
  truncated: boolean;
};

export type ProjectReadQueryResult = {
  source: "postgres";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  maxRows: number;
};

export interface ProjectDataPlanePort {
  inspectSchema(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectSchemaResult>;
  queryReadOnly(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
    limit: number,
  ): Promise<ProjectReadQueryResult>;
  inspectTriggers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectTriggerResult>;
}

export type ProjectDataPlaneErrorCode =
  | "DATA_PLANE_DISABLED"
  | "DATA_PLANE_INVALID_INPUT"
  | "DATA_PLANE_NOT_READY"
  | "DATA_PLANE_UNAVAILABLE"
  | "DATA_PLANE_BOUNDARY_REJECTED"
  | "READ_ONLY_QUERY_REQUIRED";

/** Cause-free by design: connection, role, SQL and catalog details never leave the boundary. */
export class ProjectDataPlaneError extends Error {
  constructor(readonly code: ProjectDataPlaneErrorCode) {
    super("The project data plane is unavailable.");
    this.name = "ProjectDataPlaneError";
  }
}

type SchemaRow = {
  table_name: string;
  relation_kind: "r" | "p" | "v" | "m";
  row_security_enabled: boolean;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  not_null: boolean;
  identity_kind: string;
  generated_kind: string;
};

const SCHEMA_SQL = `
  SELECT relation.relname AS table_name,
         relation.relkind AS relation_kind,
         relation.relrowsecurity AS row_security_enabled,
         attribute.attnum::integer AS ordinal_position,
         attribute.attname AS column_name,
         pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
         attribute.attnotnull AS not_null,
         attribute.attidentity AS identity_kind,
         attribute.attgenerated AS generated_kind
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid
  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
  WHERE namespace.nspname = $1
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND relation.relpersistence <> 't'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
  ORDER BY relation.relname ASC, attribute.attnum ASC
  LIMIT $2`;

type TriggerRow = {
  trigger_name: string;
  table_name: string;
  enabled_mode: "O" | "A" | "R" | "D";
  is_row: boolean;
  is_before: boolean;
  is_instead: boolean;
  on_insert: boolean;
  on_update: boolean;
  on_delete: boolean;
  on_truncate: boolean;
  function_schema: string;
  function_name: string;
  condition: string | null;
};

const MAX_TRIGGERS = 200;

/**
 * Trigger eines Schemas, aus `pg_trigger` (2.9).
 *
 * Abgeleitet aus `triggers.sql` in supabase/postgres-meta (Apache 2.0), auf
 * `pg_catalog` reduziert: `information_schema.triggers` zeigt nur Trigger auf
 * Tabellen, an denen die Rolle Rechte hat, und listet je Ereignis eine Zeile;
 * hier entscheiden die Bits in `tgtype`. Interne Trigger (Fremdschluessel,
 * Constraints) bleiben draussen, wie bei postgres-meta.
 */
const TRIGGERS_SQL = `
  SELECT trigger.tgname AS trigger_name,
         relation.relname AS table_name,
         trigger.tgenabled AS enabled_mode,
         (trigger.tgtype & 1) <> 0 AS is_row,
         (trigger.tgtype & 2) <> 0 AS is_before,
         (trigger.tgtype & 64) <> 0 AS is_instead,
         (trigger.tgtype & 4) <> 0 AS on_insert,
         (trigger.tgtype & 16) <> 0 AS on_update,
         (trigger.tgtype & 8) <> 0 AS on_delete,
         (trigger.tgtype & 32) <> 0 AS on_truncate,
         function_namespace.nspname AS function_schema,
         function.proname AS function_name,
         substring(pg_catalog.pg_get_triggerdef(trigger.oid) FROM ' WHEN \((.*)\) EXECUTE ') AS condition
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = function.pronamespace
  WHERE namespace.nspname = $1
    AND NOT trigger.tgisinternal
    AND relation.relpersistence <> 't'
  ORDER BY relation.relname ASC, trigger.tgname ASC
  LIMIT $2`;

export class ProjectDataPlaneService implements ProjectDataPlanePort {
  constructor(
    private readonly targets: ProjectDataPlaneTargetResolver,
    private readonly connections: ProjectDatabaseConnectionResolver,
  ) {}

  async inspectSchema(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectSchemaResult> {
    assertContextAndScope(context, scope);
    if (!IDENTIFIER.test(schema) || schema.startsWith("pg_") ||
        schema === "information_schema" || schema === "qkern_internal") {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<SchemaRow>(SCHEMA_SQL, [
        schema,
        MAX_TABLES * MAX_COLUMNS_PER_TABLE + 1,
      ]);
      const rows = result.rows.slice(0, MAX_TABLES * MAX_COLUMNS_PER_TABLE);
      const tables = new Map<string, ProjectSchemaTable>();
      let truncated = result.rows.length > rows.length;
      for (const row of rows) {
        if (!IDENTIFIER.test(row.table_name) || !IDENTIFIER.test(row.column_name) ||
            typeof row.data_type !== "string" || row.data_type.length > 160 ||
            !Number.isSafeInteger(row.ordinal_position) || row.ordinal_position < 1) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        let table = tables.get(row.table_name);
        if (!table) {
          if (tables.size >= MAX_TABLES) { truncated = true; continue; }
          table = {
            name: row.table_name,
            kind: relationKind(row.relation_kind),
            rowSecurityEnabled: row.row_security_enabled === true,
            columns: [],
            truncated: false,
          };
          tables.set(row.table_name, table);
        }
        if (table.columns.length >= MAX_COLUMNS_PER_TABLE) {
          table.truncated = true;
          truncated = true;
          continue;
        }
        table.columns.push({
          name: row.column_name,
          dataType: row.data_type,
          nullable: row.not_null !== true,
          identity: Boolean(row.identity_kind),
          generated: Boolean(row.generated_kind),
          sensitive: SENSITIVE_COLUMN.test(row.column_name),
        });
      }
      return { source: "postgres", schema, tables: [...tables.values()], truncated };
    });
  }

  async inspectTriggers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectTriggerResult> {
    assertContextAndScope(context, scope);
    if (!IDENTIFIER.test(schema) || schema.startsWith("pg_") ||
        schema === "information_schema" || schema === "qkern_internal") {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<TriggerRow>(TRIGGERS_SQL, [schema, MAX_TRIGGERS + 1]);
      const rows = result.rows.slice(0, MAX_TRIGGERS);
      const triggers: ProjectTrigger[] = rows.map((row) => {
        if (!IDENTIFIER.test(row.trigger_name) || !IDENTIFIER.test(row.table_name) ||
            !IDENTIFIER.test(row.function_name) || !IDENTIFIER.test(row.function_schema) ||
            !["O", "A", "R", "D"].includes(row.enabled_mode) ||
            (row.condition !== null && (typeof row.condition !== "string" || row.condition.length > 2000))) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const events: ProjectTrigger["events"] = [];
        if (row.on_insert) events.push("insert");
        if (row.on_update) events.push("update");
        if (row.on_delete) events.push("delete");
        if (row.on_truncate) events.push("truncate");
        return {
          name: row.trigger_name,
          table: row.table_name,
          timing: row.is_instead ? "instead_of" : row.is_before ? "before" : "after",
          events,
          orientation: row.is_row ? "row" : "statement",
          enabled: ({ O: "origin", A: "always", R: "replica", D: "disabled" } as const)[row.enabled_mode],
          functionSchema: row.function_schema,
          functionName: row.function_name,
          condition: row.condition,
        };
      });
      return { source: "postgres", schema, triggers, truncated: result.rows.length > rows.length };
    });
  }

  async queryReadOnly(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
    limit: number,
  ): Promise<ProjectReadQueryResult> {
    assertContextAndScope(context, scope);
    if (!isReadOnlySql(statement) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_ROWS) {
      throw new ProjectDataPlaneError("READ_ONLY_QUERY_REQUIRED");
    }
    const normalized = statement.trim().replace(/;\s*$/, "");
    return this.run(context, scope, async (client) => {
      // The bounded literal is server-generated. Wrapping prevents the driver from
      // buffering an attacker-selected number of rows before application limits run.
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM (${normalized}) AS qkern_read_result LIMIT ${limit + 1}`,
      );
      const selected = result.rows.slice(0, limit);
      const rows: Array<Record<string, unknown>> = [];
      let bytes = 0;
      for (const raw of selected) {
        const normalizedRow = normalizeDataValue(raw) as Record<string, unknown>;
        const redacted = redactSensitive(normalizedRow) as Record<string, unknown>;
        const encoded = JSON.stringify(redacted);
        if (bytes + Buffer.byteLength(encoded, "utf8") > MAX_QUERY_BYTES) break;
        bytes += Buffer.byteLength(encoded, "utf8");
        rows.push(redacted);
      }
      const columns = rows[0] ? Object.keys(rows[0]).slice(0, 128) : [];
      if (columns.length === 128 && rows[0] && Object.keys(rows[0]).length > 128) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      return {
        source: "postgres",
        columns,
        rows,
        rowCount: rows.length,
        truncated: result.rows.length > limit || rows.length < selected.length,
        maxRows: limit,
      };
    });
  }

  private async run<T>(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    operation: (client: SqlPoolClient) => Promise<T>,
  ): Promise<T> {
    let resolved: ResolvedProjectDatabaseConnection;
    try {
      const target = await this.targets.resolveTarget(context, scope);
      if (!isCatalogReference(target.databaseInstanceRef)) {
        throw new ProjectDataPlaneError("DATA_PLANE_NOT_READY");
      }
      resolved = await this.connections.resolve(target.databaseInstanceRef);
      assertResolvedBoundary(resolved);
    } catch (error) {
      if (error instanceof ProjectDataPlaneError) throw error;
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    }

    let client: SqlPoolClient;
    try {
      client = await resolved.pool.connect();
    } catch {
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    }

    let started = false;
    try {
      await client.query("BEGIN READ ONLY");
      started = true;
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await client.query("SET LOCAL row_security = on");
      const boundary = await client.query<{
        role_name: string;
        session_name: string;
        database_name: string;
        read_only: boolean;
        can_login: boolean;
        superuser: boolean;
        bypass_rls: boolean;
        create_database: boolean;
        create_role: boolean;
        replication: boolean;
        has_memberships: boolean;
      }>(`SELECT role.rolname AS role_name,
                 session_user::text AS session_name,
                 current_database() AS database_name,
                 current_setting('transaction_read_only') = 'on' AS read_only,
                 role.rolcanlogin AS can_login,
                 role.rolsuper AS superuser,
                 role.rolbypassrls AS bypass_rls,
                 role.rolcreatedb AS create_database,
                 role.rolcreaterole AS create_role,
                 role.rolreplication AS replication,
                 EXISTS (
                   SELECT 1 FROM pg_catalog.pg_auth_members AS membership
                   WHERE membership.member = role.oid
                 ) AS has_memberships
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user`);
      const checked = boundary.rows[0];
      if (!checked || checked.role_name !== resolved.expectedRole ||
          checked.session_name !== resolved.expectedRole ||
          checked.database_name !== resolved.expectedDatabase || !checked.read_only || !checked.can_login ||
          checked.superuser || checked.bypass_rls || checked.create_database || checked.create_role ||
          checked.replication || checked.has_memberships) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const output = await operation(client);
      await client.query("COMMIT");
      started = false;
      return output;
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof ProjectDataPlaneError) throw error;
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}

export class DisabledProjectDataPlane implements ProjectDataPlanePort {
  async inspectSchema(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectSchemaResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectTriggers(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectTriggerResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async queryReadOnly(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _statement: string,
    _limit: number,
  ): Promise<ProjectReadQueryResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }
}

function assertContextAndScope(context: ProjectDataPlaneContext, scope: ProjectDataPlaneScope): void {
  if (!context.organizationId || context.organizationId.length > 128 ||
      !context.actorRef || context.actorRef.length > 320 ||
      !scope.projectId || scope.projectId.length > 128 ||
      !["development", "staging", "production"].includes(scope.environment)) {
    throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
  }
}

function assertResolvedBoundary(resolved: ResolvedProjectDatabaseConnection): void {
  if (!resolved || !IDENTIFIER.test(resolved.expectedRole) ||
      !IDENTIFIER.test(resolved.expectedDatabase) || !resolved.pool ||
      typeof resolved.pool.connect !== "function") {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
}

function relationKind(value: SchemaRow["relation_kind"]): ProjectSchemaTable["kind"] {
  switch (value) {
    case "r": return "table";
    case "p": return "partitioned_table";
    case "v": return "view";
    case "m": return "materialized_view";
    default: throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
}

function normalizeDataValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[BINARY:${value.byteLength}]`;
  if (Array.isArray(value)) return value.map((entry) => normalizeDataValue(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 128)) {
      output[key] = normalizeDataValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}
