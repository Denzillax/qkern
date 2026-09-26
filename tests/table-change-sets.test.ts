import { describe, expect, it } from "vitest";
import {
  addColumnStatement,
  createTableStatement,
  MAX_NEW_TABLE_COLUMNS,
  renameTableStatement,
  TABLE_CHANGE_SET_REASONS,
  TableChangeSetError,
  tableChangeSetTexts,
  type NewColumn,
} from "@/lib/console/table-change-sets";
import { validateSingleSqlStatement } from "@/lib/security";

/**
 * Der Tabellen-Designer (2.49) erzeugt SQL aus Eingabefeldern. Das ist die
 * Stelle, an der ein Slice eine Datenbank verlieren kann, und darum steht hier
 * zuerst, was **nicht** durchkommt.
 */

const id: NewColumn = { name: "id", type: "uuid", notNull: true, default: "uuid" };

/** Die Ablehnung mit ihrem Code; eine andere Ablehnung ist kein Erfolg. */
function rejects(run: () => unknown, code: keyof typeof TABLE_CHANGE_SET_REASONS) {
  expect(run).toThrowError(TableChangeSetError);
  try {
    run();
    expect.unreachable("kein Fehler geworfen");
  } catch (error) {
    expect((error as TableChangeSetError).code).toBe(code);
  }
}

describe("table change set statements", () => {
  it("writes exactly the expected CREATE TABLE", () => {
    expect(createTableStatement({
      table: "kunden",
      columns: [
        id,
        { name: "name", type: "text", notNull: true, default: "none" },
        { name: "erstellt_am", type: "timestamptz", notNull: false, default: "now" },
      ],
    })).toBe(
      'CREATE TABLE "public"."kunden" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), ' +
      '"name" text NOT NULL, "erstellt_am" timestamptz DEFAULT now())',
    );
  });

  it("writes exactly the expected ALTER TABLE ... RENAME TO", () => {
    expect(renameTableStatement({ table: "kunden", newName: "Kundschaft" }))
      .toBe('ALTER TABLE "public"."kunden" RENAME TO "Kundschaft"');
  });

  it("writes exactly the expected ALTER TABLE ... ADD COLUMN", () => {
    expect(addColumnStatement({
      table: "kunden",
      column: { name: "notiz", type: "text", notNull: false, default: "none" },
    })).toBe('ALTER TABLE "public"."kunden" ADD COLUMN "notiz" text');
    expect(addColumnStatement({
      table: "kunden",
      column: { name: "gesehen_am", type: "timestamptz", notNull: true, default: "now" },
    })).toBe('ALTER TABLE "public"."kunden" ADD COLUMN "gesehen_am" timestamptz NOT NULL DEFAULT now()');
  });

  it("stays deterministic and keeps the column order of the input", () => {
    const columns: NewColumn[] = [
      { name: "b", type: "text", notNull: false, default: "none" },
      { name: "a", type: "text", notNull: false, default: "none" },
    ];
    const first = createTableStatement({ table: "t", columns });
    expect(createTableStatement({ table: "t", columns })).toBe(first);
    expect(first).toBe('CREATE TABLE "public"."t" ("b" text, "a" text)');
  });

  it("produces statements the Change Set validator accepts", () => {
    for (const statement of [
      createTableStatement({ table: "kunden", columns: [id] }),
      renameTableStatement({ table: "kunden", newName: "kundschaft" }),
      addColumnStatement({ table: "kunden", column: { name: "notiz", type: "jsonb", notNull: false, default: "none" } }),
    ]) {
      expect(validateSingleSqlStatement(statement)).toEqual({ valid: true });
    }
  });

  it("carries no DROP, no DROP COLUMN and no type change in its whole surface", () => {
    const statements = [
      createTableStatement({ table: "kunden", columns: [id] }),
      renameTableStatement({ table: "kunden", newName: "kundschaft" }),
      addColumnStatement({ table: "kunden", column: { name: "notiz", type: "text", notNull: false, default: "none" } }),
    ].join(" ");
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });
});

describe("table change set hostile input", () => {
  const hostileTableNames: Array<[string, string]> = [
    ["Anführungszeichen", 'kunden" ; DROP TABLE geheim; --'],
    ["nur ein Anführungszeichen", 'kun"den'],
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

  for (const [label, name] of hostileTableNames) {
    it(`refuses a table name with ${label}`, () => {
      rejects(() => createTableStatement({ table: name, columns: [id] }), "INVALID_TABLE_NAME");
      rejects(() => renameTableStatement({ table: name, newName: "kunden" }), "INVALID_TABLE_NAME");
      rejects(() => renameTableStatement({ table: "kunden", newName: name }), "INVALID_TABLE_NAME");
      rejects(() => addColumnStatement({
        table: name, column: { name: "notiz", type: "text", notNull: false, default: "none" },
      }), "INVALID_TABLE_NAME");
    });

    it(`refuses a column name with ${label}`, () => {
      rejects(() => createTableStatement({
        table: "kunden", columns: [{ name, type: "text", notNull: false, default: "none" }],
      }), "INVALID_COLUMN_NAME");
      rejects(() => addColumnStatement({
        table: "kunden", column: { name, type: "text", notNull: false, default: "none" },
      }), "INVALID_COLUMN_NAME");
    });
  }

  it("accepts exactly 63 characters and refuses 64", () => {
    expect(createTableStatement({ table: "k".repeat(63), columns: [id] }))
      .toContain(`"${"k".repeat(63)}"`);
    rejects(() => createTableStatement({ table: "k".repeat(64), columns: [id] }), "INVALID_TABLE_NAME");
  });

  for (const word of ["select", "TABLE", "User", "order", "default", "primary", "with", "grant"]) {
    it(`refuses the reserved word ${word}`, () => {
      rejects(() => createTableStatement({ table: word, columns: [id] }), "RESERVED_NAME");
      rejects(() => createTableStatement({
        table: "kunden", columns: [{ name: word, type: "text", notNull: false, default: "none" }],
      }), "RESERVED_NAME");
      rejects(() => renameTableStatement({ table: "kunden", newName: word }), "RESERVED_NAME");
      rejects(() => addColumnStatement({
        table: "kunden", column: { name: word, type: "text", notNull: false, default: "none" },
      }), "RESERVED_NAME");
    });
  }

  it("refuses a type that is not on the list", () => {
    for (const type of ["text; DROP TABLE geheim", "serial", "TEXT", "", "toString", "constructor"]) {
      rejects(() => createTableStatement({
        table: "kunden",
        columns: [{ name: "a", type: type as NewColumn["type"], notNull: false, default: "none" }],
      }), "UNKNOWN_TYPE");
    }
  });

  it("refuses a default that is not on the list", () => {
    for (const fallback of ["now(); DROP TABLE geheim", "null", "", "toString", "__proto__"]) {
      rejects(() => createTableStatement({
        table: "kunden",
        columns: [{ name: "a", type: "text", notNull: false, default: fallback as NewColumn["default"] }],
      }), "UNKNOWN_DEFAULT");
    }
  });

  it("refuses a default that does not fit the type", () => {
    rejects(() => createTableStatement({
      table: "kunden", columns: [{ name: "a", type: "text", notNull: false, default: "now" }],
    }), "DEFAULT_TYPE_MISMATCH");
    rejects(() => createTableStatement({
      table: "kunden", columns: [{ name: "a", type: "integer", notNull: false, default: "uuid" }],
    }), "DEFAULT_TYPE_MISMATCH");
  });

  it("refuses a table without columns and one with too many", () => {
    rejects(() => createTableStatement({ table: "kunden", columns: [] }), "NO_COLUMNS");
    rejects(() => createTableStatement({
      table: "kunden",
      columns: Array.from({ length: MAX_NEW_TABLE_COLUMNS + 1 }, (_value, index) => ({
        name: `spalte_${index}`, type: "text" as const, notNull: false, default: "none" as const,
      })),
    }), "TOO_MANY_COLUMNS");
  });

  it("refuses two columns with the same name", () => {
    rejects(() => createTableStatement({
      table: "kunden",
      columns: [
        { name: "a", type: "text", notNull: false, default: "none" },
        { name: "a", type: "integer", notNull: false, default: "none" },
      ],
    }), "DUPLICATE_COLUMN");
  });

  it("refuses a rename that renames nothing", () => {
    rejects(() => renameTableStatement({ table: "kunden", newName: "kunden" }), "SAME_NAME");
  });

  it("refuses a new NOT NULL column without a default", () => {
    rejects(() => addColumnStatement({
      table: "kunden", column: { name: "pflicht", type: "text", notNull: true, default: "none" },
    }), "NOT_NULL_NEEDS_DEFAULT");
  });

  it("carries no rejected value into the message", () => {
    try {
      createTableStatement({ table: 'kunden"; DROP TABLE geheim; --', columns: [id] });
      expect.unreachable("kein Fehler geworfen");
    } catch (error) {
      const rejected = error as TableChangeSetError;
      expect(rejected.reason).toBe(TABLE_CHANGE_SET_REASONS.INVALID_TABLE_NAME);
      expect(`${rejected.message} ${rejected.reason}`).not.toContain("DROP");
    }
  });

  it("offers every text of the module to the translation contract", () => {
    const texts = tableChangeSetTexts();
    expect(texts).toContain(TABLE_CHANGE_SET_REASONS.RESERVED_NAME);
    expect(texts).toContain("Text");
    expect(new Set(texts).size).toBe(texts.length);
  });
});
