import { isDataIdentifier, isDataSchemaName } from "@/lib/server/data-plane/identifiers";

/**
 * Die Vorlagen des SQL-Editors (2.61), rein und ohne Datenbank.
 *
 * Bis hierher war `SQL Editor -> Vorlagen` ein Platzhalter mit dem Satz
 * "Fertige Abfragen zum Einfuegen". Jetzt gibt es die Abfragen wirklich, und
 * zwar als feste Liste in diesem Modul: kein Nachladen, keine Verwaltung,
 * keine gespeicherten Abfragen. Eine Vorlage ist ein Text, den die Ansicht in
 * das Editorfeld schreibt. Ausgefuehrt wird nichts; den Knopf drueckt weiter
 * der Mensch.
 *
 * Warum das ein eigenes Modul ist -- dieselbe Begruendung wie beim
 * Tabellen-Designer (`table-change-sets.ts`, 2.49): der Weg von einem Namen
 * aus einem Eingabefeld bis in eine SQL-Anweisung liegt an genau einer
 * Stelle, ohne React, ohne fetch, ohne Uebersetzung, und ist einzeln pruefbar.
 *
 * Die Regeln, auf denen alles steht:
 *
 * 1. **Jede Vorlage ist lesend.** Genau ein Statement, und `isReadOnlySql`
 *    aus `lib/security.ts` muss es annehmen: ein `SELECT` (oder `WITH`/
 *    `UNION` darueber), kein `INTO`, keine Funktion mit Nebenwirkung. Das ist
 *    derselbe Waechter, den die Query-Route vor der Datenbank hat. Der Test
 *    behauptet das nicht, er ruft den Waechter.
 * 2. **Der Text der Vorlage ist fertig.** Kein Statement wird aus Bausteinen
 *    zusammengesetzt, die ein Aufrufer waehlt. Wer eine Vorlage will, nennt
 *    ihre Kennung; der SQL-Text steht hier.
 * 3. **Namen kommen nur ueber die Grammatik der Data API herein.** Zwei
 *    Vorlagen brauchen eine Tabelle. Ihr Schema- und Tabellenname muessen
 *    `[A-Za-z_][A-Za-z0-9_]{0,62}` erfuellen (`isDataIdentifier`), das Schema
 *    zusaetzlich kein Systemschema sein (`isDataSchemaName`). Erst danach
 *    wird zitiert, und zitiert wird immer: `"name"`. `quoted()` prueft das
 *    Anfuehrungszeichen ein zweites Mal, genau wie in 2.49.
 * 4. **Keine Vorlage traegt einen Parameter, den sie nicht deklariert.** Wer
 *    `parameters: []` sagt, darf im Text keinen Platzhalter haben. Der Test
 *    prueft beide Richtungen.
 *
 * Was die Vorlagen bewusst **nicht** tun: nichts schreiben, keine Funktion
 * mit Nebenwirkung rufen (`setval`, `pg_terminate_backend`, `dblink`, ...),
 * keine fremde Datenbank lesen. Jede Vorlage bleibt in `current_database()`.
 * Die Spalte `query` aus `pg_stat_statements` und `pg_stat_activity` lesen sie
 * nicht: ein Utility-Befehl behaelt dort seine Literale, und damit koennte ein
 * Geheimnis in einer Ergebniszeile stehen. Das ist dieselbe Begruendung, mit
 * der 2.57 den Leistungsberater auf Kennung und Zaehler beschraenkt hat.
 */

/** Die Kennungen der Parameter. Mehr Sorten gibt es nicht. */
export type SqlTemplateParameterId = "schema" | "table";

export type SqlTemplateCategoryId = "size" | "indexes" | "structure" | "locks" | "statements" | "cache" | "planner";

/** Die Gruende einer Ablehnung, deutsch und an einer Stelle. Kein Text traegt eine Variable. */
export const SQL_TEMPLATE_REASONS = {
  UNKNOWN_TEMPLATE: "Diese Vorlage steht nicht auf der Liste. Der Editor kennt nur die angebotenen Vorlagen.",
  INVALID_SCHEMA_NAME: "Der Schemaname passt nicht: erlaubt sind Buchstabe oder Unterstrich am Anfang, danach Buchstaben, Ziffern und Unterstriche, höchstens 63 Zeichen. Systemschemas sind ausgenommen.",
  INVALID_TABLE_NAME: "Der Tabellenname passt nicht: erlaubt sind Buchstabe oder Unterstrich am Anfang, danach Buchstaben, Ziffern und Unterstriche, höchstens 63 Zeichen.",
  MISSING_PARAMETER: "Diese Vorlage braucht eine Tabelle. Trag Schema und Tabelle ein, dann lässt sie sich einfügen.",
} as const;

export type SqlTemplateReasonCode = keyof typeof SQL_TEMPLATE_REASONS;

/** Eine abgelehnte Eingabe. Sie traegt den Code und den deutschen Grund, nie den Wert. */
export class SqlTemplateError extends Error {
  readonly code: SqlTemplateReasonCode;
  readonly reason: string;

  constructor(code: SqlTemplateReasonCode) {
    super(`SQL_TEMPLATE_REJECTED:${code}`);
    this.name = "SqlTemplateError";
    this.code = code;
    this.reason = SQL_TEMPLATE_REASONS[code];
  }
}

/** Ein Name, der geprueft und danach zitiert ist. Zwei Pruefungen, weil eine zu wenig waere. */
function quoted(name: string, invalid: SqlTemplateReasonCode): string {
  if (!isDataIdentifier(name) || name.includes("\"")) throw new SqlTemplateError(invalid);
  return `"${name}"`;
}

/**
 * Schema und Tabelle, beide geprueft und zitiert.
 *
 * `qualified` ist die Form fuer eine Stelle, an der PostgreSQL einen Namen
 * erwartet: `"public"."kunden"`. `literal` ist dieselbe Form in einem
 * Zeichenkettenliteral fuer `::regclass`. Weil die Grammatik `'` ebenso wie
 * `"` verbietet, kann ein Name auch das Literal nicht verlassen.
 */
type SqlTemplateNames = { qualified: string; literal: string };

function names(values: { schema?: string; table?: string }): SqlTemplateNames {
  if (typeof values.schema !== "string" || typeof values.table !== "string") {
    throw new SqlTemplateError("MISSING_PARAMETER");
  }
  if (!isDataSchemaName(values.schema)) throw new SqlTemplateError("INVALID_SCHEMA_NAME");
  const schema = quoted(values.schema, "INVALID_SCHEMA_NAME");
  const table = quoted(values.table, "INVALID_TABLE_NAME");
  const qualified = `${schema}.${table}`;
  if (qualified.includes("'")) throw new SqlTemplateError("INVALID_TABLE_NAME");
  return { qualified, literal: `'${qualified}'` };
}

type SqlTemplateEntry = {
  id: string;
  /** Deutscher Titel, wird uebersetzt. */
  title: string;
  /** Ein Satz: welche Frage beantwortet die Abfrage. Wird uebersetzt. */
  question: string;
  category: SqlTemplateCategoryId;
  /** Genau die Parameter, die der Text braucht. Leere Liste heisst: keine. */
  parameters: readonly SqlTemplateParameterId[];
  /**
   * Die Erweiterung, ohne die die Abfrage in der Zieldatenbank scheitert.
   * `null` heisst: sie laeuft ueberall. Die Ansicht sagt das vorher.
   */
  requiresExtension: string | null;
  /** Der Text. Bei Vorlagen ohne Parameter ignoriert die Funktion ihr Argument. */
  sql: (target: SqlTemplateNames | null) => string;
};

/**
 * Die Liste. Feste Reihenfolge, feste Kennungen; die Ansicht zeigt sie so.
 *
 * Jede Abfrage bleibt bei `pg_catalog` und den Statistiksichten, nennt
 * `current_database()` wo die Sicht clusterweit gilt, und traegt ihr eigenes
 * `LIMIT`. Das Zeilenlimit der Route gilt zusaetzlich; die Vorlage verlaesst
 * sich nicht darauf.
 */
const ENTRIES = [
  {
    id: "largest-tables",
    title: "Die größten Tabellen",
    question: "Welche Tabellen belegen den meisten Platz, und wie viel davon sind Indizes?",
    category: "size",
    parameters: [],
    requiresExtension: null,
    sql: (): string => `SELECT ns.nspname AS schema_name,
       rel.relname AS table_name,
       pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(rel.oid)) AS total_size,
       pg_catalog.pg_size_pretty(pg_catalog.pg_table_size(rel.oid)) AS table_size,
       pg_catalog.pg_size_pretty(pg_catalog.pg_indexes_size(rel.oid)) AS index_size,
       pg_catalog.pg_total_relation_size(rel.oid) AS total_bytes
FROM pg_catalog.pg_class AS rel
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
WHERE rel.relkind IN ('r', 'p', 'm')
  AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY pg_catalog.pg_total_relation_size(rel.oid) DESC NULLS LAST, rel.relname ASC
LIMIT 25`,
  },
  {
    id: "unused-indexes",
    title: "Indizes, die nie benutzt werden",
    question: "Welche Indizes hat der Planer seit dem letzten Zurücksetzen der Statistik nie gelesen?",
    category: "indexes",
    parameters: [],
    requiresExtension: null,
    // Primaerschluessel und Unique-Indizes bleiben draussen: sie tragen eine
    // Zusage, nicht eine Lesegeschwindigkeit, und wer sie nach dieser Liste
    // loescht, verliert die Zusage.
    sql: (): string => `SELECT stat.schemaname AS schema_name,
       stat.relname AS table_name,
       stat.indexrelname AS index_name,
       stat.idx_scan AS index_scans,
       pg_catalog.pg_size_pretty(pg_catalog.pg_relation_size(stat.indexrelid)) AS index_size
FROM pg_catalog.pg_stat_user_indexes AS stat
JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = stat.indexrelid
WHERE stat.idx_scan = 0
  AND idx.indisunique = false
  AND idx.indisprimary = false
ORDER BY pg_catalog.pg_relation_size(stat.indexrelid) DESC NULLS LAST, stat.indexrelname ASC
LIMIT 50`,
  },
  {
    id: "tables-without-primary-key",
    title: "Tabellen ohne Primärschlüssel",
    question: "Welche Tabellen haben keinen Primärschlüssel, können also keine Zeile eindeutig benennen?",
    category: "structure",
    parameters: [],
    requiresExtension: null,
    sql: (): string => `SELECT ns.nspname AS schema_name,
       rel.relname AS table_name,
       rel.relrowsecurity AS row_security,
       pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(rel.oid)) AS total_size
FROM pg_catalog.pg_class AS rel
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
WHERE rel.relkind = 'r'
  AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = rel.oid
      AND con.contype = 'p')
ORDER BY ns.nspname ASC, rel.relname ASC
LIMIT 50`,
  },
  {
    id: "current-locks",
    title: "Sperren und wer auf wen wartet",
    question: "Welche Sperren hält die Datenbank gerade, welche sind nicht gewährt, und welcher Prozess blockiert welchen?",
    category: "locks",
    parameters: [],
    requiresExtension: null,
    // Kein `activity.query`: der Abfragetext einer fremden Sitzung kann ein
    // Literal mit einem Geheimnis tragen. Prozessnummer, Zustand und Wartegrund
    // reichen, um die Blockade zu finden.
    sql: (): string => `SELECT act.pid AS process_id,
       act.state AS state,
       act.wait_event_type AS wait_event_type,
       act.wait_event AS wait_event,
       pg_catalog.pg_blocking_pids(act.pid)::text AS blocked_by,
       lck.locktype AS lock_type,
       lck.mode AS lock_mode,
       lck.granted AS granted,
       COALESCE(rel.relname, '') AS relation_name,
       (now() - act.query_start)::text AS running_for
FROM pg_catalog.pg_locks AS lck
JOIN pg_catalog.pg_stat_activity AS act ON act.pid = lck.pid
LEFT JOIN pg_catalog.pg_class AS rel ON rel.oid = lck.relation
WHERE act.datname = current_database()
ORDER BY lck.granted ASC, act.pid ASC
LIMIT 50`,
  },
  {
    id: "statement-statistics-available",
    title: "Ist die Statement-Statistik da?",
    question: "Liegt pg_stat_statements in dieser Datenbank und im Suchpfad der Leserolle, sodass die Vorlage zu den langsamsten Statements etwas findet?",
    category: "statements",
    parameters: [],
    requiresExtension: null,
    // Die Antwort auf die Frage "was passiert ohne die Erweiterung": Ohne sie
    // scheitert die naechste Vorlage mit "relation does not exist", weil
    // PostgreSQL eine fehlende Sicht nicht raten kann. `to_regclass` antwortet
    // dagegen mit NULL statt mit einem Fehler -- dieselbe Vorsicht wie in 2.57.
    sql: (): string => `SELECT current_database() AS database_name,
       to_regclass('pg_stat_statements') IS NOT NULL AS statements_installed,
       (SELECT count(*) FROM pg_catalog.pg_extension AS ext
        WHERE ext.extname = 'pg_stat_statements') AS extension_rows`,
  },
  {
    id: "slowest-statements",
    title: "Die langsamsten Statements",
    question: "Welche Statements dieser Datenbank summieren die meiste Laufzeit, nach Kennung und Zähler statt nach Text?",
    category: "statements",
    parameters: [],
    requiresExtension: "pg_stat_statements",
    // `dbid` ist die Mandantengrenze: die Sicht gilt fuer den ganzen Cluster.
    // `queryid IS NOT NULL` faellt, wem `pg_read_all_stats` fehlt -- fremde
    // Zeilen kommen dann ohne Kennung und sind nicht benennbar. Die Spalte
    // `query` bleibt ungelesen, siehe Modulkopf.
    sql: (): string => `SELECT stat.queryid::text AS statement_id,
       stat.calls AS calls,
       floor(stat.total_exec_time)::bigint AS total_time_ms,
       floor(stat.mean_exec_time)::bigint AS mean_time_ms,
       stat.rows AS returned_rows
FROM pg_stat_statements AS stat
WHERE stat.dbid = (SELECT db.oid FROM pg_catalog.pg_database AS db
                   WHERE db.datname = current_database())
  AND stat.queryid IS NOT NULL
ORDER BY stat.total_exec_time DESC, stat.queryid ASC
LIMIT 25`,
  },
  {
    id: "cache-hit-ratio",
    title: "Trefferquote des Caches je Tabelle",
    question: "Welche Tabellen liest PostgreSQL von der Platte statt aus dem Cache?",
    category: "cache",
    parameters: [],
    requiresExtension: null,
    sql: (): string => `SELECT stat.schemaname AS schema_name,
       stat.relname AS table_name,
       stat.heap_blks_read AS disk_blocks,
       stat.heap_blks_hit AS cache_blocks,
       round(100.0 * stat.heap_blks_hit / NULLIF(stat.heap_blks_hit + stat.heap_blks_read, 0), 2) AS cache_hit_percent
FROM pg_catalog.pg_statio_user_tables AS stat
ORDER BY stat.heap_blks_read DESC, stat.relname ASC
LIMIT 50`,
  },
  {
    id: "planner-row-estimates",
    title: "Zeilenzahlen, wie der Planer sie schätzt",
    question: "Mit wie vielen Zeilen rechnet der Planer je Tabelle, und wann wurde die Schätzung zuletzt erneuert?",
    category: "planner",
    parameters: [],
    requiresExtension: null,
    // `reltuples` ist eine Schaetzung, kein `count(*)`. Ein `-1` heisst: noch
    // nie analysiert. Genau darum steht `last_analyze` daneben.
    sql: (): string => `SELECT ns.nspname AS schema_name,
       rel.relname AS table_name,
       rel.reltuples::bigint AS estimated_rows,
       rel.relpages AS pages,
       stat.last_analyze AS last_analyze,
       stat.last_autoanalyze AS last_autoanalyze
FROM pg_catalog.pg_class AS rel
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_stat_user_tables AS stat ON stat.relid = rel.oid
WHERE rel.relkind IN ('r', 'p')
  AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY rel.reltuples DESC, rel.relname ASC
LIMIT 50`,
  },
  {
    id: "table-row-count",
    title: "Zeilen einer Tabelle, wirklich gezählt",
    question: "Wie viele Zeilen hat eine bestimmte Tabelle, gezählt statt geschätzt?",
    category: "planner",
    parameters: ["schema", "table"],
    requiresExtension: null,
    sql: (target: SqlTemplateNames | null): string => `SELECT count(*) AS exact_rows
FROM ${target!.qualified}`,
  },
  {
    id: "table-index-usage",
    title: "Indizes einer Tabelle und ihre Nutzung",
    question: "Welche Indizes trägt eine bestimmte Tabelle, wie oft wurden sie gelesen, und wie groß sind sie?",
    category: "indexes",
    parameters: ["schema", "table"],
    requiresExtension: null,
    sql: (target: SqlTemplateNames | null): string => `SELECT stat.indexrelname AS index_name,
       stat.idx_scan AS index_scans,
       stat.idx_tup_read AS tuples_read,
       stat.idx_tup_fetch AS tuples_fetched,
       pg_catalog.pg_size_pretty(pg_catalog.pg_relation_size(stat.indexrelid)) AS index_size
FROM pg_catalog.pg_stat_user_indexes AS stat
WHERE stat.relid = ${target!.literal}::regclass
ORDER BY stat.idx_scan ASC, stat.indexrelname ASC
LIMIT 50`,
  },
] as const satisfies readonly SqlTemplateEntry[];

export type SqlTemplateId = (typeof ENTRIES)[number]["id"];

/** Was die Ansicht von einer Vorlage sieht: alles ausser dem Erzeuger. */
export type SqlTemplateDescription = {
  id: string;
  title: string;
  question: string;
  category: SqlTemplateCategoryId;
  parameters: readonly SqlTemplateParameterId[];
  requiresExtension: string | null;
};

/** Die Liste fuer die Ansicht, in fester Reihenfolge und ohne Funktionen. */
export const SQL_TEMPLATES: readonly SqlTemplateDescription[] = ENTRIES.map((entry) => ({
  id: entry.id,
  title: entry.title,
  question: entry.question,
  category: entry.category,
  parameters: entry.parameters,
  requiresExtension: entry.requiresExtension,
}));

/** Vorgabe fuer das Schemafeld. Wie die uebrigen Katalogansichten: `public`. */
export const SQL_TEMPLATE_DEFAULT_SCHEMA = "public";

/**
 * Der Text einer Vorlage.
 *
 * Eine unbekannte Kennung wird abgelehnt, nicht geraten. Braucht die Vorlage
 * eine Tabelle, laufen Schema und Tabelle durch die Grammatik und werden
 * zitiert; fehlt einer der beiden, ist das eine Ablehnung mit eigenem Grund
 * und nicht ein halber Text.
 */
export function sqlTemplateStatement(
  id: string,
  values: { schema?: string; table?: string } = {},
): string {
  const entry = ENTRIES.find((candidate) => candidate.id === id);
  if (!entry) throw new SqlTemplateError("UNKNOWN_TEMPLATE");
  return entry.sql(entry.parameters.length === 0 ? null : names(values));
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function sqlTemplateTexts(): string[] {
  return [
    ...SQL_TEMPLATES.map((entry) => entry.title),
    ...SQL_TEMPLATES.map((entry) => entry.question),
    ...Object.values(SQL_TEMPLATE_REASONS),
  ];
}
