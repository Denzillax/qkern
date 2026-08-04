import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0007_migration_claim_sequence.sql");

describe("migration claim sequence", () => {
  it("adds a dedicated int8 fence generation outside bounded retry attempts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ADD COLUMN claim_sequence bigint NOT NULL DEFAULT 0");
    expect(sql).toContain("CHECK (claim_sequence BETWEEN 0 AND 9223372036854775807)");
    expect(sql).toContain("REVOKE UPDATE (claim_sequence) ON migration_jobs FROM qkern_runtime");
    expect(sql).toContain("GRANT UPDATE (claim_sequence) ON migration_jobs TO qkern_worker");
  });
});
