import type { Approval, AuditEvent, ChangeSet, Environment, Project } from "@/lib/types";
import { assertTenant, classifySqlRisk, redactSensitive, requiresApproval, validateSingleSqlStatement } from "@/lib/security";
import { createHash, timingSafeEqual } from "node:crypto";

const ORGANIZATION_ID = "org_moqro";

type Store = {
  projects: Project[];
  changes: ChangeSet[];
  approvals: Approval[];
  audit: AuditEvent[];
};

function approvalActionHash(change: Pick<ChangeSet, "id" | "organizationId" | "projectId" | "environment" | "title" | "statement">): string {
  return createHash("sha256").update(JSON.stringify({
    changeSetId: change.id,
    organizationId: change.organizationId,
    projectId: change.projectId,
    environment: change.environment,
    title: change.title,
    statement: change.statement,
  })).digest("hex");
}

const initialStore = (): Store => ({
  projects: [
    {
      id: "prj_novamarket",
      organizationId: ORGANIZATION_ID,
      name: "Nova Market",
      slug: "nova-market",
      region: "ch-zrh-1",
      environment: "development",
      status: "ready",
      databaseSizeMb: 284,
      storageSizeMb: 1280,
      apiRequests: 128420,
      activeUsers: 2847,
    },
  ],
  changes: [
    {
      id: "chg_8F2A",
      organizationId: ORGANIZATION_ID,
      projectId: "prj_novamarket",
      environment: "development",
      title: "Add order status history",
      statement: "CREATE TABLE order_status_history (...)\nALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY",
      agent: "Codex",
      risk: "medium",
      status: "ready",
      diff: ["+ table order_status_history", "+ index order_status_order_id_idx", "+ RLS enabled"],
      tests: ["Schema validates", "RLS default deny", "Rollback generated"],
      rollback: "DROP TABLE order_status_history",
      createdAt: "2026-07-17T10:42:00.000Z",
    },
  ],
  approvals: [
    {
      id: "apr_C91D",
      changeSetId: "chg_8F2A",
      organizationId: ORGANIZATION_ID,
      projectId: "prj_novamarket",
      environment: "development",
      status: "pending",
      risk: "medium",
      requestedBy: "Codex",
      action: "Create table and enable RLS",
      actionHash: approvalActionHash({
        id: "chg_8F2A", organizationId: ORGANIZATION_ID, projectId: "prj_novamarket",
        environment: "development", title: "Add order status history",
        statement: "CREATE TABLE order_status_history (...)\nALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY",
      }),
      expiresAt: "2099-07-18T10:43:00.000Z",
      createdAt: "2026-07-17T10:43:00.000Z",
    },
  ],
  audit: [
    {
      id: "aud_01",
      organizationId: ORGANIZATION_ID,
      projectId: "prj_novamarket",
      environment: "development",
      actor: "Codex",
      action: "qkern_schema_list",
      resource: "public.*",
      status: "success",
      createdAt: "2026-07-17T10:38:00.000Z",
    },
    {
      id: "aud_02",
      organizationId: ORGANIZATION_ID,
      projectId: "prj_novamarket",
      environment: "development",
      actor: "Codex",
      action: "qkern_migration_preview",
      resource: "chg_8F2A",
      status: "pending",
      createdAt: "2026-07-17T10:42:00.000Z",
    },
  ],
});

const globalStore = globalThis as typeof globalThis & { __qkernStore?: Store };
export const store = globalStore.__qkernStore ?? initialStore();
if (process.env.NODE_ENV !== "production") globalStore.__qkernStore = store;

function audit(event: Omit<AuditEvent, "id" | "createdAt">) {
  store.audit.unshift({ ...event, id: `aud_${crypto.randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString() });
}

export function createProjectForOrganization(input: Pick<Project, "id" | "organizationId" | "name" | "slug" | "region" | "environment" | "status">): Project {
  const existing = store.projects.find((project) => project.organizationId === input.organizationId && project.slug === input.slug);
  if (existing) return existing;
  const project: Project = { ...input, databaseSizeMb: 0, storageSizeMb: 0, apiRequests: 0, activeUsers: 0 };
  store.projects.push(project);
  return project;
}

export function listProjects(organizationId: string) {
  return store.projects.filter((project) => project.organizationId === organizationId);
}

export function getProject(organizationId: string, projectId: string) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("RESOURCE_NOT_FOUND");
  assertTenant(project.organizationId, organizationId);
  return project;
}

export function createChangeSet(input: {
  organizationId: string;
  projectId: string;
  environment: Environment;
  title: string;
  statement: string;
  agent: string;
  forceApproval?: boolean;
}) {
  getProject(input.organizationId, input.projectId);
  const validation = validateSingleSqlStatement(input.statement);
  if (!validation.valid) throw new Error(`INVALID_SQL:${validation.reason}`);
  const change: ChangeSet = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.environment,
    title: input.title,
    statement: input.statement,
    agent: input.agent,
    id: `chg_${crypto.randomUUID().slice(0, 8)}`,
    risk: classifySqlRisk(input.statement, input.environment),
    status: "ready",
    diff: input.statement.split("\n").filter(Boolean).map((line) => `+ ${line.trim()}`),
    tests: ["Statement parsed", "Tenant scope verified", "Rollback review required"],
    rollback: "Generated during apply planning; never executed automatically.",
    createdAt: new Date().toISOString(),
  };
  store.changes.unshift(change);

  if (requiresApproval(input.statement, input.environment) || input.forceApproval) {
    store.approvals.unshift({
      id: `apr_${crypto.randomUUID().slice(0, 8)}`,
      changeSetId: change.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.environment,
      status: "pending",
      risk: change.risk,
      requestedBy: input.agent,
      action: input.title,
      actionHash: approvalActionHash(change),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
  }
  audit({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.environment,
    actor: input.agent,
    action: "qkern_migration_preview",
    resource: change.id,
    status: requiresApproval(input.statement, input.environment) || input.forceApproval ? "pending" : "success",
  });
  return change;
}

export function decideApproval(organizationId: string, approvalId: string, decision: "approved" | "rejected", actor: string) {
  const approval = store.approvals.find((item) => item.id === approvalId);
  if (!approval) throw new Error("RESOURCE_NOT_FOUND");
  assertTenant(approval.organizationId, organizationId);
  if (approval.status !== "pending") throw new Error("APPROVAL_ALREADY_DECIDED");
  const change = store.changes.find((item) => item.id === approval.changeSetId);
  if (!change) throw new Error("APPROVAL_INVALIDATED");
  if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error("APPROVAL_EXPIRED");
  const currentHash = Buffer.from(approvalActionHash(change), "hex");
  const approvedHash = Buffer.from(approval.actionHash, "hex");
  if (currentHash.length !== approvedHash.length || !timingSafeEqual(currentHash, approvedHash)) throw new Error("APPROVAL_INVALIDATED");
  approval.status = decision;
  change.status = decision;
  audit({
    organizationId,
    projectId: approval.projectId,
    environment: approval.environment,
    actor,
    action: `approval.${decision}`,
    resource: approval.id,
    status: decision === "approved" ? "success" : "blocked",
  });
  return approval;
}

export function consoleSnapshot(organizationId: string) {
  return redactSensitive({
    projects: listProjects(organizationId),
    changeSets: store.changes.filter((item) => item.organizationId === organizationId).map((item) => ({
      ...item,
      statement: "[REDACTED]",
      diff: ["Validated migration artifact", `Environment: ${item.environment}`, `Risk: ${item.risk}`],
    })),
    approvals: store.approvals.filter((item) => item.organizationId === organizationId),
    audit: store.audit.filter((item) => item.organizationId === organizationId),
  }) as Pick<Store, "projects" | "changes" | "approvals" | "audit">;
}
