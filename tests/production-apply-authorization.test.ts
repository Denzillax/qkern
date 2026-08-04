import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalProductionApplyAuthorizationPayload,
  ProductionApplyAuthorizationFileReader,
  ProductionApplyAuthorizationVerifier,
  ProductionApplyBlockedError,
  type ProductionApplyAuthorization,
  type ProductionApplyAuthorizationEnvelope,
  type ProductionApplyAuthorizationExpectation,
  type ProductionApplyAuthorizationFileProvider,
  type ProductionApplySubject,
} from "@/lib/server/migrations/production-apply-authorization";
import { createProductionApplyAuthorizerFromEnv } from
  "@/lib/server/migrations/production-apply-authorization-runtime";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const SUBJECT: ProductionApplySubject = {
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
  environment: "production",
  changeSetId: "9a973ec8-a409-4706-ad1d-ef6360ea430d",
  approvalId: "940cb242-32d6-41fd-b244-67d4913f7b91",
  databaseInstanceRef: "managed:database-1",
  statementSha256: "1".repeat(64),
  approvalActionHash: "2".repeat(64),
};
const EXPECTATION: ProductionApplyAuthorizationExpectation = {
  releaseArtifactSha256: "3".repeat(64),
  backupRestoreEvidenceSha256: "4".repeat(64),
  runtimeDeploymentEvidenceSha256: "5".repeat(64),
  providerE2EEvidenceSha256: "6".repeat(64),
  securityAssessmentSha256: "7".repeat(64),
};
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function provider(value: unknown): ProductionApplyAuthorizationFileProvider {
  return { read: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify(value), "utf8")) };
}

function fixture(overrides: Partial<ProductionApplyAuthorization> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  if (!publicJwk.x) throw new Error("Expected Ed25519 public key");
  const keyId = "release-authority-2026-07";
  const authorization: ProductionApplyAuthorization = {
    authorizationId: "6376892b-044b-4bda-a44b-8ec12d372608",
    deployment: "production",
    scope: "migration_apply",
    organizationId: SUBJECT.organizationId,
    projectId: SUBJECT.projectId,
    changeSetId: SUBJECT.changeSetId,
    approvalId: SUBJECT.approvalId,
    databaseInstanceRefSha256: createHash("sha256")
      .update(SUBJECT.databaseInstanceRef)
      .digest("hex"),
    statementSha256: SUBJECT.statementSha256,
    approvalActionHash: SUBJECT.approvalActionHash,
    ...EXPECTATION,
    issuedAt: "2026-07-26T11:55:00.000Z",
    expiresAt: "2026-07-26T13:00:00.000Z",
    assertions: {
      backupRestoreVerified: true,
      runtimeDeploymentVerified: true,
      realPostgresVerified: true,
      providerProvisioningVerified: true,
      vaultRotationVerified: true,
      applyBrokerDeliveryVerified: true,
      incidentPagerDeliveryVerified: true,
      crossTenantIsolationVerified: true,
      staleWorkerCancellationVerified: true,
      vulnerabilityPolicyPassed: true,
      penetrationTestPassed: true,
    },
    result: "passed",
    ...overrides,
  };
  const unsigned = {
    schemaVersion: "qkern.production-apply-authorization/v1" as const,
    keyId,
    authorization,
  };
  const envelope: ProductionApplyAuthorizationEnvelope = {
    ...unsigned,
    signature: sign(
      null,
      canonicalProductionApplyAuthorizationPayload(unsigned),
      privateKey,
    ).toString("base64url"),
  };
  const key = {
    schemaVersion: "qkern.production-apply-verifier-key/v1",
    keyId,
    publicKey: publicJwk.x,
  };
  return {
    envelope,
    key,
    publicKeySha256: createHash("sha256")
      .update(Buffer.from(publicJwk.x, "base64url"))
      .digest("hex"),
  };
}

function verifier(
  built = fixture(),
  authorizationProvider: ProductionApplyAuthorizationFileProvider = provider(built.envelope),
) {
  return new ProductionApplyAuthorizationVerifier(
    authorizationProvider,
    provider(built.key),
    built.publicKeySha256,
    EXPECTATION,
    () => new Date(NOW),
  );
}

describe("production apply authorization", () => {
  it("authorizes only the exact signed production subject and bypasses non-production", async () => {
    const built = fixture();
    const authorizationProvider = provider(built.envelope);
    const gate = verifier(built, authorizationProvider);

    await expect(gate.assertAuthorized(SUBJECT)).resolves.toBeUndefined();
    await expect(gate.assertAuthorized({
      ...SUBJECT,
      environment: "staging",
    })).resolves.toBeUndefined();
    expect(authorizationProvider.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["expired", { issuedAt: "2026-07-26T07:00:00.000Z", expiresAt: "2026-07-26T11:00:00.000Z" }],
    ["overlong", { issuedAt: "2026-07-26T11:00:00.000Z", expiresAt: "2026-07-26T16:00:00.000Z" }],
    ["future", { issuedAt: "2026-07-26T12:06:00.000Z", expiresAt: "2026-07-26T13:00:00.000Z" }],
    ["wrong release", { releaseArtifactSha256: "8".repeat(64) }],
  ])("rejects a correctly signed but %s authorization", async (_case, overrides) => {
    await expect(verifier(fixture(overrides)).assertAuthorized(SUBJECT))
      .rejects.toBeInstanceOf(ProductionApplyBlockedError);
  });

  it("rejects subject substitution, signature tampering and duplicate fields cause-free", async () => {
    const built = fixture();
    await expect(verifier(built).assertAuthorized({
      ...SUBJECT,
      changeSetId: "4d645389-7168-4944-a063-46b1a21d53d4",
    })).rejects.toEqual(new ProductionApplyBlockedError());

    const tampered = {
      ...built.envelope,
      authorization: {
        ...built.envelope.authorization,
        statementSha256: "9".repeat(64),
      },
    };
    await expect(verifier(built, provider(tampered)).assertAuthorized(SUBJECT))
      .rejects.toEqual(new ProductionApplyBlockedError());

    const duplicate = JSON.stringify(built.envelope).replace(
      '"result":"passed"',
      '"result":"passed","result":"passed"',
    );
    const duplicateProvider = {
      read: vi.fn().mockResolvedValue(Buffer.from(duplicate, "utf8")),
    };
    await expect(verifier(built, duplicateProvider).assertAuthorized(SUBJECT))
      .rejects.toEqual(new ProductionApplyBlockedError());
  });

  it("is disabled by default and rejects inline, reused or incomplete authority", async () => {
    const disabled = createProductionApplyAuthorizerFromEnv({});
    await expect(disabled.assertAuthorized(SUBJECT))
      .rejects.toBeInstanceOf(ProductionApplyBlockedError);

    expect(() => createProductionApplyAuthorizerFromEnv({
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_AUTHORIZATION: "{}",
    })).toThrow("Inline production apply authority is forbidden");
    expect(() => createProductionApplyAuthorizerFromEnv({
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE: "/run/qkern/shared",
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE: "/run/qkern/shared",
    })).toThrow("must be distinct");
    expect(() => createProductionApplyAuthorizerFromEnv({
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE: "/run/qkern/release.json",
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE: "/run/qkern/release-key.json",
    })).toThrow("five distinct release evidence pins");
  });

  it("composes the enabled verifier from separate file providers and exact pins", async () => {
    const built = fixture();
    const gate = createProductionApplyAuthorizerFromEnv({
      NODE_ENV: "production",
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE: "/run/qkern/release.json",
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE: "/run/qkern/release-key.json",
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_SHA256: built.publicKeySha256,
      QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256: EXPECTATION.releaseArtifactSha256,
      QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256:
        EXPECTATION.backupRestoreEvidenceSha256,
      QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256:
        EXPECTATION.runtimeDeploymentEvidenceSha256,
      QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256:
        EXPECTATION.providerE2EEvidenceSha256,
      QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256:
        EXPECTATION.securityAssessmentSha256,
    }, {
      authorizationProvider: provider(built.envelope),
      keyProvider: provider(built.key),
      now: () => new Date(NOW),
    });

    await expect(gate.assertAuthorized(SUBJECT)).resolves.toBeUndefined();
  });

  it("accepts protected regular files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-production-apply-"));
    tempDirectories.push(directory);
    const authorizationPath = path.join(directory, "authorization.json");
    await writeFile(authorizationPath, "{}", { mode: 0o600 });
    await expect(new ProductionApplyAuthorizationFileReader(
      authorizationPath,
      1_024,
      true,
    ).read()).resolves.toBeInstanceOf(Buffer);

    await chmod(authorizationPath, 0o622);
    await expect(new ProductionApplyAuthorizationFileReader(
      authorizationPath,
      1_024,
      true,
    ).read()).rejects.toBeInstanceOf(ProductionApplyBlockedError);

    await chmod(authorizationPath, 0o600);
    const linkPath = path.join(directory, "authorization-link.json");
    await symlink(authorizationPath, linkPath);
    await expect(new ProductionApplyAuthorizationFileReader(linkPath, 1_024).read())
      .rejects.toBeInstanceOf(ProductionApplyBlockedError);
    expect(() => new ProductionApplyAuthorizationFileReader("authorization.json", 1_024))
      .toThrow("absolute paths");
  });

  it("provides a cause-free exact-subject preflight CLI", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-production-apply-cli-"));
    tempDirectories.push(directory);
    const actualNow = Date.now();
    const built = fixture({
      issuedAt: new Date(actualNow - 5 * 60_000).toISOString(),
      expiresAt: new Date(actualNow + 60 * 60_000).toISOString(),
    });
    const authorizationPath = path.join(directory, "authorization.json");
    const keyPath = path.join(directory, "key.json");
    await Promise.all([
      writeFile(authorizationPath, JSON.stringify(built.envelope), { mode: 0o600 }),
      writeFile(keyPath, JSON.stringify(built.key), { mode: 0o600 }),
    ]);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE: authorizationPath,
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE: keyPath,
      QKERN_PRODUCTION_APPLY_VERIFIER_KEY_SHA256: built.publicKeySha256,
      QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256: EXPECTATION.releaseArtifactSha256,
      QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256:
        EXPECTATION.backupRestoreEvidenceSha256,
      QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256:
        EXPECTATION.runtimeDeploymentEvidenceSha256,
      QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256:
        EXPECTATION.providerE2EEvidenceSha256,
      QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256:
        EXPECTATION.securityAssessmentSha256,
      QKERN_PRODUCTION_APPLY_SUBJECT_ORGANIZATION_ID: SUBJECT.organizationId,
      QKERN_PRODUCTION_APPLY_SUBJECT_PROJECT_ID: SUBJECT.projectId,
      QKERN_PRODUCTION_APPLY_SUBJECT_CHANGE_SET_ID: SUBJECT.changeSetId,
      QKERN_PRODUCTION_APPLY_SUBJECT_APPROVAL_ID: SUBJECT.approvalId,
      QKERN_PRODUCTION_APPLY_SUBJECT_DATABASE_INSTANCE_REF: SUBJECT.databaseInstanceRef,
      QKERN_PRODUCTION_APPLY_SUBJECT_STATEMENT_SHA256: SUBJECT.statementSha256,
      QKERN_PRODUCTION_APPLY_SUBJECT_APPROVAL_ACTION_HASH: SUBJECT.approvalActionHash,
    };
    const success = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-production-apply-authorization.ts"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(success.status, success.stderr).toBe(0);
    expect(success.stderr).toBe("");
    expect(JSON.parse(success.stdout)).toEqual({
      data: {
        productionApplyAuthorization: {
          status: "authorized",
          deployment: "production",
          scope: "migration_apply",
        },
      },
    });

    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-production-apply-authorization.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...env,
          QKERN_PRODUCTION_APPLY_SUBJECT_CHANGE_SET_ID:
            "4d645389-7168-4944-a063-46b1a21d53d4",
        },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Production apply is not authorized",
      code: "PRODUCTION_APPLY_BLOCKED",
    });
    expect(failure.stderr).not.toContain(SUBJECT.organizationId);
    expect(failure.stderr).not.toContain(authorizationPath);
  });
});
