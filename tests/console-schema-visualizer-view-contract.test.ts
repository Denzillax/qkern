import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";

/**
 * Der Schema-Visualizer (2.41) liest nur. Die Ansicht schreibt nicht, die neue
 * Route exportiert nur GET, das Bild traegt keine feste Farbe, und jeder Text
 * spricht alle vier Sprachen: Deutsch als Schluessel, dazu en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/schema-visualizer-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/schema/foreign-keys/route.ts";

describe("console schema visualizer view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("db-schemas");
    expect(isPlaceholder("db-schemas" as never)).toBe(false);
    expect("db-schemas" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "db-schemas": return <SchemaVisualizerView');
  });

  it("only reads, from the two catalog routes and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/schema?schema=");
    expect(view).toContain("/schema/foreign-keys?schema=");
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Kein Schreibbefehl in der SQL des Inspektors.
    const service = await source("lib/server/data-plane/service.ts");
    const foreignKeySql = service.slice(service.indexOf("const FOREIGN_KEYS_SQL"), service.indexOf("const ENUM_TYPES_SQL"));
    expect(foreignKeySql).toContain("pg_catalog.pg_constraint");
    expect(foreignKeySql).toContain("WITH ORDINALITY");
    expect(foreignKeySql).toMatch(/ORDER BY key\.ordinality/);
    for (const verb of ["INSERT", "UPDATE ", "DELETE", "CREATE", "DROP", "ALTER", "GRANT"]) {
      expect(foreignKeySql, verb).not.toContain(verb);
    }
  });

  it("says what it draws, what it leaves out and when the list was cut off", async () => {
    const view = await source(VIEW);
    expect(view).toContain("Gezeichnet wird, was der Katalog hergibt: Tabellen, Spalten und Fremdschlüssel. Vererbung, Partitionen, Sichten und Regeln fehlen im Bild.");
    expect(view).toContain("Dieses Schema hat noch keine Tabellen");
    expect(view).toContain("Die Liste der Fremdschlüssel ist bei 400 abgeschnitten");
    expect(view).toContain("Die Tabellenliste ist an der Grenze abgeschnitten");
    // Das Bild hat eine Beschreibung, und dieselbe Auskunft steht in Worten darunter.
    expect(view).toContain('role="img"');
    expect(view).toContain("aria-label={label}");
    expect(view).toContain("Beziehungen in Worten");
    expect(view).toContain("StableLabel");
    // Zustaende: laden, fertig, Fehler, Datenbank nicht bereit.
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
  });

  it("translates every text of the view into en, fr and it", async () => {
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
