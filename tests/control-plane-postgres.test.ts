import { describe, expect, it } from "vitest";
import type { StatementBinding, StatementCipher } from "@/lib/server/control-plane/crypto";
import { approvalActionHash, sha256 } from "@/lib/server/control-plane/crypto";
import { InvalidApprovalArtifactError } from "@/lib/server/control-plane/model";
import { PostgresControlPlaneService } from "@/lib/server/control-plane/postgres";
import { MigrationNotReadyError } from "@/lib/server/db/errors";
import { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import type { SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import type { TenantContext, TenantTransaction } from "@/lib/server/db/transaction";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const CHANGE_SET_ID = "9a973ec8-a409-4706-ad1d-ef6360ea430d";
const APPROVAL_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const USER_ID = "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca";
const CREATED_AT = "2026-07-17T12:00:00.000Z";
const STATEMENT = "CREATE INDEX products_name_idx ON products(name)";

class TestCipher implements StatementCipher {
  encrypt(statement: string, _binding: StatementBinding): Uint8Array {
    return Buffer.from(statement, "utf8");
  }

  decrypt(payload: Uint8Array, _binding: StatementBinding): string {
    return Buffer.from(payload).toString("utf8");
  }
}

class RecordingTransaction implements TenantTransaction {
  readonly organizationId = ORGANIZATION_ID;
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];

  constructor(private readonly responder: (text: string, values?: readonly SqlValue[]) => Record<string, unknown>[]) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const rows = this.responder(text, values);
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

function provider(transaction: TenantTransaction, contexts: TenantContext[]) {
  return {
    async withTenant<T>(context: TenantContext, operation: (repositories: ControlPlaneRepositories) => Promise<T>): Promise<T> {
      contexts.push(context);
      return operation(new ControlPlaneRepositories(transaction));
    },
  };
}

function projectRow() {
  return {
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
}

function environmentRow(databaseInstanceRef = "managed:database-1") {
  return {
    id: "c7d64bb4-e8e9-4bbc-89ea-ff2ab47f5c2f", organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID, environment: "production", database_instance_ref: databaseInstanceRef, created_at: CREATED_AT,
  };
}

function changeRow(statementSha256 = sha256(STATEMENT)) {
  return {
    id: CHANGE_SET_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    environment: "production",
    title: "Create product index",
    statement_sha256: statementSha256,
    encrypted_statement: Buffer.from(STATEMENT),
    risk: "high",
    status: "ready",
    created_by: USER_ID,
    agent_session_id: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function approvalRow(actionHash: string, status = "pending") {
  return {
    id: APPROVAL_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    change_set_id: CHANGE_SET_ID,
    environment: "production",
    action_hash: actionHash,
    status,
    expires_at: "2099-01-01T00:00:00.000Z",
    created_at: CREATED_AT,
  };
}

function actionHash(expiresAt = "2099-01-01T00:00:00.000Z") {
  const change = changeRow();
  return approvalActionHash({
    changeSetId: CHANGE_SET_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    environment: "production",
    databaseInstanceRef: "managed:database-1",
    title: String(change.title),
    statementSha256: String(change.statement_sha256),
    createdBy: String(change.created_by),
    risk: "high",
    expiresAt,
    requiredScope: "approval:decide",
  });
}

describe("PostgreSQL control-plane adapter", () => {
  it("creates a tenant-scoped change, approval artifact and audit event atomically", async () => {
    const contexts: TenantContext[] = [];
    let persistedActionHash = "";
    let persistedExpiresAt = "";
    const transaction = new RecordingTransaction((text, values) => {
      if (text.includes("FROM projects")) return [projectRow()];
      if (text.includes("FROM project_environments")) return [environmentRow()];
      if (text.includes("INSERT INTO change_sets")) return [changeRow(String(values?.[4]))];
      if (text.includes("INSERT INTO approval_requests")) {
        persistedActionHash = String(values?.[4]);
        persistedExpiresAt = new Date(values?.[5] as Date).toISOString();
        return [approvalRow(persistedActionHash)];
      }
      if (text.includes("INSERT INTO audit_logs")) return [{
        id: "a742d2d4-d8fc-4353-918d-b5b1f3a3959d",
        organization_id: ORGANIZATION_ID,
        project_id: PROJECT_ID,
        environment: "production",
        actor_type: "user",
        actor_ref: "owner@example.com",
        action: "qkern_migration_preview",
        resource_ref: CHANGE_SET_ID,
        status: "pending",
        redacted_metadata: {},
        previous_hash: null,
        entry_hash: "c".repeat(64),
        created_at: CREATED_AT,
      }];
      return [];
    });
    const service = new PostgresControlPlaneService(provider(transaction, contexts), new TestCipher());

    const change = await service.createChangeSet({
      organizationId: ORGANIZATION_ID,
      actor: { id: USER_ID, ref: "owner@example.com", type: "user" },
    }, {
      projectId: PROJECT_ID,
      environment: "production",
      title: "Create product index",
      statement: STATEMENT,
    });

    expect(change.statement).toBe("[REDACTED]");
    expect(change.status).toBe("ready");
    expect(persistedActionHash).toBe(actionHash(persistedExpiresAt));
    expect(contexts).toEqual([{ organizationId: ORGANIZATION_ID, actorRef: "owner@example.com" }]);
    expect(transaction.calls.some((call) => call.text.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("refuses to create a Change Set before the project database target is provisioned", async () => {
    const transaction = new RecordingTransaction((text) => {
      if (text.includes("FROM projects")) return [projectRow()];
      if (text.includes("FROM project_environments")) return [environmentRow("pending:test")];
      return [];
    });
    const service = new PostgresControlPlaneService(provider(transaction, []), new TestCipher());

    await expect(service.createChangeSet({
      organizationId: ORGANIZATION_ID,
      actor: { id: USER_ID, ref: "owner@example.com", type: "user" },
    }, {
      projectId: PROJECT_ID,
      environment: "production",
      title: "Create product index",
      statement: STATEMENT,
    })).rejects.toBeInstanceOf(MigrationNotReadyError);
    expect(transaction.calls.some((call) => call.text.includes("INSERT INTO change_sets"))).toBe(false);
  });

  it("records an attributed system decision when an autonomous policy replaces per-change approval", async () => {
    let persistedActionHash = "";
    const transaction = new RecordingTransaction((text, values) => {
      if (text.includes("FROM projects")) return [projectRow()];
      if (text.includes("FROM project_environments")) return [environmentRow()];
      if (text.includes("FROM project_automation_policies")) return [{
        organization_id: ORGANIZATION_ID,
        project_id: PROJECT_ID,
        environment: "production",
        mode: "autonomous",
        max_auto_risk: "high",
        auto_queue: true,
        emergency_stop: false,
        revision: "7",
        updated_by: USER_ID,
        updated_at: CREATED_AT,
      }];
      if (text.includes("INSERT INTO change_sets")) return [changeRow(String(values?.[4]))];
      if (text.includes("INSERT INTO approval_requests")) {
        persistedActionHash = String(values?.[4]);
        return [{ ...approvalRow(persistedActionHash), expires_at: values?.[5] as Date }];
      }
      if (text.includes("FROM approval_requests") && text.includes("FOR UPDATE")) {
        return [{ ...approvalRow(persistedActionHash), expires_at: new Date(Date.now() + 60_000) }];
      }
      if (text.includes("INSERT INTO approval_decisions")) return [{
        id: "412cb46b-6313-4a74-8480-9d9e9e240e36",
        organization_id: ORGANIZATION_ID,
        approval_request_id: APPROVAL_ID,
        decided_by: null,
        actor_type: "system",
        actor_ref: "qkern-automation-policy:7",
        decision: "approved",
        created_at: CREATED_AT,
      }];
      if (text.includes("UPDATE approval_requests")) return [approvalRow(persistedActionHash, "approved")];
      if (text.includes("INSERT INTO audit_logs")) return [{
        id: crypto.randomUUID(), organization_id: ORGANIZATION_ID, project_id: PROJECT_ID,
        environment: "production", actor_type: "system", actor_ref: "qkern-automation-policy:7",
        action: "automation", resource_ref: CHANGE_SET_ID, status: "success",
        redacted_metadata: {}, previous_hash: null, entry_hash: "c".repeat(64), created_at: CREATED_AT,
      }];
      return [];
    });
    const service = new PostgresControlPlaneService(provider(transaction, []), new TestCipher());

    const change = await service.createChangeSet({
      organizationId: ORGANIZATION_ID,
      actor: { ref: "codex", type: "agent" },
    }, {
      projectId: PROJECT_ID,
      environment: "production",
      title: "Create product index",
      statement: STATEMENT,
    });

    expect(change.status).toBe("approved");
    const decision = transaction.calls.find((call) => call.text.includes("INSERT INTO approval_decisions"));
    expect(decision?.values).toEqual([
      ORGANIZATION_ID, APPROVAL_ID, null, "system", "qkern-automation-policy:7", "approved",
    ]);
    expect(transaction.calls.some((call) => call.text.includes("INSERT INTO migration_jobs"))).toBe(false);
  });

  it("revalidates the locked approval artifact before the replay-safe repository decision", async () => {
    const contexts: TenantContext[] = [];
    const hash = actionHash();
    const transaction = new RecordingTransaction((text) => {
      if (text.includes("FROM approval_requests") && text.includes("FOR UPDATE")) return [approvalRow(hash)];
      if (text.includes("FROM change_sets")) return [changeRow()];
      if (text.includes("FROM project_environments")) return [environmentRow()];
      if (text.includes("INSERT INTO approval_decisions")) return [{
        id: "412cb46b-6313-4a74-8480-9d9e9e240e36",
        organization_id: ORGANIZATION_ID,
        approval_request_id: APPROVAL_ID,
        decided_by: USER_ID,
        decision: "approved",
        created_at: CREATED_AT,
      }];
      if (text.includes("UPDATE approval_requests")) return [approvalRow(hash, "approved")];
      if (text.includes("INSERT INTO audit_logs")) return [{
        id: "a742d2d4-d8fc-4353-918d-b5b1f3a3959d",
        organization_id: ORGANIZATION_ID,
        project_id: PROJECT_ID,
        environment: "production",
        actor_type: "user",
        actor_ref: "owner@example.com",
        action: "approval.approved",
        resource_ref: APPROVAL_ID,
        status: "success",
        redacted_metadata: {},
        previous_hash: null,
        entry_hash: "c".repeat(64),
        created_at: CREATED_AT,
      }];
      return [];
    });
    const service = new PostgresControlPlaneService(provider(transaction, contexts), new TestCipher());

    const approval = await service.decideApproval({
      organizationId: ORGANIZATION_ID,
      actor: { id: USER_ID, ref: "owner@example.com", type: "user" },
    }, { approvalId: APPROVAL_ID, decision: "approved" });

    expect(approval.status).toBe("approved");
    expect(transaction.calls.filter((call) => call.text.includes("FOR UPDATE"))).toHaveLength(2);
    expect(transaction.calls.some((call) => call.text.includes("INSERT INTO approval_decisions"))).toBe(true);
  });

  it("rejects a mutated action artifact before recording a decision", async () => {
    const transaction = new RecordingTransaction((text) => {
      if (text.includes("FROM approval_requests") && text.includes("FOR UPDATE")) return [approvalRow("d".repeat(64))];
      if (text.includes("FROM change_sets")) return [changeRow()];
      if (text.includes("FROM project_environments")) return [environmentRow()];
      return [];
    });
    const service = new PostgresControlPlaneService(provider(transaction, []), new TestCipher());

    await expect(service.decideApproval({
      organizationId: ORGANIZATION_ID,
      actor: { id: USER_ID, ref: "owner@example.com", type: "user" },
    }, { approvalId: APPROVAL_ID, decision: "approved" })).rejects.toBeInstanceOf(InvalidApprovalArtifactError);
    expect(transaction.calls.some((call) => call.text.includes("INSERT INTO approval_decisions"))).toBe(false);
  });
});
