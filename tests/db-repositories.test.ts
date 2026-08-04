import { describe, expect, it } from "vitest";
import { ApprovalRepository, AuditRepository, ProjectRepository } from "@/lib/server/db/repositories";
import type { SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import type { TenantTransaction } from "@/lib/server/db/transaction";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const CHANGE_SET_ID = "9a973ec8-a409-4706-ad1d-ef6360ea430d";
const APPROVAL_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const USER_ID = "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca";
const CREATED_AT = "2026-07-17T12:00:00.000Z";

class QueueTransaction implements TenantTransaction {
  readonly organizationId = ORGANIZATION_ID;
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  constructor(private readonly responses: Array<Record<string, unknown>[]>) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const rows = this.responses.shift() ?? [];
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

const projectRow = {
  id: PROJECT_ID,
  organization_id: ORGANIZATION_ID,
  name: "Nova Market",
  slug: "nova-market",
  region: "ch-zrh-1",
  status: "ready",
  created_by: USER_ID,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

describe("PostgreSQL repositories", () => {
  it("always includes the active organization in project lookups", async () => {
    const transaction = new QueueTransaction([[projectRow]]);
    const project = await new ProjectRepository(transaction).get(PROJECT_ID);
    expect(project.organizationId).toBe(ORGANIZATION_ID);
    expect(transaction.calls[0].text).toContain("organization_id = $1");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, PROJECT_ID]);
  });

  it("locks and decides an approval once in the surrounding transaction", async () => {
    const approvalRow = {
      id: APPROVAL_ID,
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      change_set_id: CHANGE_SET_ID,
      environment: "production",
      action_hash: "a".repeat(64),
      status: "pending",
      expires_at: "2099-01-01T00:00:00.000Z",
      created_at: CREATED_AT,
    };
    const decisionRow = {
      id: "412cb46b-6313-4a74-8480-9d9e9e240e36",
      organization_id: ORGANIZATION_ID,
      approval_request_id: APPROVAL_ID,
      decided_by: USER_ID,
      decision: "approved",
      created_at: CREATED_AT,
    };
    const transaction = new QueueTransaction([
      [approvalRow],
      [decisionRow],
      [{ ...approvalRow, status: "approved" }],
      [],
    ]);

    const result = await new ApprovalRepository(transaction).decide(APPROVAL_ID, "approved", USER_ID);
    expect(result.approval.status).toBe("approved");
    expect(transaction.calls[0].text).toContain("FOR UPDATE");
    expect(transaction.calls[1].text).toContain("approval_decisions");
    expect(transaction.calls[3].text).toContain("UPDATE change_sets");
  });

  it("redacts metadata and links new audit entries to the prior hash", async () => {
    const insertedRow = {
      id: "a742d2d4-d8fc-4353-918d-b5b1f3a3959d",
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      environment: "development",
      actor_type: "agent",
      actor_ref: "codex",
      action: "changeset.preview",
      resource_ref: CHANGE_SET_ID,
      status: "success",
      redacted_metadata: { token: "[REDACTED]", visible: true },
      previous_hash: "b".repeat(64),
      entry_hash: "c".repeat(64),
      created_at: CREATED_AT,
    };
    const transaction = new QueueTransaction([[insertedRow]]);
    const event = await new AuditRepository(transaction).append({
      projectId: PROJECT_ID,
      environment: "development",
      actorType: "agent",
      actorRef: "codex",
      action: "changeset.preview",
      resourceRef: CHANGE_SET_ID,
      status: "success",
      metadata: { token: "canary", visible: true },
    });

    expect(event.previousHash).toBe("b".repeat(64));
    expect(transaction.calls[0].text).toContain("repeat('0', 64)");
    expect(transaction.calls[0].values?.[8]).toBe(JSON.stringify({ token: "[REDACTED]", visible: true }));
  });
});
