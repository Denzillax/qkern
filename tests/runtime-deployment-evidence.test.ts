import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
  RuntimeDeploymentEvidenceFileReader,
  RuntimeDeploymentEvidenceUnavailableError,
  RuntimeDeploymentEvidenceVerifier,
  canonicalRuntimeDeploymentEvidencePayload,
  runtimeDeploymentEvidenceFileReader,
  runtimeDeploymentVerifierKeyFileReader,
  type RuntimeDeploymentEvidence,
  type RuntimeDeploymentEvidenceEnvelope,
  type RuntimeDeploymentEvidenceFileProvider,
} from "@/lib/server/operations/runtime-deployment-evidence";
import { createRuntimeDeploymentEvidenceVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-evidence-runtime";
import {
  runtimeDeploymentBundleSha256,
  serializeRuntimeDeploymentBundle,
  type RuntimeDeploymentOptions,
} from "@/lib/server/operations/runtime-deployment";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const KEY_ID = "runtime-deployment-verifier-2026-07";
const IMAGE_DIGEST = "a".repeat(64);
const OPTIONS: RuntimeDeploymentOptions = {
  namespace: "qkern",
  image: `registry.example.com/qkern/platform@sha256:${IMAGE_DIGEST}`,
  configMapName: "qkern-runtime-config",
  secretName: "qkern-runtime-secrets",
};
const CLUSTER_ID = "b".repeat(64);
const NETWORK_POLICY = "c".repeat(64);
const IMAGE_PROVENANCE = "d".repeat(64);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function component(name: RuntimeDeploymentEvidence["components"][number]["name"]) {
  return {
    name,
    desiredReplicas: 1 as const,
    readyReplicas: 1 as const,
    updatedReplicas: 1 as const,
    availableReplicas: 1 as const,
    imageDigestSha256: IMAGE_DIGEST,
    rolloutVerified: true as const,
    livenessProbeVerified: true as const,
    readinessProbeVerified: true as const,
    sigtermShutdownVerified: true as const,
    restartRecoveryVerified: true as const,
    serviceAccountTokenAbsent: true as const,
    securityContextVerified: true as const,
    secretProjectionVerified: true as const,
  };
}

function evidence(overrides: Partial<RuntimeDeploymentEvidence> = {}):
RuntimeDeploymentEvidence {
  return {
    evidenceId: "84a3af22-1955-4a6f-9930-9fe516b943f2",
    deployment: "production",
    scope: "background_runtimes",
    namespace: OPTIONS.namespace,
    clusterIdentitySha256: CLUSTER_ID,
    deploymentBundleSha256: runtimeDeploymentBundleSha256(OPTIONS),
    networkPolicySha256: NETWORK_POLICY,
    imageProvenanceSha256: IMAGE_PROVENANCE,
    imageDigestSha256: IMAGE_DIGEST,
    observationStartedAt: "2026-07-26T10:00:00.000Z",
    observationCompletedAt: "2026-07-26T11:00:00.000Z",
    certifiedAt: "2026-07-26T11:05:00.000Z",
    observationDurationSeconds: 3_600,
    componentCount: 4,
    components: [
      component("project-provisioner"),
      component("migration-worker"),
      component("apply-publisher"),
      component("incident-publisher"),
    ],
    networkPolicy: {
      defaultDenyIngressVerified: true,
      defaultDenyEgressVerified: true,
      componentEgressAllowlistVerified: true,
      externalServiceSelectorsAbsent: true,
      ingressResourcesAbsent: true,
    },
    supplyChain: {
      imageSignatureVerified: true,
      sbomVerified: true,
      vulnerabilityPolicyPassed: true,
      provenanceVerified: true,
    },
    monitoring: {
      metricsScrapeVerified: true,
      probeAlertsVerified: true,
      crashLoopAlertsVerified: true,
    },
    result: "passed",
    ...overrides,
  };
}

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Missing test public key");
  return {
    ...pair,
    publicKeyBase64Url: jwk.x,
    publicKeySha256: createHash("sha256")
      .update(Buffer.from(jwk.x, "base64url"))
      .digest("hex"),
    keyFile: Buffer.from(JSON.stringify({
      schemaVersion: "qkern.runtime-deployment-verifier-key/v1",
      keyId: KEY_ID,
      publicKey: jwk.x,
    })),
  };
}

function envelope(
  payload: RuntimeDeploymentEvidence,
  privateKey: KeyObject,
  keyId = KEY_ID,
): RuntimeDeploymentEvidenceEnvelope {
  const unsigned = {
    schemaVersion: "qkern.runtime-deployment-evidence/v1" as const,
    keyId,
    evidence: payload,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      canonicalRuntimeDeploymentEvidencePayload(unsigned),
      privateKey,
    ).toString("base64url"),
  };
}

function provider(value: Uint8Array): RuntimeDeploymentEvidenceFileProvider {
  return { read: vi.fn(async () => Uint8Array.from(value)) };
}

function verifierFor(
  payload: RuntimeDeploymentEvidence = evidence(),
  options: { now?: Date; keyId?: string } = {},
) {
  const keys = keyPair();
  const signed = envelope(payload, keys.privateKey, options.keyId);
  return {
    keys,
    signed,
    verifier: new RuntimeDeploymentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(signed))),
      provider(keys.keyFile),
      keys.publicKeySha256,
      {
        deploymentOptions: OPTIONS,
        clusterIdentitySha256: CLUSTER_ID,
        networkPolicySha256: NETWORK_POLICY,
        imageProvenanceSha256: IMAGE_PROVENANCE,
      },
      () => options.now ?? NOW,
    ),
  };
}

function runtimeEnv(): Record<string, string> {
  return {
    QKERN_RUNTIME_DEPLOYMENT_NAMESPACE: OPTIONS.namespace,
    QKERN_RUNTIME_IMAGE: OPTIONS.image,
    QKERN_RUNTIME_CONFIG_MAP: OPTIONS.configMapName,
    QKERN_RUNTIME_SECRET: OPTIONS.secretName,
    QKERN_RUNTIME_DEPLOYMENT_CLUSTER_ID_SHA256: CLUSTER_ID,
    QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256: NETWORK_POLICY,
    QKERN_RUNTIME_IMAGE_PROVENANCE_SHA256: IMAGE_PROVENANCE,
  };
}

describe("runtime deployment evidence verification", () => {
  it("binds the rendered bundle and accepts only a fresh signed live certification", async () => {
    expect(runtimeDeploymentBundleSha256(OPTIONS)).toBe(
      createHash("sha256").update(serializeRuntimeDeploymentBundle(OPTIONS)).digest("hex"),
    );
    const { verifier } = verifierFor();
    await expect(verifier.verify()).resolves.toEqual({
      status: "ready",
      deployment: "production",
      scope: "background_runtimes",
      observedAt: "2026-07-26T11:00:00.000Z",
      certifiedAt: "2026-07-26T11:05:00.000Z",
      observationDurationSeconds: 3_600,
      componentCount: 4,
      policy: RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
    });
    expect(JSON.stringify(await verifier.verify())).not.toMatch(
      /evidenceId|namespace|sha256|signature|publicKey|keyId|registry|secret|credential/i,
    );
  });

  it("rejects tampering, an unpinned key and a mismatched key id", async () => {
    const valid = verifierFor();
    const tampered = {
      ...valid.signed,
      evidence: {
        ...valid.signed.evidence,
        observationDurationSeconds: 3_601,
      },
    };
    await expect(new RuntimeDeploymentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(tampered))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      {
        deploymentOptions: OPTIONS,
        clusterIdentitySha256: CLUSTER_ID,
        networkPolicySha256: NETWORK_POLICY,
        imageProvenanceSha256: IMAGE_PROVENANCE,
      },
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);

    await expect(new RuntimeDeploymentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(valid.signed))),
      provider(valid.keys.keyFile),
      "e".repeat(64),
      {
        deploymentOptions: OPTIONS,
        clusterIdentitySha256: CLUSTER_ID,
        networkPolicySha256: NETWORK_POLICY,
        imageProvenanceSha256: IMAGE_PROVENANCE,
      },
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);

    await expect(verifierFor(evidence(), { keyId: "other-key" }).verifier.verify())
      .rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);
  });

  it("rejects missing live assertions, component drift, extras and duplicate JSON keys", async () => {
    const invalid: RuntimeDeploymentEvidence[] = [
      evidence({
        components: [
          component("migration-worker"),
          component("project-provisioner"),
          component("apply-publisher"),
          component("incident-publisher"),
        ],
      }),
      evidence({
        components: [
          { ...component("project-provisioner"), readyReplicas: 0 },
          component("migration-worker"),
          component("apply-publisher"),
          component("incident-publisher"),
        ],
      } as unknown as Partial<RuntimeDeploymentEvidence>),
      evidence({
        networkPolicy: {
          ...evidence().networkPolicy,
          defaultDenyEgressVerified: false,
        },
      } as unknown as Partial<RuntimeDeploymentEvidence>),
      evidence({
        supplyChain: {
          ...evidence().supplyChain,
          vulnerabilityPolicyPassed: false,
        },
      } as unknown as Partial<RuntimeDeploymentEvidence>),
      evidence({
        monitoring: {
          ...evidence().monitoring,
          probeAlertsVerified: false,
        },
      } as unknown as Partial<RuntimeDeploymentEvidence>),
    ];
    for (const payload of invalid) {
      await expect(verifierFor(payload).verifier.verify())
        .rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);
    }

    const valid = verifierFor();
    const extra = {
      ...valid.signed,
      evidence: { ...valid.signed.evidence, kubeconfig: "forbidden" },
    };
    await expect(new RuntimeDeploymentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(extra))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      {
        deploymentOptions: OPTIONS,
        clusterIdentitySha256: CLUSTER_ID,
        networkPolicySha256: NETWORK_POLICY,
        imageProvenanceSha256: IMAGE_PROVENANCE,
      },
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);

    const duplicate = JSON.stringify(valid.signed).replace(
      `"keyId":"${KEY_ID}"`,
      `"keyId":"${KEY_ID}","keyId":"${KEY_ID}"`,
    );
    await expect(new RuntimeDeploymentEvidenceVerifier(
      provider(Buffer.from(duplicate)),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      {
        deploymentOptions: OPTIONS,
        clusterIdentitySha256: CLUSTER_ID,
        networkPolicySha256: NETWORK_POLICY,
        imageProvenanceSha256: IMAGE_PROVENANCE,
      },
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);
  });

  it("rejects stale, future, inconsistent and incorrectly bound signed evidence", async () => {
    const cases: RuntimeDeploymentEvidence[] = [
      evidence({ certifiedAt: "2026-07-25T11:59:59.000Z" }),
      evidence({
        observationStartedAt: "2026-07-26T12:01:00.000Z",
        observationCompletedAt: "2026-07-26T12:04:00.000Z",
        certifiedAt: "2026-07-26T12:06:00.000Z",
        observationDurationSeconds: 180,
      }),
      evidence({
        observationStartedAt: "2026-07-26T10:30:01.000Z",
        observationDurationSeconds: 1_799,
      }),
      evidence({ observationDurationSeconds: 3_601 }),
      evidence({ certifiedAt: "2026-07-26T11:15:01.000Z" }),
      evidence({ namespace: "other" }),
      evidence({ clusterIdentitySha256: "e".repeat(64) }),
      evidence({ deploymentBundleSha256: "e".repeat(64) }),
      evidence({ networkPolicySha256: "e".repeat(64) }),
      evidence({ imageProvenanceSha256: "e".repeat(64) }),
      evidence({ imageDigestSha256: "e".repeat(64) }),
    ];
    for (const payload of cases) {
      await expect(verifierFor(payload).verifier.verify())
        .rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);
    }
  });
});

describe("runtime deployment evidence file boundary", () => {
  it("accepts protected regular files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-runtime-evidence-"));
    tempDirectories.push(directory);
    const evidencePath = path.join(directory, "evidence.json");
    await writeFile(evidencePath, "{}", { mode: 0o644 });
    await expect(runtimeDeploymentEvidenceFileReader(evidencePath, true).read())
      .resolves.toEqual(Buffer.from("{}"));

    await chmod(evidencePath, 0o622);
    await expect(runtimeDeploymentEvidenceFileReader(evidencePath, true).read())
      .rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);

    await chmod(evidencePath, 0o644);
    const linkPath = path.join(directory, "evidence-link.json");
    await symlink(evidencePath, linkPath);
    await expect(runtimeDeploymentEvidenceFileReader(linkPath).read())
      .rejects.toBeInstanceOf(RuntimeDeploymentEvidenceUnavailableError);

    expect(() => new RuntimeDeploymentEvidenceFileReader("relative.json", 100))
      .toThrow("bounded absolute paths");
    expect(() => runtimeDeploymentVerifierKeyFileReader("relative-key.json"))
      .toThrow("bounded absolute paths");
  });
});

describe("runtime deployment evidence runtime and CLI", () => {
  it("forbids inline values, reused authorities and ambiguous policy pins", () => {
    const keys = keyPair();
    const dependencies = {
      evidenceProvider: provider(Buffer.from("{}")),
      keyProvider: provider(keys.keyFile),
    };
    expect(() => createRuntimeDeploymentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_RUNTIME_DEPLOYMENT_EVIDENCE: "{}",
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("Inline");
    expect(() => createRuntimeDeploymentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE: "/run/qkern/shared",
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE: "/run/qkern/key",
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
      QKERN_RUNTIME_DEPLOYMENT_FILE: "/run/qkern/shared",
    })).toThrow("cannot reuse");
    expect(() => createRuntimeDeploymentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE: "/run/qkern/same",
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE: "/run/qkern/same",
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    })).toThrow("must be distinct");
    expect(() => createRuntimeDeploymentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256: CLUSTER_ID,
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("distinct policy pins");
  });

  it("runs the machine-readable verifier and keeps failures cause-free", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-runtime-evidence-cli-"));
    tempDirectories.push(directory);
    const keys = keyPair();
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const signed = envelope(evidence({
      observationStartedAt: new Date(now - 70 * 60_000).toISOString(),
      observationCompletedAt: new Date(now - 10 * 60_000).toISOString(),
      certifiedAt: new Date(now - 5 * 60_000).toISOString(),
    }), keys.privateKey);
    const evidencePath = path.join(directory, "evidence.json");
    const keyPath = path.join(directory, "key.json");
    await writeFile(evidencePath, JSON.stringify(signed), { mode: 0o600 });
    await writeFile(keyPath, keys.keyFile, { mode: 0o644 });

    const baseEnv = {
      ...process.env,
      ...runtimeEnv(),
      QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE: evidencePath,
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE: keyPath,
      QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    };
    const success = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-background-runtime-deployment-evidence.ts"],
      { cwd: process.cwd(), env: baseEnv, encoding: "utf8" },
    );
    expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)
      .data.backgroundRuntimeDeploymentEvidenceReadiness).toMatchObject({
        status: "ready",
        scope: "background_runtimes",
        componentCount: 4,
      });
    expect(success.stderr).toBe("");

    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-background-runtime-deployment-evidence.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...baseEnv,
          QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256: "e".repeat(64),
        },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Background runtime deployment evidence is not ready",
      code: "RUNTIME_DEPLOYMENT_EVIDENCE_NOT_READY",
    });
    expect(failure.stderr).not.toContain(evidencePath);
    expect(failure.stderr).not.toContain(keys.publicKeyBase64Url);
  });
});
