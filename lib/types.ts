export type Environment = "development" | "staging" | "production";
export type Risk = "low" | "medium" | "high" | "critical";
export type AutomationMode = "manual" | "guarded" | "autonomous";

export type ProjectAutomationPolicy = {
  organizationId: string;
  projectId: string;
  environment: Environment;
  mode: AutomationMode;
  maxAutoRisk: Risk;
  autoQueue: boolean;
  emergencyStop: boolean;
  revision: number;
  updatedBy: string | null;
  updatedAt: string;
};
export type ChangeStatus =
  | "draft"
  | "validating"
  | "ready"
  | "approved"
  | "applied"
  | "rejected"
  | "failed"
  | "rolled_back";

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  region: string;
  environment: Environment;
  status: "ready" | "provisioning" | "degraded";
  databaseSizeMb: number;
  storageSizeMb: number;
  apiRequests: number;
  activeUsers: number;
};

export type ChangeSet = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  title: string;
  statement: string;
  agent: string;
  risk: Risk;
  status: ChangeStatus;
  diff: string[];
  tests: string[];
  rollback: string;
  createdAt: string;
};

export type Approval = {
  id: string;
  changeSetId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  status: "pending" | "approved" | "rejected";
  risk: Risk;
  requestedBy: string;
  action: string;
  actionHash: string;
  expiresAt: string;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  actor: string;
  action: string;
  resource: string;
  status: "success" | "blocked" | "pending";
  createdAt: string;
};
