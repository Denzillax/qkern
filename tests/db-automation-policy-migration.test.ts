import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0022_project_automation_policies.sql");

describe("project automation policy migration", () => {
  it("persists tenant-scoped policies and supports attributed non-human decisions", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE project_automation_policies");
    expect(sql).toContain("PRIMARY KEY (organization_id, project_id, environment)");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("mode IN ('manual', 'guarded', 'autonomous')");
    expect(sql).toContain("max_auto_risk IN ('low', 'medium', 'high', 'critical')");
    expect(sql).toContain("approval_decisions_actor_binding");
    expect(sql).toContain("actor_type IN ('agent', 'system') AND decided_by IS NULL");
    expect(sql).toContain("GRANT UPDATE (mode, max_auto_risk, auto_queue, emergency_stop, revision, updated_by, updated_at)");
  });
});
