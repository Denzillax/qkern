import {
  consoleSnapshot,
  createChangeSet,
  decideApproval,
  getProject,
  listProjects,
  store,
} from "@/lib/server/store";
import type {
  ControlPlaneContext,
  ControlPlaneService,
  ControlPlaneSnapshot,
  CreateChangeSetInput,
  DecideApprovalInput,
  SetAutomationPolicyInput,
} from "@/lib/server/control-plane/model";
import type { Approval, AuditEvent, ChangeSet, Project, ProjectAutomationPolicy } from "@/lib/types";
import {
  defaultAutomationPolicy,
  policyAllowsAutomaticApproval,
} from "@/lib/server/control-plane/automation-policy";
import { classifySqlRisk } from "@/lib/security";

function publicChangeSet(change: ChangeSet): ChangeSet {
  return {
    ...change,
    statement: "[REDACTED]",
    diff: ["Validated migration artifact", `Environment: ${change.environment}`, `Risk: ${change.risk}`],
  };
}

type MemorySnapshot = {
  projects: Project[];
  changes?: ChangeSet[];
  changeSets?: ChangeSet[];
  approvals: Approval[];
  audit: AuditEvent[];
};

export class MemoryControlPlaneService implements ControlPlaneService {
  private readonly automationPolicies = new Map<string, ProjectAutomationPolicy>();

  async getConsoleSnapshot(context: ControlPlaneContext): Promise<ControlPlaneSnapshot> {
    const snapshot = consoleSnapshot(context.organizationId) as unknown as MemorySnapshot;
    return {
      projects: snapshot.projects,
      changeSets: (snapshot.changeSets ?? snapshot.changes ?? []).map(publicChangeSet),
      approvals: snapshot.approvals,
      audit: snapshot.audit,
    };
  }

  async listProjects(context: ControlPlaneContext) {
    return listProjects(context.organizationId);
  }

  async getProject(context: ControlPlaneContext, projectId: string) {
    return getProject(context.organizationId, projectId);
  }

  async getProjectEnvironment(context: ControlPlaneContext, projectId: string, environment: Project["environment"]) {
    const project = getProject(context.organizationId, projectId);
    if (project.environment !== environment) throw new Error("RESOURCE_NOT_FOUND");
    return project;
  }

  async getProjectDatabaseTarget(context: ControlPlaneContext, projectId: string, environment: Project["environment"]) {
    await this.getProjectEnvironment(context, projectId, environment);
    return { databaseInstanceRef: "pending:memory-data-plane" };
  }

  async getAutomationPolicy(
    context: ControlPlaneContext,
    projectId: string,
    environment: Project["environment"],
  ) {
    await this.getProjectEnvironment(context, projectId, environment);
    return this.automationPolicies.get(`${context.organizationId}:${projectId}:${environment}`) ??
      defaultAutomationPolicy(context.organizationId, projectId, environment);
  }

  async setAutomationPolicy(context: ControlPlaneContext, input: SetAutomationPolicyInput) {
    await this.getProjectEnvironment(context, input.projectId, input.environment);
    const key = `${context.organizationId}:${input.projectId}:${input.environment}`;
    const previous = this.automationPolicies.get(key);
    const policy: ProjectAutomationPolicy = {
      organizationId: context.organizationId,
      ...input,
      revision: (previous?.revision ?? 0) + 1,
      updatedBy: context.actor.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.automationPolicies.set(key, policy);
    return policy;
  }

  async createChangeSet(context: ControlPlaneContext, input: CreateChangeSetInput) {
    const policy = await this.getAutomationPolicy(context, input.projectId, input.environment);
    const automatic = policyAllowsAutomaticApproval(
      policy,
      input.statement,
      classifySqlRisk(input.statement, input.environment),
    );
    const change = createChangeSet({
      organizationId: context.organizationId,
      ...input,
      agent: context.actor.ref,
      forceApproval: automatic,
    });
    if (automatic) {
      const approval = store.approvals.find((candidate) => candidate.changeSetId === change.id);
      if (approval) decideApproval(context.organizationId, approval.id, "approved", `qkern-automation-policy:${policy.revision}`);
    }
    return publicChangeSet(change);
  }

  async decideApproval(context: ControlPlaneContext, input: DecideApprovalInput) {
    return decideApproval(context.organizationId, input.approvalId, input.decision, context.actor.ref);
  }
}
