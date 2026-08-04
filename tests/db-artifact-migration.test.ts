import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("artifact and workspace integrity migration", () => {
  it("binds changes to provisioned environments and personal workspaces to one user", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "db/migrations/0004_artifact_and_workspace_integrity.sql"), "utf8");
    expect(sql).toContain("one_personal_workspace_per_user");
    expect(sql).toContain("change_sets_project_environment_fk");
    expect(sql).toContain("approval_requests_change_set_environment_fk");
  });

  it("makes reviewed artifacts and session revocation immutable", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "db/migrations/0004_artifact_and_workspace_integrity.sql"), "utf8");
    expect(sql).toContain("change_sets_artifact_immutable");
    expect(sql).toContain("auth_sessions_revocation_monotonic");
    expect(sql).toContain("GRANT UPDATE (status, updated_at) ON change_sets");
    expect(sql).not.toContain("GRANT UPDATE (title");
  });
});
