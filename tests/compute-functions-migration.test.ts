import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "db/migrations/0033_project_functions.sql"), "utf8",
);

describe("function definition migration", () => {
  it("stores only secret references, never a secret", () => {
    expect(migration).toContain("secret_refs text[] NOT NULL");
    expect(migration).not.toMatch(/secret_value|secret_key|signing_secret\s+text/);
  });

  it("binds the image to a content digest", () => {
    // Ein Tag waere veraenderlich, und derselbe Name koennte morgen einen
    // anderen Inhalt bezeichnen.
    expect(migration).toContain("@sha256:[0-9a-f]{64}$");
  });

  it("keeps everything but the enabled flag immutable", () => {
    expect(migration).toContain("function definition is immutable except for the enabled flag");
    expect(migration).toContain("GRANT UPDATE (enabled) ON project_functions");
  });

  it("never lets the runtime change the image through a column grant", () => {
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*image[^)]*\) ON project_functions/);
  });

  it("isolates tenants on every access path", () => {
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(migration).toContain(`project_functions_${action} ON project_functions`);
    }
  });

  it("bounds the resource columns the same way the validator does", () => {
    expect(migration).toContain("timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 100 AND 300000)");
    expect(migration).toContain("memory_mib integer NOT NULL DEFAULT 128 CHECK (memory_mib BETWEEN 64 AND 2048)");
    expect(migration).toContain("max_concurrency integer NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 100)");
  });
});
