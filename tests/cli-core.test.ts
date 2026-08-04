import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateDatabaseTypes,
  initializeProject,
  parseConfig,
  planMigration,
  resolveInside,
  validateSeed,
} from "@/cli/src/core";

describe("QKERN CLI core", () => {
  it("initializes a secret-free project without overwriting an existing config", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qkern-cli-"));
    await initializeProject(directory, {
      baseUrl: "http://localhost:3000", projectId: "project-local", environment: "development",
    });
    const config = await readFile(path.join(directory, "qkern.config.json"), "utf8");
    expect(config).not.toMatch(/password|token|api.?key|secret/i);
    await expect(initializeProject(directory, {
      baseUrl: "http://localhost:3000", projectId: "project-local", environment: "development",
    })).rejects.toThrow("Refusing to overwrite");
  });

  it("rejects secret fields, traversal paths and non-loopback HTTP config", () => {
    const valid = {
      version: 1, baseUrl: "https://api.example.com", projectId: "project-1", environment: "production",
      schema: "public", typesFile: "qkern/types/database.ts",
      migrationsDirectory: "qkern/migrations", seedFile: "qkern/seed.sql",
    };
    expect(() => parseConfig({ ...valid, apiKey: "secret" })).toThrow("Invalid");
    expect(() => parseConfig({ ...valid, typesFile: "../outside.ts" })).toThrow("Invalid");
    expect(() => parseConfig({ ...valid, baseUrl: "http://api.example.com" })).toThrow("Invalid");
    expect(() => resolveInside("/tmp/project", "../outside.sql")).toThrow("Unsafe");
  });

  it("generates deterministic sorted Database types and omits sensitive columns", () => {
    const generated = generateDatabaseTypes({
      source: "postgres", schema: "public", tables: [{
        name: "orders", kind: "table", rowSecurityEnabled: true, columns: [
          { name: "secret_token", dataType: "text", nullable: false, identity: false, generated: false, sensitive: true },
          { name: "total", dataType: "numeric", nullable: false, identity: false, generated: false, sensitive: false },
          { name: "id", dataType: "uuid", nullable: false, identity: true, generated: false, sensitive: false },
        ],
      }],
    });
    expect(generated).toContain("export type Database");
    expect(generated).toContain("total: number");
    expect(generated).not.toContain("secret_token");
    expect(generated.indexOf("id: string")).toBeLessThan(generated.indexOf("total: number"));
  });

  it("plans one parsed migration without executing it", () => {
    expect(planMigration("ALTER TABLE public.orders ADD COLUMN note text", "production"))
      .toMatchObject({ valid: true, risk: "critical", executes: false });
    expect(() => planMigration("BEGIN; ALTER TABLE orders ADD note text; COMMIT;", "development"))
      .toThrow();
    expect(() => planMigration("CREATE ROLE app PASSWORD 'private'", "development"))
      .toThrow("credentials");
  });

  it("accepts bounded INSERT-only seed SQL and rejects DDL or credential canaries", () => {
    expect(validateSeed("-- INSERT-only deterministic development seed.\n"))
      .toEqual({ statements: 0, valid: true, executes: false });
    expect(validateSeed("INSERT INTO public.categories (name) VALUES ('Tools');"))
      .toEqual({ statements: 1, valid: true, executes: false });
    expect(() => validateSeed("DROP TABLE public.orders;")).toThrow("INSERT");
    expect(() => validateSeed("INSERT INTO settings (api_key) VALUES ('private');"))
      .toThrow("credentials");
  });
});
