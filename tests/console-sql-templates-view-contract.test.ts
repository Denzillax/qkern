import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { SQL_TEMPLATES, sqlTemplateTexts } from "@/lib/console/sql-templates";

/**
 * Die Vorlagen des SQL-Editors (2.61) im Quelltext der Ansicht.
 *
 * Die Zusage dieser Seite ist eine Unterlassung, und Unterlassungen pruefen
 * sich am Quelltext: Eine Vorlage wird eingefuegt, nicht ausgefuehrt. Es gibt
 * in der Ansicht keinen Weg von der Vorlagenliste zu einem fetch, und die
 * Seite sagt das auch in ihrem eigenen Text.
 *
 * Der Menuepunkt `sql-templates` ist ab hier kein Platzhalter mehr. Er fuehrt
 * in dieselbe Ansicht wie `sql`: Einfuegen heisst, das Editorfeld zu fuellen,
 * und das Feld steht dort. Eine eigene Seite haette den Text nur ueber einen
 * Umweg in dieses Feld gebracht.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/** Der Quelltext ohne Kommentare: eine Zusage steht im Code, nicht im Kommentar. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const APP = "components/console/console-app.tsx";
// Der Editor liegt seit dem Umzug aus der Schale in einer eigenen Datei; die
// Zusagen dieser Seite stehen darum dort und nicht mehr in `console-app.tsx`.
const VIEW = "components/console/sql-view.tsx";
const MODULE = "lib/console/sql-templates.ts";

describe("console sql templates view contract", () => {
  it("makes the templates entry real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("sql-templates");
    expect(isPlaceholder("sql-templates")).toBe(false);
    expect("sql-templates" in PLACEHOLDERS).toBe(false);
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Fertige Abfragen zum Einfügen, etwa für Indizes");
    expect(navigation).toContain('{ id: "sql-templates", label: "Vorlagen" }');
    // Der Eintrag haengt weiter unter dem SQL Editor, damit klar ist, wohin er fuehrt.
    const group = NAV.find((entry) => entry.id === "sql");
    expect(group?.children?.map((child) => child.id)).toEqual(["sql", "sql-templates"]);
  });

  it("routes the templates entry into the editor view instead of a page of its own", async () => {
    const app = await source(APP);
    expect(app).toContain('case "sql": case "sql-templates":');
    expect(app).toContain("templatesOpen={props.view === \"sql-templates\"}");
    // Keine zweite Ansicht, die dasselbe halb koennte.
    expect(app).not.toContain("SqlTemplatesView");
  });

  it("inserts a template and never runs it", async () => {
    const app = await source(VIEW);
    const start = app.indexOf("function insertTemplate(");
    expect(start, "insertTemplate fehlt").toBeGreaterThan(0);
    // Ohne Kommentarzeilen: geprueft wird der Code, nicht die Erzaehlung.
    const body = code(app.slice(start, app.indexOf("\n  }", start)));
    // Der Einfuegeweg ruft die Route nicht, und er ruft auch run() nicht.
    for (const word of ["fetch(", "run()", "await ", "changesets", "method:", "query"]) {
      expect(body.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
    expect(body).toContain("setSql(statement)");
    // Der Knopf der Liste ruft insertTemplate, nicht run.
    expect(app).toContain("onClick={()=>insertTemplate(template.id, template.parameters.length > 0)}");
    expect(app).not.toMatch(/insertTemplate\([^)]*\)[^;]*void run\(\)/);
  });

  it("builds no SQL of its own: every statement comes from the pure module", async () => {
    const app = await source(VIEW);
    expect(app).toContain('from "@/lib/console/sql-templates"');
    // Kein Name wird in der Ansicht zitiert oder zusammengeklebt.
    const start = app.indexOf("function insertTemplate(");
    const body = app.slice(start, app.indexOf("\n  }", start));
    expect(body).toContain("sqlTemplateStatement(");
    expect(body).not.toMatch(/`[^`]*SELECT/i);
    expect(body).not.toContain('\\"');
  });

  it("says in the view that a template is a starting point and that QKERN runs nothing on its own", async () => {
    const app = await source(VIEW);
    const honesty = "Eine Vorlage ist ein Anfang, keine Antwort. Sie landet im Editorfeld, und nichts läuft: QKERN führt von sich aus keine Abfrage aus, den Knopf drückst du.";
    expect(app).toContain(honesty);
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale][honesty]).toBeTruthy();
    }
  });

  it("shows every template with its title and its question, and names the extension one of them needs", async () => {
    const app = await source(VIEW);
    expect(app).toContain("{SQL_TEMPLATES.map((template) =>");
    expect(app).toContain("{t(template.title)}");
    expect(app).toContain("{t(template.question)}");
    expect(app).toContain("{template.requiresExtension !== null && <em>");
    expect(SQL_TEMPLATES.some((entry) => entry.requiresExtension === "pg_stat_statements")).toBe(true);
  });

  it("speaks all four languages for every text the list shows", () => {
    for (const text of sqlTemplateTexts()) {
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][text], `${locale}: ${text}`).toBeTruthy();
      }
    }
  });

  it("keeps the pure module free of React, fetch and translation", async () => {
    const module = await source(MODULE);
    for (const word of ["from \"react\"", "usestate(", "fetch(", "t(\"", "window.", "process.env"]) {
      expect(code(module).toLowerCase(), word).not.toContain(word);
    }
    // Und frei von jedem Schreibverb, auch im Kommentar-Beispiel.
    for (const verb of ["INSERT INTO", "UPDATE ", "DELETE FROM", "TRUNCATE", "ALTER ", "CREATE "]) {
      expect(module, verb).not.toContain(verb);
    }
  });
});
