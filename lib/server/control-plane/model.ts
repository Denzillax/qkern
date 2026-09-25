import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  Approval,
  AuditEvent,
  AutomationMode,
  ChangeSet,
  Environment,
  Project,
  ProjectAutomationPolicy,
  Risk,
} from "@/lib/types";

export type ControlPlaneActor = {
  id?: string;
  ref: string;
  type?: "user" | "agent" | "system";
};

export type ControlPlaneContext = {
  organizationId: string;
  actor: ControlPlaneActor;
};

export type CreateChangeSetInput = {
  projectId: string;
  environment: Environment;
  title: string;
  statement: string;
};

export type DecideApprovalInput = {
  approvalId: string;
  decision: "approved" | "rejected";
};

export type SetAutomationPolicyInput = {
  projectId: string;
  environment: Environment;
  mode: AutomationMode;
  maxAutoRisk: Risk;
  autoQueue: boolean;
  emergencyStop: boolean;
};

export type ControlPlaneSnapshot = {
  projects: Project[];
  changeSets: ChangeSet[];
  approvals: Approval[];
  audit: AuditEvent[];
};

export interface ControlPlaneService {
  getConsoleSnapshot(context: ControlPlaneContext): Promise<ControlPlaneSnapshot>;
  listProjects(context: ControlPlaneContext): Promise<Project[]>;
  getProject(context: ControlPlaneContext, projectId: string): Promise<Project>;
  getProjectEnvironment(context: ControlPlaneContext, projectId: string, environment: Environment): Promise<Project>;
  /** Internal opaque target lookup. Connection strings never cross this boundary. */
  getProjectDatabaseTarget(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<{ databaseInstanceRef: string }>;
  getAutomationPolicy(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<ProjectAutomationPolicy>;
  setAutomationPolicy(
    context: ControlPlaneContext,
    input: SetAutomationPolicyInput,
  ): Promise<ProjectAutomationPolicy>;
  createChangeSet(context: ControlPlaneContext, input: CreateChangeSetInput): Promise<ChangeSet>;
  decideApproval(context: ControlPlaneContext, input: DecideApprovalInput): Promise<Approval>;
}

export class InvalidApprovalArtifactError extends Error {
  readonly code = "APPROVAL_INVALIDATED";

  constructor() {
    super("The approval artifact no longer matches its change set.");
    this.name = "InvalidApprovalArtifactError";
  }
}
recognisedByName(InvalidApprovalArtifactError, "InvalidApprovalArtifactError");

export class MissingDecisionActorError extends Error {
  readonly code = "INVALID_DECISION_ACTOR";

  constructor() {
    super("A persistent user id is required to decide an approval.");
    this.name = "MissingDecisionActorError";
  }
}
recognisedByName(MissingDecisionActorError, "MissingDecisionActorError");

export class MissingPolicyActorError extends Error {
  readonly code = "INVALID_POLICY_ACTOR";

  constructor() {
    super("A persistent user id is required to change an automation policy.");
    this.name = "MissingPolicyActorError";
  }
}
recognisedByName(MissingPolicyActorError, "MissingPolicyActorError");
