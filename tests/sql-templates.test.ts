import { describe, expect, it } from "vitest";
import { parse } from "pgsql-ast-parser";
import { isReadOnlySql } from "@/lib/security";
import {
  SQL_TEMPLATES,
  SQL_TEMPLATE_DEFAULT_SCHEMA,
  SQL_TEMPLATE_REASONS,
  SqlTemplateError,
  sqlTemplateStatement,
  sqlTemplateTexts,
} from "@/lib/console/sql-templates";

/**
 * Die Vorlagen des SQL-Editors (2.61) als reines Modul.
 *
 * Der Kern dieses Tests ist nicht, dass die Texte nett aussehen, sondern dass
 * jede Vorlage genau den Waechter besteht, den die Query-Route vor die
 * Datenbank stellt: `isReadOnlySql` aus `lib/security.ts`. Der Test ruft ihn
 * wirklich, statt seine Regeln nachzuerzaehlen. Dass die Abfragen danach in
 * einer echten Datenbank auch laufen, belegt der Fall "(2.61)" in
 * `postgres.integration`.
 */

const TARGET = { schema: SQL_TEMPLATE_DEFAULT_SCHEMA, table: "kunden" };

function statementOf(template: (typeof SQL_TEMPLATES)[number]): string {
  return sqlTemplateStatement(template.id, template.parameters.length === 0 ? {} : TARGET);
}

function rejects(run: () => unknown, code: keyof typeof SQL_TEMPLATE_REASONS): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SqlTemplateError);
    expect((error as SqlTemplateError).code).toBe(code);
    expect((error as SqlTemplateError).reason).toBe(SQL_TEMPLATE_REASONS[code]);
    return;
  }
  throw new Error(`Die Eingabe wurde angenommen, erwartet war ${code}`);
}

describe("sql templates list", () => {
  it("carries the seven questions the slice promised, plus the two per-table ones", () => {
    expect(SQL_TEMPLATES.map((entry) => entry.id)).toEqual([
      "largest-tables",
      "unused-indexes",
      "tables-without-primary-key",
      "current-locks",
      "statement-statistics-available",
      "slowest-statements",
      "cache-hit-ratio",
      "planner-row-estimates",
      "table-row-count",
      "table-index-usage",
    ]);
  });

  it("gives every template a unique id, a German title and one sentence of purpose", () => {
    const ids = SQL_TEMPLATES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SQL_TEMPLATES) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.title.length).toBeGreaterThan(4);
      expect(entry.question.endsWith("?"), entry.id).toBe(true);
      expect(entry.question.length).toBeGreaterThan(20);
    }
  });

  it("names the one extension a template needs and leaves the others unconditional", () => {
    const needing = SQL_TEMPLATES.filter((entry) => entry.requiresExtension !== null);
    expect(needing.map((entry) => entry.id)).toEqual(["slowest-statements"]);
    expect(needing[0]!.requiresExtension).toBe("pg_stat_statements");
  });

  it("offers every text of the module to the translation contract", () => {
    const texts = sqlTemplateTexts();
    for (const entry of SQL_TEMPLATES) {
      expect(texts).toContain(entry.title);
      expect(texts).toContain(entry.question);
    }
    for (const reason of Object.values(SQL_TEMPLATE_REASONS)) expect(texts).toContain(reason);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("sql templates are read-only", () => {
  for (const template of SQL_TEMPLATES) {
    it(`parses as exactly one statement: ${template.id}`, () => {
      const statement = statementOf(template);
      const parsed = parse(statement);
      expect(parsed).toHaveLength(1);
      expect(statement.trim()).toBe(statement);
      expect(statement).not.toContain(";");
      expect(statement.length).toBeLessThanOrEqual(4_000);
    });

    it(`passes the guard the query route applies: ${template.id}`, () => {
      // Genau dieselbe Funktion, die `queryReadOnly` vor der Datenbank ruft.
      expect(isReadOnlySql(statementOf(template))).toBe(true);
      // Die Ansicht schickt den Text aus dem Editorfeld, also mit Umbruechen.
      expect(isReadOnlySql(statementOf(template).replace(/\n/g, " "))).toBe(true);
    });

    it(`carries no write verb and no side-effecting function: ${template.id}`, () => {
      const statement = statementOf(template);
      // Mit Wortgrenze, damit `lck.granted` und `last_analyze` nicht als Verb
      // gelesen werden: gesucht ist das Verb, nicht die Silbe.
      for (const verb of [
        "insert", "update", "delete", "drop", "truncate", "alter", "create",
        "grant", "revoke", "vacuum", "analyze", "copy", "comment", "refresh",
        "reindex", "cluster", "lock\\s+table", "select\\s+into", "for\\s+update",
        "for\\s+share", "returning", "do\\s+instead",
      ]) {
        expect(statement.toLowerCase(), `${template.id} enthält ${verb}`)
          .not.toMatch(new RegExp(`\\b${verb}\\b`));
      }
      for (const dangerous of [
        "pg_read_file", "pg_stat_file", "pg_ls_dir", "pg_terminate_backend",
        "pg_cancel_backend", "pg_reload_conf", "pg_advisory_lock", "dblink",
        "lo_import", "lo_export", "set_config", "setval", "nextval", "pg_sleep",
      ]) {
        expect(statement.toLowerCase(), `${template.id} ruft ${dangerous}`).not.toContain(dangerous);
      }
    });

    it(`stays inside the project database and carries its own limit: ${template.id}`, () => {
      const statement = statementOf(template);
      expect(statement.toLowerCase()).not.toContain("postgres_fdw");
      expect(statement.toLowerCase()).not.toContain("current_setting('cluster");
      // Jede Sicht, die clusterweit gilt, wird auf die eigene Datenbank
      // eingegrenzt. Der Rest liest ohnehin nur den eigenen Katalog.
      if (/pg_stat_statements|pg_stat_activity/.test(statement)) {
        expect(statement).toContain("current_database()");
      }
      // Die Vorlage zu den Sperren und die Statement-Statistik lesen nie den
      // Abfragetext einer fremden Sitzung.
      expect(statement.toLowerCase()).not.toMatch(/\b(act|stat)\.query\b/);
    });

    it(`declares exactly the parameters its text needs: ${template.id}`, () => {
      const statement = statementOf(template);
      // Kein Platzhalter bleibt stehen, und keine Bindung schleicht sich ein:
      // die Route uebergibt genau ein Statement ohne Parameterliste.
      expect(statement).not.toMatch(/\{\{|\}\}|\$\{/);
      expect(statement).not.toMatch(/\$\d/);
      if (template.parameters.length === 0) {
        // Ohne deklarierte Parameter darf der Text von keiner Eingabe abhaengen.
        expect(sqlTemplateStatement(template.id, {})).toBe(statement);
        expect(sqlTemplateStatement(template.id, { schema: "andere", table: "andere" })).toBe(statement);
        expect(statement).not.toContain(`"${TARGET.table}"`);
      } else {
        expect(template.parameters).toEqual(["schema", "table"]);
        expect(statement).toContain(`"${TARGET.schema}"."${TARGET.table}"`);
        // Ohne Eingabe gibt es keinen halben Text, sondern eine Ablehnung.
        rejects(() => sqlTemplateStatement(template.id, {}), "MISSING_PARAMETER");
        rejects(() => sqlTemplateStatement(template.id, { schema: TARGET.schema }), "MISSING_PARAMETER");
        rejects(() => sqlTemplateStatement(template.id, { table: TARGET.table }), "MISSING_PARAMETER");
      }
    });
  }

  it("refuses a template id it does not know instead of guessing one", () => {
    for (const id of ["", "largest_tables", "LARGEST-TABLES", "toString", "constructor", "__proto__"]) {
      rejects(() => sqlTemplateStatement(id, TARGET), "UNKNOWN_TEMPLATE");
    }
  });
});

/**
 * Dieselben feindlichen Eingaben, mit denen 2.49 den Tabellen-Designer
 * beschiesst. Die Grammatik ist dieselbe; die Vorlagen duerfen sie nicht
 * lockerer auslegen.
 */
describe("sql template hostile input", () => {
  const parameterized = SQL_TEMPLATES.filter((entry) => entry.parameters.length > 0);

  const hostileNames: Array<[string, string]> = [
    ["Anführungszeichen", 'kunden" ; DROP TABLE geheim; --'],
    ["nur ein Anführungszeichen", 'kun"den'],
    ["einfaches Anführungszeichen", "kun'den"],
    ["Semikolon", "kunden; DROP TABLE geheim"],
    ["Zeilenkommentar", "kunden--"],
    ["Blockkommentar", "kunden/*x*/"],
    ["Punkt und Schema", "geheim.kunden"],
    ["Leerzeichen", "meine kunden"],
    ["Bindestrich", "kunden-alt"],
    ["Klammern", "kunden()"],
    ["Rückstrich", "kunden\\"],
    ["Dollarzeichen", "kunden$$"],
    ["Zeilenumbruch", "kunden\nDROP TABLE geheim"],
    ["Nullbyte", "kunden\u0000"],
    ["kyrillisches a", "kundenа"],
    ["Fullwidth-Buchstabe", "ｋunden"],
    ["Umlaut", "kündig"],
    ["türkisches punktloses i", "kundenı"],
    ["Ziffer am Anfang", "1kunden"],
    ["leer", ""],
    ["nur Leerzeichen", "   "],
    ["64 Zeichen", "k".repeat(64)],
  ];

  it("has parameterized templates to attack at all", () => {
    expect(parameterized.length).toBeGreaterThan(0);
  });

  for (const [label, name] of hostileNames) {
    it(`refuses a table name with ${label}`, () => {
      for (const template of parameterized) {
        rejects(() => sqlTemplateStatement(template.id, { schema: TARGET.schema, table: name }),
          "INVALID_TABLE_NAME");
      }
    });

    it(`refuses a schema name with ${label}`, () => {
      for (const template of parameterized) {
        rejects(() => sqlTemplateStatement(template.id, { schema: name, table: TARGET.table }),
          "INVALID_SCHEMA_NAME");
      }
    });
  }

  it("refuses a system schema even though its name fits the grammar", () => {
    for (const template of parameterized) {
      for (const schema of ["pg_catalog", "pg_toast", "pg_temp_1", "information_schema", "qkern_internal"]) {
        rejects(() => sqlTemplateStatement(template.id, { schema, table: TARGET.table }),
          "INVALID_SCHEMA_NAME");
      }
    }
  });

  it("refuses anything that is not a string, including the values a form sends by accident", () => {
    for (const template of parameterized) {
      for (const value of [null, undefined, 1, true, {}, [], () => "kunden"] as unknown[]) {
        rejects(() => sqlTemplateStatement(template.id,
          { schema: TARGET.schema, table: value as string }), "MISSING_PARAMETER");
      }
    }
  });

  it("keeps a name that passes the grammar inside its quotes, and the statement read-only", () => {
    for (const template of parameterized) {
      for (const table of ["Order", "createdAt", "UserProfile", "_intern", "t", "k".repeat(63)]) {
        const statement = sqlTemplateStatement(template.id, { schema: "Shop", table });
        expect(statement).toContain(`"Shop"."${table}"`);
        expect(isReadOnlySql(statement)).toBe(true);
        expect(statement.split("\"").length % 2, "ungerade Zahl von Anführungszeichen").toBe(1);
      }
    }
  });
});
