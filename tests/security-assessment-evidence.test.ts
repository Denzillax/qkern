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
  SECURITY_ASSESSMENT_EVIDENCE_POLICY,
  SecurityAssessmentEvidenceFileReader,
  SecurityAssessmentEvidenceUnavailableError,
  SecurityAssessmentEvidenceVerifier,
  canonicalSecurityAssessmentEvidencePayload,
  securityAssessmentEvidenceFileReader,
  securityAssessmentVerifierKeyFileReader,
  type SecurityAssessmentChecks,
  type SecurityAssessmentEvidence,
  type SecurityAssessmentEvidenceEnvelope,
  type SecurityAssessmentEvidenceFileProvider,
} from "@/lib/server/security/security-assessment-evidence";
import { createSecurityAssessmentEvidenceVerifierFromEnv } from
  "@/lib/server/security/security-assessment-evidence-runtime";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const KEY_ID = "independent-security-assessor-2026-07";
const PINS = {
  releaseArtifactSha256: "1".repeat(64),
  sbomSha256: "2".repeat(64),
  dependencyAuditSha256: "3".repeat(64),
  sastReportSha256: "4".repeat(64),
  dastReportSha256: "5".repeat(64),
  secretScanReportSha256: "6".repeat(64),
  crossTenantReportSha256: "7".repeat(64),
  penetrationTestReportSha256: "8".repeat(64),
};
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function checks(): SecurityAssessmentChecks {
  return {
    threatModelReviewed: true,
    dependencyAuditPassed: true,
    sastPassed: true,
    dastPassed: true,
    secretScanPassed: true,
    crossTenantIsolationPassed: true,
    restAuthorizationPassed: true,
    mcpAuthorizationPassed: true,
    mcpPromptInjectionPassed: true,
    ssrfEgressPassed: true,
    approvalRacePassed: true,
    backupIsolationPassed: true,
    sessionAndTokenSecurityPassed: true,
    penetrationTestPassed: true,
  };
}

function evidence(
  overrides: Partial<SecurityAssessmentEvidence> = {},
): SecurityAssessmentEvidence {
  return {
    evidenceId: "6d0f4328-3c8c-49e8-8b45-32f3458c7b79",
    deployment: "production",
    scope: "release_security",
    ...PINS,
    assessmentStartedAt: "2026-07-25T10:00:00.000Z",
    assessmentCompletedAt: "2026-07-26T10:00:00.000Z",
    certifiedAt: "2026-07-26T11:00:00.000Z",
    assessmentDurationSeconds: 86_400,
    assessmentCount: 14,
    unresolvedCriticalFindings: 0,
    unresolvedHighFindings: 0,
    checks: checks(),
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
      schemaVersion: "qkern.security-assessment-verifier-key/v1",
      keyId: KEY_ID,
      publicKey: jwk.x,
    })),
  };
}

function envelope(
  payload: SecurityAssessmentEvidence,
  privateKey: KeyObject,
  keyId = KEY_ID,
): SecurityAssessmentEvidenceEnvelope {
  const unsigned = {
    schemaVersion: "qkern.security-assessment-evidence/v1" as const,
    keyId,
    evidence: payload,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      canonicalSecurityAssessmentEvidencePayload(unsigned),
      privateKey,
    ).toString("base64url"),
  };
}

function provider(value: Uint8Array): SecurityAssessmentEvidenceFileProvider {
  return { read: vi.fn(async () => Uint8Array.from(value)) };
}

function verifierFor(
  payload: SecurityAssessmentEvidence = evidence(),
  options: { keyId?: string; now?: Date } = {},
) {
  const keys = keyPair();
  const signed = envelope(payload, keys.privateKey, options.keyId);
  return {
    keys,
    signed,
    verifier: new SecurityAssessmentEvidenceVerifier(
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
    QKERN_SECURITY_ASSESSMENT_RELEASE_ARTIFACT_SHA256:
      PINS.releaseArtifactSha256,
    QKERN_SECURITY_ASSESSMENT_SBOM_SHA256: PINS.sbomSha256,
    QKERN_SECURITY_ASSESSMENT_DEPENDENCY_AUDIT_SHA256:
      PINS.dependencyAuditSha256,
    QKERN_SECURITY_ASSESSMENT_SAST_REPORT_SHA256: PINS.sastReportSha256,
    QKERN_SECURITY_ASSESSMENT_DAST_REPORT_SHA256: PINS.dastReportSha256,
    QKERN_SECURITY_ASSESSMENT_SECRET_SCAN_REPORT_SHA256:
      PINS.secretScanReportSha256,
    QKERN_SECURITY_ASSESSMENT_CROSS_TENANT_REPORT_SHA256:
      PINS.crossTenantReportSha256,
    QKERN_SECURITY_ASSESSMENT_PENTEST_REPORT_SHA256:
      PINS.penetrationTestReportSha256,
  };
}

describe("security assessment evidence verification", () => {
  it("accepts only a fresh, fully bound independent certification", async () => {
    const { verifier } = verifierFor();
    await expect(verifier.verify()).resolves.toEqual({
      status: "ready",
      deployment: "production",
      scope: "release_security",
      assessmentCompletedAt: "2026-07-26T10:00:00.000Z",
      certifiedAt: "2026-07-26T11:00:00.000Z",
      assessmentDurationSeconds: 86_400,
      assessmentCount: 14,
      unresolvedCriticalFindings: 0,
      unresolvedHighFindings: 0,
      policy: SECURITY_ASSESSMENT_EVIDENCE_POLICY,
    });
    expect(JSON.stringify(await verifier.verify())).not.toMatch(
      /evidenceId|sha256|signature|publicKey|keyId|penetrationTest/i,
    );
  });

  it("rejects tampering, key substitution and key-id mismatch", async () => {
    const valid = verifierFor();
    const tampered = {
      ...valid.signed,
      evidence: {
        ...valid.signed.evidence,
        assessmentDurationSeconds: 86_401,
      },
    };
    await expect(new SecurityAssessmentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(tampered))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    await expect(new SecurityAssessmentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(valid.signed))),
      provider(valid.keys.keyFile),
      "9".repeat(64),
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    await expect(verifierFor(evidence(), { keyId: "other-key" }).verifier.verify())
      .rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
  });

  it("rejects incomplete controls, findings, extra and duplicate fields", async () => {
    const invalidCases = [
      evidence({
        checks: { ...checks(), penetrationTestPassed: false } as
          unknown as SecurityAssessmentChecks,
      }),
      evidence({ unresolvedCriticalFindings: 1 } as
        unknown as Partial<SecurityAssessmentEvidence>),
      evidence({ unresolvedHighFindings: 1 } as
        unknown as Partial<SecurityAssessmentEvidence>),
    ];
    for (const payload of invalidCases) {
      await expect(verifierFor(payload).verifier.verify())
        .rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    }

    const valid = verifierFor();
    const extra = {
      ...valid.signed,
      evidence: { ...valid.signed.evidence, assessorNotes: "forbidden" },
    };
    await expect(new SecurityAssessmentEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(extra))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    const duplicate = JSON.stringify(valid.signed).replace(
      `"keyId":"${KEY_ID}"`,
      `"keyId":"${KEY_ID}","keyId":"${KEY_ID}"`,
    );
    await expect(new SecurityAssessmentEvidenceVerifier(
      provider(Buffer.from(duplicate)),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      PINS,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
  });

  it("rejects stale, future, short, inconsistent and incorrectly pinned assessments", async () => {
    const invalidCases = [
      evidence({ certifiedAt: "2026-07-20T11:59:59.000Z" }),
      evidence({ certifiedAt: "2026-07-27T12:05:01.000Z" }),
      evidence({
        assessmentStartedAt: "2026-07-26T09:00:01.000Z",
        assessmentDurationSeconds: 3_599,
      }),
      evidence({ assessmentDurationSeconds: 86_401 }),
      evidence({ certifiedAt: "2026-07-27T11:00:01.000Z" }),
      evidence({ releaseArtifactSha256: "9".repeat(64) }),
      evidence({ penetrationTestReportSha256: "9".repeat(64) }),
    ];
    for (const payload of invalidCases) {
      await expect(verifierFor(payload).verifier.verify())
        .rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    }
  });
});

describe("security assessment file, runtime and CLI boundaries", () => {
  itOnPosix("accepts protected files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-security-evidence-"));
    tempDirectories.push(directory);
    const evidencePath = path.join(directory, "evidence.json");
    await writeFile(evidencePath, "{}", { mode: 0o644 });
    await expect(securityAssessmentEvidenceFileReader(evidencePath, true).read())
      .resolves.toEqual(Buffer.from("{}"));
    await chmod(evidencePath, 0o622);
    await expect(securityAssessmentEvidenceFileReader(evidencePath, true).read())
      .rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    await chmod(evidencePath, 0o644);
    const linkPath = path.join(directory, "evidence-link.json");
    await symlink(evidencePath, linkPath);
    await expect(securityAssessmentEvidenceFileReader(linkPath).read())
      .rejects.toBeInstanceOf(SecurityAssessmentEvidenceUnavailableError);
    expect(() => new SecurityAssessmentEvidenceFileReader("relative.json", 100))
      .toThrow("bounded absolute paths");
    expect(() => securityAssessmentVerifierKeyFileReader("relative-key.json"))
      .toThrow("bounded absolute paths");
  });

  it("forbids inline values, authority reuse, ambiguous pins and release mismatch", () => {
    const keys = keyPair();
    const dependencies = {
      evidenceProvider: provider(Buffer.from("{}")),
      keyProvider: provider(keys.keyFile),
    };
    expect(() => createSecurityAssessmentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_EVIDENCE: "{}",
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("Inline");
    expect(() => createSecurityAssessmentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE: "/run/qkern/shared",
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE: "/run/qkern/key",
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
      QKERN_PROVIDER_E2E_EVIDENCE_FILE: "/run/qkern/shared",
    })).toThrow("cannot reuse");
    expect(() => createSecurityAssessmentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE: "/run/qkern/same",
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE: "/run/qkern/same",
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    })).toThrow("must be distinct");
    expect(() => createSecurityAssessmentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_SBOM_SHA256: PINS.releaseArtifactSha256,
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("eight distinct artifact pins");
    expect(() => createSecurityAssessmentEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
      QKERN_PRODUCTION_APPLY_ENABLED: "true",
      QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256: "9".repeat(64),
    }, dependencies)).toThrow("same release artifact");
  });

  itOnPosix("runs a redacted CLI and returns a fixed cause-free failure", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-security-cli-"));
    tempDirectories.push(directory);
    const keys = keyPair();
    const completedAt = new Date(Date.now() - 10 * 60_000);
    const signed = envelope(evidence({
      assessmentStartedAt:
        new Date(completedAt.getTime() - 60 * 60_000).toISOString(),
      assessmentCompletedAt: completedAt.toISOString(),
      certifiedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      assessmentDurationSeconds: 3_600,
    }), keys.privateKey);
    const evidencePath = path.join(directory, "evidence.json");
    const keyPath = path.join(directory, "key.json");
    await writeFile(evidencePath, JSON.stringify(signed), { mode: 0o600 });
    await writeFile(keyPath, keys.keyFile, { mode: 0o600 });
    const env = {
      ...process.env,
      ...runtimeEnv(),
      QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE: evidencePath,
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE: keyPath,
      QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    };
    const success = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-security-assessment-evidence.ts"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(success.status).toBe(0);
    expect(JSON.parse(success.stdout).data.securityAssessmentEvidenceReadiness)
      .toMatchObject({ status: "ready", assessmentCount: 14 });
    expect(success.stdout).not.toContain(evidencePath);
    expect(success.stdout).not.toContain(PINS.releaseArtifactSha256);

    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-security-assessment-evidence.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...env,
          QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256: "9".repeat(64),
        },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Security assessment evidence is not ready",
      code: "SECURITY_ASSESSMENT_EVIDENCE_NOT_READY",
    });
    expect(failure.stderr).not.toContain(evidencePath);
    expect(failure.stderr).not.toContain(keys.publicKeySha256);
  });
});
