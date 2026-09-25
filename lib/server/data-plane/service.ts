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

export type ProjectFunction = {
  name: string;
  /** f = Funktion, p = Prozedur; Aggregate und Fensterfunktionen bleiben draussen */
  kind: "function" | "procedure";
  language: string;
  /** Wie `pg_get_function_arguments`: Namen, Typen, Modi, Vorgaben */
  arguments: string;
  /** Wie `pg_get_function_identity_arguments`: ohne Vorgaben, mit OUT-Parametern */
  identityArguments: string;
  /** Wie `pg_get_function_result`; Prozeduren haben keinen */
  returnType: string | null;
  returnsSet: boolean;
  volatility: "immutable" | "stable" | "volatile";
  securityDefiner: boolean;
};

export type ProjectFunctionResult = {
  source: "postgres";
  schema: string;
  functions: ProjectFunction[];
  truncated: boolean;
};

export type ProjectIndex = {
  name: string;
  table: string;
  /** btree, hash, gin, gist, brin, spgist ... */
  accessMethod: string;
  unique: boolean;
  primary: boolean;
  /** false waehrend CREATE INDEX CONCURRENTLY oder nach einem Fehlschlag */
  valid: boolean;
  /** Spalten in Indexreihenfolge; Ausdruecke fehlen hier und stehen in `definition` */
  columns: string[];
  /** Wie `pg_get_indexdef` */
  definition: string;
  /** WHERE-Teil eines partiellen Index, sonst null */
  predicate: string | null;
};

export type ProjectIndexResult = {
  source: "postgres";
  schema: string;
  indexes: ProjectIndex[];
  truncated: boolean;
};

export type ProjectPolicy = {
  name: string;
  table: string;
  permissive: boolean;
  command: "select" | "insert" | "update" | "delete" | "all";
  /** `public` steht fuer alle Rollen */
  roles: string[];
  usingExpression: string | null;
  checkExpression: string | null;
};

export type ProjectPolicyResult = {
  source: "postgres";
  schema: string;
  policies: ProjectPolicy[];
  truncated: boolean;
};

export type ProjectEnumType = {
  name: string;
  /** In Sortierreihenfolge des Typs */
  labels: string[];
};

export type ProjectEnumTypeResult = {
  source: "postgres";
  schema: string;
  types: ProjectEnumType[];
  truncated: boolean;
};

export type ProjectExtension = {
  name: string;
  defaultVersion: string;
  /** null, wenn die Erweiterung verfuegbar, aber nicht installiert ist */
  installedVersion: string | null;
  schema: string | null;
  comment: string | null;
};

export type ProjectExtensionResult = {
  source: "postgres";
  extensions: ProjectExtension[];
  truncated: boolean;
};

export type ProjectRole = {
  name: string;
  superuser: boolean;
  createDatabase: boolean;
  createRole: boolean;
  inherit: boolean;
  login: boolean;
  replication: boolean;
  bypassRowSecurity: boolean;
  /** null heisst unbegrenzt */
  connectionLimit: number | null;
  validUntil: string | null;
};

export type ProjectRoleResult = {
  source: "postgres";
  roles: ProjectRole[];
  truncated: boolean;
};

export type ProjectPublication = {
  name: string;
  owner: string;
  publishInsert: boolean;
  publishUpdate: boolean;
  publishDelete: boolean;
  publishTruncate: boolean;
  allTables: boolean;
  /** `schema.table`, oder `schema.*` bei FOR TABLES IN SCHEMA; leer bei FOR ALL TABLES */
  tables: string[];
};

export type ProjectPublicationResult = {
  source: "postgres";
  publications: ProjectPublication[];
  truncated: boolean;
};

export type ProjectColumnPrivilege = {
  table: string;
  column: string;
  /** `public` steht fuer alle Rollen */
  grantee: string;
  privileges: Array<{ type: "select" | "insert" | "update" | "references"; grantable: boolean }>;
};

export type ProjectColumnPrivilegeResult = {
  source: "postgres";
  schema: string;
  privileges: ProjectColumnPrivilege[];
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
  inspectFunctions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectFunctionResult>;
  inspectIndexes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectIndexResult>;
  inspectPolicies(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectPolicyResult>;
  inspectEnumTypes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectEnumTypeResult>;
  inspectExtensions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectExtensionResult>;
  inspectRoles(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectRoleResult>;
  inspectPublications(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectPublicationResult>;
  inspectColumnPrivileges(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectColumnPrivilegeResult>;
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

type FunctionRow = {
  function_name: string;
  kind: "f" | "p";
  language: string;
  arguments: string;
  identity_arguments: string;
  return_type: string | null;
  returns_set: boolean;
  volatility: "i" | "s" | "v";
  security_definer: boolean;
};

const MAX_FUNCTIONS = 200;

/**
 * Funktionen und Prozeduren eines Schemas, aus `pg_proc` (2.18).
 *
 * Abgeleitet aus `functions.sql` in supabase/postgres-meta (Apache 2.0), auf
 * das reduziert, was die Liste braucht: Signatur und Rueckgabe liefern die
 * Katalogfunktionen `pg_get_function_*`, statt die Argument-Arrays selbst zu
 * entfalten. Aggregate und Fensterfunktionen bleiben draussen (`prokind`),
 * der Quelltext ebenfalls: er kann Geheimnisse tragen und gehoert in eine
 * eigene, bewusst geoeffnete Ansicht.
 */
const FUNCTIONS_SQL = `
  SELECT function.proname AS function_name,
         function.prokind AS kind,
         language.lanname AS language,
         pg_catalog.pg_get_function_arguments(function.oid) AS arguments,
         pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
         pg_catalog.pg_get_function_result(function.oid) AS return_type,
         function.proretset AS returns_set,
         function.provolatile AS volatility,
         function.prosecdef AS security_definer
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
  WHERE namespace.nspname = $1
    AND function.prokind IN ('f', 'p')
  ORDER BY function.proname ASC, function.oid ASC
  LIMIT $2`;

type IndexRow = {
  index_name: string;
  table_name: string;
  access_method: string;
  is_unique: boolean;
  is_primary: boolean;
  is_valid: boolean;
  columns: string[];
  definition: string;
  predicate: string | null;
};

type PolicyRow = {
  policy_name: string;
  table_name: string;
  permissive: boolean;
  command: "r" | "a" | "w" | "d" | "*";
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
};

type EnumTypeRow = {
  type_name: string;
  labels: string[];
};

const MAX_INDEXES = 200;
const MAX_POLICIES = 200;
const MAX_ENUM_TYPES = 200;
const MAX_ENUM_LABELS = 200;
const MAX_EXPRESSION = 4000;

/**
 * Indizes eines Schemas, aus `pg_index` (2.19). Abgeleitet aus `indexes.sql`
 * in supabase/postgres-meta (Apache 2.0): statt `pg_indexes` (das ueber den
 * Namen joint und bei gleichnamigen Indizes in zwei Schemas doppelt liefert)
 * direkt `pg_get_indexdef`; die Spaltennamen kommen aus `indkey`, Ausdruecke
 * (attnum 0) fallen dort weg und stehen in der Definition.
 */
const INDEXES_SQL = `
  SELECT index_class.relname AS index_name,
         relation.relname AS table_name,
         access_method.amname AS access_method,
         idx.indisunique AS is_unique,
         idx.indisprimary AS is_primary,
         idx.indisvalid AS is_valid,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(idx.indkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = idx.indrelid AND attribute.attnum = key.attnum
                   WHERE key.attnum > 0), ARRAY[]::text[]) AS columns,
         pg_catalog.pg_get_indexdef(idx.indexrelid) AS definition,
         pg_catalog.pg_get_expr(idx.indpred, idx.indrelid) AS predicate
  FROM pg_catalog.pg_index AS idx
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = idx.indexrelid
  JOIN pg_catalog.pg_class AS relation ON relation.oid = idx.indrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_class.relam
  WHERE namespace.nspname = $1
    AND relation.relpersistence <> 't'
  ORDER BY relation.relname ASC, index_class.relname ASC
  LIMIT $2`;

/**
 * Row-Level-Security-Regeln eines Schemas, aus `pg_policy` (2.19). Abgeleitet
 * aus `policies.sql` in supabase/postgres-meta (Apache 2.0). `polroles = {0}`
 * heisst PUBLIC, also alle Rollen; USING und WITH CHECK kommen als Text aus
 * `pg_get_expr`. Ob RLS auf der Tabelle eingeschaltet ist, sagt `/schema`.
 */
const POLICIES_SQL = `
  SELECT policy.polname AS policy_name,
         relation.relname AS table_name,
         policy.polpermissive AS permissive,
         policy.polcmd AS command,
         CASE WHEN policy.polroles = '{0}'::oid[] THEN ARRAY['public']::text[]
              ELSE ARRAY(SELECT member.rolname::text FROM pg_catalog.pg_roles AS member
                         WHERE member.oid = ANY (policy.polroles) ORDER BY member.rolname) END AS roles,
         pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
         pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = $1
  ORDER BY relation.relname ASC, policy.polname ASC
  LIMIT $2`;

/**
 * Aufzaehlungstypen eines Schemas, aus `pg_type` und `pg_enum` (2.19).
 * Abgeleitet aus `types.sql` in supabase/postgres-meta (Apache 2.0), auf
 * `typtype = 'e'` reduziert; die Werte in der Sortierreihenfolge des Typs.
 */
const ENUM_TYPES_SQL = `
  SELECT type.typname AS type_name,
         ARRAY(SELECT enum.enumlabel::text FROM pg_catalog.pg_enum AS enum
               WHERE enum.enumtypid = type.oid ORDER BY enum.enumsortorder) AS labels
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = $1
    AND type.typtype = 'e'
  ORDER BY type.typname ASC
  LIMIT $2`;

type ExtensionRow = { name: string; default_version: string; installed_version: string | null; schema: string | null; comment: string | null };
type RoleRow = {
  role_name: string; superuser: boolean; create_database: boolean; create_role: boolean; inherit: boolean;
  login: boolean; replication: boolean; bypass_rls: boolean; connection_limit: number; valid_until: string | null;
};
type PublicationRow = {
  publication_name: string; owner: string; publish_insert: boolean; publish_update: boolean; publish_delete: boolean;
  publish_truncate: boolean; all_tables: boolean; tables: string[];
};
type ColumnPrivilegeRow = { table_name: string; column_name: string; grantee: string; privilege_type: string; is_grantable: boolean };

const MAX_EXTENSIONS = 400;
const MAX_ROLES = 200;
const MAX_PUBLICATIONS = 100;
const MAX_PUBLICATION_TABLES = 500;
const MAX_COLUMN_PRIVILEGE_ROWS = 2000;
const MAX_COLUMN_PRIVILEGES = 500;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// Erweiterungsnamen duerfen Bindestriche tragen (`uuid-ossp`), anders als Bezeichner.
const EXTENSION_NAME = /^[a-z_][a-z0-9_-]{0,62}$/;

/**
 * Erweiterungen (2.20): alle verfuegbaren, mit installierter Version, wo sie
 * installiert sind. Abgeleitet aus `extensions.sql` in postgres-meta (Apache
 * 2.0). Ob eine Erweiterung installiert werden darf, entscheidet weiter die
 * Migration; hier wird nur gelesen.
 */
const EXTENSIONS_SQL = `
  SELECT available.name AS name,
         available.default_version AS default_version,
         installed.extversion AS installed_version,
         namespace.nspname AS schema,
         available.comment AS comment
  FROM pg_catalog.pg_available_extensions() AS available(name, default_version, comment)
  LEFT JOIN pg_catalog.pg_extension AS installed ON installed.extname = available.name
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = installed.extnamespace
  ORDER BY (installed.extversion IS NULL) ASC, available.name ASC
  LIMIT $1`;

/**
 * Rollen (2.20), aus `pg_roles`, ohne die vordefinierten `pg_*`-Rollen.
 * Abgeleitet aus `roles.sql` in postgres-meta (Apache 2.0), ohne Passwort
 * (in `pg_roles` ohnehin maskiert) und ohne Verbindungszaehler
 * (`pg_stat_activity` zeigt fremde Sitzungen nur mit Sonderrecht).
 *
 * `pg_roles` ist clusterweit. Seit 2.23 (Review-Befund) bleiben nur Rollen,
 * die diese Datenbank betreffen: die eigene, Eigentuemer von Objekten in
 * Anwendungsschemata, Empfaenger von Tabellen- oder Spaltenrechten dort,
 * oder in einer Policy genannt. Superuser bleiben draussen; auf einem
 * geteilten Cluster gehoeren Steuerungs- und Nachbarrollen nicht in die
 * Ansicht eines Projekts.
 */
const ROLES_SQL = `
  SELECT account.rolname AS role_name,
         account.rolsuper AS superuser,
         account.rolcreatedb AS create_database,
         account.rolcreaterole AS create_role,
         account.rolinherit AS inherit,
         account.rolcanlogin AS login,
         account.rolreplication AS replication,
         account.rolbypassrls AS bypass_rls,
         account.rolconnlimit AS connection_limit,
         to_char(account.rolvaliduntil AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS valid_until
  FROM pg_catalog.pg_roles AS account
  WHERE NOT pg_catalog.starts_with(account.rolname, 'pg_')
    AND NOT account.rolsuper
    AND (account.rolname = current_user
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 WHERE relation.relowner = account.oid
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
                 WHERE acl.grantee = account.oid
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS attribute
                 JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
                 WHERE acl.grantee = account.oid AND attribute.attnum > 0
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE account.oid = ANY (policy.polroles)))
  ORDER BY account.rolname ASC
  LIMIT $1`;

/**
 * Publikationen (2.20), aus `pg_publication` und `pg_publication_rel`.
 * Abgeleitet aus `publications.sql` in postgres-meta (Apache 2.0); die
 * Tabellen als `schema.name`, leer bei FOR ALL TABLES.
 */
const PUBLICATIONS_SQL = `
  SELECT publication.pubname AS publication_name,
         publication.pubowner::regrole::text AS owner,
         publication.pubinsert AS publish_insert,
         publication.pubupdate AS publish_update,
         publication.pubdelete AS publish_delete,
         publication.pubtruncate AS publish_truncate,
         publication.puballtables AS all_tables,
         COALESCE((SELECT array_agg(entry ORDER BY entry) FROM (
                     SELECT namespace.nspname || '.' || relation.relname AS entry
                     FROM pg_catalog.pg_publication_rel AS member
                     JOIN pg_catalog.pg_class AS relation ON relation.oid = member.prrelid
                     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                     WHERE member.prpubid = publication.oid
                     UNION ALL
                     SELECT namespace.nspname || '.*'
                     FROM pg_catalog.pg_publication_namespace AS member
                     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = member.pnnspid
                     WHERE member.pnpubid = publication.oid) AS entries), ARRAY[]::text[]) AS tables
  FROM pg_catalog.pg_publication AS publication
  ORDER BY publication.pubname ASC
  LIMIT $1`;

/**
 * Spaltenrechte eines Schemas (2.20), aus `pg_attribute.attacl` ueber
 * `aclexplode`. Abgeleitet aus `column_privileges.sql` in postgres-meta
 * (Apache 2.0), das `information_schema.column_privileges` nachbaut, weil
 * die Sicht nur zeigt, was die eigene Rolle betrifft. Tabellenrechte
 * ueberlagern Spaltenrechte; hier stehen nur die je Spalte gesetzten.
 */
const COLUMN_PRIVILEGES_SQL = `
  SELECT relation.relname AS table_name,
         attribute.attname AS column_name,
         CASE WHEN acl.grantee = 0 THEN 'public' ELSE grantee_role.rolname END AS grantee,
         acl.privilege_type AS privilege_type,
         acl.is_grantable AS is_grantable
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = $1
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL
    AND relation.relkind IN ('r', 'v', 'm', 'p', 'f')
  ORDER BY relation.relname ASC, attribute.attnum ASC, grantee ASC, acl.privilege_type ASC
  LIMIT $2`;

function assertInspectableSchema(schema: string): void {
  if (!IDENTIFIER.test(schema) || schema.startsWith("pg_") ||
      schema === "information_schema" || schema === "qkern_internal") {
    throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
  }
}

/**
 * Ein Name, den der Katalog zurueckgibt (2.23): nicht die Bezeichner-Grammatik
 * fuer Eingaben, denn `"Order_pkey"`, `Enable read access for all users` oder
 * `uuid-ossp` sind legitime Katalogwerte. Sie kommen parametrisiert aus dem
 * Katalog und gehen nur als JSON hinaus; geprueft wird Typ, Laenge (PostgreSQL
 * kappt bei 63 Bytes) und dass keine Steuerzeichen drinstecken.
 */
function catalogName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 63 && !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

function identifierList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 63);
}

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
        if (!catalogName(row.trigger_name) || !catalogName(row.table_name) ||
            !catalogName(row.function_name) || !catalogName(row.function_schema) ||
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

  async inspectFunctions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectFunctionResult> {
    assertContextAndScope(context, scope);
    if (!IDENTIFIER.test(schema) || schema.startsWith("pg_") ||
        schema === "information_schema" || schema === "qkern_internal") {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<FunctionRow>(FUNCTIONS_SQL, [schema, MAX_FUNCTIONS + 1]);
      const rows = result.rows.slice(0, MAX_FUNCTIONS);
      const functions: ProjectFunction[] = rows.map((row) => {
        if (!catalogName(row.function_name) || !catalogName(row.language) ||
            !["f", "p"].includes(row.kind) || !["i", "s", "v"].includes(row.volatility) ||
            typeof row.arguments !== "string" || row.arguments.length > 2000 ||
            typeof row.identity_arguments !== "string" || row.identity_arguments.length > 2000 ||
            (row.return_type !== null && (typeof row.return_type !== "string" || row.return_type.length > 2000)) ||
            typeof row.returns_set !== "boolean" || typeof row.security_definer !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.function_name,
          kind: row.kind === "p" ? "procedure" : "function",
          language: row.language,
          arguments: row.arguments,
          identityArguments: row.identity_arguments,
          returnType: row.return_type,
          returnsSet: row.returns_set,
          volatility: ({ i: "immutable", s: "stable", v: "volatile" } as const)[row.volatility],
          securityDefiner: row.security_definer,
        };
      });
      return { source: "postgres", schema, functions, truncated: result.rows.length > rows.length };
    });
  }

  async inspectIndexes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectIndexResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<IndexRow>(INDEXES_SQL, [schema, MAX_INDEXES + 1]);
      const rows = result.rows.slice(0, MAX_INDEXES);
      const indexes: ProjectIndex[] = rows.map((row) => {
        if (!catalogName(row.index_name) || !catalogName(row.table_name) || !catalogName(row.access_method) ||
            typeof row.is_unique !== "boolean" || typeof row.is_primary !== "boolean" || typeof row.is_valid !== "boolean" ||
            !identifierList(row.columns, 32) || typeof row.definition !== "string" || row.definition.length > MAX_EXPRESSION ||
            !boundedText(row.predicate, MAX_EXPRESSION)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.index_name, table: row.table_name, accessMethod: row.access_method,
          unique: row.is_unique, primary: row.is_primary, valid: row.is_valid,
          columns: row.columns, definition: row.definition, predicate: row.predicate,
        };
      });
      return { source: "postgres", schema, indexes, truncated: result.rows.length > rows.length };
    });
  }

  async inspectPolicies(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectPolicyResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<PolicyRow>(POLICIES_SQL, [schema, MAX_POLICIES + 1]);
      const rows = result.rows.slice(0, MAX_POLICIES);
      const policies: ProjectPolicy[] = rows.map((row) => {
        if (!catalogName(row.policy_name) || !catalogName(row.table_name) || typeof row.permissive !== "boolean" ||
            !["r", "a", "w", "d", "*"].includes(row.command) || !identifierList(row.roles, 64) || row.roles.length === 0 ||
            !boundedText(row.using_expression, MAX_EXPRESSION) || !boundedText(row.check_expression, MAX_EXPRESSION)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.policy_name, table: row.table_name, permissive: row.permissive,
          command: ({ r: "select", a: "insert", w: "update", d: "delete", "*": "all" } as const)[row.command],
          roles: row.roles, usingExpression: row.using_expression, checkExpression: row.check_expression,
        };
      });
      return { source: "postgres", schema, policies, truncated: result.rows.length > rows.length };
    });
  }

  async inspectEnumTypes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectEnumTypeResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<EnumTypeRow>(ENUM_TYPES_SQL, [schema, MAX_ENUM_TYPES + 1]);
      const rows = result.rows.slice(0, MAX_ENUM_TYPES);
      const types: ProjectEnumType[] = rows.map((row) => {
        if (!catalogName(row.type_name) || !identifierList(row.labels, MAX_ENUM_LABELS)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.type_name, labels: row.labels };
      });
      return { source: "postgres", schema, types, truncated: result.rows.length > rows.length };
    });
  }

  async inspectExtensions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectExtensionResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ExtensionRow>(EXTENSIONS_SQL, [MAX_EXTENSIONS + 1]);
      const rows = result.rows.slice(0, MAX_EXTENSIONS);
      const extensions: ProjectExtension[] = rows.map((row) => {
        if (!EXTENSION_NAME.test(row.name) || !VERSION.test(row.default_version) ||
            (row.installed_version !== null && !VERSION.test(row.installed_version)) ||
            (row.schema !== null && !catalogName(row.schema)) || !boundedText(row.comment, 400)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.name, defaultVersion: row.default_version, installedVersion: row.installed_version, schema: row.schema, comment: row.comment };
      });
      return { source: "postgres", extensions, truncated: result.rows.length > rows.length };
    });
  }

  async inspectRoles(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectRoleResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<RoleRow>(ROLES_SQL, [MAX_ROLES + 1]);
      const rows = result.rows.slice(0, MAX_ROLES);
      const roles: ProjectRole[] = rows.map((row) => {
        const flags = [row.superuser, row.create_database, row.create_role, row.inherit, row.login, row.replication, row.bypass_rls];
        if (!catalogName(row.role_name) || flags.some((flag) => typeof flag !== "boolean") ||
            !Number.isSafeInteger(row.connection_limit) || row.connection_limit < -1 || !boundedText(row.valid_until, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.role_name, superuser: row.superuser, createDatabase: row.create_database, createRole: row.create_role,
          inherit: row.inherit, login: row.login, replication: row.replication, bypassRowSecurity: row.bypass_rls,
          connectionLimit: row.connection_limit === -1 ? null : row.connection_limit, validUntil: row.valid_until,
        };
      });
      return { source: "postgres", roles, truncated: result.rows.length > rows.length };
    });
  }

  async inspectPublications(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectPublicationResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<PublicationRow>(PUBLICATIONS_SQL, [MAX_PUBLICATIONS + 1]);
      const rows = result.rows.slice(0, MAX_PUBLICATIONS);
      const publications: ProjectPublication[] = rows.map((row) => {
        const flags = [row.publish_insert, row.publish_update, row.publish_delete, row.publish_truncate, row.all_tables];
        if (!catalogName(row.publication_name) || typeof row.owner !== "string" || row.owner.length === 0 || row.owner.length > 130 ||
            flags.some((flag) => typeof flag !== "boolean") || !Array.isArray(row.tables) || row.tables.length > MAX_PUBLICATION_TABLES ||
            row.tables.some((table) => typeof table !== "string" || table.length === 0 || table.length > 130)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.publication_name, owner: row.owner, publishInsert: row.publish_insert, publishUpdate: row.publish_update,
          publishDelete: row.publish_delete, publishTruncate: row.publish_truncate, allTables: row.all_tables, tables: row.tables,
        };
      });
      return { source: "postgres", publications, truncated: result.rows.length > rows.length };
    });
  }

  async inspectColumnPrivileges(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectColumnPrivilegeResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ColumnPrivilegeRow>(COLUMN_PRIVILEGES_SQL, [schema, MAX_COLUMN_PRIVILEGE_ROWS + 1]);
      const rows = result.rows.slice(0, MAX_COLUMN_PRIVILEGE_ROWS);
      const grouped = new Map<string, ProjectColumnPrivilege>();
      let truncated = result.rows.length > rows.length;
      for (const row of rows) {
        const type = String(row.privilege_type).toLowerCase();
        if (!catalogName(row.table_name) || !catalogName(row.column_name) || !catalogName(row.grantee) ||
            !["select", "insert", "update", "references"].includes(type) || typeof row.is_grantable !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const key = `${row.table_name}\u0000${row.column_name}\u0000${row.grantee}`;
        let entry = grouped.get(key);
        if (!entry) {
          if (grouped.size >= MAX_COLUMN_PRIVILEGES) { truncated = true; continue; }
          entry = { table: row.table_name, column: row.column_name, grantee: row.grantee, privileges: [] };
          grouped.set(key, entry);
        }
        entry.privileges.push({ type: type as ProjectColumnPrivilege["privileges"][number]["type"], grantable: row.is_grantable });
      }
      return { source: "postgres", schema, privileges: [...grouped.values()], truncated };
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

  async inspectFunctions(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectFunctionResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectIndexes(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectIndexResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectPolicies(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectPolicyResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectEnumTypes(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectEnumTypeResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectExtensions(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectExtensionResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectRoles(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectRoleResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectPublications(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectPublicationResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectColumnPrivileges(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectColumnPrivilegeResult> {
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
