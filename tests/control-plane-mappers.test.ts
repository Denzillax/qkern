import { describe, expect, it } from "vitest";
import { approvalFromRecord, changeSetFromRecord } from "@/lib/server/control-plane/mappers";
import type { StatementCipher } from "@/lib/server/control-plane/crypto";
import type { ApprovalRequestRecord, ChangeSetRecord } from "@/lib/server/db/models";
import type { ChangeSet } from "@/lib/types";

const changeSet: ChangeSet = {
  id: "change", organizationId: "organization", projectId: "project", environment: "development",
  title: "Change", statement: "[REDACTED]", agent: "owner@example.com", risk: "medium", status: "ready",
  diff: [], tests: [], rollback: "review", createdAt: "2026-07-17T00:00:00.000Z",
};

function approval(expiresAt: string, status: ApprovalRequestRecord["status"] = "pending"): ApprovalRequestRecord {
  return {
    id: "approval", organizationId: "organization", projectId: "project", changeSetId: "change",
    environment: "development", actionHash: "a".repeat(64), status, expiresAt,
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("public control-plane mappers", () => {
  it("hides pending approvals after their expiry even before cleanup persists the expired status", () => {
    expect(approvalFromRecord(approval("2000-01-01T00:00:00.000Z"), changeSet)).toBeUndefined();
    expect(approvalFromRecord(approval("2099-01-01T00:00:00.000Z"), changeSet)).toMatchObject({ status: "pending" });
  });

  it("never decrypts or reconstructs SQL for a public Change Set DTO", () => {
    const record: ChangeSetRecord = {
      id: "change", organizationId: "organization", projectId: "project", environment: "development",
      title: "Update profile", statementSha256: "a".repeat(64), encryptedStatement: Buffer.from("ciphertext"),
      risk: "medium", status: "ready", createdBy: "user", agentSessionId: null,
      createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    };
    const cipher = { decrypt: () => { throw new Error("public mapper must not decrypt"); } } as unknown as StatementCipher;
    const mapped = changeSetFromRecord(record, cipher);
    expect(mapped.statement).toBe("[REDACTED]");
    expect(JSON.stringify(mapped)).not.toContain("ciphertext");
  });
});
