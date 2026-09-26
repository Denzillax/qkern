import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";

/**
 * Der Tabellen-Designer (2.49) ist die erste Ansicht der Console, aus der eine
 * Schemaaenderung hervorgeht. Dieser Vertrag prueft ihren **Quelltext**: Sie
 * darf kein SQL selbst ausfuehren, sie darf keine zerstoerende Anweisung
 * kennen, und der einzige schreibende Aufruf muss die Change-Set-Route sein.
 *
 * Eine Zusicherung am Quelltext ist die schwaechere Aussage und die, die frueh
 * genug kommt: beim Schreiben statt nach dem Zertifizierungslauf.
 */
const VIEW = path.resolve(process.cwd(), "components/console/table-designer-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/table-change-sets.ts");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("table designer view contract", () => {
  it("names no destructive SQL anywhere in its source", async () => {
    const source = await view();
    for (const forbidden of [/\bDROP\b/i, /\bTRUNCATE\b/i, /ALTER\s+COLUMN/i, /\bDELETE\s+FROM\b/i,
      /\bGRANT\b/i, /\bREVOKE\b/i, /\bRENAME\s+COLUMN\b/i]) {
      expect(source, `verbotenes SQL: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("writes no SQL of its own: every statement comes from the pure module", async () => {
    const source = await view();
    // Kein DDL-Text in dieser Datei. Die drei Anweisungen entstehen
    // ausschliesslich in `lib/console/table-change-sets`.
    for (const forbidden of [/CREATE\s+TABLE/i, /ALTER\s+TABLE/i, /ADD\s+COLUMN/i, /\bINSERT\s+INTO\b/i]) {
      expect(source, `SQL im Quelltext der Ansicht: ${forbidden}`).not.toMatch(forbidden);
    }
    expect(source).toContain('from "@/lib/console/table-change-sets"');
    for (const builder of ["createTableStatement", "renameTableStatement", "addColumnStatement"]) {
      expect(source).toContain(builder);
    }
  });

  it("has exactly one writing call and it is the Change Set route", async () => {
    const source = await view();
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map((match) => match[1]);
    expect(methods).toEqual(["POST"]);
    const targets = [...source.matchAll(/fetch\(([^,]+),/g)].map((match) => match[1].trim());
    expect(targets).toEqual(["url", '"/api/v1/changesets"']);
    // Was gesendet wird, ist genau die angezeigte Vorschau.
    expect(source).toContain("statement: preview.statement");
  });

  it("touches no data plane route that could execute the change directly", async () => {
    const source = await view();
    for (const forbidden of ["/query", "/rows", "/sql", "/apply", "/migrations"]) {
      expect(source, `fremde Route: ${forbidden}`).not.toContain(forbidden);
    }
    // Die einzige lesende Route ist der Schemakatalog.
    expect(source).toContain("/schema?schema=");
  });

  it("says in the view that nothing is applied and links to the approval centre", async () => {
    const source = await view();
    expect(source).toContain("Angewendet wird nichts, solange das Change Set nicht freigegeben ist.");
    expect(source).toContain('navigate("approvals")');
  });

  it("generates no destructive statement in the pure module either", async () => {
    const source = await readFile(MODULE, "utf8");
    // Im Modul stehen die verbotenen Woerter nur in Kommentaren; erzeugt wird
    // aus keiner Vorlage eine solche Anweisung.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
      .replace(/^\s*\*.*$/gm, " ");
    for (const forbidden of [/\bDROP\b/i, /\bTRUNCATE\b/i, /ALTER\s+COLUMN/i, /\bDELETE\b/i]) {
      expect(code, `verbotenes SQL: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("replaces the placeholder and routes the view", async () => {
    expect(Object.keys(PLACEHOLDERS)).not.toContain("db-tables");
    expect(REAL_VIEWS as readonly string[]).toContain("db-tables");
    const children = NAV.flatMap((group) => group.children ?? []);
    expect(children.some((child) => child.id === "db-tables")).toBe(true);
    const app = await readFile(path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(app).toContain('case "db-tables": return <TableDesignerView');
  });
});
