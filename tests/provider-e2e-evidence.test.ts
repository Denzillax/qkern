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
import { itOnPosix } from "./support/posix";
import {
  PROVIDER_E2E_EVIDENCE_POLICY,
  ProviderE2EEvidenceFileReader,
  ProviderE2EEvidenceUnavailableError,
  ProviderE2EEvidenceVerifier,
  canonicalProviderE2EEvidencePayload,
  providerE2EEvidenceFileReader,
  providerE2EVerifierKeyFileReader,
  type ProviderE2EEvidence,
  type ProviderE2EEvidenceEnvelope,
  type ProviderE2EEvidenceFileProvider,
} from "@/lib/server/operations/provider-e2e-evidence";
import { createProviderE2EEvidenceVerifierFromEnv } from
  "@/lib/server/operations/provider-e2e-evidence-runtime";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const KEY_ID = "provider-e2e-verifier-2026-07";
const PINS = {
  providerIdentitySha256: "1".repeat(64),
  providerConfigurationSha256: "2".repeat(64),
  brokerContractSha256: "3".repeat(64),
  vaultPolicySha256: "4".repeat(64),
  pagerRoutingSha256: "5".repeat(64),
  backupRestoreEvidenceSha256: "6".repeat(64),
  runtimeDeploymentEvidenceSha256: "7".repeat(64),
};
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function scenarios(): ProviderE2EEvidence["scenarios"] {
  return {
    provisioningSucceeded: true,
    provisioningIdempotencyVerified: true,
    invalidBrokerSignatureRejected: true,
    vaultCredentialIssued: true,
    vaultRotationVerified: true,
    previousVaultCredentialRevoked: true,
    tlsCertificatePinVerified: true,
    migrationApplyVerified: true,
    crashAfterCommitReconciled: true,
    leaseLossCancelled: true,
    rollbackRetryVerified: true,
    crossTenantIsolationVerified: true,
    applyDeliveryVerified: true,
    incidentPagerDeliveryVerified: true,
    metricsAlertLifecycleVerified: true,
  };
}

function evidence(
  overrides: Partial<ProviderE2EEvidence> = {},
): ProviderE2EEvidence {
  return {
    evidenceId: "4bd7f46a-86f7-41ca-8a4d-74bfb64410b2",
    deployment: "production",
    scope: "managed_postgresql_e2e",
    ...PINS,
    testRunStartedAt: "2026-07-26T10:30:00.000Z",
    testRunCompletedAt: "2026-07-26T11:30:00.000Z",
    certifiedAt: "2026-07-26T11:35:00.000Z",
    testRunDurationSeconds: 3_600,
    postgresMajorVersion: 17,
    scenarioCount: 15,
    scenarios: scenarios(),
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
    publicKeySha256: createHash("sha256")
      .update(Buffer.from(jwk.x, "base64url"))
      .digest("hex"),
    keyFile: Buffer.from(JSON.stringify({
      schemaVersion: "qkern.provider-e2e-verifier-key/v1",
      keyId: KEY_ID,
      publicKey: jwk.x,
    })),
  };
}

function envelope(
  payload: ProviderE2EEvidence,
  privateKey: KeyObject,
  keyId = KEY_ID,
): ProviderE2EEvidenceEnvelope {
  const unsigned = {
    schemaVersion: "qkern.provider-e2e-evidence/v1" as const,
    keyId,
    evidence: payload,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      canonicalProviderE2EEvidencePayload(unsigned),
      privateKey,
    ).toString("base64url"),
  };
}

function provider(value: Uint8Array): ProviderE2EEvidenceFileProvider {
  return { read: vi.fn(async () => Uint8Array.from(value)) };
}

function verifierFor(
  payload: ProviderE2EEvidence = evidence(),
  options: { now?: Date; keyId?: string } = {},
) {
  const keys = keyPair();
  const signed = envelope(payload, keys.privateKey, options.keyId);
  return {
    keys,
    signed,
    verifier: new ProviderE2EEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(signed))),
      provider(keys.keyFile),
      keys.publicKeySha256,
      PINS,
      () => options.now ?? NOW,
    ),
  };
}

function runtimeEnv(): Record<string, string> {
  return {
    QKERN_PROVIDER_E2E_PROVIDER_ID_SHA256: PINS.providerIdentitySha256,
    QKERN_PROVIDER_E2E_PROVIDER_CONFIG_SHA256:
      PINS.providerConfigurationSha256,
    QKERN_PROVIDER_E2E_BROKER_CONTRACT_SHA256: PINS.brokerContractSha256,
    QKERN_PROVIDER_E2E_VAULT_POLICY_SHA256: PINS.vaultPolicySha256,
    QKERN_PROVIDER_E2E_PAGER_ROUTING_SHA256: PINS.pagerRoutingSha256,
    QKERN_PROVIDER_E2E_BACKUP_RESTORE_EVIDENCE_SHA256:
      PINS.backupRestoreEvidenceSha256,
    QKERN_PROVIDER_E2E_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256:
      PINS.runtimeDeploymentEvidenceSha256,
  };
}

describe("provider E2E evidence verification", () => {
  it("accepts only the fully bound signed real-service scenario set", async () => {
    const { verifier } = verifierFor();
    await expect(verifier.verify()).resolves.toEqual({
      status: "ready",
      deployment: "production",
      scope: "managed_postgresql_e2e",
      testRunCompletedAt: "2026-07-26T11:30:00.000Z",
      certifiedAt: "2026-07-26T11:35:00.000Z",
      testRunDurationSeconds: 3_600,
      postgresMajorVersion: 17,
      scenarioCount: 15,
      policy: PROVIDER_E2E_EVIDENCE_POLICY,
    });
    expect(JSON.stringify(await verifier.verify())).not.toMatch(
      /evidenceId|sha256|signature|publicKey|keyId|providerIdentity|pagerRouting/i,
    );
  });

  it("rejects tampering, key substitution and key-id mismatch", async () => {
    const valid = verifierFor();
    const tampered = {
      ...valid.signed,
      evidence: {
        ...valid.signed.evidence,
        testRunDurationSeconds: 3_601,
      },
    };
    await expect(new ProviderE2EEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(tampered))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);
    await expect(new ProviderE2EEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(valid.signed))),
      provider(valid.keys.keyFile),
      "8".repeat(64),
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);
    await expect(verifierFor(evidence(), { keyId: "other-key" }).verifier.verify())
      .rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);
  });

  it("rejects incomplete scenarios, extra fields and duplicate JSON keys", async () => {
    await expect(verifierFor(evidence({
      scenarios: {
        ...scenarios(),
        incidentPagerDeliveryVerified: false,
      },
    } as unknown as Partial<ProviderE2EEvidence>)).verifier.verify())
      .rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);

    const valid = verifierFor();
    const extra = {
      ...valid.signed,
      evidence: { ...valid.signed.evidence, providerResponse: "forbidden" },
    };
    await expect(new ProviderE2EEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(extra))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);

    const duplicate = JSON.stringify(valid.signed).replace(
      `"keyId":"${KEY_ID}"`,
      `"keyId":"${KEY_ID}","keyId":"${KEY_ID}"`,
    );
    await expect(new ProviderE2EEvidenceVerifier(
      provider(Buffer.from(duplicate)),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);
  });

  it("rejects stale, future, short, inconsistent and incorrectly pinned runs", async () => {
    const cases: ProviderE2EEvidence[] = [
      evidence({ certifiedAt: "2026-07-25T11:59:59.000Z" }),
      evidence({
        testRunStartedAt: "2026-07-26T11:51:00.000Z",
        testRunCompletedAt: "2026-07-26T12:01:00.000Z",
        certifiedAt: "2026-07-26T12:06:00.000Z",
        testRunDurationSeconds: 600,
      }),
      evidence({
        testRunStartedAt: "2026-07-26T11:20:01.000Z",
        testRunDurationSeconds: 599,
      }),
      evidence({ testRunDurationSeconds: 3_601 }),
      evidence({ certifiedAt: "2026-07-26T12:00:01.000Z" }),
      evidence({ providerIdentitySha256: "8".repeat(64) }),
      evidence({ backupRestoreEvidenceSha256: "8".repeat(64) }),
      evidence({ runtimeDeploymentEvidenceSha256: "8".repeat(64) }),
    ];
    for (const payload of cases) {
      await expect(verifierFor(payload).verifier.verify())
        .rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);
    }
  });
});

describe("provider E2E evidence file boundary", () => {
  itOnPosix("accepts protected regular files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-provider-e2e-"));
    tempDirectories.push(directory);
    const evidencePath = path.join(directory, "evidence.json");
    await writeFile(evidencePath, "{}", { mode: 0o644 });
    await expect(providerE2EEvidenceFileReader(evidencePath, true).read())
      .resolves.toEqual(Buffer.from("{}"));

    await chmod(evidencePath, 0o622);
    await expect(providerE2EEvidenceFileReader(evidencePath, true).read())
      .rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);

    await chmod(evidencePath, 0o644);
    const linkPath = path.join(directory, "evidence-link.json");
    await symlink(evidencePath, linkPath);
    await expect(providerE2EEvidenceFileReader(linkPath).read())
      .rejects.toBeInstanceOf(ProviderE2EEvidenceUnavailableError);

    expect(() => new ProviderE2EEvidenceFileReader("relative.json", 100))
      .toThrow("bounded absolute paths");
    expect(() => providerE2EVerifierKeyFileReader("relative-key.json"))
      .toThrow("bounded absolute paths");
  });
});

describe("provider E2E evidence runtime and CLI", () => {
  it("forbids inline values, authority reuse and ambiguous policy pins", () => {
    const keys = keyPair();
    const dependencies = {
      evidenceProvider: provider(Buffer.from("{}")),
      keyProvider: provider(keys.keyFile),
    };
    expect(() => createProviderE2EEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_PROVIDER_E2E_EVIDENCE: "{}",
      QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("Inline");
    expect(() => createProviderE2EEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_PROVIDER_E2E_EVIDENCE_FILE: "/run/qkern/shared",
      QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE: "/run/qkern/key",
      QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: keys.publicKeySha256,
      QKERN_BACKUP_RESTORE_EVIDENCE_FILE: "/run/qkern/shared",
    })).toThrow("cannot reuse");
    expect(() => createProviderE2EEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_PROVIDER_E2E_EVIDENCE_FILE: "/run/qkern/same",
      QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE: "/run/qkern/same",
      QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    })).toThrow("must be distinct");
    expect(() => createProviderE2EEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_PROVIDER_E2E_PROVIDER_CONFIG_SHA256:
        PINS.providerIdentitySha256,
      QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("seven distinct policy pins");
  });

  itOnPosix("runs the redacted machine-readable CLI and keeps failures cause-free", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-provider-cli-"));
    tempDirectories.push(directory);
    const keys = keyPair();
    const signed = envelope(evidence({
      testRunStartedAt: new Date(Date.now() - 70 * 60_000).toISOString(),
      testRunCompletedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      certifiedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    }), keys.privateKey);
    const evidencePath = path.join(directory, "evidence.json");
    const keyPath = path.join(directory, "key.json");
    await writeFile(evidencePath, JSON.stringify(signed), { mode: 0o600 });
    await writeFile(keyPath, keys.keyFile, { mode: 0o600 });
    const env = {
      ...process.env,
      ...runtimeEnv(),
      QKERN_PROVIDER_E2E_EVIDENCE_FILE: evidencePath,
      QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE: keyPath,
      QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    };
    const success = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-provider-e2e-evidence.ts"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(success.status).toBe(0);
    expect(JSON.parse(success.stdout).data.providerE2EEvidenceReadiness)
      .toMatchObject({ status: "ready", scenarioCount: 15 });
    expect(success.stdout).not.toContain(evidencePath);
    expect(success.stdout).not.toContain(PINS.providerIdentitySha256);

    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-provider-e2e-evidence.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...env,
          QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256: "8".repeat(64),
        },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Provider E2E evidence is not ready",
      code: "PROVIDER_E2E_EVIDENCE_NOT_READY",
    });
    expect(failure.stderr).not.toContain(evidencePath);
    expect(failure.stderr).not.toContain(keys.publicKeySha256);
  });
});
