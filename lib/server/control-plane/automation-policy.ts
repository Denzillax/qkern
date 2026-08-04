import type {
  Environment,
  ProjectAutomationPolicy,
  Risk,
} from "@/lib/types";

const RISK_ORDER: Record<Risk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const GUARDED_STATEMENT = /^(?:create\s+(?:unique\s+)?index|create\s+(?:materialized\s+)?view|comment\s+on)\b/i;

export function defaultAutomationPolicy(
  organizationId: string,
  projectId: string,
  environment: Environment,
): ProjectAutomationPolicy {
  return {
    organizationId,
    projectId,
    environment,
    mode: "manual",
    maxAutoRisk: "low",
    autoQueue: false,
    emergencyStop: false,
    revision: 0,
    updatedBy: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/** A persisted policy is a standing authorization; every decision remains an immutable audit artifact. */
export function policyAllowsAutomaticApproval(
  policy: ProjectAutomationPolicy,
  statement: string,
  risk: Risk,
): boolean {
  if (policy.emergencyStop || policy.mode === "manual") return false;
  if (RISK_ORDER[risk] > RISK_ORDER[policy.maxAutoRisk]) return false;
  if (policy.mode === "autonomous") return true;
  return policy.environment !== "production" &&
    RISK_ORDER[risk] <= RISK_ORDER.medium &&
    GUARDED_STATEMENT.test(statement.trim());
}

export function policyCanAutoQueue(policy: ProjectAutomationPolicy): boolean {
  // Production execution retains the separate, machine-verifiable release
  // authorization boundary. It can be automated by a signer, never bypassed.
  return policy.autoQueue && policy.environment !== "production" && !policy.emergencyStop;
}
