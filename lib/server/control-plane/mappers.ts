import type { Approval, AuditEvent, ChangeSet, Environment, Project } from "@/lib/types";
import type { ApprovalRequestRecord, AuditLogRecord, ChangeSetRecord, ProjectRecord } from "@/lib/server/db/models";
import type { StatementCipher } from "@/lib/server/control-plane/crypto";

const DEFAULT_ENVIRONMENT: Environment = "development";

export function projectFromRecord(record: ProjectRecord, environment: Environment = DEFAULT_ENVIRONMENT): Project {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    region: record.region,
    environment,
    status: record.status,
    databaseSizeMb: 0,
    storageSizeMb: 0,
    apiRequests: 0,
    activeUsers: 0,
  };
}

export function changeSetFromRecord(record: ChangeSetRecord, cipher: StatementCipher): ChangeSet {
  // Public snapshots never decrypt migration SQL. Review/execution paths use a
  // separate capability and revalidate the encrypted artifact immediately
  // before the sensitive operation.
  void cipher;
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    title: record.title,
    statement: "[REDACTED]",
    agent: record.createdBy ?? "system",
    risk: record.risk,
    status: record.status,
    diff: ["Validated migration artifact", `Environment: ${record.environment}`, `Risk: ${record.risk}`],
    tests: ["Statement parsed", "Tenant scope verified", "Approval artifact bound"],
    rollback: "Generated during apply planning; never executed automatically.",
    createdAt: record.createdAt,
  };
}

export function approvalFromRecord(record: ApprovalRequestRecord, changeSet: ChangeSet): Approval | undefined {
  if (record.status === "expired" || (record.status === "pending" && Date.parse(record.expiresAt) <= Date.now())) return undefined;
  return {
    id: record.id,
    changeSetId: record.changeSetId,
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    status: record.status,
    risk: changeSet.risk,
    requestedBy: changeSet.agent,
    action: changeSet.title,
    actionHash: record.actionHash,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export function auditEventFromRecord(record: AuditLogRecord): AuditEvent | undefined {
  if (!record.projectId || !record.environment) return undefined;
  const status: AuditEvent["status"] = record.status === "success"
    ? "success"
    : record.status === "pending" ? "pending" : "blocked";
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    actor: record.actorRef,
    action: record.action,
    resource: record.resourceRef,
    status,
    createdAt: record.createdAt,
  };
}
