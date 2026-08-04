import {
  ApprovalAlreadyDecidedError,
  ApprovalExpiredError,
  InvalidRecordError,
  MigrationNotReadyError,
  ResourceNotFoundError,
} from "@/lib/server/db/errors";
import type { ApprovalRequestRecord, ChangeSetRecord } from "@/lib/server/db/models";
import { PostgresControlPlane, type ControlPlaneRepositories } from "@/lib/server/db/repositories";
import { classifySqlRisk, requiresApproval, validateSingleSqlStatement } from "@/lib/security";
import {
  approvalActionHash,
  hashesMatch,
  sha256,
  type StatementCipher,
} from "@/lib/server/control-plane/crypto";
import {
  approvalFromRecord,
  auditEventFromRecord,
  changeSetFromRecord,
  projectFromRecord,
} from "@/lib/server/control-plane/mappers";
import {
  InvalidApprovalArtifactError,
  MissingDecisionActorError,
  MissingPolicyActorError,
  type ControlPlaneContext,
  type ControlPlaneService,
  type CreateChangeSetInput,
  type DecideApprovalInput,
  type SetAutomationPolicyInput,
} from "@/lib/server/control-plane/model";
import {
  defaultAutomationPolicy,
  policyAllowsAutomaticApproval,
  policyCanAutoQueue,
} from "@/lib/server/control-plane/automation-policy";
import { randomUUID } from "node:crypto";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

type ApprovalVerificationRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  project_id: string;
  change_set_id: string;
  environment: ApprovalRequestRecord["environment"];
  action_hash: string;
  status: ApprovalRequestRecord["status"];
  expires_at: string | Date;
  created_at: string | Date;
};

function verificationRecord(row: ApprovalVerificationRow): ApprovalRequestRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    changeSetId: String(row.change_set_id),
    environment: row.environment,
    actionHash: String(row.action_hash),
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function expectedActionHash(changeSet: ChangeSetRecord, expiresAt: string, databaseInstanceRef: string): string {
  return approvalActionHash({
    changeSetId: changeSet.id,
    organizationId: changeSet.organizationId,
    projectId: changeSet.projectId,
    environment: changeSet.environment,
    databaseInstanceRef,
    title: changeSet.title,
    statementSha256: changeSet.statementSha256,
    createdBy: changeSet.createdBy,
    risk: changeSet.risk,
    expiresAt,
    requiredScope: "approval:decide",
  });
}

export class PostgresControlPlaneService implements ControlPlaneService {
  constructor(
    private readonly database: TenantRepositoryProvider,
    private readonly cipher: StatementCipher,
    private readonly approvalTtlMs = 24 * 60 * 60 * 1_000,
  ) {
    if (!Number.isInteger(approvalTtlMs) || approvalTtlMs < 60_000 || approvalTtlMs > 7 * 24 * 60 * 60 * 1_000) {
      throw new InvalidRecordError("approvalTtlMs must be between one minute and seven days.");
    }
  }

  async getConsoleSnapshot(context: ControlPlaneContext) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const projects = await repositories.projects.list();
      const environmentRecords = await repositories.environments.list();
      const changeRecords = await repositories.changeSets.list();
      const approvalRecords = await repositories.approvals.list();
      const auditRecords = await repositories.audit.list();
      const changeSets = changeRecords.map((record) => changeSetFromRecord(record, this.cipher));
      const changeSetsById = new Map(changeSets.map((changeSet) => [changeSet.id, changeSet]));
      const environmentsByProject = new Map(environmentRecords.map((record) => [record.projectId, record.environment]));
      return {
        projects: projects.map((project) => projectFromRecord(project, environmentsByProject.get(project.id))),
        changeSets,
        approvals: approvalRecords.flatMap((approval) => {
          const changeSet = changeSetsById.get(approval.changeSetId);
          if (!changeSet) return [];
          const mapped = approvalFromRecord(approval, changeSet);
          return mapped ? [mapped] : [];
        }),
        audit: auditRecords.flatMap((record) => {
          const mapped = auditEventFromRecord(record);
          return mapped ? [mapped] : [];
        }),
      };
    });
  }

  async listProjects(context: ControlPlaneContext) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const [projects, environments] = await Promise.all([repositories.projects.list(), repositories.environments.list()]);
      const environmentByProject = new Map(environments.map((record) => [record.projectId, record.environment]));
      return projects.map((record) => projectFromRecord(record, environmentByProject.get(record.id)));
    });
  }

  async getProject(context: ControlPlaneContext, projectId: string) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => projectFromRecord(await repositories.projects.get(projectId)));
  }

  async getProjectEnvironment(context: ControlPlaneContext, projectId: string, environment: import("@/lib/types").Environment) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const [project] = await Promise.all([
        repositories.projects.get(projectId),
        repositories.environments.get(projectId, environment),
      ]);
      return projectFromRecord(project, environment);
    });
  }

  async getProjectDatabaseTarget(context: ControlPlaneContext, projectId: string, environment: import("@/lib/types").Environment) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.projects.get(projectId);
      const target = await repositories.environments.get(projectId, environment);
      return { databaseInstanceRef: target.databaseInstanceRef };
    });
  }

  async getAutomationPolicy(
    context: ControlPlaneContext,
    projectId: string,
    environment: import("@/lib/types").Environment,
  ) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.environments.get(projectId, environment);
      return await repositories.automationPolicies.get(projectId, environment) ??
        defaultAutomationPolicy(context.organizationId, projectId, environment);
    });
  }

  async setAutomationPolicy(context: ControlPlaneContext, input: SetAutomationPolicyInput) {
    if (!context.actor.id || (context.actor.type ?? "user") !== "user") {
      throw new MissingPolicyActorError();
    }
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      await repositories.environments.get(input.projectId, input.environment);
      const policy = await repositories.automationPolicies.set({
        ...input,
        updatedBy: context.actor.id!,
      });
      await repositories.audit.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: "user",
        actorRef: context.actor.ref,
        action: "automation.policy.updated",
        resourceRef: `${input.projectId}:${input.environment}`,
        status: input.emergencyStop ? "blocked" : "success",
        metadata: {
          mode: input.mode,
          maxAutoRisk: input.maxAutoRisk,
          autoQueue: input.autoQueue,
          emergencyStop: input.emergencyStop,
          revision: policy.revision,
        },
      });
      return policy;
    });
  }

  async createChangeSet(context: ControlPlaneContext, input: CreateChangeSetInput) {
    const validation = validateSingleSqlStatement(input.statement);
    if (!validation.valid) throw new InvalidRecordError(`INVALID_SQL:${validation.reason}`);

    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      await repositories.projects.get(input.projectId);
      const environment = await repositories.environments.get(input.projectId, input.environment);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new MigrationNotReadyError();
      const policy = await repositories.automationPolicies.get(input.projectId, input.environment) ??
        defaultAutomationPolicy(context.organizationId, input.projectId, input.environment);
      const changeSetId = randomUUID();
      const statementSha256 = sha256(input.statement);
      const risk = classifySqlRisk(input.statement, input.environment);
      const created = await repositories.changeSets.create({
        id: changeSetId,
        projectId: input.projectId,
        environment: input.environment,
        title: input.title,
        statementSha256,
        encryptedStatement: this.cipher.encrypt(input.statement, {
          changeSetId,
          organizationId: context.organizationId,
          projectId: input.projectId,
          environment: input.environment,
          statementSha256,
        }),
        risk,
        status: "ready",
        createdBy: context.actor.id ?? null,
      });

      const automaticApproval = policyAllowsAutomaticApproval(policy, input.statement, risk);
      const approvalRequired = requiresApproval(input.statement, input.environment) || automaticApproval;
      let approval: ApprovalRequestRecord | null = null;
      if (approvalRequired) {
        const expiresAt = new Date(Date.now() + this.approvalTtlMs);
        approval = await repositories.approvals.create({
          projectId: input.projectId,
          changeSetId: created.id,
          environment: input.environment,
          actionHash: expectedActionHash(created, expiresAt.toISOString(), environment.databaseInstanceRef),
          expiresAt,
        });
      }
      if (approval && automaticApproval) {
        const decision = await repositories.approvals.decide(approval.id, "approved", {
          type: "system",
          ref: `qkern-automation-policy:${policy.revision}`,
        });
        approval = decision.approval;
        await repositories.audit.append({
          projectId: input.projectId,
          environment: input.environment,
          actorType: "system",
          actorRef: `qkern-automation-policy:${policy.revision}`,
          action: "approval.automatically_approved",
          resourceRef: approval.id,
          status: "success",
          metadata: { policyMode: policy.mode, policyRevision: policy.revision, risk },
        });
        if (policyCanAutoQueue(policy)) {
          const queued = await repositories.migrationJobs.enqueueApproved(created.id, approval.id);
          await repositories.audit.append({
            projectId: input.projectId,
            environment: input.environment,
            actorType: "system",
            actorRef: `qkern-automation-policy:${policy.revision}`,
            action: "migration.apply.automatically_queued",
            resourceRef: queued.job.id,
            status: "pending",
            metadata: { changeSetId: created.id, policyRevision: policy.revision },
          });
        }
      }
      await repositories.audit.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: "qkern_migration_preview",
        resourceRef: created.id,
        status: approval && !automaticApproval ? "pending" : "success",
        metadata: {
          statementSha256,
          risk,
          automationMode: policy.mode,
          automaticApproval,
          automaticQueue: automaticApproval && policyCanAutoQueue(policy),
          policyRevision: policy.revision,
        },
      });
      return changeSetFromRecord(
        automaticApproval ? { ...created, status: "approved" } : created,
        this.cipher,
      );
    });
  }

  async decideApproval(context: ControlPlaneContext, input: DecideApprovalInput) {
    const actorId = context.actor.id;
    if (!actorId) throw new MissingDecisionActorError();
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      const approval = await this.lockApprovalArtifact(repositories, input.approvalId);
      if (approval.status !== "pending") throw new ApprovalAlreadyDecidedError();
      if (Date.parse(approval.expiresAt) <= Date.now()) throw new ApprovalExpiredError();

      const changeRecord = await repositories.changeSets.get(approval.changeSetId);
      const environment = await repositories.environments.get(changeRecord.projectId, changeRecord.environment);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new InvalidApprovalArtifactError();
      const plaintext = this.cipher.decrypt(changeRecord.encryptedStatement, {
        changeSetId: changeRecord.id,
        organizationId: changeRecord.organizationId,
        projectId: changeRecord.projectId,
        environment: changeRecord.environment,
        statementSha256: changeRecord.statementSha256,
      });
      if (!hashesMatch(sha256(plaintext), changeRecord.statementSha256) ||
          !hashesMatch(approval.actionHash, expectedActionHash(
            changeRecord, approval.expiresAt, environment.databaseInstanceRef,
          ))) {
        throw new InvalidApprovalArtifactError();
      }
      const result = await repositories.approvals.decide(input.approvalId, input.decision, {
        id: actorId,
        type: "user",
        ref: context.actor.ref,
      });
      await repositories.audit.append({
        projectId: result.approval.projectId,
        environment: result.approval.environment,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: `approval.${input.decision}`,
        resourceRef: result.approval.id,
        status: input.decision === "approved" ? "success" : "blocked",
        metadata: { actionHash: result.approval.actionHash },
      });
      const changeSet = changeSetFromRecord({ ...changeRecord, status: input.decision }, this.cipher);
      const mapped = approvalFromRecord(result.approval, changeSet);
      if (!mapped) throw new InvalidApprovalArtifactError();
      return mapped;
    });
  }

  private async lockApprovalArtifact(repositories: ControlPlaneRepositories, approvalId: string): Promise<ApprovalRequestRecord> {
    const result = await repositories.transaction.query<ApprovalVerificationRow>(
      `SELECT approval.id, approval.organization_id, approval.project_id, approval.change_set_id,
              approval.environment, approval.action_hash, approval.status, approval.expires_at, approval.created_at
       FROM approval_requests AS approval
       JOIN change_sets AS change_set
         ON change_set.organization_id = approval.organization_id
        AND change_set.project_id = approval.project_id
        AND change_set.environment = approval.environment
        AND change_set.id = approval.change_set_id
       WHERE approval.organization_id = $1 AND approval.id = $2
       FOR UPDATE OF approval, change_set`,
      [repositories.transaction.organizationId, approvalId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Approval request");
    return verificationRecord(result.rows[0]);
  }
}

export function createPostgresControlPlaneService(
  database: PostgresControlPlane,
  cipher: StatementCipher,
  approvalTtlMs?: number,
): PostgresControlPlaneService {
  return new PostgresControlPlaneService(database, cipher, approvalTtlMs);
}
