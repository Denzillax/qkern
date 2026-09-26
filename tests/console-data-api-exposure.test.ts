import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataApiReadiness, exposedTablesFromOpenApi } from "@/lib/console/data-api-exposure";
import { DATA_API_LIMITS, SENSITIVE_COLUMN_PATTERN, SENSITIVE_COLUMN_WORDS } from "@/lib/data-api-limits";

/**
 * Die Data-API-Einstellungen der Console lesen die Freigabe aus dem
 * OpenAPI-Dokument des Servers und die Grenzen aus DATA_API_LIMITS. Der
 * Vertrag haelt drei Dinge fest: die Pfadauswertung, die Zuordnung der
 * Statuscodes und dass keine Zahl der Grenzen als Literal im JSX steht.
 */
describe("console data api exposure", () => {
  it("reads exposed table names from the OpenAPI row paths", () => {
    const prefix = "/v1/projects/p1/environments/development";
    expect(exposedTablesFromOpenApi({
      [`${prefix}/tables/todos/rows`]: {},
      [`${prefix}/tables/Order/rows`]: {},
      [`${prefix}/tables/active_todos/rows`]: {},
      [`${prefix}/rpc/add_todo`]: {},
      [`${prefix}/tables/todos/rows/extra`]: {},
      "/v1/projects/p1/environments/staging/tables/todos/rows": {},
    })).toEqual(["active_todos", "Order", "todos"]);
    expect(exposedTablesFromOpenApi({})).toEqual([]);
  });

  it("maps the OpenAPI route status to a readiness", () => {
    expect(dataApiReadiness(200)).toBe("ready");
    expect(dataApiReadiness(409, "GENERATED_DATA_API_NOT_READY")).toBe("not-ready");
    expect(dataApiReadiness(503, "GENERATED_DATA_API_DISABLED")).toBe("disabled");
    expect(dataApiReadiness(503)).toBe("disabled");
    expect(dataApiReadiness(503, "GENERATED_DATA_API_UNAVAILABLE")).toBe("error");
    expect(dataApiReadiness(401)).toBe("error");
    expect(dataApiReadiness(500)).toBe("error");
    expect(dataApiReadiness(0)).toBe("error");
  });

  it("keeps the limits and the sensitive words consistent", () => {
    expect(DATA_API_LIMITS.rowsMin).toBeLessThan(DATA_API_LIMITS.rowsMax);
    expect(DATA_API_LIMITS.operators).toHaveLength(new Set(DATA_API_LIMITS.operators).size);
    const pattern = new RegExp(SENSITIVE_COLUMN_PATTERN, "i");
    for (const word of SENSITIVE_COLUMN_WORDS) expect(pattern.test(word), word).toBe(true);
    for (const name of ["user_password", "refresh_token", "PRIVATE_KEY", "apiKey"]) expect(pattern.test(name), name).toBe(true);
    for (const name of ["id", "title", "created_at"]) expect(pattern.test(name), name).toBe(false);
  });

  it("uses the server limits instead of its own literals", async () => {
    const server = await readFile(path.resolve(process.cwd(), "lib/server/data-plane/generated-api.ts"), "utf8");
    expect(server).toContain("DATA_API_LIMITS.rowsMax");
    expect(server).toContain("DATA_API_LIMITS.maxFilters");
    expect(server).toContain("DATA_API_LIMITS.operators");
    expect(server).toContain("SENSITIVE_COLUMN_PATTERN");
    expect(server).not.toMatch(/\["eq", "neq"/);
  });

  it("takes the key claims from the same constant", async () => {
    const http = await readFile(path.resolve(process.cwd(), "lib/server/data-plane/generated-http.ts"), "utf8");
    expect(http).toContain("DATA_API_LIMITS.keyClaims");
    // Kommentare zaehlen nicht: Block- und Zeilenkommentare vor der Pruefung entfernen.
    const code = http.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain('"service_role"');
    expect(code).not.toContain('"anon"');
    expect(DATA_API_LIMITS.keyClaims).toEqual({ public: "anon", service: "service_role" });
  });

  it("keeps every limit number out of the view source", async () => {
    const source = await readFile(path.resolve(process.cwd(), "components/console/data-api-settings-view.tsx"), "utf8");
    // Text zwischen JSX-Tags ohne Ausdruecke: dort darf keine Zahl der Grenzen stehen.
    const jsxText = [...source.matchAll(/>([^<>{}]*)</g)].map((match) => match[1]).join("\n");
    expect(jsxText).not.toMatch(/\b(?:10|100)\b/);
    // Auch nicht in den uebersetzten Texten.
    const keys = [...source.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    for (const key of keys) expect(key, key).not.toMatch(/\b(?:10|100)\b/);
    expect(source).toContain("DATA_API_LIMITS");
    // Keine schreibende Aktion: nur GET.
    expect(source).not.toMatch(/method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
  });
});
