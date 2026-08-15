import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Rechte, die nicht die Operation verlangt, sondern eine ihrer Klauseln.
 *
 * Innerhalb von zwei Releases ist dasselbe Muster dreimal aufgetreten:
 *
 * - `1.61` — der Heartbeat des Provisioners schreibt mit
 *   `ON CONFLICT (organization_id, provisioner_id) DO UPDATE`. Der benannte
 *   Arbiter verlangt Leserecht auf genau diesen Spalten; erteilt waren nur
 *   `INSERT` und `UPDATE`. Der Prozess hat deshalb seit Migration 0021 nie
 *   gearbeitet.
 * - `1.62` — `complete()` schreibt die Bindung mit `INSERT … RETURNING`.
 *   `RETURNING` verlangt Leserecht auf den zurueckgegebenen Spalten; erteilt
 *   war nur `INSERT`.
 * - `1.63` — dieser Vertrag hat den dritten gefunden, bevor ein Prozess
 *   darueber gestolpert ist.
 *
 * Dreimal dasselbe ist kein Zufall, sondern eine Luecke im Verfahren: Ein
 * `GRANT INSERT` sieht vollstaendig aus, und der Fehler zeigt sich erst, wenn
 * jemand die Anweisung mit der echten Rolle ausfuehrt.
 *
 * Der Vertrag schliesst sie. Er liest die Anweisungen aus dem Adapter und die
 * Rechte aus dem **laufenden Cluster** — beides abgeleitet, nichts von Hand
 * gepflegt. Eine handgepflegte Liste waere die naechste Stelle, an der etwas
 * vergessen wird; das ist die Lehre aus Release 1.40.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const enabled = Boolean(ownerUrl);

const ROOT = process.cwd();

function sources(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Spaltenlisten stehen als Konstante im selben Modul.
 *
 * `RETURNING ${MIGRATION_JOB_COLUMNS}` ist ohne diese Aufloesung nicht
 * lesbar — und genau solche Stellen sind die interessanten.
 */
function resolveInterpolations(source: string): { text: string; unresolved: number } {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*`([^`]*)`/g)) {
    constants.set(match[1], match[2]);
  }
  let unresolved = 0;
  const text = source.replace(/\$\{([^}]*)\}/g, (_whole, expression: string) => {
    const name = expression.trim();
    const known = constants.get(name);
    if (known !== undefined) return known;
    unresolved += 1;
    // Ein Platzhalter, den keine Spaltenregel trifft. Er darf nicht wie ein
    // Spaltenname aussehen, sonst erfindet der Vertrag Anforderungen.
    return " ?unresolved? ";
  });
  return { text, unresolved };
}

/** `schema.spalte AS alias` → `spalte`. Sternchen und Ausdruecke fallen weg. */
function columnNames(list: string): { columns: string[]; opaque: boolean } {
  const columns: string[] = [];
  let opaque = false;
  for (const raw of list.split(",")) {
    const item = raw.trim().replace(/\s+AS\s+[A-Za-z0-9_"]+$/i, "").trim();
    const plain = item.includes(".") ? item.slice(item.lastIndexOf(".") + 1) : item;
    if (/^[a-z_][a-z0-9_]*$/.test(plain)) columns.push(plain);
    else opaque = true;
  }
  return { columns: [...new Set(columns)], opaque };
}

type Requirement = {
  table: string;
  columns: string[];
  clause: "ON CONFLICT" | "RETURNING";
  writeKind: "INSERT" | "UPDATE";
  file: string;
};

/**
 * Sammelt, was jede Anweisung an Leserecht braucht.
 *
 * Gesucht wird ab `INSERT INTO <tabelle>` beziehungsweise `UPDATE <tabelle>`
 * bis zum Ende des Template-Literals. Das ist grob, aber es liest dieselben
 * Zeichen, die PostgreSQL spaeter bekommt.
 */
function requirements(): { found: Requirement[]; unresolved: number; opaque: number } {
  const found: Requirement[] = [];
  let unresolved = 0;
  let opaque = 0;
  for (const file of sources(path.join(ROOT, "lib", "server"))) {
    const resolved = resolveInterpolations(readFileSync(file, "utf8"));
    unresolved += resolved.unresolved;
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const statement of resolved.text.matchAll(
      /\b(INSERT\s+INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\b([\s\S]*?)(?=\bINSERT\s+INTO\b|\bUPDATE\s+[a-z_]|`|$)/gi,
    )) {
      const writeKind = /INSERT/i.test(statement[1]) ? "INSERT" as const : "UPDATE" as const;
      const table = statement[2].toLowerCase();
      const body = statement[3];

      const arbiter = /ON\s+CONFLICT\s*\(([^)]*)\)/i.exec(body);
      if (arbiter) {
        const parsed = columnNames(arbiter[1]);
        if (parsed.opaque) opaque += 1;
        if (parsed.columns.length > 0) {
          found.push({ table, columns: parsed.columns, clause: "ON CONFLICT", writeKind, file: relative });
        }
      }

      const returning = /\bRETURNING\s+([\s\S]*?)(?:;|$)/i.exec(body);
      if (returning) {
        const parsed = columnNames(returning[1]);
        if (parsed.opaque) opaque += 1;
        if (parsed.columns.length > 0) {
          found.push({ table, columns: parsed.columns, clause: "RETURNING", writeKind, file: relative });
        }
      }
    }
  }
  return { found, unresolved, opaque };
}

describe.runIf(enabled)("SQL privilege clause contract", () => {
  let owner: SqlPool;
  /** Rollen des Produkts, aus dem Cluster gelesen statt aufgezaehlt. */
  let roles: string[] = [];
  let existingTables = new Set<string>();

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    const roleRows = await owner.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'qkern\\_%' AND rolcanlogin = false ORDER BY 1`);
    roles = roleRows.rows.map((row) => row.rolname);
    const tableRows = await owner.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    existingTables = new Set(tableRows.rows.map((row) => row.relname));
  }, 120_000);

  afterAll(async () => { await owner?.end(); });

  it("finds statements to check", () => {
    const collected = requirements();
    expect(collected.found.length).toBeGreaterThan(20);
    // Was der Vertrag nicht lesen konnte, wird genannt statt verschwiegen: Eine
    // stille Begrenzung liest sich wie vollstaendige Abdeckung.
    // eslint-disable-next-line no-console
    console.info(`privilege clause contract: ${collected.found.length} Anweisungen, ` +
      `${collected.opaque} Spaltenlisten nicht auswertbar, ${collected.unresolved} Platzhalter offen`);
    expect(roles.length).toBeGreaterThanOrEqual(4);
  });

  it("grants every write role the read right its clauses require", async () => {
    const collected = requirements();
    const missing: string[] = [];

    for (const requirement of collected.found) {
      if (!existingTables.has(requirement.table)) continue;
      // Was der Ausdruck fuer einen Spaltennamen gehalten hat, es aber nicht
      // ist, faellt hier heraus statt die Abfrage zu sprengen.
      const known = await owner.query<{ attname: string }>(
        `SELECT a.attname FROM pg_attribute a
         WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
        [requirement.table]);
      const columns = requirement.columns.filter(
        (column) => known.rows.some((row) => row.attname === column));
      if (columns.length === 0) continue;
      for (const role of roles) {
        // Nur Rollen, die diese Art Schreibzugriff ueberhaupt haben. Eine Rolle
        // ohne INSERT fuehrt kein `ON CONFLICT` aus, und ihr deshalb ein
        // Leserecht abzuverlangen waere das Gegenteil von eng.
        const writes = await owner.query<{ writes: boolean }>(
          `SELECT bool_or(has_column_privilege($1, $2::regclass, a.attname, $3)) AS writes
           FROM pg_attribute a
           WHERE a.attrelid = $2::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
          [role, requirement.table, requirement.writeKind]);
        if (!writes.rows[0]?.writes) continue;

        for (const column of columns) {
          const readable = await owner.query<{ readable: boolean }>(
            `SELECT has_column_privilege($1, $2::regclass, $3, 'SELECT') AS readable`,
            [role, requirement.table, column]);
          if (!readable.rows[0]?.readable) {
            missing.push(`${role} darf ${requirement.table}.${column} nicht lesen, ` +
              `aber ${requirement.file} benutzt ${requirement.clause} darauf`);
          }
        }
      }
    }

    expect([...new Set(missing)].sort(), [
      "PostgreSQL verlangt Leserecht fuer benannte ON-CONFLICT-Arbiter und fuer",
      "RETURNING. Ein GRANT INSERT allein sieht vollstaendig aus, und die",
      "Anweisung scheitert trotzdem — sichtbar erst mit der echten Rolle.",
      "Dreimal ist das passiert: 1.61, 1.62 und der Fund dieses Vertrags.",
    ].join(" ")).toEqual([]);
  }, 180_000);
});
