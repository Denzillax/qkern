import { describe, expect, it } from "vitest";
import {
  policyAllowsAutomaticApproval,
  policyCanAutoQueue,
} from "@/lib/server/control-plane/automation-policy";
import type { ProjectAutomationPolicy } from "@/lib/types";

function policy(overrides: Partial<ProjectAutomationPolicy> = {}): ProjectAutomationPolicy {
  return {
    organizationId: "organization",
    projectId: "project",
    environment: "development",
    mode: "manual",
    maxAutoRisk: "low",
    autoQueue: false,
    emergencyStop: false,
    revision: 1,
    updatedBy: "user",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("project automation policy", () => {
  it("keeps manual mode and emergency stop human-gated", () => {
    expect(policyAllowsAutomaticApproval(policy({ maxAutoRisk: "critical" }), "DROP TABLE users", "critical"))
      .toBe(false);
    expect(policyAllowsAutomaticApproval(policy({
      mode: "autonomous", maxAutoRisk: "critical", emergencyStop: true,
    }), "DROP TABLE users", "critical")).toBe(false);
  });

  it("limits guarded mode to explicit non-production safe classes", () => {
    const guarded = policy({ mode: "guarded", maxAutoRisk: "medium" });
    expect(policyAllowsAutomaticApproval(guarded, "CREATE INDEX products_name_idx ON products(name)", "medium"))
      .toBe(true);
    expect(policyAllowsAutomaticApproval(guarded, "CREATE TABLE products(id uuid)", "medium"))
      .toBe(false);
    expect(policyAllowsAutomaticApproval({ ...guarded, environment: "production" }, "CREATE INDEX x ON t(id)", "medium"))
      .toBe(false);
  });

  it("allows autonomous decisions only through the configured risk ceiling", () => {
    const autonomous = policy({ mode: "autonomous", maxAutoRisk: "high", autoQueue: true });
    expect(policyAllowsAutomaticApproval(autonomous, "ALTER TABLE products ADD COLUMN sku text", "high"))
      .toBe(true);
    expect(policyAllowsAutomaticApproval(autonomous, "DROP TABLE products", "critical"))
      .toBe(false);
    expect(policyCanAutoQueue(autonomous)).toBe(true);
    expect(policyCanAutoQueue({ ...autonomous, environment: "production" })).toBe(false);
  });
});
