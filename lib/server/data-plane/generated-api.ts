import { DATA_IDENTIFIER, DATA_IDENTIFIER_PATTERN, isDataSchemaName } from "@/lib/server/data-plane/identifiers";
import { readFreeQuery, type FreeQueryRelation } from "@/lib/server/data-plane/free-query";
import { DATA_API_LIMITS, SENSITIVE_COLUMN_PATTERN, type DataApiFilterOperator } from "@/lib/data-api-limits";
import { recognisedByName } from "@/lib/server/errors/identity";
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

// Seit 2.26 mit Grossbuchstaben (`"Order"`, `"createdAt"`); siehe identifiers.ts.
const IDENTIFIER = DATA_IDENTIFIER;
// Zeilengrenze, Filterzahl, Operatoren und das Muster fuer sensible Spalten
// stehen in lib/data-api-limits.ts, weil die Console sie auch zeigt.
const SENSITIVE_COLUMN = new RegExp(SENSITIVE_COLUMN_PATTERN, "i");
const MAX_ROWS = DATA_API_LIMITS.rowsMax;
const MIN_ROWS = DATA_API_LIMITS.rowsMin;
// Zeilen je Mutation (2.97): dieselbe Zahl fuer ein Einfuegen ueber REST und
// fuer jede Mutation der GraphQL-Flaeche, in lib/data-api-limits.ts genannt.
const MAX_INSERT_ROWS = DATA_API_LIMITS.mutationRowsMax;
const MAX_MUTATIONS = DATA_API_LIMITS.mutationsMax;
const MAX_COLUMNS = 100;
const MAX_FILTERS = DATA_API_LIMITS.maxFilters;
const MAX_EMBEDS = DATA_API_LIMITS.maxEmbeds;
const MAX_EMBED_ROWS = DATA_API_LIMITS.maxEmbedRows;
/** Ebenen einer Einbettung (2.111); die Rechnung dazu steht in lib/data-api-limits.ts. */
const MAX_EMBED_DEPTH = DATA_API_LIMITS.maxEmbedDepth;
/** Einbettungen in einer Einbettung (2.111). */
const MAX_NESTED_EMBEDS = DATA_API_LIMITS.maxNestedEmbeds;
/**
 * Fremdschluessel zwischen zwei genannten Tabellen, die der Katalog hergibt.
 * Zwei sind schon mehrdeutig; die Abfrage holt drei, damit die Ablehnung nicht
 * davon abhaengt, wie viele es genau sind.
 */
const MAX_EMBED_FOREIGN_KEYS = 2;
/** PostgreSQL erlaubt 32 Spalten je Schluessel; dieselbe Zahl wie in service.ts. */
const MAX_FOREIGN_KEY_COLUMNS = 32;
/** Eindeutige Schluessel an einer Tabelle, die der Katalog fuer einen Upsert hergibt (2.105). */
const MAX_UNIQUE_KEYS = 100;
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
  /**
   * Der Aussteller eines fremden Tokens (2.80). Nur gesetzt, wenn das Token
   * **nicht** von QKERN kommt.
   *
   * Er steht als `iss` in `request.jwt.claims`, damit eine Policy den
   * Unterschied lesen kann. Ohne ihn saehe eine Bedingung nur `role` und `sub`
   * und koennte nicht unterscheiden, ob dieses Subjekt ein Nutzer dieses
   * Projekts ist oder ein Konto bei einem fremden Dienst. Das ist genau die
   * Unterscheidung, die eine Policy treffen koennen muss.
   */
  issuer?: string;
  /**
   * Die uebrigen Ansprueche eines fremden Ausstellers (2.80): flach, skalar und
   * begrenzt, so wie `third-party.ts` sie durchlaesst.
   *
   * Sie werden **vor** den eigenen Anspruechen gesetzt, damit ein fremder Name,
   * der bis hierher kaeme, nie gewinnt. Gefiltert hat ihn schon die Pruefung;
   * die Reihenfolge hier ist die Absicherung dagegen, dass jemand einen zweiten
   * Weg baut, der die Filterung nicht kennt.
   */
  external?: Record<string, string | number | boolean | null>;
};

export type GeneratedDataContext = {
  organizationId: string;
  actorRef: string;
  claims: ProjectDataClaims;
};

export type GeneratedDataFilterOperator = DataApiFilterOperator;
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
  /** Views sind lesend; Schreibversuche enden mit GENERATED_DATA_API_READ_ONLY. */
  kind: "table" | "view";
  rowSecurityEnabled: boolean;
  primaryKey: string[];
  columns: GeneratedTableColumn[];
  /**
   * Die Tabellenrechte der Projektrolle (2.97), damit die GraphQL-Flaeche ihr
   * Schema aus demselben Katalog baut: Eine Mutation steht nur dort, wo die
   * Rolle das Recht dazu hat. Ob eine Zeile durchkommt, entscheidet die Policy.
   */
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

/**
 * Eine eingebettete Beziehung (2.66): `autor:autoren(name)` in `select`.
 *
 * `relation` ist der Name der Nachbartabelle im selben Schema. Welche Seite
 * des Fremdschluessels gemeint ist, entscheidet der Katalog: Zeigt der
 * Schluessel von der Basistabelle auf die Nachbartabelle, kommt eine Zeile
 * oder `null`; zeigt er von der Nachbartabelle her, kommt eine Liste. Gibt es
 * mehr als einen Schluessel zwischen den beiden Tabellen, wird die Einbettung
 * als mehrdeutig abgewiesen; ein Hinweis auf den Schluessel, wie PostgREST ihn
 * kennt, gibt es hier nicht.
 *
 * Seit 2.111 darf eine Einbettung eine zweite tragen (`beitraege(autor(name))`),
 * und zwar nur in der Richtung `one`; die Rechnung dazu steht bei
 * `DATA_API_LIMITS.maxEmbedDepth`. Seit 2.112 darf `schema` die Nachbartabelle
 * in ein anderes Schema legen.
 */
export type GeneratedEmbed = {
  /** Der Schluessel in der Antwortzeile; ohne `alias:` der Name der Beziehung. */
  alias: string;
  relation: string;
  /**
   * Das Schema der Nachbartabelle (2.112); fehlt es, das Schema der
   * Basistabelle. Die Tabelle geht in jedem Fall durch dieselbe Pruefung.
   */
  schema?: string;
  /** Spalten der Nachbartabelle; fehlt die Liste, alle waehlbaren, nicht sensiblen. */
  columns?: string[];
  /** Die zweite Ebene (2.111), hoechstens `DATA_API_LIMITS.maxNestedEmbeds` Eintraege. */
  embed?: GeneratedEmbed[];
};

export type GeneratedEmbedResult = {
  alias: string;
  relation: string;
  /** `one`: der Schluessel zeigt von der Basistabelle weg; `many`: er zeigt auf sie. */
  kind: "one" | "many";
  /** Der Name des Fremdschluessels, ueber den die Einbettung lief. */
  constraint: string;
  /** Mindestens eine Elternzeile hatte mehr als `DATA_API_LIMITS.maxEmbedRows` Nachbarn. */
  truncated: boolean;
  /**
   * Das Schema der Nachbartabelle, **nur wenn es ein anderes ist** als das der
   * Basistabelle (2.112). Fehlt der Schluessel, lief die Einbettung im selben
   * Schema; so traegt die Antwort einer gewoehnlichen Einbettung kein Feld, das
   * nichts sagt.
   */
  schema?: string;
  /** Eine Angabe je Einbettung der zweiten Ebene (2.111); fehlt ohne zweite Ebene. */
  embeds?: GeneratedEmbedResult[];
};

export type GeneratedListInput = {
  schema: string;
  table: string;
  select?: string[];
  embed?: GeneratedEmbed[];
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
  /** Eine Angabe je Einbettung aus `select`, in der Reihenfolge der Anfrage; leer ohne Einbettung. */
  embeds: GeneratedEmbedResult[];
};

export type GeneratedMutationResult = {
  source: "postgres";
  table: GeneratedTable;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  /**
   * Eine Angabe je Einbettung der Mutation (2.111), in der Reihenfolge der
   * Anfrage; leer ohne Einbettung. Dieselbe Form wie bei einer Lesung, weil es
   * dieselbe Einbettung ist.
   */
  embeds: GeneratedEmbedResult[];
};

/**
 * Eine Mutation im Stapel (2.97): einfuegen, aendern mit Bedingung, loeschen
 * mit Bedingung. Aendern und Loeschen verlangen mindestens einen Filter; ein
 * Stapel ohne Bedingung aendert nie die ganze Tabelle. `atMost` ist die
 * Obergrenze getroffener Zeilen, hoechstens `DATA_API_LIMITS.mutationRowsMax`.
 *
 * `onConflict` macht aus dem Einfuegen einen Upsert (2.105): die Spalten des
 * Konfliktschluessels, die es im Katalog als Primaerschluessel oder eindeutigen
 * Index geben muss. Siehe `insertWithin`.
 *
 * `embed` haengt der Antwort die Nachbarzeilen der geschriebenen Zeilen an
 * (2.111). Es ist **ein Lesen und kein Schreiben**: Was in `embed` steht, wird
 * nach der Mutation und in derselben Transaktion gelesen, mit denselben
 * Grenzen und derselben Tuer wie bei einer Lesung. Ein Schreiben ueber eine
 * Beziehung gibt es an dieser Flaeche nicht, und die GraphQL-Grammatik weist es
 * mit eigenem Grund ab (`nested_write_not_supported`).
 *
 * Ein Loeschen traegt `embed` nicht. Die Nachbarzeilen einer geloeschten Zeile
 * sind nach dem Loeschen entweder mitgeloescht oder haetten das Loeschen
 * verhindert; was dann noch zu lesen waere, haengt an der Regel des
 * Fremdschluessels und nicht an der Anfrage. Eine Antwort, die davon abhaengt,
 * ist keine Zusage.
 */
export type GeneratedMutation =
  | {
    kind: "insert"; table: string; rows: Array<Record<string, unknown>>;
    onConflict?: string[]; embed?: GeneratedEmbed[];
  }
  | {
    kind: "update"; table: string; filters: GeneratedDataFilter[];
    values: Record<string, unknown>; atMost?: number; embed?: GeneratedEmbed[];
  }
  | { kind: "delete"; table: string; filters: GeneratedDataFilter[]; atMost?: number };

export type GeneratedMutationBatchInput = { schema: string; mutations: GeneratedMutation[] };

/** Ein Ergebnis je Mutation, in der Reihenfolge des Stapels; alle aus einer Transaktion. */
export type GeneratedMutationBatchResult = { source: "postgres"; results: GeneratedMutationResult[] };

export type GeneratedAggregateFunction = "count" | "sum" | "avg" | "min" | "max";
export type GeneratedAggregate = { fn: GeneratedAggregateFunction; column?: string };
export type GeneratedAggregateInput = {
  schema: string;
  table: string;
  filters?: GeneratedDataFilter[];
  aggregates: GeneratedAggregate[];
  groupBy?: string;
};
export type GeneratedAggregateResult = {
  source: "postgres";
  table: GeneratedTable;
  /** Zaehler und Summen kommen als Dezimalstrings — bigint/numeric verlieren in JSON sonst Praezision. */
  groups: Array<Record<string, unknown>>;
  groupCount: number;
  /** Mehr Gruppen als MAX_ROWS wurden beschnitten — genannt, nicht verschwiegen. */
  truncated: boolean;
};

export type GeneratedFreeQueryInput = {
  schema: string;
  statement: string;
  limit?: number;
};

export type GeneratedFreeQueryResult = {
  source: "postgres";
  /** Die Relationen, die die Lesung im Text gefunden hat, jede unter der Zeilensicherheit geprueft. */
  relations: FreeQueryRelation[];
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  /** Spalten, die wegen ihres Namens nicht ausgeliefert wurden; genannt und nicht verschwiegen. */
  omitted: string[];
  truncated: boolean;
  maxRows: number;
};

export interface GeneratedDataApiPort {
  aggregateRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedAggregateInput,
  ): Promise<GeneratedAggregateResult>;
  callFunction(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedCallInput,
  ): Promise<GeneratedCallResult>;
  listRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedListInput,
  ): Promise<GeneratedListResult>;
  /**
   * Die Tabellen eines Schemas, die diese Fläche lesend bedient (2.83).
   *
   * Genau die Bedingung, die `generateOpenApi` für eine Tabelle anlegt, und sie
   * steht als `listableTable` an einer Stelle. Die GraphQL-Fläche baut ihr
   * Schema daraus, statt eine eigene Liste zu pflegen: Zwei Listen würden
   * irgendwann Verschiedenes behaupten, und dann wäre eine davon falsch.
   *
   * Views bleiben draussen. Sie haben keinen Primärschlüssel, also auch keine
   * Ordnung, auf der ein Cursor stehen könnte, und ein Feld mit erzwungenem
   * `orderBy` wäre eine Sonderform im Schema, die niemand erwartet.
   */
  listReadableTables(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<GeneratedTable[]>;
  /**
   * Eine freie lesende Abfrage **unter** der Zeilensicherheit (2.117).
   *
   * Dieselbe Rolle, dieselben Ansprueche und dieselbe Lesetuer wie jede andere
   * Anfrage dieser Flaeche. Was dazukommt, ist die Lesung des Abfragetextes:
   * `readFreeQuery` nennt die Relationen, und jede einzelne geht durch
   * `assertTableBoundary`, bevor die Abfrage laeuft. Eine Tabelle ohne
   * Zeilensicherheit ist auf diesem Weg darum nicht erreichbar, auch dann
   * nicht, wenn die Projektrolle das Leserecht an ihr hat.
   */
  queryUnderRowSecurity(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedFreeQueryInput,
  ): Promise<GeneratedFreeQueryResult>;
  /**
   * Zeilen einfuegen, und mit `onConflict` als Upsert (2.105).
   *
   * Ohne `onConflict` ist es das Einfuegen von 2.97. Mit `onConflict` wird
   * daraus `INSERT ... ON CONFLICT (...) DO UPDATE`, und dann verlangt die
   * Tabelle zusaetzlich das Recht zum Aendern: Ein Upsert aendert Zeilen, also
   * geht er durch dieselbe Tuer wie ein Aendern.
   */
  insertRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; rows: Array<Record<string, unknown>>; onConflict?: string[] },
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
  /**
   * Mehrere Mutationen in **einer** Transaktion (2.97), fuer die GraphQL-Flaeche.
   *
   * Derselbe Schreibweg wie `insertRows`, `updateRow` und `deleteRow`: dieselbe
   * Rolle, dieselben Ansprueche, dieselbe Grenzpruefung je Tabelle. Neu ist
   * nur die Klammer: Faellt eine Mutation, auch an einer Policy, wirkt keine.
   */
  mutateRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedMutationBatchInput,
  ): Promise<GeneratedMutationBatchResult>;
  generateOpenApi(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<Record<string, unknown>>;
}

export type GeneratedCallInput = {
  schema: string;
  function: string;
  args?: Record<string, unknown>;
};

export type GeneratedCallResult = {
  source: "postgres";
  function: { schema: string; name: string; returnType: string; returnsSet: boolean; volatile: boolean };
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  /** Eine Set-Funktion ueber dem Zeilenlimit wurde beschnitten — genannt, nicht verschwiegen. */
  truncated: boolean;
};

export type GeneratedDataApiErrorCode =
  | "GENERATED_DATA_API_DISABLED"
  | "GENERATED_DATA_API_INVALID_INPUT"
  | "GENERATED_DATA_API_NOT_READY"
  | "GENERATED_DATA_API_UNAVAILABLE"
  | "GENERATED_DATA_API_BOUNDARY_REJECTED"
  | "GENERATED_DATA_API_TABLE_NOT_FOUND"
  | "GENERATED_DATA_API_RLS_REQUIRED"
  | "GENERATED_DATA_API_READ_ONLY"
  | "GENERATED_DATA_API_PRIMARY_KEY_REQUIRED"
  | "GENERATED_DATA_API_FORBIDDEN"
  /**
   * Eine Policy hat eine Zeile abgewiesen (2.97): `WITH CHECK` beim Einfuegen
   * oder Aendern. Bis 2.96 fiel das unter "unavailable", und ein Aufrufer
   * konnte einen abgelehnten Datensatz nicht von einer fehlenden Verbindung
   * unterscheiden. Der Code sagt nur, dass eine Policy gegriffen hat, nicht
   * welche.
   */
  | "GENERATED_DATA_API_POLICY_REJECTED"
  /**
   * Der Konfliktschluessel eines Upsert steht nicht im Katalog (2.105): Es gibt
   * zu diesen Spalten keinen Primaerschluessel und keinen eindeutigen Index,
   * auf den `ON CONFLICT` sich berufen kann. Ein Fehler der Anfrage, darum ein
   * eigener Code und nicht "unavailable": Der Aufrufer soll den Schluessel
   * korrigieren und nicht wiederholen.
   */
  | "GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN";

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
recognisedByName(GeneratedDataApiError, "GeneratedDataApiError");

/**
 * Returns the name of the violated boundary predicate, or null when the
 * introspection row is acceptable. Only predicate names are returned, never
 * schema content.
 */
function metadataRowRejection(row: MetadataRow): string | null {
  if (!IDENTIFIER.test(row.table_name)) return "table_name";
  if (!IDENTIFIER.test(row.column_name)) return "column_name";
  if (!["r", "p", "v"].includes(row.relation_kind)) return "relation_kind";
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
  relation_kind: "r" | "p" | "v";
  security_invoker: boolean;
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
         -- security_invoker steht in den reloptions. Nur ein View mit dieser
         -- Option laesst die RLS der Basistabellen fuer den Aufrufer gelten;
         -- alle anderen laufen mit den Rechten des View-Eigentuemers und sind
         -- fuer diese API keine Kandidaten.
         COALESCE(relation.reloptions::text[] && ARRAY['security_invoker=true','security_invoker=on'], false)
           AS security_invoker,
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
    AND relation.relkind IN ('r', 'p', 'v')
    AND relation.relpersistence <> 't'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
  ORDER BY relation.relname ASC, attribute.attnum ASC
  LIMIT $3`;

/**
 * Der Fremdschluessel zwischen zwei genannten Tabellen, in beide Richtungen
 * (2.66, Schemas seit 2.112).
 *
 * Dieselbe Katalogabfrage wie `FOREIGN_KEYS_SQL` in service.ts (2.41), auf ein
 * Paar verengt: Schluessel, die von der Basistabelle auf die Nachbartabelle
 * zeigen, und Schluessel, die von ihr auf die Basistabelle zeigen.
 * `unnest ... WITH ORDINALITY` haelt die Reihenfolge der Spalten fest, damit bei
 * `FOREIGN KEY (b, a) REFERENCES p (y, x)` `b` zu `y` gehoert und nicht zu `x`.
 *
 * Bis 2.111 musste die Nachbartabelle im Schema der Anfrage liegen, weil die
 * Einbettung nur einen Tabellennamen nennen konnte und ein Name ohne Schema
 * zwischen zwei Schemas nicht eindeutig waere. Seit 2.112 nennt die Einbettung
 * das Schema, also fragt diese Abfrage nach beiden Seiten mit Schema und Namen.
 * Ob die Nachbartabelle bedient werden darf, entscheidet `assertTableBoundary`.
 */
const EMBED_FOREIGN_KEYS_SQL = `
  SELECT fk.conname AS constraint_name,
         fk_namespace.nspname AS table_schema,
         relation.relname AS table_name,
         referenced_namespace.nspname AS referenced_schema,
         referenced.relname AS referenced_table,
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
  JOIN pg_catalog.pg_namespace AS fk_namespace ON fk_namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class AS referenced ON referenced.oid = fk.confrelid
  JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced.relnamespace
  WHERE fk.contype = 'f'
    AND ((fk_namespace.nspname = $1 AND relation.relname = $2
          AND referenced_namespace.nspname = $3 AND referenced.relname = $4)
      OR (fk_namespace.nspname = $3 AND relation.relname = $4
          AND referenced_namespace.nspname = $1 AND referenced.relname = $2))
  ORDER BY fk.conname ASC
  LIMIT $5`;

/**
 * Die eindeutigen Schluessel einer Tabelle, aus dem Katalog (2.105).
 *
 * Der Konfliktschluessel eines Upsert darf nicht vom Aufrufer frei gewaehlt
 * werden. `ON CONFLICT (a, b)` ohne einen passenden Index waere in PostgreSQL
 * ohnehin ein Fehler, aber der Aufrufer bekaeme dann einen Treiberfehler statt
 * einer Ablehnung, und die Fehlermeldung traege den Tabellennamen. Darum liest
 * diese Abfrage die vorhandenen Schluessel und der Dienst vergleicht.
 *
 * Nur Indizes, auf die `ON CONFLICT` sich ueberhaupt berufen kann:
 *
 * - `indisunique`, also Primaerschluessel und eindeutige Indizes; ein
 *   gewoehnlicher Index kennt keinen Konflikt.
 * - `indisvalid` und `indislive`: Ein Index, der gerade nebenlaeufig entsteht
 *   oder fallengelassen wird, traegt die Zusage nicht.
 * - `indpred IS NULL`: Ein teilweiser Index gilt nur fuer die Zeilen seiner
 *   Bedingung. `ON CONFLICT` mit ihm verlangt, dass die Bedingung in der
 *   Anfrage steht, und diese Flaeche schreibt keine Bedingungen.
 * - `indexprs IS NULL`: Ein Index auf einem Ausdruck (`lower(email)`) laesst
 *   sich mit Spaltennamen nicht benennen.
 * - `indimmediate`: Ein aufschiebbarer eindeutiger Schluessel
 *   (`DEFERRABLE`) prueft erst am Ende der Transaktion. `ON CONFLICT` nimmt
 *   ihn nicht als Schiedsrichter an und bricht mit einem Fehler ab; hier
 *   faellt er vorher als unbekannter Schluessel.
 *
 * `indkey` traegt bei einem abdeckenden Index auch die Spalten hinter
 * `INCLUDE`; die gehoeren nicht zum Schluessel, und `ON CONFLICT` kennt sie
 * nicht. Darum der Schnitt bei `indnkeyatts`. `WITH ORDINALITY` haelt die
 * Reihenfolge fest, auch wenn sie fuer die Ableitung des Index keine Rolle
 * spielt: Der Dienst vergleicht als Menge, die Antwort nennt die Spalten aber
 * in der Reihenfolge des Index.
 */
const UNIQUE_KEYS_SQL = `
  SELECT index_relation.relname AS index_name,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(unique_index.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = unique_index.indrelid AND attribute.attnum = key.attnum
                   WHERE key.ordinality <= unique_index.indnkeyatts), ARRAY[]::text[]) AS columns
  FROM pg_catalog.pg_index AS unique_index
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = unique_index.indexrelid
  JOIN pg_catalog.pg_class AS relation ON relation.oid = unique_index.indrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = $1
    AND relation.relname = $2
    AND unique_index.indisunique
    AND unique_index.indisvalid
    AND unique_index.indislive
    AND unique_index.indimmediate
    AND unique_index.indpred IS NULL
    AND unique_index.indexprs IS NULL
  ORDER BY index_relation.relname ASC
  LIMIT $3`;

type UniqueKeyRow = { index_name: string; columns: string[] };

/**
 * Ein eindeutiger Schluessel, wie der Katalog ihn hergibt. Der Name steht hier,
 * weil die Grenzpruefung ihn gegen die Grammatik haelt: Ein Katalogeintrag, der
 * keinen gueltigen Bezeichner tragen kann, wird abgewiesen statt benutzt.
 */
type UniqueKey = { name: string; columns: string[] };

type EmbedForeignKeyRow = {
  constraint_name: string;
  table_schema: string;
  table_name: string;
  referenced_schema: string;
  referenced_table: string;
  columns: string[];
  referenced_columns: string[];
};

type EmbedForeignKey = {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
};

/**
 * Eine Einbettung, nachdem Katalog und Rechte gesprochen haben: welcher
 * Schluessel, welche Richtung, welche Spalten auf beiden Seiten.
 */
type ResolvedEmbed = {
  embed: GeneratedEmbed;
  target: InternalTable;
  /** Das Schema der Nachbartabelle; gleich dem der Basistabelle, wenn `embed.schema` fehlt. */
  schema: string;
  /** Ob das Schema ein anderes ist als das der Basistabelle (2.112). */
  foreignSchema: boolean;
  kind: "one" | "many";
  constraint: string;
  /** Spalten der Basistabelle, ueber die verknuepft wird. */
  localKey: string[];
  /** Spalten der Nachbartabelle, die `localKey` gegenueberstehen. */
  remoteKey: string[];
  /** Die Spalten, die der Aufrufer von der Nachbartabelle bekommt. */
  columns: string[];
  /** Die zweite Ebene (2.111), schon aufgeloest; leer ohne zweite Ebene. */
  nested: ResolvedEmbed[];
};

const SELECT_EMBED = new RegExp(
  `^(?:(${DATA_IDENTIFIER_PATTERN}):)?(?:(${DATA_IDENTIFIER_PATTERN})\\.)?(${DATA_IDENTIFIER_PATTERN})\\((.*)\\)$`);

/**
 * Liest den `select`-Parameter der Zeilenliste (2.66).
 *
 * Bis 2.65 war er eine Liste von Spaltennamen. Seit 2.66 darf ein Eintrag
 * eine Einbettung sein, in der Schreibweise von PostgREST:
 * `select=id,titel,autor:autoren(name),kommentare(text)`. `*` steht fuer alle
 * waehlbaren, nicht sensiblen Spalten, allein oder in einer Einbettung; neben
 * benannten Spalten ist es ein Fehler, weil dann unklar waere, was gemeint ist.
 *
 * Seit 2.111 darf eine Einbettung eine zweite tragen,
 * `beitraege(titel,autor(name))`, bis `DATA_API_LIMITS.maxEmbedDepth` Ebenen
 * und `DATA_API_LIMITS.maxNestedEmbeds` je Einbettung. Eine Klammer eine Ebene
 * zu tief ist weiterhin ein Fehler des Aufrufs.
 *
 * Seit 2.112 darf vor dem Namen der Beziehung ein Schema stehen,
 * `autor:verlag.autoren(name)`. Der Punkt gehoert nicht in einen Bezeichner, er
 * trennt also eindeutig, und ohne Schema bleibt es das Schema der Anfrage.
 *
 * Gibt `null` zurueck, wenn der Text nicht zur Grammatik gehoert. Was zurueck
 * kommt, ist geprueft in der Form, nicht in der Sache: Ob eine Spalte, ein
 * Schema oder eine Beziehung existiert, entscheidet `listRows` gegen den
 * Katalog.
 */
export function parseGeneratedSelect(text: string): { select?: string[]; embed: GeneratedEmbed[] } | null {
  const parsed = parseSelectLevel(text, 1);
  if (!parsed) return null;
  return { ...(parsed.columns ? { select: parsed.columns } : {}), embed: parsed.embed };
}

/**
 * Eine Ebene der Liste. `level` ist die Ebene der Einbettungen, die in diesem
 * Text stehen: 1 fuer `select` selbst, 2 fuer das, was in einer Klammer steht.
 *
 * `columns` fehlt, wenn `*` dastand oder nur Einbettungen; beides heisst alle
 * waehlbaren, nicht sensiblen Spalten. Ein leerer Text ist hier ein Fehler; der
 * Aufrufer entscheidet, ob eine leere Klammer erlaubt ist.
 */
function parseSelectLevel(text: string, level: number): { columns?: string[]; embed: GeneratedEmbed[] } | null {
  const parts = splitSelectParts(text);
  if (!parts) return null;
  const select: string[] = [];
  const embed: GeneratedEmbed[] = [];
  let star = false;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) return null;
    if (part === "*") {
      if (star) return null;
      star = true;
      continue;
    }
    const match = SELECT_EMBED.exec(part);
    if (match) {
      // Eine Einbettung auf einer Ebene, die es nicht gibt. Die Grenze steht
      // vor dem Katalog, weil sonst eine Anfrage mit zehn Ebenen erst zehn
      // Aufloesungen kostete.
      if (level > MAX_EMBED_DEPTH) return null;
      const relation = match[3]!;
      const inner = match[4]!.trim();
      let columns: string[] | undefined;
      let nested: GeneratedEmbed[] = [];
      if (inner !== "") {
        const parsedInner = parseSelectLevel(inner, level + 1);
        if (!parsedInner) return null;
        columns = parsedInner.columns;
        nested = parsedInner.embed;
      }
      embed.push({
        alias: match[1] ?? relation,
        relation,
        ...(match[2] ? { schema: match[2] } : {}),
        ...(columns ? { columns } : {}),
        ...(nested.length > 0 ? { embed: nested } : {}),
      });
      continue;
    }
    if (!safeIdentifier(part)) return null;
    select.push(part);
  }
  if (star && select.length > 0) return null;
  if (!star && select.length === 0 && embed.length === 0) return null;
  // Die Zahl der Einbettungen gilt je Ebene: drei oben, und in einer Klammer
  // die kleinere Zahl der zweiten Ebene.
  if (embed.length > (level === 1 ? MAX_EMBEDS : MAX_NESTED_EMBEDS)) return null;
  // Ein Alias, der mit einer Spalte oder einem anderen Alias zusammenfaellt,
  // wuerde in der Antwortzeile einen Wert ueberschreiben, und zwar still.
  const keys = [...select, ...embed.map((entry) => entry.alias)];
  if (new Set(keys).size !== keys.length) return null;
  return { ...(star || select.length === 0 ? {} : { columns: select }), embed };
}

/**
 * Teilt einen Text an den Kommas der eigenen Ebene. Klammern duerfen so tief
 * gehen, wie es Ebenen gibt; tiefer ist ein Fehler, und zwar schon hier, damit
 * ein Text mit tausend Klammern nicht erst rekursiv zerlegt wird.
 */
function splitSelectParts(text: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") {
      depth += 1;
      if (depth > MAX_EMBED_DEPTH) return null;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (depth !== 0) return null;
  parts.push(current);
  return parts;
}

/**
 * Eine Funktion, wie der Aufrufweg sie sehen darf.
 *
 * `SECURITY DEFINER` faellt durch dieselbe Tuer wie ein View ohne
 * `security_invoker`: Der Rumpf liefe mit den Rechten des Eigentuemers, und
 * die RLS der beruehrten Tabellen gaelte fuer den Aufrufer nicht.
 */
const FUNCTION_METADATA_SQL = `
  SELECT p.proname AS function_name,
         p.prosecdef AS security_definer,
         p.provolatile AS volatility,
         p.proretset AS returns_set,
         p.pronargs::integer AS arg_count,
         p.pronargdefaults::integer AS default_count,
         COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
         COALESCE((SELECT array_agg(pg_catalog.format_type(args.t, NULL) ORDER BY args.o)
                   FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS args(t, o)),
                  ARRAY[]::text[]) AS arg_types,
         pg_catalog.format_type(p.prorettype, NULL) AS return_type,
         has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = 'f'
  LIMIT 3`;

/**
 * Alle Funktionen eines Schemas fuer das OpenAPI-Dokument — dieselben Spalten
 * wie `FUNCTION_METADATA_SQL`, damit dieselben Eignungsregeln gelten koennen.
 * Ueberladungen bleiben absichtlich in der Liste: Erst ihr Anblick erlaubt es,
 * den Namen vollstaendig auszuschliessen, statt zufaellig einen Rumpf zu
 * dokumentieren.
 */
const SCHEMA_FUNCTIONS_SQL = `
  SELECT p.proname AS function_name,
         p.prosecdef AS security_definer,
         p.provolatile AS volatility,
         p.proretset AS returns_set,
         p.pronargs::integer AS arg_count,
         p.pronargdefaults::integer AS default_count,
         COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
         COALESCE((SELECT array_agg(pg_catalog.format_type(args.t, NULL) ORDER BY args.o)
                   FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS args(t, o)),
                  ARRAY[]::text[]) AS arg_types,
         pg_catalog.format_type(p.prorettype, NULL) AS return_type,
         has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.prokind = 'f'
  ORDER BY p.proname
  LIMIT 200`;

type FunctionMetadataRow = {
  function_name: string;
  security_definer: boolean;
  volatility: "i" | "s" | "v";
  returns_set: boolean;
  arg_count: number;
  default_count: number;
  arg_names: string[];
  arg_types: string[];
  return_type: string;
  can_execute: boolean;
};

/**
 * Nur Typnamen, die sich gefahrlos als Cast interpolieren lassen. Ein
 * schema-qualifizierter oder gequoteter Typ faellt heraus — eigene Typen
 * ausserhalb des Suchpfads sind damit (noch) nicht aufrufbar, und das steht
 * in der Release Note statt zwischen den Zeilen.
 */
const SAFE_TYPE = /^[a-z_][a-z0-9_ ]*(\(\d+(,\d+)?\))?(\[\])?$/;

type InternalTable = GeneratedTable & {
  securityInvoker: boolean;
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

  async callFunction(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedCallInput,
  ): Promise<GeneratedCallResult> {
    assertRequest(context, scope, input.schema, input.function);
    const args = input.args ?? {};
    if (!isPlainRecord(args) || Object.keys(args).length > 32 || byteLength(args) > MAX_INPUT_BYTES) {
      throw invalidInput();
    }

    // Erst die Metadaten in einer Lese-Transaktion; erst wenn feststeht, dass
    // die Funktion fluechtig ist, bekommt der eigentliche Aufruf Schreibrechte.
    const metadata = await this.run(context, scope, false, async (client) => {
      const result = await client.query<FunctionMetadataRow>(
        FUNCTION_METADATA_SQL, [input.schema, input.function]);
      if (result.rows.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_TABLE_NOT_FOUND");
      }
      if (result.rows.length > 1) {
        // Ueberladungen machen den Aufruf mehrdeutig; welcher Rumpf laeuft,
        // entschiede der Zufall der Typaufloesung.
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
          cause: new Error("function is overloaded"),
        });
      }
      return result.rows[0]!;
    });

    if (metadata.security_definer) throw new GeneratedDataApiError("GENERATED_DATA_API_RLS_REQUIRED");
    if (!metadata.can_execute) throw new GeneratedDataApiError("GENERATED_DATA_API_FORBIDDEN");
    if (!SAFE_TYPE.test(metadata.return_type) && !metadata.returns_set) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
        cause: new Error("unsupported return type"),
      });
    }

    const argNames = metadata.arg_names.slice(0, metadata.arg_count);
    const requiredNames = argNames.slice(0, metadata.arg_count - metadata.default_count);
    if (argNames.some((name) => !IDENTIFIER.test(name))) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
        cause: new Error("unnamed or invalid argument names"),
      });
    }
    const provided = Object.keys(args);
    if (provided.some((name) => !argNames.includes(name)) ||
        requiredNames.some((name) => !Object.hasOwn(args, name))) {
      throw invalidInput();
    }

    const values: SqlValue[] = [];
    const namedArgs: string[] = [];
    for (const name of argNames) {
      if (!(name in args)) continue;
      const argType = metadata.arg_types[argNames.indexOf(name)] ?? "";
      if (!SAFE_TYPE.test(argType)) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
          cause: new Error("unsupported argument type"),
        });
      }
      const value = args[name];
      const isJsonType = argType === "json" || argType === "jsonb";
      if (value !== null && !["string", "number", "boolean"].includes(typeof value) && !isJsonType) {
        throw invalidInput();
      }
      if (typeof value === "number" && !Number.isFinite(value)) throw invalidInput();
      values.push(isJsonType && value !== null && typeof value === "object"
        ? JSON.stringify(value) : value as SqlValue);
      namedArgs.push(`${quoted(name)} => $${values.length}::${argType}`);
    }

    const call = `${qualified(input.schema, input.function)}(${namedArgs.join(", ")})`;
    const sql = metadata.returns_set
      ? `SELECT * FROM ${call} LIMIT ${MAX_ROWS + 1}`
      : `SELECT ${call} AS result`;

    // volatile heisst: darf schreiben. Alles andere laeuft in derselben
    // Lese-Transaktion wie ein Listenaufruf — eine als stabil deklarierte
    // Funktion, die doch schreibt, scheitert an READ ONLY statt zu wirken.
    return this.run(context, scope, metadata.volatility === "v", async (client) => {
      const result = await client.query<Record<string, unknown>>(sql, values);
      const selected = result.rows.slice(0, MAX_ROWS);
      const rows = boundedRows(
        selected.map((row) => projectRow(row, Object.keys(row))), MAX_RESPONSE_BYTES);
      if (selected.length > 0 && rows.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      await this.meterRowReads(context, scope, rows.length);
      return {
        source: "postgres" as const,
        function: {
          schema: input.schema,
          name: metadata.function_name,
          returnType: metadata.return_type,
          returnsSet: metadata.returns_set,
          volatile: metadata.volatility === "v",
        },
        rows,
        rowCount: rows.length,
        truncated: result.rows.length > MAX_ROWS || rows.length < selected.length,
      };
    });
  }

  async listRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedListInput,
  ): Promise<GeneratedListResult> {
    assertRequest(context, scope, input.schema, input.table);
    const limit = input.limit ?? 20;
    const embeds = input.embed ?? [];
    // Die Zahl der Einbettungen faellt vor der Datenbank: Jede weitere waere
    // eine weitere Abfrage, und die Grenze soll die Arbeit sparen und nicht
    // erst das Ergebnis verwerfen.
    if (!Number.isSafeInteger(limit) || limit < MIN_ROWS || limit > MAX_ROWS ||
        (input.select?.length ?? 0) > MAX_COLUMNS ||
        (input.filters?.length ?? 0) > MAX_FILTERS) {
      throw invalidInput();
    }
    assertEmbedInput(embeds, 1);

    return this.run(context, scope, false, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "select");
      if (table.kind === "table" && table.primaryKey.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_PRIMARY_KEY_REQUIRED");
      }
      // Ein View traegt keinen Primaerschluessel und damit keine Ordnung, auf
      // der ein Keyset-Cursor stehen koennte. Verlangt wird eine ausdrueckliche
      // Sortierspalte; Cursor werden abgewiesen statt still falsch zu blaettern.
      if (table.kind === "view" && (input.cursor !== undefined || !input.order?.column)) {
        throw invalidInput();
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
      const primaryOrder = input.order?.column ?? table.primaryKey[0]!;
      const primaryOrderColumn = byName.get(primaryOrder);
      if (!primaryOrderColumn?.selectable || primaryOrderColumn.sensitive ||
          !isSortableDataType(primaryOrderColumn.dataType)) throw invalidInput();
      const orderColumns = [primaryOrder, ...table.primaryKey.filter((name) => name !== primaryOrder)];
      if (orderColumns.some((name) => !isSortableDataType(byName.get(name)!.dataType))) throw invalidInput();

      // Die Einbettungen werden aufgeloest, bevor eine Zeile gelesen ist: Eine
      // unbekannte Beziehung, eine Nachbartabelle ohne Zeilensicherheit oder
      // ein Alias auf einer Spalte weisen die ganze Anfrage ab, nicht nur den
      // Teil in der Klammer.
      const resolvedEmbeds = await this.resolveEmbeds(client, input.schema, table, embeds, selectedNames);

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

      // Die Schluesselspalten der Einbettungen werden mitgelesen, auch wenn der
      // Aufrufer sie nicht bestellt hat, und wie die Sortierspalten nur
      // intern benutzt; in die Antwort kommen sie nur, wenn sie in `select`
      // stehen.
      const embedKeyColumns = resolvedEmbeds.flatMap((resolved) => resolved.localKey);
      const queryColumns = [...new Set([...selectedNames, ...orderColumns, ...embedKeyColumns])];
      const sql = `SELECT ${queryColumns.map(quoted).join(", ")}
        FROM ${qualified(input.schema, input.table)}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${orderColumns.map((name) => `${quoted(name)} ${direction.toUpperCase()}`).join(", ")}
        LIMIT ${limit + 1}`;
      const result = await client.query<Record<string, unknown>>(sql, values);
      const selected = result.rows.slice(0, limit);
      const projected = selected.map((row) => projectRow(row, selectedNames));
      const embedResults = await this.attachEmbeds(client, resolvedEmbeds, selected, projected);
      const rows = boundedRows(projected, MAX_RESPONSE_BYTES);
      if (selected.length > 0 && rows.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      const hasMore = result.rows.length > limit || rows.length < selected.length;
      const cursorSource = rows.length > 0 ? selected[rows.length - 1] : undefined;
      // Gemessen wird, was der Aufrufer tatsächlich bekommt — nicht, was die
      // Abfrage geholt hat. Die eine Zeile über dem Limit dient nur dazu,
      // `hasMore` zu bestimmen, und verlässt QKERN nie. Eingebettete Zeilen
      // zaehlen mit: Sie sind gelesene Zeilen, auch wenn sie in einer anderen
      // Zeile stecken.
      const embeddedRowCount = rows.reduce((sum, row) => sum + countEmbeddedRows(row, embedResults), 0);
      await this.meterRowReads(context, scope, rows.length + embeddedRowCount);
      return {
        source: "postgres",
        table: publicTable(table),
        rows,
        rowCount: rows.length,
        hasMore,
        embeds: embedResults,
        // Ein View bekommt keinen Cursor: Ohne eindeutige Ordnung wuerde er
        // Zeilen ueberspringen oder doppeln, und beides still.
        nextCursor: table.kind === "table" && hasMore && cursorSource
          ? encodeCursor(input.schema, input.table, orderColumns, direction,
            orderColumns.map((name) => normalizeDataValue(cursorSource[name])))
          : null,
        maxRows: limit,
      };
    });
  }

  /**
   * Aggregate unter der RLS des Aufrufers — die Luecke "Aggregate" der
   * Paritaetsleiter (Data API).
   *
   * Dieselben Grenzen wie beim Listen: nur waehlbare, nicht-sensible Spalten,
   * dieselben Filter, Views nur mit security_invoker. sum/avg verlangen einen
   * numerischen Typ, min/max einen sortierbaren; count(*) braucht keine
   * Spalte. Eine Gruppierungsspalte ist optional; mehr als MAX_ROWS Gruppen
   * werden beschnitten und als `truncated` genannt. Die Mutationsprobe dieses
   * Releases nimmt die Sensibel-Pruefung aus der Aggregatspalte — dann liesse
   * sich ein Geheimnis per min() lesen.
   */
  async aggregateRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedAggregateInput,
  ): Promise<GeneratedAggregateResult> {
    assertRequest(context, scope, input.schema, input.table);
    if (!Array.isArray(input.aggregates) || input.aggregates.length < 1 || input.aggregates.length > 10 ||
        (input.filters?.length ?? 0) > MAX_FILTERS) {
      throw invalidInput();
    }
    return this.run(context, scope, false, async (client) => {
      const table = await this.loadTable(client, input.schema, input.table);
      assertTableBoundary(table, "select");
      const byName = new Map(table.columns.map((column) => [column.name, column]));
      const usable = (name: string) => {
        const column = byName.get(name);
        return column && column.selectable && !column.sensitive ? column : null;
      };
      const filters = input.filters ?? [];
      for (const filter of filters) {
        if (!usable(filter.column) || !isFilter(filter)) throw invalidInput();
      }
      const selects: string[] = [];
      const keys = new Set<string>();
      if (input.groupBy !== undefined) {
        const column = usable(input.groupBy);
        if (!column || !isSortableDataType(column.dataType)) throw invalidInput();
        selects.push(quoted(input.groupBy));
        keys.add(input.groupBy);
      }
      for (const aggregate of input.aggregates) {
        if (!["count", "sum", "avg", "min", "max"].includes(aggregate.fn)) throw invalidInput();
        if (aggregate.column === undefined) {
          if (aggregate.fn !== "count" || keys.has("count")) throw invalidInput();
          keys.add("count");
          selects.push(`count(*) AS ${quoted("count")}`);
          continue;
        }
        const column = usable(aggregate.column);
        if (!column) throw invalidInput();
        if ((aggregate.fn === "sum" || aggregate.fn === "avg") && !isNumericDataType(column.dataType)) throw invalidInput();
        if ((aggregate.fn === "min" || aggregate.fn === "max") && !isSortableDataType(column.dataType)) throw invalidInput();
        const key = `${aggregate.fn}_${aggregate.column}`;
        if (keys.has(key) || !IDENTIFIER.test(key)) throw invalidInput();
        keys.add(key);
        selects.push(`${aggregate.fn}(${quoted(aggregate.column)}) AS ${quoted(key)}`);
      }
      const values: SqlValue[] = [];
      const where = filters.map((filter) => filterSql(filter, values));
      const sql = `SELECT ${selects.join(", ")}
        FROM ${qualified(input.schema, input.table)}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ${input.groupBy !== undefined ? `GROUP BY ${quoted(input.groupBy)} ORDER BY ${quoted(input.groupBy)} ASC` : ""}
        LIMIT ${MAX_ROWS + 1}`;
      const result = await client.query<Record<string, unknown>>(sql, values);
      const selected = result.rows.slice(0, MAX_ROWS);
      const groups = boundedRows(selected.map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, normalizeDataValue(value)]),
      )), MAX_RESPONSE_BYTES);
      if (selected.length > 0 && groups.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
      }
      await this.meterRowReads(context, scope, groups.length);
      return {
        source: "postgres",
        table: publicTable(table),
        groups,
        groupCount: groups.length,
        truncated: result.rows.length > MAX_ROWS || groups.length < selected.length,
      };
    });
  }

  async insertRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; rows: Array<Record<string, unknown>>; onConflict?: string[] },
  ): Promise<GeneratedMutationResult> {
    assertRequest(context, scope, input.schema, input.table);
    assertInsertInput(input.rows);
    assertConflictInput(input.onConflict);
    return this.run(context, scope, true, (client) =>
      this.insertWithin(client, input.schema, input.table, input.rows, input.onConflict));
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
    return this.run(context, scope, true, (client) =>
      this.updateWithin(client, input.schema, input.table, { match: input.match }, input.values, 1));
  }

  async deleteRow(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: { schema: string; table: string; match: Record<string, unknown> },
  ): Promise<GeneratedMutationResult> {
    assertRequest(context, scope, input.schema, input.table);
    if (!isPlainRecord(input.match) || byteLength(input) > MAX_INPUT_BYTES) throw invalidInput();
    return this.run(context, scope, true, (client) =>
      this.deleteWithin(client, input.schema, input.table, { match: input.match }, 1));
  }

  async mutateRows(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedMutationBatchInput,
  ): Promise<GeneratedMutationBatchResult> {
    assertRequest(context, scope, input.schema);
    // Alle Formpruefungen vor der Datenbank: Ein Stapel, dessen dritte Mutation
    // keine Bedingung hat, soll die ersten beiden nicht erst ausfuehren und
    // dann zurueckrollen. Das Zurueckrollen ist die Zusage fuer den Fall, den
    // erst die Datenbank entscheidet, etwa eine Policy; die Form entscheidet
    // sich hier.
    if (!Array.isArray(input.mutations) || input.mutations.length < 1 ||
        input.mutations.length > MAX_MUTATIONS || byteLength(input.mutations) > MAX_INPUT_BYTES) {
      throw invalidInput();
    }
    for (const mutation of input.mutations) {
      if (!isPlainRecord(mutation) || !safeIdentifier(mutation.table)) throw invalidInput();
      if (mutation.kind === "insert") {
        assertInsertInput(mutation.rows);
        assertConflictInput(mutation.onConflict);
        assertEmbedInput(mutation.embed ?? [], 1);
        continue;
      }
      if (mutation.kind !== "update" && mutation.kind !== "delete") throw invalidInput();
      // Ein Loeschen traegt keine Einbettung (2.111); warum, steht bei
      // `GeneratedMutation`. Ein `embed` daran ist ein Fehler des Aufrufs und
      // nicht ein Feld, das still verfaellt.
      if (mutation.kind === "delete" && "embed" in mutation) throw invalidInput();
      if (mutation.kind === "update") assertEmbedInput(mutation.embed ?? [], 1);
      // Aendern und Loeschen ohne Bedingung gibt es hier nicht. Eine Mutation
      // ohne Filter traefe jede Zeile, die die Policy hergibt, und "jede
      // Zeile" ist nie das, was ein Formular meint.
      if (!Array.isArray(mutation.filters) || mutation.filters.length < 1 ||
          mutation.filters.length > MAX_FILTERS || !mutation.filters.every(isFilter)) {
        throw invalidInput();
      }
      if (mutation.atMost !== undefined &&
          (!Number.isSafeInteger(mutation.atMost) || mutation.atMost < 1 || mutation.atMost > MAX_INSERT_ROWS)) {
        throw invalidInput();
      }
      if (mutation.kind === "update" && !isPlainRecord(mutation.values)) throw invalidInput();
    }
    return this.run(context, scope, true, async (client) => {
      const results: GeneratedMutationResult[] = [];
      // Der Reihe nach, in einer Transaktion. Jede Mutation nimmt denselben
      // Helfer wie ihr REST-Gegenstueck; es gibt keinen zweiten Schreibweg.
      for (const mutation of input.mutations) {
        if (mutation.kind === "insert") {
          results.push(await this.insertWithin(
            client, input.schema, mutation.table, mutation.rows, mutation.onConflict, mutation.embed));
        } else if (mutation.kind === "update") {
          results.push(await this.updateWithin(client, input.schema, mutation.table,
            { filters: mutation.filters }, mutation.values, mutation.atMost ?? MAX_INSERT_ROWS,
            mutation.embed));
        } else {
          results.push(await this.deleteWithin(client, input.schema, mutation.table,
            { filters: mutation.filters }, mutation.atMost ?? MAX_INSERT_ROWS));
        }
      }
      // Eingebettete Zeilen einer Mutation (2.111) sind gelesene Zeilen und
      // werden wie die einer Lesung abgerechnet. Die geschriebenen Zeilen
      // selbst zaehlt diese Flaeche nicht; daran aendert der Schnitt nichts.
      const embeddedRowCount = results.reduce((sum, result) =>
        sum + result.rows.reduce((inner, row) => inner + countEmbeddedRows(row, result.embeds), 0), 0);
      if (embeddedRowCount > 0) await this.meterRowReads(context, scope, embeddedRowCount);
      return { source: "postgres" as const, results };
    });
  }

  /**
   * Das Einfuegen selbst, innerhalb einer Schreibtransaktion; von REST und
   * GraphQL geteilt. Mit `onConflict` ist es ein Upsert (2.105).
   *
   * **Der Konfliktschluessel kommt aus dem Katalog und nicht vom Aufrufer.**
   * `resolveConflictKey` sucht unter den eindeutigen Schluesseln der Tabelle
   * einen, dessen Spalten genau die genannten sind, und die Spaltennamen im
   * SQL stammen dann aus `pg_index` und nicht aus der Anfrage. Ohne passenden
   * Schluessel gibt es `GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN`, und zwar
   * bevor eine Zeile geschrieben ist.
   *
   * **Ein Upsert geht durch beide Tueren.** `assertTableBoundary(..., "insert")`
   * und, sobald `onConflict` dabei ist, auch `"update"`: Ein Upsert aendert
   * Zeilen, also braucht die Rolle das Recht dazu. Die Tuer steht hier auch
   * dann, wenn die Spaltenpruefung unten dieselbe Zeile schon abwiese: Ohne
   * `UPDATE` ist keine Spalte `updateable`, und der Aufrufer bekaeme
   * `_INVALID_INPUT` statt `_FORBIDDEN`, also einen Grund, der die Lage falsch
   * beschreibt. Die Mutationsprobe B dieses Schnitts nimmt genau diese Zeile
   * heraus und zeigt den Unterschied. Die Spalten hinter
   * `DO UPDATE SET` gehen durch dieselbe Pruefung wie `set` eines Aenderns:
   * aenderbar, nicht sensibel, keine Identitaets- und keine berechnete Spalte
   * und keine Spalte des Primaerschluessels. Was ein Aendern nicht setzen
   * darf, setzt ein Upsert auch nicht.
   *
   * **Die Zusage, die zaehlt: Ein Upsert aendert keine Zeile, die der Aufrufer
   * nicht auch per UPDATE aendern duerfte.** Sie kommt von PostgreSQL, und sie
   * kommt anders als beim Aendern. Ein gewoehnliches `UPDATE` filtert mit der
   * `USING`-Bedingung der Policy: Eine fremde Zeile wird nicht getroffen, und
   * die Antwort lautet null Zeilen. Bei `ON CONFLICT DO UPDATE` trifft der
   * eindeutige Index die Zeile ohne Ruecksicht auf eine Policy, und erst
   * danach prueft PostgreSQL die `USING`-Bedingung jeder UPDATE-Policy gegen
   * die vorhandene Zeile. Faellt sie durch, bricht PostgreSQL ab, statt die
   * Zeile zu ueberspringen: SQLSTATE 42501, bei uns
   * `GENERATED_DATA_API_POLICY_REJECTED`, und die ganze Transaktion rollt
   * zurueck. Die fremde Zeile bleibt unberuehrt, und eine Tabelle ohne
   * UPDATE-Policy laesst darum ueberhaupt keinen Upsert auf eine vorhandene
   * Zeile zu.
   *
   * **Was ein Upsert verraet, verriet ein Einfuegen auch.** Wer eine fremde
   * Zeile anstupst, erfaehrt an der Ablehnung, dass es zu diesem Schluessel
   * eine Zeile gibt. Dasselbe erfuhr er vorher am eindeutigen Index selbst,
   * der ein gewoehnliches Einfuegen mit 23505 abweist. Der Upsert oeffnet
   * hier nichts, was die Tabelle nicht schon sagte.
   */
  private async insertWithin(
    client: SqlPoolClient,
    schema: string,
    tableName: string,
    rows: Array<Record<string, unknown>>,
    onConflict?: string[],
    embeds?: GeneratedEmbed[],
  ): Promise<GeneratedMutationResult> {
    const table = await this.loadTable(client, schema, tableName);
    assertTableBoundary(table, "insert");
    if (onConflict) assertTableBoundary(table, "update");
    // Die Einbettungen (2.111) stehen vor dem Schreiben: Katalog, Richtung und
    // Tuer der Nachbartabelle entscheiden sich, bevor eine Zeile entsteht.
    const resolvedEmbeds = embeds?.length
      ? await this.resolveEmbeds(client, schema, table, embeds, safeReturningColumns(table))
      : [];
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    const columns = Object.keys(rows[0]!).sort();
    if (columns.length > MAX_COLUMNS || rows.some((row) => Object.keys(row).sort().join("\0") !== columns.join("\0")) ||
        columns.some((name) => {
          const column = byName.get(name);
          return !column?.insertable || column.sensitive || column.identity || column.generated;
        }) || rows.some((row) => columns.some((name) => !isDataValue(row[name])))) {
      throw invalidInput();
    }
    const returning = safeReturningColumns(table);
    let conflictClause = "";
    if (onConflict) {
      const key = await this.resolveConflictKey(client, schema, tableName, onConflict);
      // Der Schluessel muss in jeder Zeile stehen. Fehlt eine seiner Spalten,
      // entscheidet ein DEFAULT der Tabelle, auf welche Zeile der Upsert
      // trifft, und der Aufrufer wuesste nicht, welche er geaendert hat.
      const keySet = new Set(key.columns);
      if (key.columns.some((name) => !columns.includes(name))) throw invalidInput();
      const assigned = columns.filter((name) => !keySet.has(name));
      // Ein Upsert, dessen Zeile nur aus dem Schluessel besteht, hat nichts zu
      // aendern. `DO NOTHING` daraus zu machen waere eine andere Zusage als
      // die, die der Aufrufer geschrieben hat.
      if (assigned.length === 0) throw invalidInput();
      if (assigned.some((name) => {
        const column = byName.get(name);
        return !column?.updateable || column.sensitive || column.identity || column.generated ||
          column.primaryKeyPosition !== null;
      })) throw invalidInput();
      // Zwei Zeichen einer Anfrage mit demselben Schluessel gehen nicht.
      // PostgreSQL bricht das mit 21000 ab ("cannot affect row a second time"),
      // und das waere bei uns ein Ausfall statt einer Ablehnung. Hier faellt es
      // vor der Datenbank und mit einem Grund, der zur Anfrage passt.
      const seen = new Set<string>();
      for (const row of rows) {
        const identity = JSON.stringify(key.columns.map((name) => normalizeDataValue(row[name])));
        if (seen.has(identity)) throw invalidInput();
        seen.add(identity);
      }
      conflictClause = `ON CONFLICT (${key.columns.map(quoted).join(", ")})
         DO UPDATE SET ${assigned.map((name) => `${quoted(name)} = EXCLUDED.${quoted(name)}`).join(", ")}`;
    }
    let result;
    if (columns.length === 0) {
      // Ohne Spalten gibt es keinen Konfliktschluessel in der Zeile; der Fall
      // oben hat das schon abgewiesen.
      if (rows.length !== 1) throw invalidInput();
      result = await client.query<Record<string, unknown>>(
        `INSERT INTO ${qualified(schema, tableName)} DEFAULT VALUES RETURNING ${returning.map(quoted).join(", ")}`,
      );
    } else {
      const values: SqlValue[] = [];
      const tuples = rows.map((row) => `(${columns.map((name) => {
        values.push(row[name] as SqlValue);
        return `$${values.length}`;
      }).join(", ")})`);
      result = await client.query<Record<string, unknown>>(
        `INSERT INTO ${qualified(schema, tableName)} (${columns.map(quoted).join(", ")})
         VALUES ${tuples.join(", ")}
         ${conflictClause}
         RETURNING ${returning.map(quoted).join(", ")}`,
        values,
      );
    }
    return this.withMutationEmbeds(
      client, resolvedEmbeds, result.rows, mutationResult(table, result.rows, MAX_INSERT_ROWS));
  }

  /**
   * Den Konfliktschluessel eines Upsert gegen den Katalog pruefen (2.105).
   *
   * Verglichen wird als Menge: `ON CONFLICT (a, b)` und `ON CONFLICT (b, a)`
   * berufen sich auf denselben Index, und PostgreSQL leitet ihn genauso ab.
   * Zurueck kommen die Spalten in der Reihenfolge des Index und mit den Namen
   * aus `pg_index`.
   *
   * Zwei Indizes ueber genau denselben Spalten sind kein Grund abzulehnen: Sie
   * halten dieselbe Zusage, und welcher von beiden die Ableitung nimmt, aendert
   * am Ergebnis nichts.
   */
  private async resolveConflictKey(
    client: SqlPoolClient,
    schema: string,
    table: string,
    requested: string[],
  ): Promise<UniqueKey> {
    const keys = await this.loadUniqueKeys(client, schema, table);
    const wanted = [...requested].sort().join("\0");
    const candidate = keys.find((key) => [...key.columns].sort().join("\0") === wanted);
    if (!candidate) throw new GeneratedDataApiError("GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN");
    return candidate;
  }

  private async loadUniqueKeys(client: SqlPoolClient, schema: string, table: string): Promise<UniqueKey[]> {
    const result = await client.query<UniqueKeyRow>(UNIQUE_KEYS_SQL, [schema, table, MAX_UNIQUE_KEYS + 1]);
    if (result.rows.length > MAX_UNIQUE_KEYS) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
    }
    return result.rows.map((row) => {
      if (!safeIdentifier(row.index_name) || !Array.isArray(row.columns) || row.columns.length < 1 ||
          row.columns.length > MAX_FOREIGN_KEY_COLUMNS || !row.columns.every(safeIdentifier) ||
          new Set(row.columns).size !== row.columns.length) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
          cause: new Error("unique key row rejected"),
        });
      }
      return { name: row.index_name, columns: row.columns };
    });
  }

  /**
   * Das Aendern selbst. `target` ist entweder der Primaerschluessel (REST) oder
   * eine Liste von Filtern (GraphQL, 2.97); die Bedingung entsteht aus
   * demselben `filterSql` wie beim Lesen, und `maximum` Zeilen duerfen es
   * hoechstens sein. Mehr getroffene Zeilen sind ein Fehler, und der Fehler
   * rollt die Transaktion zurueck: RETURNING zaehlt, was geaendert wurde, und
   * die Aenderung wirkt nur, wenn die Zahl stimmt.
   */
  private async updateWithin(
    client: SqlPoolClient,
    schema: string,
    tableName: string,
    target: MutationTarget,
    values: Record<string, unknown>,
    maximum: number,
    embeds?: GeneratedEmbed[],
  ): Promise<GeneratedMutationResult> {
    const table = await this.loadTable(client, schema, tableName);
    assertTableBoundary(table, "update");
    const resolvedEmbeds = embeds?.length
      ? await this.resolveEmbeds(client, schema, table, embeds, safeReturningColumns(table))
      : [];
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    const columns = Object.keys(values).sort();
    if (columns.length < 1 || columns.length > MAX_COLUMNS || columns.some((name) => {
      const column = byName.get(name);
      return !column?.updateable || column.sensitive || column.identity || column.generated ||
        column.primaryKeyPosition !== null || !isDataValue(values[name]);
    })) throw invalidInput();
    const parameters: SqlValue[] = [];
    const assignments = columns.map((name) => {
      parameters.push(values[name] as SqlValue);
      return `${quoted(name)} = $${parameters.length}`;
    });
    const where = mutationTargetSql(table, target, parameters);
    const returning = safeReturningColumns(table);
    const result = await client.query<Record<string, unknown>>(
      `UPDATE ${qualified(schema, tableName)} SET ${assignments.join(", ")}
       WHERE ${where} RETURNING ${returning.map(quoted).join(", ")}`,
      parameters,
    );
    return this.withMutationEmbeds(
      client, resolvedEmbeds, result.rows, mutationResult(table, result.rows, maximum));
  }

  /** Das Loeschen selbst, mit derselben Bedingung und derselben Obergrenze wie das Aendern. */
  private async deleteWithin(
    client: SqlPoolClient,
    schema: string,
    tableName: string,
    target: MutationTarget,
    maximum: number,
  ): Promise<GeneratedMutationResult> {
    const table = await this.loadTable(client, schema, tableName);
    assertTableBoundary(table, "delete");
    const parameters: SqlValue[] = [];
    const where = mutationTargetSql(table, target, parameters);
    const returning = safeReturningColumns(table);
    const result = await client.query<Record<string, unknown>>(
      `DELETE FROM ${qualified(schema, tableName)} WHERE ${where}
       RETURNING ${returning.map(quoted).join(", ")}`,
      parameters,
    );
    return mutationResult(table, result.rows, maximum);
  }

  async generateOpenApi(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<Record<string, unknown>> {
    assertRequest(context, scope, schema);
    return this.run(context, scope, false, async (client) => {
      const relations = await this.loadTables(client, schema);
      const tables = relations.filter(listableTable);
      // Views nur mit `security_invoker` — dieselbe Grenze wie beim Bedienen:
      // Ein View ohne sie wird von der Flaeche abgewiesen und gehoert deshalb
      // auch nicht ins Dokument. Die Mutationsprobe dieses Releases nimmt
      // genau diese Bedingung heraus.
      const views = relations
        .filter((table) => table.kind === "view" && table.securityInvoker && table.canSelect &&
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
          // Ein Upsert (2.105) steht nur, wo die Rolle auch aendern darf: Er
          // aendert eine vorhandene Zeile, und das Recht dazu ist dasselbe.
          ...(table.canInsert ? { post: generatedOperation(`insert_${table.name}`,
            table.canUpdate ? "Insert RLS-checked rows, or upsert with onConflict" : "Insert RLS-checked rows",
            componentName) } : {}),
          ...(table.canUpdate ? { patch: generatedOperation(`update_${table.name}`, "Update one row by primary key", componentName) } : {}),
          ...(table.canDelete ? { delete: generatedOperation(`delete_${table.name}`, "Delete one row by primary key", componentName) } : {}),
        };
      }
      for (const view of views) {
        const componentName = `Row_${view.name}`;
        schemas[componentName] = { type: "object", additionalProperties: false,
          properties: Object.fromEntries(view.columns
            .filter((column) => column.selectable && !column.sensitive)
            .map((column) => [column.name, openApiType(column.dataType, column.nullable)])) };
        const path = `/v1/projects/${scope.projectId}/environments/${scope.environment}/tables/${view.name}/rows`;
        // Nur GET: Ein View ist an dieser Flaeche ausschliesslich lesbar, und
        // ohne Primaerschluessel verlangt die Liste eine ausdrueckliche
        // Sortierspalte; Cursor werden abgewiesen statt still falsch zu
        // blaettern.
        paths[path] = {
          get: {
            ...generatedOperation(`list_view_${view.name}`,
              "List rows of a security_invoker view (read-only, cursorless)", componentName),
            parameters: [{
              name: "order", in: "query", required: true,
              description: "Explicit order as column.asc or column.desc — a view has no primary key to imply one.",
              schema: { type: "string", pattern: `^${DATA_IDENTIFIER_PATTERN}\\.(asc|desc)$` },
            }],
          },
        };
      }
      // RPC: nur was `callFunction` auch bedienen wuerde — SECURITY INVOKER,
      // ausfuehrbar, nicht ueberladen, benannte Argumente mit sicheren Typen.
      // Hoechstens 200 Funktionen je Schema; mehr kappt das Dokument bewusst.
      const functionRows = await client.query<FunctionMetadataRow>(SCHEMA_FUNCTIONS_SQL, [schema]);
      const overloadsByName = new Map<string, FunctionMetadataRow[]>();
      for (const row of functionRows.rows) {
        overloadsByName.set(row.function_name, [...(overloadsByName.get(row.function_name) ?? []), row]);
      }
      for (const [name, overloads] of [...overloadsByName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (overloads.length > 1) continue;
        // Ein Funktionsname ausserhalb der Grammatik ergaebe einen Pfad, den niemand erreicht (Review 2.28).
        if (!IDENTIFIER.test(name)) continue;
        const fn = overloads[0];
        const argNames = fn.arg_names.slice(0, fn.arg_count);
        const argTypes = fn.arg_types.slice(0, fn.arg_count);
        if (fn.security_definer || !fn.can_execute) continue;
        if (!SAFE_TYPE.test(fn.return_type) && !fn.returns_set) continue;
        if (argNames.length !== fn.arg_count || argNames.some((argName) => !IDENTIFIER.test(argName)) ||
            argTypes.some((argType) => !SAFE_TYPE.test(argType))) continue;
        const requiredArgs = argNames.slice(0, fn.arg_count - fn.default_count);
        const path = `/v1/projects/${scope.projectId}/environments/${scope.environment}/rpc/${name}`;
        paths[path] = {
          post: {
            operationId: `call_${name}`,
            // Die Volatilitaet steht im Dokument, weil sie das Verhalten
            // bestimmt: Alles ausser volatile laeuft in einer
            // READ-ONLY-Transaktion und kann nicht schreiben.
            summary: fn.volatility === "v"
              ? "Call a SECURITY INVOKER function (volatile — runs in a write transaction)"
              : "Call a SECURITY INVOKER function (read-only transaction)",
            security: [{ projectApiKey: [], projectAuthAccess: [] }, { projectApiKey: [] }, { sessionCookie: [] }],
            requestBody: {
              required: requiredArgs.length > 0,
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: {
                schema: { type: "string" },
                args: {
                  type: "object", additionalProperties: false,
                  properties: Object.fromEntries(argNames.map((argName, index) =>
                    [argName, openApiType(argTypes[index] ?? "", false)])),
                  ...(requiredArgs.length > 0 ? { required: requiredArgs } : {}),
                },
              }, ...(requiredArgs.length > 0 ? { required: ["args"] } : {}) } } },
            },
            responses: {
              "200": {
                description: fn.returns_set ? "Set-returning result rows" : "Single result value",
                content: { "application/json": { schema: { type: "object" } } },
              },
            },
          },
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

  async listReadableTables(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<GeneratedTable[]> {
    assertRequest(context, scope, schema);
    return this.run(context, scope, false, async (client) => {
      const relations = await this.loadTables(client, schema);
      return relations.filter(listableTable).map(publicTable);
    });
  }

  /**
   * Loest die Einbettungen einer Liste gegen den Katalog auf (2.66).
   *
   * Fuer jede Einbettung muss es zwischen Basistabelle und Nachbartabelle
   * genau einen Fremdschluessel geben. Zeigt er von der Basistabelle weg, ist
   * die Einbettung `one`; zeigt er auf sie, `many`. Zwei Schluessel, gleich in
   * welcher Richtung, sind mehrdeutig und werden abgewiesen.
   *
   * **Eine Tabelle auf sich selbst faellt auch.** Bis 2.110 behauptete der
   * Kommentar hier das, und der Code tat es nicht: Der eine Schluessel von
   * `kategorien.eltern_id` auf `kategorien.id` passte auf beide Richtungen,
   * `candidates.length` war 1, und die Einbettung lief still als `one`. Dabei
   * ist genau hier nicht entscheidbar, was gemeint war, der Elternknoten oder
   * die Kinder. Seit 2.111 faellt der Fall als mehrdeutig, wie der Kommentar es
   * immer sagte.
   *
   * Die Nachbartabelle geht durch dieselbe Tuer wie die Basistabelle:
   * `assertTableBoundary(..., "select")`. Ohne Zeilensicherheit gibt es
   * `GENERATED_DATA_API_RLS_REQUIRED`, ohne Leserecht `_FORBIDDEN`. Das gilt
   * auch fuer eine Nachbartabelle in einem anderen Schema (2.112): Die Policy
   * haengt an der Tabelle, und die Pruefung ist dieselbe. Die Mutationsprobe
   * dieses Schnitts nimmt genau diese Zeile heraus.
   *
   * Die zweite Ebene (2.111) wird hier gleich mit aufgeloest, und nur in der
   * Richtung `one`. Warum, steht mit den Zahlen bei
   * `DATA_API_LIMITS.maxEmbedDepth`.
   */
  private async resolveEmbeds(
    client: SqlPoolClient,
    schema: string,
    table: InternalTable,
    embeds: GeneratedEmbed[],
    selectedNames: string[],
    level = 1,
  ): Promise<ResolvedEmbed[]> {
    if (embeds.length === 0) return [];
    // Ein View traegt keine Fremdschluessel; eine Einbettung an ihm hat nichts,
    // woran sie haengen koennte.
    if (table.kind !== "table") throw invalidInput();
    if (level > MAX_EMBED_DEPTH || embeds.length > (level === 1 ? MAX_EMBEDS : MAX_NESTED_EMBEDS)) {
      throw invalidInput();
    }
    const taken = new Set(selectedNames);
    for (const embed of embeds) {
      if (taken.has(embed.alias)) throw invalidInput();
      taken.add(embed.alias);
    }
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    const resolved: ResolvedEmbed[] = [];
    for (const embed of embeds) {
      const targetSchema = embed.schema ?? schema;
      // Ein Systemschema ist keines, das diese Flaeche bedient, und die Grenze
      // steht hier genauso wie am Schema der Anfrage selbst.
      if (!isDataSchemaName(targetSchema)) throw invalidInput();
      const candidates = await this.loadEmbedForeignKeys(
        client, schema, table.name, targetSchema, embed.relation);
      // Unbekannt, mehrdeutig oder eine Tabelle auf sich selbst: alles drei ist
      // ein Fehler des Aufrufs, und die Antwort sagt nicht, welches davon. Der
      // Unterschied verriete, ob eine Tabelle dieses Namens existiert.
      const selfReference = targetSchema === schema && embed.relation === table.name;
      if (candidates.length !== 1 || selfReference) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_INVALID_INPUT", {
          cause: new Error(selfReference ? "self relation"
            : candidates.length === 0 ? "unknown relation" : "ambiguous relation"),
        });
      }
      const fk = candidates[0]!;
      const kind: "one" | "many" = fk.schema === schema && fk.table === table.name ? "one" : "many";
      // Die zweite Ebene traegt nur `one`. Eine zweite Ebene als `many` waere
      // maxEmbedRows mal maxEmbedRows Zeilen je Wurzelzeile; die Rechnung steht
      // in lib/data-api-limits.ts.
      if (level > 1 && kind !== "one") {
        throw new GeneratedDataApiError("GENERATED_DATA_API_INVALID_INPUT", {
          cause: new Error("nested many relation"),
        });
      }
      const localKey = kind === "one" ? fk.columns : fk.referencedColumns;
      const remoteKey = kind === "one" ? fk.referencedColumns : fk.columns;
      const target = await this.loadTable(client, targetSchema, embed.relation);
      assertTableBoundary(target, "select");
      if (target.kind !== "table") throw invalidInput();
      // Eine Liste braucht eine Ordnung, sonst waere der Schnitt bei
      // maxEmbedRows Zufall; die Ordnung ist der Primaerschluessel der
      // Nachbartabelle, wie bei der Liste selbst.
      if (kind === "many" && target.primaryKey.length === 0) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_PRIMARY_KEY_REQUIRED");
      }
      const targetByName = new Map(target.columns.map((column) => [column.name, column]));
      const usable = (columns: Map<string, GeneratedTableColumn>, name: string) => {
        const column = columns.get(name);
        return Boolean(column && column.selectable && !column.sensitive);
      };
      // Die Schluesselspalten werden auf beiden Seiten gelesen; eine sensible
      // oder nicht lesbare Schluesselspalte macht die Einbettung unmoeglich,
      // nicht nur unvollstaendig.
      if (localKey.some((name) => !usable(byName, name)) || remoteKey.some((name) => !usable(targetByName, name))) {
        throw invalidInput();
      }
      if (kind === "many" && target.primaryKey.some((name) =>
        !usable(targetByName, name) || !isSortableDataType(targetByName.get(name)!.dataType))) {
        throw invalidInput();
      }
      const columns = embed.columns
        ? uniqueIdentifiers(embed.columns)
        : target.columns.filter((column) => column.selectable && !column.sensitive).map((column) => column.name);
      if (columns.length === 0 || columns.some((name) => !usable(targetByName, name))) throw invalidInput();
      // Die zweite Ebene steht unter der Nachbartabelle, also mit ihr als
      // Basistabelle und ihrem Schema; ihre Aliasse duerfen nicht auf die
      // Spalten der Nachbartabelle fallen.
      const nested = await this.resolveEmbeds(
        client, targetSchema, target, embed.embed ?? [], columns, level + 1);
      resolved.push({
        embed,
        target,
        schema: targetSchema,
        foreignSchema: targetSchema !== schema,
        kind,
        constraint: fk.name,
        localKey,
        remoteKey,
        columns,
        nested,
      });
    }
    return resolved;
  }

  /**
   * Die Fremdschluessel zwischen zwei genannten Tabellen, in beide Richtungen.
   * Mehr als einer ist mehrdeutig; die Abfrage holt einen mehr, damit der
   * Aufrufer das entscheiden kann, statt hier eine Grenze zu reissen.
   */
  private async loadEmbedForeignKeys(
    client: SqlPoolClient,
    schema: string,
    table: string,
    targetSchema: string,
    targetTable: string,
  ): Promise<EmbedForeignKey[]> {
    const result = await client.query<EmbedForeignKeyRow>(
      EMBED_FOREIGN_KEYS_SQL, [schema, table, targetSchema, targetTable, MAX_EMBED_FOREIGN_KEYS + 1]);
    return result.rows.map((row) => {
      const names = (value: unknown): value is string[] => Array.isArray(value) &&
        value.length >= 1 && value.length <= MAX_FOREIGN_KEY_COLUMNS && value.every(safeIdentifier);
      if (!safeIdentifier(row.constraint_name) || !safeIdentifier(row.table_name) ||
          !safeIdentifier(row.referenced_table) || !isDataSchemaName(row.table_schema) ||
          !isDataSchemaName(row.referenced_schema) ||
          !names(row.columns) || !names(row.referenced_columns) ||
          // Ein Fremdschluessel hat auf beiden Seiten gleich viele Spalten.
          // Stimmt das nicht, hat die Abfrage eine verloren, und die Zuordnung
          // waere falsch.
          row.columns.length !== row.referenced_columns.length) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
          cause: new Error("foreign key row rejected"),
        });
      }
      return {
        name: row.constraint_name,
        schema: row.table_schema,
        table: row.table_name,
        columns: row.columns,
        referencedSchema: row.referenced_schema,
        referencedTable: row.referenced_table,
        referencedColumns: row.referenced_columns,
      };
    });
  }

  /**
   * Haengt die Einbettungen einer Mutation an deren Antwortzeilen (2.111).
   *
   * Lesend und nur lesend: Die Mutation hat schon geschrieben, und was hier
   * passiert, ist dieselbe Einbettung wie bei einer Lesung, mit derselben
   * Aufloesung, denselben Grenzen und derselben Tuer. Sie laeuft in derselben
   * Transaktion und auf derselben Verbindung, also unter denselben Anspruechen:
   * Der Aufrufer sieht in `records` keine Zeile, die ihm eine Lesung nicht auch
   * gaebe.
   *
   * Die Aliasse duerfen nicht auf die zurueckgegebenen Spalten fallen. Eine
   * Mutation gibt alle waehlbaren, nicht sensiblen Spalten zurueck, und ein
   * Alias darauf wuerde einen Wert still ueberschreiben.
   *
   * Die Groesse wird nach dem Anhaengen noch einmal gemessen. `mutationResult`
   * hat die Zeilen ohne Nachbarn gemessen, und mit ihnen sind sie groesser.
   *
   * Aufgeloest sind die Einbettungen schon, und zwar **vor** dem Schreiben: Eine
   * Mutation mit einer Einbettung, die der Katalog nicht hergibt, soll nicht
   * erst schreiben und dann zurueckrollen.
   */
  private async withMutationEmbeds(
    client: SqlPoolClient,
    resolved: ResolvedEmbed[],
    raw: Array<Record<string, unknown>>,
    result: GeneratedMutationResult,
  ): Promise<GeneratedMutationResult> {
    if (resolved.length === 0) return result;
    const embedResults = await this.attachEmbeds(client, resolved, raw, result.rows);
    if (boundedRows(result.rows, MAX_RESPONSE_BYTES).length !== result.rows.length) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
    }
    return { ...result, embeds: embedResults };
  }

  /**
   * Haengt die aufgeloesten Einbettungen an die Antwortzeilen (2.66).
   *
   * `source` sind die Zeilen, wie die Datenbank sie hergegeben hat, mit allen
   * Schluesselspalten; `target` sind dieselben Zeilen, schon auf die bestellten
   * Spalten beschnitten. Beide Listen haben dieselbe Laenge und dieselbe
   * Reihenfolge, und daran haengt die Zuordnung.
   *
   * Eine Lesung und eine Mutation benutzen genau diese Methode, damit es keine
   * zweite Stelle gibt, an der eine Einbettung anders entsteht.
   */
  private async attachEmbeds(
    client: SqlPoolClient,
    resolvedEmbeds: ResolvedEmbed[],
    source: Array<Record<string, unknown>>,
    target: Array<Record<string, unknown>>,
  ): Promise<GeneratedEmbedResult[]> {
    const results: GeneratedEmbedResult[] = [];
    for (const resolved of resolvedEmbeds) {
      const loaded = await this.loadEmbed(client, resolved, source);
      for (const [index, row] of target.entries()) {
        row[resolved.embed.alias] = loaded.byRow[index];
      }
      results.push(embedResult(resolved, loaded.truncated, loaded.nested));
    }
    return results;
  }

  /**
   * Liest die Nachbarzeilen einer aufgeloesten Einbettung (2.66).
   *
   * Eine Abfrage je Einbettung, in derselben Transaktion und unter denselben
   * Anspruechen wie die Liste: `WHERE (schluessel) IN (...)` ueber die
   * Schluesselwerte der gelesenen Zeilen. Die Zeilensicherheit der
   * Nachbartabelle gilt damit von PostgreSQL her; es gibt keinen Weg an ihr
   * vorbei, weil es keine zweite Verbindung und keine zweite Rolle gibt. Das
   * gilt auch fuer eine Nachbartabelle in einem anderen Schema (2.112): Dieselbe
   * Verbindung, dieselbe Rolle, dieselbe Transaktion.
   *
   * `many` begrenzt je Elternzeile mit `row_number()` ueber den
   * Primaerschluessel der Nachbartabelle und liest eine Zeile mehr, um
   * `truncated` sagen zu koennen. `one` braucht keine Grenze: Die Zielspalten
   * eines Fremdschluessels sind eindeutig.
   *
   * Die zweite Ebene (2.111) laeuft ueber dieselbe Methode, mit den Zeilen
   * dieser Einbettung als Eltern. Sie laeuft **einmal fuer alle** Elternzeilen
   * und nicht je Elternzeile: eine Abfrage je Einbettung und Ebene, nicht eine
   * je Zeile.
   */
  private async loadEmbed(
    client: SqlPoolClient,
    resolved: ResolvedEmbed,
    parents: Array<Record<string, unknown>>,
  ): Promise<{ byRow: unknown[]; truncated: boolean; nested: GeneratedEmbedResult[] }> {
    const empty = resolved.kind === "many" ? () => [] as unknown[] : () => null;
    const nestedEmpty: GeneratedEmbedResult[] = resolved.nested.map((nested) => embedResult(nested, false, []));
    const parentKeys = parents.map((row) => {
      const values = resolved.localKey.map((name) => row[name]);
      return values.some((value) => value === null || value === undefined) ? null : values;
    });
    const distinct = new Map<string, unknown[]>();
    for (const key of parentKeys) {
      if (key) distinct.set(embedKey(key), key);
    }
    if (distinct.size === 0) {
      return { byRow: parents.map(empty), truncated: false, nested: nestedEmpty };
    }

    const values: SqlValue[] = [];
    const tuples = [...distinct.values()].map((key) => {
      const placeholders = key.map((value) => {
        if (!isScalarDataValue(value) && !(value instanceof Date)) {
          throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED", {
            cause: new Error("unsupported foreign key value"),
          });
        }
        values.push(value as SqlValue);
        return `$${values.length}`;
      });
      return placeholders.length === 1 ? placeholders[0]! : `(${placeholders.join(", ")})`;
    });
    const keyList = resolved.remoteKey.length === 1
      ? quoted(resolved.remoteKey[0]!)
      : `(${resolved.remoteKey.map(quoted).join(", ")})`;
    // Die Schluesselspalten der zweiten Ebene werden mitgelesen, auch wenn der
    // Aufrufer sie nicht bestellt hat; in die Antwort kommen sie nur, wenn sie
    // in der Spaltenliste dieser Einbettung stehen.
    const nestedKeyColumns = resolved.nested.flatMap((nested) => nested.localKey);
    const readColumns = [...new Set([
      ...resolved.remoteKey, ...resolved.columns, ...resolved.target.primaryKey, ...nestedKeyColumns,
    ])];
    const target = qualified(resolved.schema, resolved.target.name);

    let rows: Array<Record<string, unknown>>;
    if (resolved.kind === "one") {
      const result = await client.query<Record<string, unknown>>(
        `SELECT ${readColumns.map(quoted).join(", ")} FROM ${target} WHERE ${keyList} IN (${tuples.join(", ")})`,
        values);
      rows = result.rows;
    } else {
      const rank = "__qkern_embed_rank";
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM (
           SELECT ${readColumns.map(quoted).join(", ")},
                  row_number() OVER (PARTITION BY ${resolved.remoteKey.map(quoted).join(", ")}
                                     ORDER BY ${resolved.target.primaryKey.map((name) => `${quoted(name)} ASC`).join(", ")}) AS "${rank}"
           FROM ${target}
           WHERE ${keyList} IN (${tuples.join(", ")})
         ) AS "__qkern_embed" WHERE "${rank}" <= ${MAX_EMBED_ROWS + 1}`,
        values);
      rows = result.rows;
    }
    // Mehr Zeilen, als die Grenze je Elternzeile mal Eltern zulaesst, kann
    // die Abfrage nicht liefern; kommt es doch vor, ist die Annahme falsch.
    if (rows.length > distinct.size * (resolved.kind === "one" ? 1 : MAX_EMBED_ROWS + 1)) {
      throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
    }

    // Zuerst zuordnen und beschneiden, dann die zweite Ebene. Die Reihenfolge
    // ist der Grund, warum die Rechnung in lib/data-api-limits.ts aufgeht: Eine
    // Zeile, die der Schnitt bei maxEmbedRows wegnimmt, kostet keine Abfrage auf
    // der zweiten Ebene. Umgekehrt waere die Zahl der Elternzeilen dort um die
    // eine Zeile je Elternzeile hoeher, die nur den Schnitt feststellt.
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const key = embedKey(resolved.remoteKey.map((name) => row[name]));
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    let truncated = false;
    const perParent = parentKeys.map((key) => {
      if (!key) return null;
      const matched = grouped.get(embedKey(key)) ?? [];
      if (resolved.kind === "one") return matched.slice(0, 1);
      if (matched.length > MAX_EMBED_ROWS) truncated = true;
      return matched.slice(0, MAX_EMBED_ROWS);
    });

    // Die zweite Ebene laeuft ueber die Zeilen, die der Aufrufer wirklich
    // bekommt, und bevor sie auf ihre Spalten beschnitten werden: Sonst waeren
    // die Schluesselspalten der zweiten Ebene schon fort. Eine Zeile, die an
    // mehreren Elternzeilen haengt, steht hier nur einmal.
    const kept: Array<Record<string, unknown>> = [];
    const position = new Map<Record<string, unknown>, number>();
    for (const matched of perParent) {
      for (const row of matched ?? []) {
        if (position.has(row)) continue;
        position.set(row, kept.length);
        kept.push(row);
      }
    }
    const nestedResults: GeneratedEmbedResult[] = [];
    const nestedValues = new Map<string, unknown[]>();
    for (const nested of resolved.nested) {
      const loaded = await this.loadEmbed(client, nested, kept);
      nestedValues.set(nested.embed.alias, loaded.byRow);
      nestedResults.push(embedResult(nested, loaded.truncated, loaded.nested));
    }

    // Jede gelesene Zeile wird genau einmal auf ihre Spalten gebracht, auch
    // wenn sie an mehreren Elternzeilen haengt; die Antwort traegt dann dasselbe
    // Objekt zweimal, und das ist beim Serialisieren dasselbe Ergebnis.
    const projected = kept.map((row) => {
      const value = projectRow(row, resolved.columns);
      for (const [alias, byRow] of nestedValues) {
        value[alias] = byRow[position.get(row)!];
      }
      return value;
    });
    const byRow = perParent.map((matched) => {
      if (!matched) return empty();
      const values = matched.map((row) => projected[position.get(row)!]!);
      return resolved.kind === "one" ? values[0] ?? null : values;
    });
    return { byRow, truncated, nested: nestedResults };
  }

  /**
   * Die freie Abfrage unter der Zeilensicherheit (2.117).
   *
   * Vier Dinge stehen hier, und jedes traegt einen Teil der Zusage:
   *
   * 1. **Die Lesung vor der Datenbank.** `readFreeQuery` nennt jede Relation des
   *    Textes und weist alles ab, dessen Auflösung sie nicht nachvollziehen
   *    kann: eine Tabelle ohne Schema, eine Tabelle aus einem fremden Schema,
   *    eine Funktion mit Schema, einen Operator mit Schema, einen Cast mit
   *    Schema und jede Funktion ausserhalb der Liste. Die Begruendung dieser
   *    Regel steht in `free-query.ts`.
   * 2. **Die Pruefung je Relation.** Jede gefundene Relation geht durch
   *    `assertTableBoundary(..., "select")`, also durch genau die Tuer, durch die
   *    auch `listRows` geht. Eine Tabelle ohne Zeilensicherheit endet mit
   *    `GENERATED_DATA_API_RLS_REQUIRED`, eine Tabelle im Eigentum der
   *    Projektrolle ohne `FORCE` mit der Grenzablehnung.
   * 3. **`search_path = pg_catalog`.** Ohne diese Zeile waere die Lesung oben
   *    eine Annahme. Mit ihr loest PostgreSQL unqualifizierte Namen nur im
   *    Systemkatalog auf, und die Lesung und die Auflösung koennen nicht
   *    auseinandergehen.
   * 4. **Die Ausfuehrung in `this.run`.** Dieselbe Verbindung, dieselbe Rolle,
   *    dasselbe `BEGIN READ ONLY`, dasselbe `row_security = on`, dieselben
   *    Zeitlimits und dieselben `request.jwt.claims` wie bei einer Liste. Es
   *    gibt hier keinen zweiten Weg in die Datenbank, denn ein zweiter Weg waere
   *    eine zweite Antwort auf die Frage, unter welchen Anspruechen gelesen wird.
   *
   * Spalten mit einem Namen wie `password` oder `api_token` liefert diese
   * Flaeche nicht aus, so wie sie sie auch aus einer Liste und aus dem
   * generierten Dokument heraushaelt. Bei einer freien Abfrage steht der
   * Spaltenname erst am Ergebnis fest, also fallen sie dort und werden in
   * `omitted` genannt.
   */
  async queryUnderRowSecurity(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    input: GeneratedFreeQueryInput,
  ): Promise<GeneratedFreeQueryResult> {
    assertRequest(context, scope, input.schema);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < MIN_ROWS || limit > MAX_ROWS) throw invalidInput();
    const reading = readFreeQuery(input.statement, input.schema);
    if (!reading.ok) {
      // Der Grund der Ablehnung gehoert zum Aufruf und nicht zum Inhalt: Er
      // nennt die Form des Textes und keine Tabelle, keine Spalte und keine
      // Zeile. Darum steht er als `cause` im Log und nicht in der Antwort.
      throw new GeneratedDataApiError("GENERATED_DATA_API_READ_ONLY", {
        cause: new Error(`free query rejected by ${reading.reason}`),
      });
    }
    const statement = input.statement.trim().replace(/;\s*$/, "");
    return this.run(context, scope, false, async (client) => {
      for (const relation of reading.relations) {
        assertTableBoundary(await this.loadTable(client, relation.schema, relation.name), "select");
      }
      await client.query(`SET LOCAL search_path = pg_catalog`);
      // Die Grenze steht als Literal im Text und kommt vom Server: Ohne sie
      // puffert der Treiber so viele Zeilen, wie die Abfrage hergibt, und die
      // Grenze der Anwendung kaeme zu spaet.
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM (${statement}) AS qkern_free_query LIMIT ${limit + 1}`,
      );
      const selected = result.rows.slice(0, limit);
      const present = selected[0] ? Object.keys(selected[0]) : [];
      const omitted = present.filter((name) => SENSITIVE_COLUMN.test(name));
      const columns = present.filter((name) => !SENSITIVE_COLUMN.test(name)).slice(0, MAX_COLUMNS);
      const rows = boundedRows(
        selected.map((row) => projectRow(row, columns)), MAX_RESPONSE_BYTES);
      await this.meterRowReads(context, scope, rows.length);
      return {
        source: "postgres" as const,
        relations: reading.relations,
        columns,
        rows,
        rowCount: rows.length,
        omitted,
        truncated: result.rows.length > limit || rows.length < selected.length ||
          present.length > columns.length + omitted.length,
        maxRows: limit,
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
          kind: row.relation_kind === "v" ? "view" as const : "table" as const,
          securityInvoker: row.security_invoker === true,
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
        // Die Ansprueche eines fremden Ausstellers zuerst (2.80), die eigenen
        // danach: Bei gleichem Namen gewinnt QKERN, und zwar durch die Stellung
        // und nicht durch eine zweite Pruefung, die jemand vergessen kann.
        ...(context.claims.external ?? {}),
        role: context.claims.role,
        sub: context.claims.subject,
        ...(context.claims.keyId ? { key_id: context.claims.keyId } : {}),
        ...(context.claims.email ? { email: context.claims.email } : {}),
        ...(context.claims.emailVerified !== undefined ? { email_verified: context.claims.emailVerified } : {}),
        ...(context.claims.assurance ? { aal: context.claims.assurance } : {}),
        ...(context.claims.sessionId ? { session_id: context.claims.sessionId } : {}),
        ...(context.claims.userMetadata ? { user_metadata: context.claims.userMetadata } : {}),
        ...(context.claims.appMetadata ? { app_metadata: context.claims.appMetadata } : {}),
        ...(context.claims.issuer ? { iss: context.claims.issuer } : {}),
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
      // 42501 ist insufficient_privilege, und genau so meldet PostgreSQL eine
      // Zeile, die an WITH CHECK scheitert. In einer Schreibtransaktion ist das
      // die Antwort der Policy und kein Ausfall; die Transaktion ist oben
      // schon zurueckgerollt, also wirkt nichts aus ihr.
      if (write && isPolicyRejection(error)) {
        throw new GeneratedDataApiError("GENERATED_DATA_API_POLICY_REJECTED", { cause: error });
      }
      throw new GeneratedDataApiError("GENERATED_DATA_API_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}

export class DisabledGeneratedDataApi implements GeneratedDataApiPort {
  private disabled(): never { throw new GeneratedDataApiError("GENERATED_DATA_API_DISABLED"); }
  async aggregateRows(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedAggregateInput,
  ): Promise<GeneratedAggregateResult> { return this.disabled(); }
  async callFunction(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedCallInput,
  ): Promise<GeneratedCallResult> { return this.disabled(); }
  async listRows(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedListInput,
  ): Promise<GeneratedListResult> { return this.disabled(); }
  async listReadableTables(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _schema: string,
  ): Promise<GeneratedTable[]> { return this.disabled(); }
  async queryUnderRowSecurity(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedFreeQueryInput,
  ): Promise<GeneratedFreeQueryResult> { return this.disabled(); }
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
  async mutateRows(
    _context: GeneratedDataContext, _scope: ProjectDataPlaneScope, _input: GeneratedMutationBatchInput,
  ): Promise<GeneratedMutationBatchResult> { return this.disabled(); }
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
      // Der Aussteller eines fremden Tokens (2.80). Begrenzt, weil er in eine
      // Transaktionseinstellung wandert, und mit `issuer` **und** `service_role`
      // zusammen verboten: Ein fremdes Token bekommt hoechstens
      // `authenticated`, und diese Regel steht hier noch einmal, weil die Data
      // API sie nicht davon abhaengig machen soll, dass jeder Aufrufweg sie
      // kennt. Wer einen zweiten Weg baut, der ein fremdes Token auf
      // `service_role` abbildet, faellt hier und nicht erst in einer Policy,
      // die es nicht gibt.
      (context.claims.issuer !== undefined &&
        (context.claims.issuer.length < 1 || context.claims.issuer.length > 512 ||
          context.claims.role === "service_role")) ||
      !["authenticated", "anon", "service_role"].includes(context.claims.role) ||
      !scope.projectId || scope.projectId.length > 128 ||
      !(["development", "staging", "production"] satisfies Environment[]).includes(scope.environment) ||
      !safeSchema(schema) || (table !== undefined && !safeIdentifier(table))) {
    throw invalidInput();
  }
}

function safeSchema(value: string): boolean {
  return isDataSchemaName(value);
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

/**
 * Eine Tabelle, die diese Flaeche als Liste anbietet.
 *
 * Bis 2.82 stand diese Bedingung nur im generierten OpenAPI-Dokument. Seit 2.83
 * liest die GraphQL-Flaeche dasselbe Praedikat, statt es abzuschreiben: Sonst
 * koennte ein Dokument eine Tabelle nennen, die die andere Flaeche nicht
 * bedient, und umgekehrt.
 *
 * Views stehen absichtlich nicht hier. Sie haben ihre eigene Bedingung
 * (`security_invoker`) und ihre eigene Einschraenkung (keine Ordnung, kein
 * Cursor), und das OpenAPI-Dokument filtert sie darum getrennt.
 */
function listableTable(table: InternalTable): boolean {
  return table.kind === "table" &&
    table.rowSecurityEnabled && (!table.ownedByCurrentRole || table.forceRowSecurity) &&
    table.primaryKey.length > 0 && table.canSelect &&
    table.columns.some((column) => column.selectable && !column.sensitive);
}

function assertTableBoundary(table: InternalTable, action: "select" | "insert" | "update" | "delete"): void {
  if (table.kind === "view") {
    // Ein View ist hier eine Leseflaeche. Schreibbare Views existieren in
    // PostgreSQL, aber ihre Update-Regeln liegen ausserhalb dessen, was diese
    // API zusagen kann — ein Schreibversuch ist ein Fehler des Aufrufs.
    if (action !== "select") throw new GeneratedDataApiError("GENERATED_DATA_API_READ_ONLY");
    // Ohne security_invoker laeuft der View mit den Rechten seines
    // Eigentuemers und die RLS der Basistabellen gilt fuer den Aufrufer
    // nicht. Das ist derselbe Mangel wie eine Tabelle ohne RLS, und er
    // bekommt denselben Code.
    if (!table.securityInvoker) throw new GeneratedDataApiError("GENERATED_DATA_API_RLS_REQUIRED");
    if (table.ownedByCurrentRole) throw new GeneratedDataApiError("GENERATED_DATA_API_BOUNDARY_REJECTED");
    if (!table.canSelect) throw new GeneratedDataApiError("GENERATED_DATA_API_FORBIDDEN");
    return;
  }
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
    kind: table.kind,
    rowSecurityEnabled: table.rowSecurityEnabled,
    primaryKey: [...table.primaryKey],
    columns: table.columns.filter((column) => !column.sensitive).map((column) => ({ ...column })),
    canInsert: table.canInsert,
    canUpdate: table.canUpdate,
    canDelete: table.canDelete,
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
      !DATA_API_LIMITS.operators.includes(value.operator)) return false;
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

/**
 * Der Schluessel einer Elternzeile fuer die Zuordnung der Nachbarzeilen (2.66).
 *
 * Beide Seiten kommen vom Treiber, aber nicht zwingend im selben Typ: Ein
 * `integer` kommt als Zahl, ein `bigint` als Zeichenkette, und ein
 * Fremdschluessel darf die beiden verbinden. Verglichen wird darum der Text
 * jedes Werts und nicht der Wert selbst.
 */
function embedKey(values: unknown[]): string {
  return JSON.stringify(values.map((value) => {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
    if (value !== null && typeof value === "object") return JSON.stringify(value);
    return String(value);
  }));
}

/**
 * Die Angabe zu einer Einbettung, wie der Aufrufer sie bekommt (2.111).
 *
 * `schema` steht nur dort, wo es ein anderes ist als das der Basistabelle, und
 * `embeds` nur dort, wo es eine zweite Ebene gibt. Eine gewoehnliche
 * Einbettung traegt damit genau die Felder, die sie bis 2.110 trug.
 */
function embedResult(
  resolved: ResolvedEmbed,
  truncated: boolean,
  nested: GeneratedEmbedResult[],
): GeneratedEmbedResult {
  return {
    alias: resolved.embed.alias,
    relation: resolved.embed.relation,
    kind: resolved.kind,
    constraint: resolved.constraint,
    truncated,
    ...(resolved.foreignSchema ? { schema: resolved.schema } : {}),
    ...(nested.length > 0 ? { embeds: nested } : {}),
  };
}

/**
 * Die eingebetteten Zeilen einer Antwortzeile, ueber alle Ebenen gezaehlt
 * (2.111). Sie sind gelesene Zeilen, auch wenn sie in einer anderen Zeile
 * stecken, und die Abrechnung zaehlt sie darum mit.
 */
function countEmbeddedRows(row: Record<string, unknown>, embeds: GeneratedEmbedResult[]): number {
  let total = 0;
  for (const embed of embeds) {
    const value = row[embed.alias];
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    total += rows.length;
    for (const inner of rows) {
      if (isPlainRecord(inner)) total += countEmbeddedRows(inner, embed.embeds ?? []);
    }
  }
  return total;
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
  return { source: "postgres", table: publicTable(table), rows, rowCount: rows.length, embeds: [] };
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

/** Worauf eine Aenderung zielt: der Primaerschluessel (REST) oder Filter (GraphQL, 2.97). */
type MutationTarget = { match: Record<string, unknown> } | { filters: GeneratedDataFilter[] };

/**
 * Die WHERE-Bedingung einer Mutation. Filter gehen durch dieselbe Pruefung und
 * dasselbe `filterSql` wie beim Lesen: nur waehlbare, nicht sensible Spalten,
 * nur die bekannten Operatoren, jeder Wert als Parameter. Ohne Bedingung gibt
 * es keine Aenderung; eine leere Liste ist hier ein Fehler und kein "alle".
 */
function mutationTargetSql(table: InternalTable, target: MutationTarget, values: SqlValue[]): string {
  if ("match" in target) {
    assertPrimaryKeyMatch(table, target.match);
    return primaryKeySql(table, target.match, values);
  }
  if (target.filters.length < 1 || target.filters.length > MAX_FILTERS) throw invalidInput();
  const byName = new Map(table.columns.map((column) => [column.name, column]));
  for (const filter of target.filters) {
    const column = byName.get(filter.column);
    if (!column?.selectable || column.sensitive || !isFilter(filter)) throw invalidInput();
  }
  return target.filters.map((filter) => filterSql(filter, values)).join(" AND ");
}

/** Die Form eines Einfuegens, vor der Datenbank; von `insertRows` und `mutateRows` geteilt. */
/**
 * Die Form der Einbettungen, vor der Datenbank (2.66, Ebenen seit 2.111).
 *
 * Die Zahl je Ebene faellt hier und nicht erst nach dem Lesen: Jede weitere
 * Einbettung waere eine weitere Abfrage, und die Grenze soll die Arbeit sparen
 * und nicht erst das Ergebnis verwerfen. Was eine Beziehung oder eine Spalte in
 * der Sache ist, entscheidet danach der Katalog in `resolveEmbeds`.
 */
function assertEmbedInput(embeds: unknown, level: number): asserts embeds is GeneratedEmbed[] {
  if (!Array.isArray(embeds) || embeds.length > (level === 1 ? MAX_EMBEDS : MAX_NESTED_EMBEDS)) {
    throw invalidInput();
  }
  if (embeds.length > 0 && level > MAX_EMBED_DEPTH) throw invalidInput();
  for (const embed of embeds) {
    if (!isPlainRecord(embed) || !safeIdentifier(embed.alias) || !safeIdentifier(embed.relation) ||
        (embed.schema !== undefined && !isDataSchemaName(embed.schema)) ||
        (embed.columns !== undefined && (!Array.isArray(embed.columns) || embed.columns.length > MAX_COLUMNS))) {
      throw invalidInput();
    }
    if (embed.embed !== undefined) assertEmbedInput(embed.embed, level + 1);
  }
}

function assertInsertInput(rows: unknown): asserts rows is Array<Record<string, unknown>> {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_INSERT_ROWS ||
      byteLength(rows) > MAX_INPUT_BYTES || rows.some((row) => !isPlainRecord(row))) {
    throw invalidInput();
  }
}

/**
 * Die Form des Konfliktschluessels, vor der Datenbank (2.105).
 *
 * Nur die Form: dass es zu diesen Spalten einen eindeutigen Schluessel gibt,
 * sagt erst der Katalog in `resolveConflictKey`. 32 ist die Zahl, die
 * PostgreSQL fuer einen Schluessel zulaesst; mehr koennte kein Index sein.
 */
function assertConflictInput(onConflict: unknown): asserts onConflict is string[] | undefined {
  if (onConflict === undefined) return;
  if (!Array.isArray(onConflict) || onConflict.length < 1 || onConflict.length > MAX_FOREIGN_KEY_COLUMNS ||
      !onConflict.every(safeIdentifier) || new Set(onConflict).size !== onConflict.length) {
    throw invalidInput();
  }
}

/** Ein Treiberfehler mit SQLSTATE 42501: die Policy hat die Zeile abgewiesen. */
function isPolicyRejection(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "42501";
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

function isNumericDataType(type: string): boolean {
  return /^(?:smallint|integer|bigint|numeric|decimal|real|double precision)/.test(type);
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
