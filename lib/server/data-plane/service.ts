import { DATA_IDENTIFIER, isDataSchemaName } from "@/lib/server/data-plane/identifiers";
import { recognisedByName } from "@/lib/server/errors/identity";
import { isReadOnlySql, redactSensitive } from "@/lib/security";
import type { Environment } from "@/lib/types";
import type { SqlPoolClient } from "@/lib/server/db/sql";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";

// Rollen- und Datenbanknamen bleiben klein; Schemanamen stehen in identifiers.ts.
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

export type ProjectTableStatistics = {
  table: string;
  /** Sequenzielle Scans seit dem letzten Zuruecksetzen der Zaehler */
  seqScan: number;
  seqTupRead: number;
  /** Scans ueber einen Index der Tabelle; null im Katalog heisst 0 */
  idxScan: number;
  /** Schaetzungen des Statistiksammlers, keine exakte Zeilenzahl */
  liveTuples: number;
  deadTuples: number;
  lastAutovacuum: string | null;
  /** Letzte Stichprobe, manuell oder automatisch (`GREATEST`) */
  lastAnalyze: string | null;
};

export type ProjectIndexStatistics = {
  name: string;
  table: string;
  scans: number;
  sizeBytes: number;
  isUnique: boolean;
  isPrimary: boolean;
};

export type ProjectStatisticsResult = {
  source: "postgres";
  schema: string;
  tables: ProjectTableStatistics[];
  indexes: ProjectIndexStatistics[];
  truncated: boolean;
};

/**
 * Ein Statement aus `pg_stat_statements`, auf drei Zahlen reduziert (2.57).
 *
 * Es gibt hier kein Textfeld, und das ist der ganze Punkt. 2.40 hat die
 * Sicht bewusst ungelesen gelassen, weil `pg_stat_statements` nur Abfragen
 * normalisiert und ein Utility-Befehl (`CREATE ROLE … PASSWORD '…'`) seine
 * Literale behaelt — auf einem Cluster auch die eines fremden Mandanten. Der
 * sichere Teilausschnitt ist: nur Zeilen der eigenen Datenbank, und von
 * jeder Zeile nur die normalisierte Kennung und zwei Zaehler. Die Kennung
 * ist ein Hash ueber den Abfragebaum; sie traegt kein Literal, und aus ihr
 * laesst sich der Text nicht zurueckrechnen.
 */
export type ProjectStatementDigest = {
  /** `queryid` als Dezimaltext; `bigint` passt nicht verlustfrei in `number` */
  id: string;
  calls: number;
  /** Gesamte Ausfuehrungszeit in Millisekunden, abgerundet */
  totalTimeMs: number;
};

export type ProjectStatementResult = {
  source: "postgres";
  /** `false`, wenn `pg_stat_statements` in dieser Datenbank nicht erreichbar ist */
  installed: boolean;
  statements: ProjectStatementDigest[];
  truncated: boolean;
};

/**
 * Betriebszahlen der Projektdatenbank aus `pg_stat_database` (2.46).
 *
 * Alles hier sind Zaehler seit `statsReset`, nicht seit dem Start des
 * Servers. Die Ansicht sagt das ausdruecklich, weil eine Trefferquote von
 * 99 Prozent ueber zwei Minuten etwas anderes ist als ueber zwei Wochen.
 */
export type ProjectDatabaseActivity = {
  commits: number;
  rollbacks: number;
  /** Bloecke, die von der Platte kamen */
  blocksRead: number;
  /** Bloecke, die schon im Cache lagen; daraus rechnet die Ansicht die Trefferquote */
  blocksHit: number;
  deadlocks: number;
  tempFiles: number;
  tempBytes: number;
  /** Offene Backends dieser Datenbank, wie `pg_stat_database` sie zaehlt */
  backends: number;
  /** `current_setting('max_connections')` des Servers, nicht dieser Datenbank */
  maxConnections: number;
  /** Zeitpunkt des letzten Zuruecksetzens, UTC-Text; null heisst nie zurueckgesetzt */
  statsReset: string | null;
};

/**
 * Eine Gruppe offener Verbindungen (2.46): Rolle, Zustand, Anzahl, Alter der
 * aeltesten Sitzung in Sekunden.
 *
 * Eine Zeile je Gruppe, nie eine je Sitzung. Eine einzelne Sitzung ist ein
 * Mensch bei der Arbeit; eine Anzahl ist eine Betriebszahl. Der Abfragetext,
 * `client_addr` und `backend_xmin` stehen ausdruecklich nicht hier: Ein
 * Abfragetext kann ein Literal eines anderen Mandanten tragen.
 */
export type ProjectConnectionGroup = {
  role: string;
  /** `active`, `idle`, `idle in transaction`, ... oder `unknown` */
  state: string;
  count: number;
  /** Alter der aeltesten Sitzung dieser Gruppe in Sekunden, aus `backend_start` */
  oldestSeconds: number;
};

export type ProjectActivityResult = {
  source: "postgres";
  database: ProjectDatabaseActivity;
  connections: ProjectConnectionGroup[];
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

/**
 * Was PostgreSQL bei einer geloeschten oder geaenderten Elternzeile tut. Der
 * Katalog schreibt einen Buchstaben; hier stehen Worte.
 */
export type ProjectForeignKeyAction = "no_action" | "restrict" | "cascade" | "set_null" | "set_default";

export type ProjectForeignKey = {
  name: string;
  /** Die verweisende Tabelle; sie liegt im abgefragten Schema */
  table: string;
  /** Die verweisenden Spalten, in der Reihenfolge des Schluessels */
  columns: string[];
  /** Das Schema der Zieltabelle; kann ein anderes als das abgefragte sein */
  referencedSchema: string;
  referencedTable: string;
  /** Die Zielspalten, in derselben Reihenfolge wie `columns` */
  referencedColumns: string[];
  onDelete: ProjectForeignKeyAction;
  onUpdate: ProjectForeignKeyAction;
};

export type ProjectForeignKeyResult = {
  source: "postgres";
  schema: string;
  foreignKeys: ProjectForeignKey[];
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

/**
 * Der TLS-Zustand dieser einen Verbindung (2.53).
 *
 * Zwei verschiedene Aussagen, darum zwei Felder. `encrypted` gilt fuer das
 * Backend, das gerade liest: `pg_stat_ssl` fuer `pg_backend_pid()`, also die
 * Sitzung selbst und nie eine fremde. `serverEnabled` ist die
 * Servereinstellung `ssl`; sie sagt, ob der Server TLS ueberhaupt anbietet,
 * und nicht, ob er es erzwingt. Erzwungen wird TLS in `pg_hba.conf`, und die
 * liest QKERN nicht.
 *
 * `version` ist der Protokollname, den PostgreSQL meldet, oder null ohne TLS.
 * Chiffre, Bits und `client_dn` stehen bewusst nicht hier: Ein Zertifikatsname
 * ist eine Identitaet und keine Betriebszahl.
 */
export type ProjectDatabaseTls = {
  encrypted: boolean;
  version: string | null;
  serverEnabled: boolean;
};

/**
 * Die Verbindungsgrenzen, die der Server selbst haelt (2.53). `null` heisst
 * jeweils unbegrenzt, so wie PostgreSQL das mit -1 ausdrueckt.
 */
export type ProjectDatabaseConnectionLimits = {
  /** `max_connections` des Servers, nicht dieser Datenbank */
  maxConnections: number;
  /** `superuser_reserved_connections`; so viele Plaetze bleiben fuer Superuser frei */
  superuserReserved: number;
  /** `pg_database.datconnlimit` dieser Datenbank */
  database: number | null;
  /** `rolconnlimit` der Rolle, mit der die Data Plane liest */
  role: number | null;
};

/**
 * Was ueber die Projektdatenbank wirklich gilt (2.53): Name und Eigentuemer,
 * der TLS-Zustand, die Verbindungsgrenzen und die Rollen aus demselben
 * Katalog, den `inspectRoles` liest.
 *
 * Ausdruecklich nicht enthalten: Verbindungszeichenfolge, Passwort, Host,
 * Port. Sie stehen im Katalog der Verbindungen, verlassen ihn nie und haben
 * in dieser Antwort keinen Platz.
 */
export type ProjectDatabaseSettingsResult = {
  source: "postgres";
  databaseName: string;
  databaseOwner: string;
  /** Die Rolle, mit der diese Antwort gelesen wurde */
  currentRole: string;
  tls: ProjectDatabaseTls;
  limits: ProjectDatabaseConnectionLimits;
  roles: ProjectRole[];
  truncated: boolean;
};

/**
 * Worauf diese Umgebung laeuft (2.67): die Angaben, die der Server ueber sich
 * selbst macht, und die Groesse der einen Datenbank.
 *
 * Die Abgrenzung zu `inspectSettings` ist gewollt. Dort steht, wie die
 * Datenbank eingestellt ist (Rollen, TLS, Grenzen); hier steht, worauf sie
 * laeuft. Kein Feld wird gerechnet und keines geraten: `serverVersion` und
 * `serverVersionNum` sind zwei Angaben desselben Servers, weil die eine
 * lesbar ist und die andere vergleichbar, und QKERN aus der einen nicht die
 * andere ableiten will.
 *
 * `inRecovery` ist die einzige Aussage, die QKERN zum Thema Replikation
 * ueberhaupt treffen kann: ob die Verbindung gerade auf einem Standby liest.
 * Es ist keine Liste von Lese-Replikaten, und die Ansicht sagt das so.
 *
 * Ausdruecklich nicht enthalten: Host, Port, Verbindungszeichenfolge,
 * Datenpfad. Der Ort der Datenbank ist kein Betriebswert.
 */
export type ProjectDatabaseRuntimeResult = {
  source: "postgres";
  /** `server_version`, wie der Server ihn schreibt, etwa `17.2` */
  serverVersion: string;
  /** `server_version_num`, etwa 170002; danach laesst sich vergleichen */
  serverVersionNum: number;
  /** `server_encoding` dieser Datenbank, etwa `UTF8` */
  encoding: string;
  /** `datcollate` aus `pg_database` */
  collate: string;
  /** `datctype` aus `pg_database` */
  ctype: string;
  /**
   * `pg_database_size(current_database())`. Postgres meldet `bigint`; die Zahl
   * bleibt hier eine `number`, weil selbst 9 Petabyte noch in einen sicheren
   * Integer passen. Ueber die Grenze geht sie trotzdem geprueft.
   */
  sizeBytes: number;
  /** `pg_is_in_recovery()`: true heisst, diese Verbindung liest ein Standby */
  inRecovery: boolean;
  /** `pg_postmaster_start_time()`, UTC-Text: seit wann dieser Server laeuft */
  startedAt: string;
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
  inspectStatistics(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectStatisticsResult>;
  inspectActivity(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectActivityResult>;
  inspectStatements(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectStatementResult>;
  inspectForeignKeys(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectForeignKeyResult>;
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
  inspectSettings(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult>;
  inspectRuntime(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult>;
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
recognisedByName(ProjectDataPlaneError, "ProjectDataPlaneError");

/**
 * Erkennt einen Data-Plane-Fehler an Name und Code statt an der Klasse (2.24,
 * dasselbe Muster wie `isAuthError` aus 2.8): der Dienst lebt auf `globalThis`
 * und ueberlebt Neuladen der Module im Dev-Server; die Route importiert dann
 * eine andere Klasse als die, mit der der Fehler geworfen wurde, `instanceof`
 * ist falsch, und aus einem sauberen 503 wird ein stummes 500. Genau so sah
 * die Console am 25. September aus: jede Katalogansicht "nicht verfuegbar".
 */
export function isProjectDataPlaneError(error: unknown, code?: ProjectDataPlaneErrorCode): error is ProjectDataPlaneError {
  if (!(error instanceof Error) || error.name !== "ProjectDataPlaneError") return false;
  const candidate = error as Error & { code?: unknown };
  if (typeof candidate.code !== "string") return false;
  return code === undefined || candidate.code === code;
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

type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  referenced_schema: string;
  referenced_table: string;
  on_delete: string;
  on_update: string;
  columns: string[];
  referenced_columns: string[];
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

type TableStatisticsRow = {
  table_name: string;
  seq_scan: string | number;
  seq_tup_read: string | number;
  idx_scan: string | number;
  live_tuples: string | number;
  dead_tuples: string | number;
  last_autovacuum: string | null;
  last_analyze: string | null;
};

type IndexStatisticsRow = {
  index_name: string;
  table_name: string;
  scans: string | number;
  size_bytes: string | number;
  is_unique: boolean;
  is_primary: boolean;
};

const MAX_STATISTICS_TABLES = 200;
const MAX_STATISTICS_INDEXES = 400;

/**
 * Tabellenstatistik eines Schemas, aus `pg_stat_user_tables` (2.40).
 *
 * Der Leistungsberater rechnet daraus seine Verdachtsfaelle. Die Sicht zeigt
 * Zaehler, keine Zeileninhalte: Scans, geschaetzte lebende und tote Zeilen,
 * Zeitpunkte des letzten Aufraeumens. `last_analyze` und `last_autoanalyze`
 * kommen als `GREATEST` heraus: eine nur automatisch analysierte Tabelle hat
 * eine Stichprobe, und die Regel `never_analyzed` soll sie nicht melden.
 * Zeitpunkte als UTC-Text wie in `ROLES_SQL`, damit kein Treibertyp mitreist.
 */
const TABLE_STATISTICS_SQL = `
  SELECT stat.relname AS table_name,
         stat.seq_scan AS seq_scan,
         stat.seq_tup_read AS seq_tup_read,
         COALESCE(stat.idx_scan, 0) AS idx_scan,
         stat.n_live_tup AS live_tuples,
         stat.n_dead_tup AS dead_tuples,
         to_char(stat.last_autovacuum AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_autovacuum,
         to_char(GREATEST(stat.last_analyze, stat.last_autoanalyze) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_analyze
  FROM pg_catalog.pg_stat_user_tables AS stat
  WHERE stat.schemaname = $1
  ORDER BY stat.relname ASC
  LIMIT $2`;

/**
 * Indexstatistik eines Schemas, aus `pg_stat_user_indexes` (2.40), mit
 * `pg_index` fuer unique und Primaerschluessel und `pg_relation_size` fuer die
 * Groesse. Ein Index mit null Scans ist erst dann ein Befund, wenn er auch
 * Platz kostet; darum gehoert die Groesse dazu.
 */
const INDEX_STATISTICS_SQL = `
  SELECT stat.indexrelname AS index_name,
         stat.relname AS table_name,
         COALESCE(stat.idx_scan, 0) AS scans,
         pg_catalog.pg_relation_size(stat.indexrelid) AS size_bytes,
         idx.indisunique AS is_unique,
         idx.indisprimary AS is_primary
  FROM pg_catalog.pg_stat_user_indexes AS stat
  JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = stat.indexrelid
  WHERE stat.schemaname = $1
  ORDER BY stat.relname ASC, stat.indexrelname ASC
  LIMIT $2`;

type StatementDigestRow = {
  statement_id: string;
  calls: string | number;
  total_time_ms: string | number;
};

/** Mehr als das braucht keine Regel; der Berater nimmt ohnehin nur die teuersten fuenf. */
const MAX_STATEMENT_DIGESTS = 50;

/**
 * Gibt es `pg_stat_statements` ueberhaupt, und zwar im `search_path` dieser
 * Sitzung? `to_regclass` antwortet mit NULL statt mit einem Fehler, und ein
 * Fehler mitten in der lesenden Transaktion wuerde sie abbrechen. Steht die
 * Erweiterung in einem Schema, das die Leserolle nicht im Pfad hat, gilt sie
 * hier als nicht vorhanden — das ist die ehrlichere Antwort als ein Rateversuch.
 */
const STATEMENTS_INSTALLED_SQL = `
  SELECT to_regclass('pg_stat_statements') IS NOT NULL AS installed`;

/**
 * Der sichere Teilausschnitt aus `pg_stat_statements` (2.57).
 *
 * Drei Zusagen stecken in dieser Abfrage, und jede davon ist der Grund,
 * warum 2.40 die Sicht gar nicht erst angefasst hat:
 *
 * - **`dbid`.** Die Sicht gilt fuer den ganzen Cluster. `dbid` auf die OID
 *   der eigenen Datenbank einzugrenzen ist die Mandantengrenze, nicht eine
 *   Bequemlichkeit — genau wie `datname = current_database()` in 2.46.
 * - **Kein `query`.** Die Spalte wird nicht ausgewaehlt, nicht gefiltert und
 *   nicht sortiert. Ein Utility-Befehl behaelt seine Literale; in dieser
 *   Antwort kann er sie darum nirgends unterbringen. Uebrig bleiben die
 *   normalisierte Kennung und zwei Zaehler.
 * - **`queryid IS NOT NULL`.** Wem `pg_read_all_stats` fehlt, dem zeigt
 *   PostgreSQL fremde Zeilen ohne Kennung. Eine Zeile ohne Kennung waere im
 *   Befund nicht benennbar; sie faellt hier heraus.
 *
 * `total_exec_time` ist `double precision`; `floor(...)::bigint` macht daraus
 * einen Zaehler, den `counter` pruefen kann.
 */
const STATEMENT_DIGESTS_SQL = `
  SELECT stat.queryid::text AS statement_id,
         stat.calls AS calls,
         floor(stat.total_exec_time)::bigint AS total_time_ms
  FROM pg_stat_statements AS stat
  WHERE stat.dbid = (SELECT database.oid FROM pg_catalog.pg_database AS database
                     WHERE database.datname = current_database())
    AND stat.queryid IS NOT NULL
  ORDER BY stat.total_exec_time DESC, stat.queryid ASC
  LIMIT $1`;

type DatabaseActivityRow = {
  commits: string | number;
  rollbacks: string | number;
  blocks_read: string | number;
  blocks_hit: string | number;
  deadlocks: string | number;
  temp_files: string | number;
  temp_bytes: string | number;
  backends: string | number;
  max_connections: string | number;
  stats_reset: string | null;
};

type ConnectionGroupRow = {
  role_name: string;
  state: string;
  connections: string | number;
  oldest_seconds: string | number;
};

/** Mehr Gruppen als das hat kein Server: Rollen mal sechs Zustaende. */
const MAX_CONNECTION_GROUPS = 200;

/**
 * Betriebszahlen der eigenen Datenbank, aus `pg_stat_database` (2.46).
 *
 * `datname = current_database()` ist keine Bequemlichkeit, sondern die
 * Grenze: Auf einem Cluster stehen in dieser Sicht auch die Zeilen anderer
 * Datenbanken, also anderer Mandanten. Gelesen werden nur Zaehler, kein Name
 * und kein Wert aus einer Tabelle. `max_connections` gilt fuer den ganzen
 * Server und ist der einzige Wert, der nicht aus dieser Zeile stammt.
 */
const DATABASE_ACTIVITY_SQL = `
  SELECT stat.xact_commit AS commits,
         stat.xact_rollback AS rollbacks,
         stat.blks_read AS blocks_read,
         stat.blks_hit AS blocks_hit,
         stat.deadlocks AS deadlocks,
         stat.temp_files AS temp_files,
         stat.temp_bytes AS temp_bytes,
         stat.numbackends AS backends,
         current_setting('max_connections') AS max_connections,
         to_char(stat.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS stats_reset
  FROM pg_catalog.pg_stat_database AS stat
  WHERE stat.datname = current_database()`;

/**
 * Offene Verbindungen je Rolle und Zustand, aus `pg_stat_activity` (2.46).
 *
 * Diese Sicht ist die gefaehrlichste des ganzen Katalogs: Sie traegt den
 * Abfragetext laufender Statements, und fuer eine Rolle mit genug Rechten
 * auch die Sitzungen anderer Datenbanken desselben Clusters. Ein
 * Abfragetext kann ein Literal eines fremden Mandanten enthalten. Darum:
 *
 * - `datname = current_database()` grenzt auf die eigene Datenbank ein.
 * - Ausgewaehlt werden nur `usename`, `state` und zwei Aggregate. `query`,
 *   `backend_xmin`, `client_addr`, `client_hostname`, `application_name`,
 *   `pid` und `query_start` bleiben draussen; keines von ihnen wird
 *   gelesen, keines steht in der Antwort.
 * - `GROUP BY` statt einer Zeile je Sitzung: Eine einzelne Sitzung ist ein
 *   Mensch bei der Arbeit, eine Anzahl ist eine Betriebszahl.
 *
 * Was eine unprivilegierte Rolle nicht sehen darf, fehlt hier einfach;
 * PostgreSQL blendet fremde Sitzungen aus. Die Ansicht sagt das.
 */
const CONNECTION_GROUPS_SQL = `
  SELECT COALESCE(activity.usename::text, 'unknown') AS role_name,
         COALESCE(activity.state, 'unknown') AS state,
         count(*) AS connections,
         COALESCE(floor(EXTRACT(EPOCH FROM (now() - min(activity.backend_start)))), 0) AS oldest_seconds
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.datname = current_database()
  GROUP BY 1, 2
  ORDER BY connections DESC, role_name ASC, state ASC
  LIMIT $1`;

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

const MAX_FOREIGN_KEYS = 400;
/** Ein zusammengesetzter Schluessel darf hoechstens so viele Spalten tragen; PostgreSQL erlaubt 32. */
const MAX_FOREIGN_KEY_COLUMNS = 32;

/**
 * Fremdschluessel eines Schemas, aus `pg_constraint` mit `contype = 'f'`
 * (2.41). Der Schema-Visualizer zeichnet daraus die Linien.
 *
 * `conkey` und `confkey` sind Arrays von Spaltennummern, und ihre Reihenfolge
 * ist die des Schluessels: bei `FOREIGN KEY (b, a) REFERENCES p (y, x)` gehoert
 * `b` zu `y`. `unnest ... WITH ORDINALITY` haelt genau diese Reihenfolge fest;
 * `array_agg` ohne `ORDER BY` waere sonst die Reihenfolge des Joins, und das
 * Bild wuerde die Spalten verwechseln. Dasselbe Muster wie `indkey` in
 * `INDEXES_SQL`.
 *
 * Gefiltert wird nach dem Schema der verweisenden Tabelle. Zeigt ein Schluessel
 * in ein anderes Schema, bleibt er drin und nennt jenes Schema; wegwerfen
 * waere eine Luege im Bild.
 */
const FOREIGN_KEYS_SQL = `
  SELECT fk.conname AS constraint_name,
         relation.relname AS table_name,
         referenced_namespace.nspname AS referenced_schema,
         referenced.relname AS referenced_table,
         fk.confdeltype AS on_delete,
         fk.confupdtype AS on_update,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(fk.conkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = fk.conrelid AND attribute.attnum = key.attnum), ARRAY[]::text[]) AS columns,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(fk.confkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = fk.confrelid AND attribute.attnum = key.attnum), ARRAY[]::text[]) AS referenced_columns
  FROM pg_catalog.pg_constraint AS fk
  JOIN pg_catalog.pg_class AS relation ON relation.oid = fk.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class AS referenced ON referenced.oid = fk.confrelid
  JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced.relnamespace
  WHERE namespace.nspname = $1
    AND fk.contype = 'f'
  ORDER BY relation.relname ASC, fk.conname ASC
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

type SettingsRow = {
  database_name: string;
  database_owner: string;
  current_role_name: string;
  connection_encrypted: boolean;
  tls_version: string | null;
  server_tls_enabled: boolean;
  max_connections: number;
  superuser_reserved: number;
  database_connection_limit: number;
  role_connection_limit: number;
};

/**
 * Was ueber die Projektdatenbank gilt (2.53): Name, Eigentuemer, TLS-Zustand
 * und Verbindungsgrenzen, in einer Anweisung.
 *
 * Gelesen wird nur, was der Server ohnehin ueber sich selbst meldet. Aus
 * `pg_stat_ssl` kommt ausschliesslich die Zeile des eigenen Backends
 * (`pg_backend_pid()`); fremde Sitzungen werden nicht einmal betrachtet, und
 * `client_dn` wird nicht ausgewaehlt. `current_setting('ssl', true)` kann auf
 * einem Server ohne TLS-Unterstuetzung fehlen, darum die Vorgabe `off` statt
 * eines Fehlers.
 *
 * Es gibt hier keine Adresse: weder `inet_server_addr` noch
 * `inet_server_port`, weder `client_addr` noch ein Pfad. Der Ort der
 * Datenbank ist kein Betriebswert und hat in einer Antwort an den Mandanten
 * nichts verloren.
 */
const SETTINGS_SQL = `
  SELECT current_database() AS database_name,
         pg_catalog.pg_get_userbyid(database.datdba) AS database_owner,
         current_user::text AS current_role_name,
         COALESCE(ssl.ssl, false) AS connection_encrypted,
         ssl.version AS tls_version,
         COALESCE(current_setting('ssl', true), 'off') = 'on' AS server_tls_enabled,
         current_setting('max_connections')::integer AS max_connections,
         COALESCE(current_setting('superuser_reserved_connections', true), '0')::integer AS superuser_reserved,
         database.datconnlimit::integer AS database_connection_limit,
         account.rolconnlimit::integer AS role_connection_limit
  FROM pg_catalog.pg_database AS database
  JOIN pg_catalog.pg_roles AS account ON account.rolname = current_user
  LEFT JOIN pg_catalog.pg_stat_ssl AS ssl ON ssl.pid = pg_catalog.pg_backend_pid()
  WHERE database.datname = current_database()`;

type RuntimeRow = {
  server_version: string;
  server_version_num: number;
  server_encoding: string;
  collate: string;
  ctype: string;
  /** `bigint` kommt als Text aus dem Treiber; die Pruefung sieht ihn so */
  size_bytes: string;
  in_recovery: boolean;
  started_at: string;
};

/**
 * Worauf diese Umgebung laeuft (2.67), in einer Anweisung.
 *
 * Alles hier ist Auskunft des Servers ueber sich selbst. `current_setting`
 * fuer Version und Kodierung, `pg_database` fuer Sortierung und
 * Zeichenklassen der einen Datenbank, `pg_database_size` fuer ihre Groesse.
 *
 * `pg_is_in_recovery()` steht dabei, weil es die einzige belegbare Aussage zu
 * Replikation ist, die diese Verbindung machen kann. Eine Liste von
 * Lese-Replikaten gibt es nicht: die stuende in `pg_stat_replication` des
 * Primaerservers und setzt ein Recht voraus, das die Leserolle eines Projekts
 * nicht hat und nicht bekommen soll.
 *
 * Keine Adresse, kein Pfad: weder `inet_server_addr` noch `data_directory`.
 */
const RUNTIME_SQL = `
  SELECT current_setting('server_version') AS server_version,
         current_setting('server_version_num')::integer AS server_version_num,
         current_setting('server_encoding') AS server_encoding,
         database.datcollate AS collate,
         database.datctype AS ctype,
         pg_catalog.pg_database_size(database.oid)::text AS size_bytes,
         pg_catalog.pg_is_in_recovery() AS in_recovery,
         to_char(pg_catalog.pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
  FROM pg_catalog.pg_database AS database
  WHERE database.datname = current_database()`;

/** Wie `server_version` aussehen darf: `17.2`, `16.4 (Debian 16.4-1)`, `18beta1`. */
const SERVER_VERSION = /^[0-9][0-9A-Za-z.()+~ _-]{0,63}$/;
/** Kodierung, Sortierung und Zeichenklasse sind Katalognamen, keine Prosa. */
const ENCODING = /^[A-Za-z0-9_]{1,40}$/;
const LOCALE_NAME = /^[A-Za-z0-9._@ -]{1,100}$/;
const UNSIGNED_DECIMAL = /^[0-9]{1,20}$/;
const UTC_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

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
  if (!isDataSchemaName(schema)) {
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

/**
 * Ein Zaehler aus einer Statistiksicht (2.40). `bigint` kommt beim Treiber als
 * Dezimaltext an, darum beides. Ueber 2^53 wird gekappt statt abgelehnt: ein
 * Zaehler dieser Groesse ist real, und ein abgelehnter Wert wuerde den ganzen
 * Berater abschalten. Alle Schwellen liegen weit darunter. `null` heisst:
 * kein gueltiger Zaehler.
 */
function counter(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return null;
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
    if (!isDataSchemaName(schema)) {
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
        // Seit 2.26 mit Grossbuchstaben: `"Order"` aus Prisma fehlte sonst im Table Editor.
        if (!DATA_IDENTIFIER.test(row.table_name) || !DATA_IDENTIFIER.test(row.column_name) ||
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
    if (!isDataSchemaName(schema)) {
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
    if (!isDataSchemaName(schema)) {
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

  async inspectStatistics(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectStatisticsResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const tableRows = await client.query<TableStatisticsRow>(TABLE_STATISTICS_SQL, [schema, MAX_STATISTICS_TABLES + 1]);
      const indexRows = await client.query<IndexStatisticsRow>(INDEX_STATISTICS_SQL, [schema, MAX_STATISTICS_INDEXES + 1]);
      const selectedTables = tableRows.rows.slice(0, MAX_STATISTICS_TABLES);
      const selectedIndexes = indexRows.rows.slice(0, MAX_STATISTICS_INDEXES);
      const tables: ProjectTableStatistics[] = selectedTables.map((row) => {
        const numbers = [counter(row.seq_scan), counter(row.seq_tup_read), counter(row.idx_scan), counter(row.live_tuples), counter(row.dead_tuples)];
        if (!catalogName(row.table_name) || numbers.some((value) => value === null) ||
            !boundedText(row.last_autovacuum, 40) || !boundedText(row.last_analyze, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const [seqScan, seqTupRead, idxScan, liveTuples, deadTuples] = numbers as number[];
        return {
          table: row.table_name, seqScan, seqTupRead, idxScan, liveTuples, deadTuples,
          lastAutovacuum: row.last_autovacuum, lastAnalyze: row.last_analyze,
        };
      });
      const indexes: ProjectIndexStatistics[] = selectedIndexes.map((row) => {
        const scans = counter(row.scans);
        const sizeBytes = counter(row.size_bytes);
        if (!catalogName(row.index_name) || !catalogName(row.table_name) || scans === null || sizeBytes === null ||
            typeof row.is_unique !== "boolean" || typeof row.is_primary !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.index_name, table: row.table_name, scans, sizeBytes, isUnique: row.is_unique, isPrimary: row.is_primary };
      });
      return {
        source: "postgres", schema, tables, indexes,
        truncated: tableRows.rows.length > selectedTables.length || indexRows.rows.length > selectedIndexes.length,
      };
    });
  }

  /**
   * Betriebszahlen und Verbindungsgruppen der Projektdatenbank (2.46).
   *
   * Zwei Abfragen in derselben lesenden Transaktion wie jede andere
   * Inspektion. Die Antwort traegt keinen Abfragetext, keine Adresse und
   * keine einzelne Sitzung; was die Grenze nicht als Zaehler oder Namen
   * erkennt, faellt hier heraus statt in die Console.
   */
  async inspectActivity(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectActivityResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const databaseRows = await client.query<DatabaseActivityRow>(DATABASE_ACTIVITY_SQL);
      const groupRows = await client.query<ConnectionGroupRow>(CONNECTION_GROUPS_SQL, [MAX_CONNECTION_GROUPS + 1]);
      const row = databaseRows.rows[0];
      // Ohne Zeile in `pg_stat_database` gibt es keine Zahlen. Eine Null
      // waere gelogen, darum faellt der Aufruf hier fail-closed.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      const numbers = [
        counter(row.commits), counter(row.rollbacks), counter(row.blocks_read), counter(row.blocks_hit),
        counter(row.deadlocks), counter(row.temp_files), counter(row.temp_bytes),
        counter(row.backends), counter(row.max_connections),
      ];
      if (numbers.some((value) => value === null) || !boundedText(row.stats_reset, 40)) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const [commits, rollbacks, blocksRead, blocksHit, deadlocks, tempFiles, tempBytes, backends, maxConnections] = numbers as number[];
      const selected = groupRows.rows.slice(0, MAX_CONNECTION_GROUPS);
      const connections: ProjectConnectionGroup[] = selected.map((group) => {
        const count = counter(group.connections);
        const oldestSeconds = counter(group.oldest_seconds);
        if (!catalogName(group.role_name) || !catalogName(group.state) || group.state.length > 64 ||
            count === null || oldestSeconds === null) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { role: group.role_name, state: group.state, count, oldestSeconds };
      });
      return {
        source: "postgres",
        database: {
          commits, rollbacks, blocksRead, blocksHit, deadlocks, tempFiles, tempBytes,
          backends, maxConnections, statsReset: row.stats_reset,
        },
        connections,
        truncated: groupRows.rows.length > selected.length,
      };
    });
  }

  /**
   * Die teuersten Statements der eigenen Datenbank, ohne ihren Text (2.57).
   *
   * Der Gegenentwurf zu "gar nicht lesen" aus 2.40: Statt die Sicht ganz
   * liegen zu lassen, wird sie so eng gelesen, dass ihr gefaehrlicher Teil
   * gar nicht erst mitkommt. `STATEMENT_DIGESTS_SQL` waehlt `query` nicht
   * aus, und dieser Rumpf baut die Antwort aus drei Feldern, die alle die
   * Grenze passieren muessen: eine Kennung aus Ziffern, zwei Zaehler. Was
   * die Grenze nicht als solches erkennt, laesst den Aufruf scheitern,
   * statt in die Console zu laufen.
   *
   * Fehlt die Erweiterung, ist das kein Fehler: `installed: false` ist die
   * ehrliche Antwort, und der Berater macht daraus einen Grund.
   */
  async inspectStatements(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectStatementResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const probe = await client.query<{ installed: boolean }>(STATEMENTS_INSTALLED_SQL);
      if (probe.rows[0]?.installed !== true) {
        return { source: "postgres", installed: false, statements: [], truncated: false };
      }
      const result = await client.query<StatementDigestRow>(STATEMENT_DIGESTS_SQL, [MAX_STATEMENT_DIGESTS + 1]);
      const rows = result.rows.slice(0, MAX_STATEMENT_DIGESTS);
      const statements: ProjectStatementDigest[] = rows.map((row) => {
        const calls = counter(row.calls);
        const totalTimeMs = counter(row.total_time_ms);
        // Eine `queryid` ist ein `bigint`, also hoechstens 20 Zeichen aus
        // Ziffern und einem moeglichen Minus. Alles andere waere kein
        // Statement-Hash, und was hier nicht hineinpasst, geht nicht hinaus.
        if (typeof row.statement_id !== "string" || !/^-?[0-9]{1,20}$/.test(row.statement_id) ||
            calls === null || totalTimeMs === null) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { id: row.statement_id, calls, totalTimeMs };
      });
      return {
        source: "postgres", installed: true, statements,
        truncated: result.rows.length > rows.length,
      };
    });
  }

  async inspectForeignKeys(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectForeignKeyResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL, [schema, MAX_FOREIGN_KEYS + 1]);
      const rows = result.rows.slice(0, MAX_FOREIGN_KEYS);
      const foreignKeys: ProjectForeignKey[] = rows.map((row) => {
        if (!catalogName(row.constraint_name) || !catalogName(row.table_name) ||
            !catalogName(row.referenced_schema) || !catalogName(row.referenced_table) ||
            !identifierList(row.columns, MAX_FOREIGN_KEY_COLUMNS) || row.columns.length === 0 ||
            !identifierList(row.referenced_columns, MAX_FOREIGN_KEY_COLUMNS) ||
            // Ein Fremdschluessel hat auf beiden Seiten gleich viele Spalten. Stimmt
            // das nicht, hat die Abfrage eine Spalte verloren, und das Bild waere falsch.
            row.referenced_columns.length !== row.columns.length) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.constraint_name,
          table: row.table_name,
          columns: row.columns,
          referencedSchema: row.referenced_schema,
          referencedTable: row.referenced_table,
          referencedColumns: row.referenced_columns,
          onDelete: foreignKeyAction(row.on_delete),
          onUpdate: foreignKeyAction(row.on_update),
        };
      });
      return { source: "postgres", schema, foreignKeys, truncated: result.rows.length > rows.length };
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

  /**
   * Die Einstellungen der Projektdatenbank (2.53). Dieselbe Verbindung, zwei
   * Anweisungen: die Rollen aus `ROLES_SQL`, also genau die Liste, die
   * `inspectRoles` liefert, und daneben Name, Eigentuemer, TLS-Zustand und
   * Grenzen. Nichts davon wird gerechnet oder geraten; was der Katalog nicht
   * in der erwarteten Form meldet, faellt an der Grenze durch.
   */
  async inspectSettings(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const settingsResult = await client.query<SettingsRow>(SETTINGS_SQL);
      const roleResult = await client.query<RoleRow>(ROLES_SQL, [MAX_ROLES + 1]);
      const row = settingsResult.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Eine leere Antwort waere eine
      // Behauptung ueber eine Datenbank, die der Katalog nicht kennt.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      const flags = [row.connection_encrypted, row.server_tls_enabled];
      const numbers = [row.max_connections, row.superuser_reserved, row.database_connection_limit, row.role_connection_limit];
      if (!catalogName(row.database_name) || !catalogName(row.database_owner) || !catalogName(row.current_role_name) ||
          flags.some((flag) => typeof flag !== "boolean") ||
          numbers.some((value) => !Number.isSafeInteger(value) || value < -1) ||
          !boundedText(row.tls_version, 32) ||
          (typeof row.tls_version === "string" && !/^[A-Za-z0-9. _-]{1,32}$/.test(row.tls_version))) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const roleRows = roleResult.rows.slice(0, MAX_ROLES);
      const roles: ProjectRole[] = roleRows.map((entry) => {
        const roleFlags = [entry.superuser, entry.create_database, entry.create_role, entry.inherit, entry.login, entry.replication, entry.bypass_rls];
        if (!catalogName(entry.role_name) || roleFlags.some((flag) => typeof flag !== "boolean") ||
            !Number.isSafeInteger(entry.connection_limit) || entry.connection_limit < -1 || !boundedText(entry.valid_until, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: entry.role_name, superuser: entry.superuser, createDatabase: entry.create_database, createRole: entry.create_role,
          inherit: entry.inherit, login: entry.login, replication: entry.replication, bypassRowSecurity: entry.bypass_rls,
          connectionLimit: entry.connection_limit === -1 ? null : entry.connection_limit, validUntil: entry.valid_until,
        };
      });
      return {
        source: "postgres",
        databaseName: row.database_name,
        databaseOwner: row.database_owner,
        currentRole: row.current_role_name,
        tls: {
          encrypted: row.connection_encrypted,
          version: row.connection_encrypted ? row.tls_version : null,
          serverEnabled: row.server_tls_enabled,
        },
        limits: {
          maxConnections: row.max_connections,
          superuserReserved: row.superuser_reserved,
          database: row.database_connection_limit === -1 ? null : row.database_connection_limit,
          role: row.role_connection_limit === -1 ? null : row.role_connection_limit,
        },
        roles,
        truncated: roleResult.rows.length > roleRows.length,
      };
    });
  }

  /**
   * Worauf diese Umgebung laeuft (2.67), in einer Anweisung und ohne Rechnung.
   *
   * Jede Angabe wird an der Grenze geprueft, bevor sie den Dienst verlaesst.
   * Das ist hier kein Formalismus: `server_version` ist ein freier Text, den
   * der Packager setzt, und `datcollate` traegt einen Gebietsnamen aus dem
   * Betriebssystem. Was nicht wie ein Katalogwert aussieht, faellt durch,
   * statt in der Console zu landen.
   */
  async inspectRuntime(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<RuntimeRow>(RUNTIME_SQL);
      const row = result.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Eine leere Antwort waere eine
      // Behauptung ueber eine Datenbank, die der Katalog nicht kennt.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      if (typeof row.server_version !== "string" || !SERVER_VERSION.test(row.server_version) ||
          !Number.isSafeInteger(row.server_version_num) ||
          row.server_version_num < 80_000 || row.server_version_num > 99_999_999 ||
          typeof row.server_encoding !== "string" || !ENCODING.test(row.server_encoding) ||
          typeof row.collate !== "string" || !LOCALE_NAME.test(row.collate) ||
          typeof row.ctype !== "string" || !LOCALE_NAME.test(row.ctype) ||
          typeof row.size_bytes !== "string" || !UNSIGNED_DECIMAL.test(row.size_bytes) ||
          typeof row.in_recovery !== "boolean" ||
          typeof row.started_at !== "string" || !UTC_MOMENT.test(row.started_at)) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const sizeBytes = Number(row.size_bytes);
      // Eine Groesse jenseits des sicheren Integers waere still falsch. Lieber
      // keine Antwort als eine gerundete.
      if (!Number.isSafeInteger(sizeBytes)) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      return {
        source: "postgres",
        serverVersion: row.server_version,
        serverVersionNum: row.server_version_num,
        encoding: row.server_encoding,
        collate: row.collate,
        ctype: row.ctype,
        sizeBytes,
        inRecovery: row.in_recovery,
        startedAt: row.started_at,
      };
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
      if (isProjectDataPlaneError(error)) throw error;
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
      if (isProjectDataPlaneError(error)) throw error;
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}

export class DisabledProjectDataPlane implements ProjectDataPlanePort {
  /** Literal statt Klassenname: ein Bundle darf den Klassennamen kuerzen (Review 2.28). */
  readonly kind = "disabled" as const;

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

  async inspectStatistics(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectStatisticsResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectActivity(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectActivityResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectStatements(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectStatementResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectForeignKeys(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectForeignKeyResult> {
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

  async inspectSettings(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectRuntime(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult> {
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

/**
 * `confdeltype` und `confupdtype` aus `pg_constraint` in Worte (2.41). Ein
 * unbekannter Buchstabe ist kein Fall fuer eine Vorgabe: dann kennt QKERN die
 * PostgreSQL-Version nicht, die ihn schreibt, und raten waere schlimmer als
 * abbrechen.
 */
function foreignKeyAction(value: unknown): ProjectForeignKeyAction {
  switch (value) {
    case "a": return "no_action";
    case "r": return "restrict";
    case "c": return "cascade";
    case "n": return "set_null";
    case "d": return "set_default";
    default: throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
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
