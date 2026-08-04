import { describe, expect, it } from "vitest";
import { consoleSnapshot, createChangeSet, decideApproval, getProject, store } from "@/lib/server/store";

describe("control-plane store", () => {
  it("isolates projects by organization", () => {
    expect(() => getProject("org_other", "prj_novamarket")).toThrow("RESOURCE_NOT_FOUND");
  });

  it("creates a preview and never marks it applied", () => {
    const change = createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "development",
      title: "Create audit index", statement: "CREATE INDEX audit_created_idx ON audit_logs(created_at)", agent: "test-agent",
    });
    expect(change.status).toBe("ready");
    expect(change.risk).toBe("medium");
    expect(store.approvals.some((approval) => approval.changeSetId === change.id && approval.status === "pending")).toBe(true);
  });

  it("rejects invalid or multiple SQL statements before ready", () => {
    expect(() => createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "development",
      title: "Invalid migration", statement: "CREATE TABLE x(id int); DROP TABLE users", agent: "test-agent",
    })).toThrow("INVALID_SQL");
  });

  it("never exposes literal SQL values through public statement or diff fields", () => {
    const canary = "person-12345@example.test";
    createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "development",
      title: "Update profile", statement: `UPDATE profiles SET display_name = '${canary}' WHERE id = 1`, agent: "test-agent",
    });
    expect(JSON.stringify(consoleSnapshot("org_moqro"))).not.toContain(canary);
  });

  it("allows an approval to be decided once", () => {
    const change = createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "production",
      title: "Safe index", statement: "CREATE INDEX products_name_idx ON products(name)", agent: "test-agent",
    });
    const approval = store.approvals.find((item) => item.changeSetId === change.id)!;
    expect(decideApproval("org_moqro", approval.id, "approved", "owner").status).toBe("approved");
    expect(() => decideApproval("org_moqro", approval.id, "approved", "owner")).toThrow("APPROVAL_ALREADY_DECIDED");
  });

  it("rejects expired or mutated approval artifacts", () => {
    const expiredChange = createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "production",
      title: "Expired index", statement: "CREATE INDEX expired_idx ON products(name)", agent: "test-agent",
    });
    const expired = store.approvals.find((item) => item.changeSetId === expiredChange.id)!;
    expired.expiresAt = new Date(0).toISOString();
    expect(() => decideApproval("org_moqro", expired.id, "approved", "owner")).toThrow("APPROVAL_EXPIRED");

    const mutatedChange = createChangeSet({
      organizationId: "org_moqro", projectId: "prj_novamarket", environment: "production",
      title: "Bound index", statement: "CREATE INDEX bound_idx ON products(name)", agent: "test-agent",
    });
    const bound = store.approvals.find((item) => item.changeSetId === mutatedChange.id)!;
    mutatedChange.statement = "DROP TABLE products";
    expect(() => decideApproval("org_moqro", bound.id, "approved", "owner")).toThrow("APPROVAL_INVALIDATED");
  });
});
