import { randomUUID } from "node:crypto";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import { approvalActionHash, hashesMatch } from "@/lib/server/control-plane/crypto";
import type { ApprovalRequestRecord, ChangeSetRecord } from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import { MigrationNotReadyError, ResourceNotFoundError } from "@/lib/server/db/errors";
import type { ChangeSetApplyService, QueueApprovedChangeSetResult } from "@/lib/server/migrations/apply-service";
import {
  denyProductionApplyAuthorizer,
  ProductionApplyBlockedError,
  type ProductionApplyAuthorizer,
} from "@/lib/server/migrations/production-apply-authorization";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

export class MemoryChangeSetApplyService implements ChangeSetApplyService {
  private readonly jobs = new Map<string, { id: string; status: "queued" | "applied" }>();

  constructor(private readonly controlPlane: ControlPlaneService) {}

  async queueApprovedChangeSet(context: Parameters<ChangeSetApplyService["queueApprovedChangeSet"]>[0], input: Parameters<ChangeSetApplyService["queueApprovedChangeSet"]>[1]): Promise<QueueApprovedChangeSetResult> {
    const snapshot = await this.controlPlane.getConsoleSnapshot(context);
    const change = snapshot.changeSets.find((candidate) => candidate.id === input.changeSetId);
    if (!change) throw new ResourceNotFoundError("Change Set");
    if (change.status === "applied") return { outcome: "already_applied", changeSetId: change.id };
    if (change.status !== "approved") throw new MigrationNotReadyError();
    // Memory mode has no trusted target binding or encrypted statement hash
    // from which an exact release authorization could be constructed.
    if (change.environment === "production") throw new ProductionApplyBlockedError();
    const approval = snapshot.approvals.find((candidate) => candidate.changeSetId === change.id && candidate.status === "approved");
    if (!approval || Date.parse(approval.expiresAt) <= Date.now()) throw new MigrationNotReadyError();
    const key = `${context.organizationId}:${change.id}`;
    const existing = this.jobs.get(key);
    if (existing) return { outcome: "already_queued", changeSetId: change.id, jobId: existing.id };
    const job = { id: `mjob_${randomUUID()}`, status: "queued" as const };
    this.jobs.set(key, job);
    return { outcome: "queued", changeSetId: change.id, jobId: job.id };
  }
}

export class PostgresChangeSetApplyService implements ChangeSetApplyService {
  constructor(
    private readonly database: TenantRepositoryProvider,
    private readonly productionApplyAuthorizer: ProductionApplyAuthorizer =
      denyProductionApplyAuthorizer,
  ) {}

  async queueApprovedChangeSet(context: Parameters<ChangeSetApplyService["queueApprovedChangeSet"]>[0], input: Parameters<ChangeSetApplyService["queueApprovedChangeSet"]>[1]): Promise<QueueApprovedChangeSetResult> {
    return this.database.withTenant({ organizationId: context.organizationId, actorRef: context.actor.ref }, async (repositories: ControlPlaneRepositories) => {
      const change = await repositories.changeSets.get(input.changeSetId);
      if (change.status === "applied") return { outcome: "already_applied", changeSetId: change.id };
      if (change.status !== "approved") throw new MigrationNotReadyError();
      const [environment, approval] = await Promise.all([
        repositories.environments.get(change.projectId, change.environment),
        repositories.approvals.getForChangeSet(change.id),
      ]);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new MigrationNotReadyError();
      if (!approval || approval.status !== "approved" || approval.environment !== change.environment ||
          !validApproval(change, approval, environment.databaseInstanceRef, Date.now())) throw new MigrationNotReadyError();
      try {
        await this.productionApplyAuthorizer.assertAuthorized({
          organizationId: change.organizationId,
          projectId: change.projectId,
          environment: change.environment,
          changeSetId: change.id,
          approvalId: approval.id,
          databaseInstanceRef: environment.databaseInstanceRef,
          statementSha256: change.statementSha256,
          approvalActionHash: approval.actionHash,
        });
      } catch {
        throw new ProductionApplyBlockedError();
      }
      const result = await repositories.migrationJobs.enqueueApproved(change.id, approval.id);
      if (result.created) {
        await repositories.audit.append({
          projectId: change.projectId,
          environment: change.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.apply.queued",
          resourceRef: result.job.id,
          status: "pending",
          metadata: { changeSetId: change.id },
        });
      }
      if (result.job.status === "applied") return { outcome: "already_applied", changeSetId: change.id };
      return {
        outcome: result.created ? "queued" : "already_queued",
        changeSetId: change.id,
        jobId: result.job.id,
      };
    });
  }
}

function validApproval(
  change: ChangeSetRecord,
  approval: ApprovalRequestRecord,
  databaseInstanceRef: string,
  now: number,
): boolean {
  if (Date.parse(approval.expiresAt) <= now) return false;
  return hashesMatch(approval.actionHash, approvalActionHash({
    changeSetId: change.id,
    organizationId: change.organizationId,
    projectId: change.projectId,
    environment: change.environment,
    databaseInstanceRef,
    title: change.title,
    statementSha256: change.statementSha256,
    createdBy: change.createdBy,
    risk: change.risk,
    expiresAt: approval.expiresAt,
    requiredScope: "approval:decide",
  }));
}
