import { createHash } from "node:crypto";
import type { SqlQueryable } from "@/lib/server/db/sql";

/**
 * Das Manifest einer Projektdatenbank (2.126).
 *
 * ## Wozu es da ist
 *
 * Ein Backup, dessen Wiederherstellung niemand gefahren hat, ist kein Backup.
 * Und eine Wiederherstellung, die niemand mit dem gesicherten Stand verglichen
 * hat, ist kein Nachweis. Das Manifest ist dieser Vergleich: eine Zahl, die
 * genau dann gleich ist, wenn Schema, Zeilen, Policies, Erweiterungen,
 * Sequenzen und Rechte gleich sind.
 *
 * Es ist derselbe Gedanke wie `manifest()` im Control-Plane-Drill aus 2.29,
 * aber nicht derselbe Umfang: dort stehen zwei bekannte Tabellen im Code, hier
 * ist die Datenbank einem Mandanten gehoerig und ihr Inhalt unbekannt. Das
 * Manifest liest darum den Katalog und richtet sich nach dem, was es findet.
 *
 * ## Warum sechs Teile und nicht einer
 *
 * Ein einziger Hash ueber alles sagt "ungleich" und sonst nichts. Beim
 * Vergleich zweier Datenbanken ist das die unbrauchbarste aller Antworten.
 * Darum traegt das Manifest **je Teil** einen Hash und daneben die Summe; faellt
 * ein Vergleich, nennt der Fall den Teil.
 *
 * ## Welche Schemata, und warum nicht alle
 *
 * Gelesen werden die Schemata des Mandanten: alles ausser `pg_catalog`,
 * `information_schema` und `pg_toast*`. `qkern_internal` (aus `db/project`)
 * **gehoert dazu**: Ledger, Zaun und Aenderungs-Feed sind Teil des Zustands
 * einer Projektdatenbank, und ein Backup, das sie auslaesst, stellt eine
 * Datenbank wieder her, die ihre eigene Migrationsgeschichte nicht kennt.
 *
 * ## Was das Manifest **nicht** liest
 *
 * Keine Cluster-Rollen. `pg_authid` ist clusterweit, nicht Teil einer
 * Datenbank, und waere ueber alle Mandanten hinweg dasselbe; sie hier zu lesen
 * hiesse, die Rollen fremder Mandanten in das Manifest eines Mandanten zu
 * schreiben. Was von den Rollen in einer Datenbank liegt, sind die **Rechte**,
 * und die stehen im Teil `grants`.
 */
export const PROJECT_DATABASE_MANIFEST_PARTS = [
  "schema", "rows", "policies", "extensions", "sequences", "grants",
] as const;
export type ProjectDatabaseManifestPart = (typeof PROJECT_DATABASE_MANIFEST_PARTS)[number];

export type ProjectDatabaseManifest = Readonly<{
  /** Je Teil ein Hash. Ungleich heisst damit: dieser Teil ist ungleich. */
  parts: Readonly<Record<ProjectDatabaseManifestPart, string>>;
  /** Die Summe ueber die sechs Teile, in fester Reihenfolge. */
  sha256: string;
  /** Wie viele Tabellen gelesen wurden. Eine Zahl, kein Name. */
  tableCount: number;
  /** Wie viele Zeilen gelesen wurden, ueber alle Tabellen. */
  rowCount: number;
}>;

/** Eine Projektdatenbank mit mehr Tabellen laesst dieser Weg fallen, statt stillschweigend zu kuerzen. */
export const MAX_MANIFEST_TABLES = 2_000;

const TENANT_SCHEMA_FILTER =
  "nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'";

export class ProjectDatabaseManifestError extends Error {
  readonly code = "MANIFEST_UNAVAILABLE";
  constructor() {
    super("The project database manifest could not be read.");
    this.name = "ProjectDatabaseManifestError";
  }
}

/**
 * Liest das Manifest. Jede Abfrage ist geordnet, und zwar serverseitig: eine
 * Ordnung im Dienst waere eine Ordnung nach der Locale des Dienstes, und zwei
 * Dienste mit zwei Locales kaemen auf zwei Manifeste derselben Datenbank.
 * `COLLATE "C"` ordnet nach Bytes und ist ueberall dieselbe Ordnung.
 */
export async function readProjectDatabaseManifest(
  database: SqlQueryable,
): Promise<ProjectDatabaseManifest> {
  const schema = await rowsAsText(database, `
    SELECT format('%s.%s %s %s %s %s %s',
             n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
             a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''), c.relrowsecurity) AS line
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE ${TENANT_SCHEMA_FILTER} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY line COLLATE "C"`);

  const constraints = await rowsAsText(database, `
    SELECT format('%s.%s %s %s', n.nspname, c.relname, t.conname, pg_get_constraintdef(t.oid)) AS line
    FROM pg_constraint AS t
    JOIN pg_class AS c ON c.oid = t.conrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE ${TENANT_SCHEMA_FILTER}
    ORDER BY line COLLATE "C"`);

  const indexes = await rowsAsText(database, `
    SELECT format('%s.%s %s', schemaname, tablename, indexdef) AS line
    FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY line COLLATE "C"`);

  const policies = await rowsAsText(database, `
    SELECT format('%s.%s %s %s %s %s %s %s',
             schemaname, tablename, policyname, permissive,
             coalesce(array_to_string(roles, ','), ''), cmd,
             coalesce(qual, ''), coalesce(with_check, '')) AS line
    FROM pg_policies
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY line COLLATE "C"`);

  const extensions = await rowsAsText(database, `
    SELECT format('%s %s %s', e.extname, e.extversion, n.nspname) AS line
    FROM pg_extension AS e
    JOIN pg_namespace AS n ON n.oid = e.extnamespace
    ORDER BY line COLLATE "C"`);

  // Sequenzen mit ihrem Stand. Ohne ihn stimmt das Schema und der naechste
  // INSERT kollidiert, und genau das ist der Fehler, den eine Wiederherstellung
  // ohne Sequenzen macht.
  const sequences = await rowsAsText(database, `
    SELECT format('%s.%s %s %s %s %s',
             schemaname, sequencename, coalesce(last_value::text, 'unset'),
             start_value, increment_by, cycle) AS line
    FROM pg_sequences
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY line COLLATE "C"`);

  // Die Rechte kommen aus `pg_class.relacl` und **nicht** aus
  // `information_schema.table_privileges`. Die Sicht zeigt nur Rechte, bei
  // denen der aufrufende Benutzer Geber, Nehmer oder Eigentuemer ist; sie
  // liefert damit je Rolle eine andere Antwort, und ein Manifest, das von der
  // lesenden Rolle abhaengt, vergleicht nichts. `relacl` steht im Katalog und
  // ist fuer jeden gleich. `aclexplode` zerlegt es in Zeilen, `::regrole`
  // macht aus einer Oid einen Namen; die Oid selbst waere nach einer
  // Wiederherstellung eine andere Zahl fuer dieselbe Rolle.
  const grants = await rowsAsText(database, `
    SELECT line FROM (
      SELECT format('%s.%s %s %s %s',
               n.nspname, c.relname,
               coalesce(nullif(acl.grantee::regrole::text, '-'), 'PUBLIC'),
               acl.privilege_type, acl.is_grantable) AS line
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
      WHERE ${TENANT_SCHEMA_FILTER} AND c.relacl IS NOT NULL
      UNION ALL
      SELECT format('schema %s %s %s %s',
               n.nspname,
               coalesce(nullif(acl.grantee::regrole::text, '-'), 'PUBLIC'),
               acl.privilege_type, acl.is_grantable) AS line
      FROM pg_namespace AS n
      CROSS JOIN LATERAL aclexplode(n.nspacl) AS acl
      WHERE ${TENANT_SCHEMA_FILTER} AND n.nspacl IS NOT NULL
      UNION ALL
      -- Die Default-Privilegien. Sie entscheiden, was die **naechste** Tabelle
      -- eines Mandanten mitbringt; eine Wiederherstellung ohne sie liefert eine
      -- Datenbank, in der ab morgen die Rechte fehlen.
      SELECT format('default %s %s %s %s %s',
               d.defaclrole::regrole::text,
               coalesce(nullif(d.defaclnamespace::regnamespace::text, '-'), '*'),
               d.defaclobjtype,
               coalesce(nullif(acl.grantee::regrole::text, '-'), 'PUBLIC'),
               acl.privilege_type) AS line
      FROM pg_default_acl AS d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    ) AS collected
    ORDER BY line COLLATE "C"`);

  const { digest: rowsDigest, tableCount, rowCount } = await rowDigest(database);

  const parts = {
    // Spalten, Einschraenkungen und Indizes sind zusammen das Schema. Sie
    // getrennt zu hashen hiesse, drei Teile zu haben, die nie einzeln
    // interessieren: wer einen Index verliert, hat ein Schemaproblem.
    schema: digest([...schema, "--", ...constraints, "--", ...indexes]),
    rows: rowsDigest,
    policies: digest(policies),
    extensions: digest(extensions),
    sequences: digest(sequences),
    grants: digest(grants),
  } as const;

  return Object.freeze({
    parts: Object.freeze(parts),
    sha256: digest(PROJECT_DATABASE_MANIFEST_PARTS.map((part) => `${part}=${parts[part]}`)),
    tableCount,
    rowCount,
  });
}

/**
 * Die Zeilen. Je Tabelle eine Abfrage, und je Tabelle ein Hash ueber die
 * geordneten Zeilen.
 *
 * `t::text` ist die Zeile als Text, so wie PostgreSQL sie schreibt; `ORDER BY`
 * darauf macht die Ordnung von der Zeile selbst abhaengig und nicht von einem
 * Primaerschluessel, den eine Mandantentabelle nicht haben muss. Zwei gleiche
 * Zeilen (eine Tabelle ohne Schluessel darf sie haben) ergeben zwei gleiche
 * Texte und bleiben damit zwei.
 *
 * Der Tabellenname kommt aus `quote_ident` **des Servers** und wird nicht im
 * Dienst zusammengesetzt. Ein Tabellenname ist in einer Projektdatenbank
 * Mandanteneingabe; ihn hier selbst zu zitieren waere die Stelle, an der eine
 * Tabelle namens `"; DROP ..."` etwas bedeutet.
 */
async function rowDigest(database: SqlQueryable): Promise<{ digest: string; tableCount: number; rowCount: number }> {
  let tables: { qualified: string; label: string }[];
  try {
    const result = await database.query<{ qualified: string; label: string }>(`
      SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS qualified,
             n.nspname || '.' || c.relname AS label
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE ${TENANT_SCHEMA_FILTER} AND c.relkind IN ('r', 'p')
        AND c.relispartition = false
      ORDER BY label COLLATE "C"`);
    tables = result.rows.map((row) => ({ qualified: String(row.qualified), label: String(row.label) }));
  } catch {
    throw new ProjectDatabaseManifestError();
  }
  if (tables.length > MAX_MANIFEST_TABLES) throw new ProjectDatabaseManifestError();

  const lines: string[] = [];
  let rowCount = 0;
  for (const table of tables) {
    try {
      const result = await database.query<{ digest: string | null; rows: string }>(
        `SELECT md5(coalesce(string_agg(line, E'\\n' ORDER BY line COLLATE "C"), '')) AS digest,
                count(*)::text AS rows
         FROM (SELECT t::text AS line FROM ${table.qualified} AS t) AS ordered`,
      );
      const row = result.rows[0];
      lines.push(`${table.label} ${row?.digest ?? "none"} ${row?.rows ?? "0"}`);
      rowCount += Number(row?.rows ?? 0);
    } catch {
      throw new ProjectDatabaseManifestError();
    }
  }
  return { digest: digest(lines), tableCount: tables.length, rowCount };
}

async function rowsAsText(database: SqlQueryable, text: string): Promise<string[]> {
  try {
    const result = await database.query<{ line: string }>(text);
    return result.rows.map((row) => String(row.line));
  } catch {
    throw new ProjectDatabaseManifestError();
  }
}

function digest(lines: readonly string[]): string {
  const hash = createHash("sha256");
  for (const line of lines) hash.update(line).update("\n");
  return hash.digest("hex");
}

/** Der erste Teil, der abweicht. Fuer die Meldung eines Falls: er soll den Teil nennen, nicht zwei Hashes. */
export function firstDifferingManifestPart(
  left: ProjectDatabaseManifest,
  right: ProjectDatabaseManifest,
): ProjectDatabaseManifestPart | null {
  return PROJECT_DATABASE_MANIFEST_PARTS.find((part) => left.parts[part] !== right.parts[part]) ?? null;
}
