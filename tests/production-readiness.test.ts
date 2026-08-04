import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_READINESS_POLICY,
  ProductionEnvironmentVerifier,
  ProductionReadinessNotReadyError,
  ProductionReadinessVerifier,
  type ProductionReadinessGate,
} from "@/lib/server/operations/production-readiness";
import { createProductionReadinessVerifierFromEnv } from
  "@/lib/server/operations/production-readiness-runtime";
import {
  ReleaseEvidenceVerifier,
  type ReleaseEvidenceReadiness,
} from "@/lib/server/operations/release-evidence-readiness";
import {
  RuntimeDeploymentVerifier,
  generateRuntimeDeploymentBundle,
  type RuntimeDeploymentOptions,
  type RuntimeDeploymentReadiness,
} from "@/lib/server/operations/runtime-deployment";

const ORGANIZATION_ID = "dd98439e-c47c-4674-a3c2-2f6df0ddde8c";
const OPTIONS: RuntimeDeploymentOptions = {
  namespace: "qkern",
  image: `registry.example.com/qkern/platform@sha256:${"a".repeat(64)}`,
  configMapName: "qkern-runtime-config",
  secretName: "qkern-runtime-secrets",
};
const PINS = ["1", "2", "3", "4", "5"].map((value) => value.repeat(64));

function environment(): Record<string, string> {
  return {
    NODE_ENV: "production",
    QKERN_RUNTIME_MODE: "postgres",
    DATABASE_SSL: "require",
    QKERN_PROJECT_DATABASE_CATALOG_SOURCE: "control-plane",
    QKERN_PRODUCTION_APPLY_ENABLED: "false",
    QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "false",
    QKERN_RUNTIME_PROBE_ENABLED: "true",
    QKERN_PROVISIONING_METRICS_ENABLED: "true",
    QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED: "true",
    QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED: "true",
    QKERN_PROVIDER_E2E_EVIDENCE_ENABLED: "true",
    QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED: "true",
    QKERN_PROVISIONER_ORGANIZATION_ID: ORGANIZATION_ID,
    QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
    QKERN_PROVISIONING_METRICS_ORGANIZATION_ID: ORGANIZATION_ID,
    QKERN_TRUST_PROXY_HOPS: "1",
    QKERN_APP_ORIGINS: "https://app.qkern.ch,https://admin.qkern.ch",
  };
}

function runtimeVerifier(): RuntimeDeploymentVerifier {
  return new RuntimeDeploymentVerifier({
    read: async () => Buffer.from(JSON.stringify(
      generateRuntimeDeploymentBundle(OPTIONS),
    )),
  }, OPTIONS);
}

function releaseVerifier(): ReleaseEvidenceVerifier {
  return new ReleaseEvidenceVerifier(
    Array.from({ length: 4 }, () => ({ verify: vi.fn(async () => ({})) })),
    PINS.map((pin) => ({ digest: vi.fn(async () => pin) })),
    {
      releaseArtifactSha256: PINS[0]!,
      backupRestoreEvidenceSha256: PINS[1]!,
      runtimeDeploymentEvidenceSha256: PINS[2]!,
      providerE2EEvidenceSha256: PINS[3]!,
      securityAssessmentSha256: PINS[4]!,
    },
  );
}

function gate<T>(value: T): ProductionReadinessGate<T> {
  return { verify: vi.fn(async () => value) };
}

describe("production readiness", () => {
  it("returns only a redacted dry-run decision after all three gates pass", async () => {
    const verifier = createProductionReadinessVerifierFromEnv(environment(), {
      runtimeDeploymentVerifier: runtimeVerifier(),
      releaseEvidenceVerifier: releaseVerifier(),
    });
    await expect(verifier.verify()).resolves.toEqual({
      status: "ready_for_controlled_rollout",
      deployment: "production",
      scope: "controlled_rollout",
      runtimeComponentCount: 4,
      signedEvidenceCount: 4,
      pinnedArtifactCount: 5,
      organizationBindingCount: 1,
      productionApplyEnabled: false,
      policy: PRODUCTION_READINESS_POLICY,
    });
    expect(JSON.stringify(await verifier.verify())).not.toMatch(
      /organizationId|https:\/\/|hostname|sha256|\/run\/|signature|keyId/i,
    );
  });

  it("requires production, PostgreSQL/TLS, persistent catalog and disabled Apply", async () => {
    const invalid = [
      { NODE_ENV: "development" },
      { QKERN_RUNTIME_MODE: "memory" },
      { DATABASE_SSL: "disable" },
      { QKERN_PROJECT_DATABASE_CATALOG_SOURCE: "static-env" },
      { QKERN_PRODUCTION_APPLY_ENABLED: "true" },
      { QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true" },
      { QKERN_RUNTIME_PROBE_ENABLED: "false" },
      { QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED: "false" },
    ];
    for (const override of invalid) {
      await expect(new ProductionEnvironmentVerifier({
        ...environment(),
        ...override,
      }).verify()).rejects.toBeInstanceOf(ProductionReadinessNotReadyError);
    }
  });

  it("requires one tenant, HTTPS-only exact origins and a trusted proxy boundary", async () => {
    const invalid = [
      { QKERN_WORKER_ORGANIZATION_ID: crypto.randomUUID() },
      { QKERN_APP_ORIGINS: "http://app.qkern.ch" },
      { QKERN_APP_ORIGINS: "https://localhost" },
      { QKERN_APP_ORIGINS: "https://app.qkern.ch/path" },
      { QKERN_APP_ORIGINS: "https://app.qkern.ch,https://app.qkern.ch" },
      { QKERN_TRUST_PROXY_HOPS: "0" },
    ];
    for (const override of invalid) {
      await expect(new ProductionEnvironmentVerifier({
        ...environment(),
        ...override,
      }).verify()).rejects.toBeInstanceOf(ProductionReadinessNotReadyError);
    }
  });

  it("rejects every inline evidence, verifier and Vault authority", async () => {
    for (const name of [
      "QKERN_BACKUP_RESTORE_EVIDENCE",
      "QKERN_RUNTIME_DEPLOYMENT_BUNDLE",
      "QKERN_PROVIDER_E2E_VERIFIER_KEY",
      "QKERN_SECURITY_ASSESSMENT_EVIDENCE",
      "QKERN_PRODUCTION_APPLY_AUTHORIZATION",
      "QKERN_VAULT_TOKEN",
      "VAULT_TOKEN",
    ]) {
      await expect(new ProductionEnvironmentVerifier({
        ...environment(),
        [name]: "forbidden-inline-authority",
      }).verify()).rejects.toBeInstanceOf(ProductionReadinessNotReadyError);
    }
  });

  it("rejects counterfeit successful dependency results and cancellation", async () => {
    const validEnvironment = await new ProductionEnvironmentVerifier(environment())
      .verify();
    const validRuntime = await runtimeVerifier().verify();
    const validEvidence = await releaseVerifier().verify();
    const invalidRuntime = {
      ...validRuntime,
      componentCount: 3,
    } as unknown as RuntimeDeploymentReadiness;
    await expect(new ProductionReadinessVerifier(
      gate(validEnvironment),
      gate(invalidRuntime),
      gate(validEvidence),
    ).verify()).rejects.toBeInstanceOf(ProductionReadinessNotReadyError);

    const invalidEvidence = {
      ...validEvidence,
      artifactCount: 4,
    } as unknown as ReleaseEvidenceReadiness;
    await expect(new ProductionReadinessVerifier(
      gate(validEnvironment),
      gate(validRuntime),
      gate(invalidEvidence),
    ).verify()).rejects.toBeInstanceOf(ProductionReadinessNotReadyError);

    const controller = new AbortController();
    controller.abort();
    await expect(new ProductionReadinessVerifier(
      gate(validEnvironment),
      gate(validRuntime),
      gate(validEvidence),
    ).verify(controller.signal)).rejects.toBeInstanceOf(
      ProductionReadinessNotReadyError,
    );
  });

  it("keeps the CLI failure fixed and cause-free", () => {
    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-production-readiness.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Production readiness is not ready",
      code: "PRODUCTION_READINESS_NOT_READY",
    });
    expect(failure.stderr).not.toMatch(/path|sha256|origin|tenant|cause/i);
  });
});
