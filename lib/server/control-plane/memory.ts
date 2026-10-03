import {
  consoleSnapshot,
  createChangeSet,
  createProjectForOrganization,
  decideApproval,
  getProject,
  listProjects,
  store,
} from "@/lib/server/store";
import {
  FIXED_ENVIRONMENTS,
  MissingProjectActorError,
  ProjectSlugTakenError,
} from "@/lib/server/control-plane/model";
import type {
  ApprovalTallyStatus,
  ChangeFlowTally,
  ControlPlaneContext,
  ControlPlaneService,
  ControlPlaneSnapshot,
  CreateChangeSetInput,
  CreateProjectInput,
  DecideApprovalInput,
  ProjectChangeFlow,
  SetAutomationPolicyInput,
} from "@/lib/server/control-plane/model";
import type { Approval, AuditEvent, ChangeSet, ChangeStatus, Project, ProjectAutomationPolicy } from "@/lib/types";
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

const MEMORY_CHANGE_STATUSES: readonly ChangeStatus[] =
  ["draft", "validating", "ready", "approved", "applied", "rejected", "failed", "rolled_back"];
const MEMORY_APPROVAL_STATUSES: readonly ApprovalTallyStatus[] = ["pending", "approved", "rejected", "expired"];

/**
 * Dieselbe Zaehlung wie in der PostgreSQL-Kontrollebene (2.81), nur an einer
 * Liste statt in der Datenbank. Ein Zustand ausserhalb der Liste wird nicht
 * gezaehlt und auch nicht in die Summe geschoben, damit die Summe und die
 * Einzelwerte hier dasselbe sagen wie dort.
 */
function memoryTally<Status extends string>(
  entries: ReadonlyArray<{ status: string; createdAt: string }>,
  statuses: readonly Status[],
): ChangeFlowTally<Status> {
  const known = new Set<string>(statuses);
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<Status, number>;
  let total = 0;
  let latest = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (!known.has(entry.status)) continue;
    byStatus[entry.status as Status] += 1;
    total += 1;
    const moment = Date.parse(entry.createdAt);
    if (Number.isFinite(moment) && moment > latest) latest = moment;
  }
  return {
    total,
    byStatus,
    latestCreatedAt: latest === Number.NEGATIVE_INFINITY ? null : new Date(latest).toISOString(),
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

  /**
   * Der Speicher kennt je Projekt genau eine Umgebung, und sie ist an keine
   * Datenbank gebunden. Die Antwort sagt das, statt eine Bindung zu erfinden.
   */
  async listProjectEnvironments(context: ControlPlaneContext, projectId: string) {
    const project = getProject(context.organizationId, projectId);
    return [{
      environment: project.environment,
      databaseInstanceRef: "pending:memory-data-plane",
      bound: false,
      createdAt: null,
    }];
  }

  /**
   * Was je Umgebung unterwegs und was angekommen ist (2.81), aus dem Speicher.
   *
   * Der Speicher fuehrt Change Sets und Freigaben, aber keine Warteschlange
   * fuer Migrationen: Es gibt hier keinen Worker, der etwas anwenden koennte.
   * Darum steht `migrations` auf null und nicht auf lauter Nullen. Null heisst
   * "diese Installation fuehrt keine Warteschlange", lauter Nullen hiessen
   * "die Warteschlange ist leer", und das sind zwei verschiedene Auskuenfte.
   */
  async summariseChangeFlow(context: ControlPlaneContext, projectId: string): Promise<ProjectChangeFlow> {
    const project = getProject(context.organizationId, projectId);
    const snapshot = consoleSnapshot(context.organizationId) as unknown as MemorySnapshot;
    const changeSets = (snapshot.changeSets ?? snapshot.changes ?? []).filter((entry) => entry.projectId === projectId);
    const approvals = snapshot.approvals.filter((entry) => entry.projectId === projectId);
    return {
      projectId,
      environments: FIXED_ENVIRONMENTS.map((environment) => ({
        environment,
        // Der Speicher kennt je Projekt genau eine Umgebung; die anderen zwei
        // gibt es als Begriff, aber nicht als Zeile.
        present: project.environment === environment,
        bound: false,
        changeSets: memoryTally(
          changeSets.filter((entry) => entry.environment === environment),
          MEMORY_CHANGE_STATUSES,
        ),
        approvals: memoryTally(
          approvals.filter((entry) => entry.environment === environment),
          MEMORY_APPROVAL_STATUSES,
        ),
        migrations: null,
      })),
    };
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

  /**
   * Legt ein Projekt im Speicher an (2.147).
   *
   * Derselbe Vertrag wie in der PostgreSQL-Kontrollebene: Der Status ist
   * `provisioning`, der Slug ist je Organisation eindeutig, und ein belegter
   * Slug ergibt `ProjectSlugTakenError`. Umgebungen legt der Speicher nicht an,
   * weil er je Projekt genau eine fuehrt und sie am Projekt haengt; das sagt
   * `listProjectEnvironments` daneben schon, und es wird hier nicht erfunden.
   *
   * Eine Audit-Kette mit Hash fuehrt der Speicher nicht. Der Eintrag geht
   * darum durch denselben Weg wie jedes andere Ereignis hier, naemlich die
   * Liste in `store.audit`; die verkettete Kette ist die der Datenbank.
   */
  async createProject(context: ControlPlaneContext, input: CreateProjectInput): Promise<Project> {
    if (!context.actor.id || (context.actor.type ?? "user") !== "user") throw new MissingProjectActorError();
    const taken = listProjects(context.organizationId).some((entry) => entry.slug === input.slug);
    if (taken) throw new ProjectSlugTakenError(input.slug);
    return createProjectForOrganization({
      id: `prj_${input.slug}`,
      organizationId: context.organizationId,
      name: input.name,
      slug: input.slug,
      region: input.region,
      environment: FIXED_ENVIRONMENTS[0],
      status: "provisioning",
    });
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
