import { describe, expect, it } from "vitest";
import { projectProvisionerRuntimeConfigurationFromEnv } from "@/lib/server/provisioning/runtime-composition";

const base = {
  QKERN_PROJECT_PROVISIONER_ENABLED: "true",
  QKERN_PROVISIONER_ORGANIZATION_ID: "0d9423d9-7437-4f66-898a-86275e6598fb",
  QKERN_PROJECT_PROVISIONER_ID: "provisioner-1",
};

describe("project provisioner runtime composition", () => {
  it("is disabled by default and validates tenant and worker identity", () => {
    expect(() => projectProvisionerRuntimeConfigurationFromEnv({})).toThrow("disabled");
    expect(() => projectProvisionerRuntimeConfigurationFromEnv({ ...base, QKERN_PROVISIONER_ORGANIZATION_ID: "org" }))
      .toThrow("must be a UUID");
    expect(() => projectProvisionerRuntimeConfigurationFromEnv({ ...base, QKERN_PROJECT_PROVISIONER_ID: "bad id" }))
      .toThrow("bounded reference");
  });

  it("requires broker timeout headroom inside the fenced lease", () => {
    expect(() => projectProvisionerRuntimeConfigurationFromEnv({
      ...base,
      QKERN_PROVISIONER_LEASE_MS: "20000",
      QKERN_PROVISIONING_BROKER_TIMEOUT_MS: "20000",
    })).toThrow("leave 1000ms");
    expect(projectProvisionerRuntimeConfigurationFromEnv({
      ...base,
      QKERN_PROVISIONER_LEASE_MS: "21000",
      QKERN_PROVISIONING_BROKER_TIMEOUT_MS: "20000",
    })).toMatchObject({ leaseMs: 21_000, provisionerId: "provisioner-1" });
  });
});
