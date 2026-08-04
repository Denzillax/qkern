import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifySqlRisk as classifyCliRisk, validateSingleSqlStatement as validateCliSql } from "@/cli/src/security";
import { classifySqlRisk, validateSingleSqlStatement } from "@/lib/security";

describe("developer package contracts", () => {
  it("publishes SDK and CLI through generated distribution entries", async () => {
    const repository = process.cwd();
    const sdk = JSON.parse(await readFile(path.join(repository, "sdk/typescript/package.json"), "utf8"));
    const cli = JSON.parse(await readFile(path.join(repository, "cli/package.json"), "utf8"));
    expect(sdk.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    expect(sdk.files).toEqual(["dist", "README.md"]);
    expect(cli.bin.qkern).toBe("./dist/main.js");
    expect(cli.files).toEqual(["dist", "README.md"]);
    expect(sdk.private).toBe(true);
    expect(cli.private).toBe(true);
  });

  it("keeps the standalone CLI migration policy aligned with the server policy", () => {
    const statements = [
      "SELECT id FROM public.notes",
      "CREATE TABLE public.notes (id uuid PRIMARY KEY)",
      "ALTER TABLE public.notes DROP COLUMN body",
      "BEGIN; SELECT 1; COMMIT;",
      "CREATE ROLE app PASSWORD 'private'",
    ];
    for (const statement of statements) {
      expect(validateCliSql(statement)).toEqual(validateSingleSqlStatement(statement));
      for (const environment of ["development", "staging", "production"] as const) {
        expect(classifyCliRisk(statement, environment)).toBe(classifySqlRisk(statement, environment));
      }
    }
  });
});
