import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itOnPosix } from "./support/posix";
import {
  ReleaseEvidenceFileDigester,
  ReleaseEvidenceNotReadyError,
  ReleaseEvidenceVerifier,
  releaseArtifactFileDigester,
  releaseEvidenceFileDigester,
  type ReleaseEvidenceComponentVerifier,
  type ReleaseEvidenceDigestProvider,
} from "@/lib/server/operations/release-evidence-readiness";
import { createReleaseEvidenceVerifierFromEnv } from
  "@/lib/server/operations/release-evidence-readiness-runtime";

const PINS = [
  "1".repeat(64),
  "2".repeat(64),
  "3".repeat(64),
  "4".repeat(64),
  "5".repeat(64),
] as const;
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function verifier(result: unknown = { status: "ready" }):
ReleaseEvidenceComponentVerifier {
  return { verify: vi.fn(async () => result) };
}

function digester(result: string): ReleaseEvidenceDigestProvider {
  return { digest: vi.fn(async () => result) };
}

function expectation() {
  return {
    releaseArtifactSha256: PINS[0],
    backupRestoreEvidenceSha256: PINS[1],
    runtimeDeploymentEvidenceSha256: PINS[2],
    providerE2EEvidenceSha256: PINS[3],
    securityAssessmentSha256: PINS[4],
  };
}

function runtimeEnv(): Record<string, string> {
  return {
    QKERN_RELEASE_ARTIFACT_FILE: "/secure/qkern-release.zip",
    QKERN_BACKUP_RESTORE_EVIDENCE_FILE: "/run/qkern/backup.json",
    QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE: "/run/qkern/backup-key.json",
    QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE: "/run/qkern/deployment.json",
    QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE:
      "/run/qkern/deployment-key.json",
    QKERN_PROVIDER_E2E_EVIDENCE_FILE: "/run/qkern/provider.json",
    QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE: "/run/qkern/provider-key.json",
    QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE: "/run/qkern/security.json",
    QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE:
      "/run/qkern/security-key.json",
    QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256: PINS[0],
    QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256: PINS[1],
    QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256: PINS[2],
    QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256: PINS[3],
    QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256: PINS[4],
  };
}

describe("combined release evidence readiness", () => {
  it("requires all four signed gates and all five exact file digests", async () => {
    const verifiers = [verifier(), verifier(), verifier(), verifier()];
    const digesters = PINS.map((pin) => digester(pin));
    const releaseVerifier = new ReleaseEvidenceVerifier(
      verifiers,
      digesters,
      expectation(),
    );
    await expect(releaseVerifier.verify()).resolves.toEqual({
      status: "ready",
      deployment: "production",
      scope: "release_evidence",
      evidenceCount: 4,
      artifactCount: 5,
    });
    for (const component of verifiers) {
      expect(component.verify).toHaveBeenCalledOnce();
    }
    for (const digestProvider of digesters) {
      expect(digestProvider.digest).toHaveBeenCalledOnce();
    }
  });

  it("fails cause-free on a component failure, digest mismatch or cancellation", async () => {
    const failedVerifier = verifier();
    vi.mocked(failedVerifier.verify).mockRejectedValueOnce(new Error("secret cause"));
    await expect(new ReleaseEvidenceVerifier(
      [failedVerifier, verifier(), verifier(), verifier()],
      PINS.map((pin) => digester(pin)),
      expectation(),
    ).verify()).rejects.toEqual(new ReleaseEvidenceNotReadyError());

    await expect(new ReleaseEvidenceVerifier(
      [verifier(), verifier(), verifier(), verifier()],
      PINS.map((pin, index) => digester(index === 4 ? "9".repeat(64) : pin)),
      expectation(),
    ).verify()).rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);

    const controller = new AbortController();
    controller.abort();
    await expect(new ReleaseEvidenceVerifier(
      [verifier(), verifier(), verifier(), verifier()],
      PINS.map((pin) => digester(pin)),
      expectation(),
    ).verify(controller.signal)).rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);
  });

  it("rejects missing, ambiguous or malformed component contracts", () => {
    expect(() => new ReleaseEvidenceVerifier(
      [verifier(), verifier(), verifier()],
      PINS.map((pin) => digester(pin)),
      expectation(),
    )).toThrow("four verifiers");
    expect(() => new ReleaseEvidenceVerifier(
      [verifier(), verifier(), verifier(), verifier()],
      PINS.slice(0, 4).map((pin) => digester(pin)),
      expectation(),
    )).toThrow("five digest providers");
    expect(() => new ReleaseEvidenceVerifier(
      [verifier(), verifier(), verifier(), verifier()],
      PINS.map((pin) => digester(pin)),
      { ...expectation(), securityAssessmentSha256: PINS[0] },
    )).toThrow("five distinct");
  });
});

describe("release evidence file and runtime boundaries", () => {
  itOnPosix("hashes regular no-follow files and rejects mutable files, links and aborts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-release-evidence-"));
    tempDirectories.push(directory);
    const releasePath = path.join(directory, "release.zip");
    await writeFile(releasePath, "release-artifact", { mode: 0o644 });
    await expect(releaseArtifactFileDigester(releasePath, true).digest())
      .resolves.toBe(
        createHash("sha256").update("release-artifact").digest("hex"),
      );

    await chmod(releasePath, 0o622);
    await expect(releaseEvidenceFileDigester(releasePath, true).digest())
      .rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);
    await chmod(releasePath, 0o644);
    const linkPath = path.join(directory, "release-link.zip");
    await symlink(releasePath, linkPath);
    await expect(releaseArtifactFileDigester(linkPath).digest())
      .rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);
    expect(() => new ReleaseEvidenceFileDigester("relative.zip", 100))
      .toThrow("bounded absolute paths");
    await expect(new ReleaseEvidenceFileDigester(releasePath, 3).digest())
      .rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);

    const controller = new AbortController();
    controller.abort();
    await expect(releaseArtifactFileDigester(releasePath).digest({
      signal: controller.signal,
    })).rejects.toBeInstanceOf(ReleaseEvidenceNotReadyError);
  });

  it("composes injected gates and rejects every protected path collision", async () => {
    const componentVerifiers = [verifier(), verifier(), verifier(), verifier()];
    const digestProviders = PINS.map((pin) => digester(pin));
    await expect(createReleaseEvidenceVerifierFromEnv(runtimeEnv(), {
      componentVerifiers,
      digestProviders,
    }).verify()).resolves.toMatchObject({
      status: "ready",
      evidenceCount: 4,
      artifactCount: 5,
    });
    expect(() => createReleaseEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_PROVISIONING_METRICS_TOKEN_FILE: "/run/qkern/security.json",
    }, {
      componentVerifiers,
      digestProviders,
    })).toThrow("distinct artifact, evidence, key and authority paths");
    expect(() => createReleaseEvidenceVerifierFromEnv({
      ...runtimeEnv(),
      QKERN_RELEASE_ARTIFACT_FILE: "/run/qkern/backup-key.json",
    }, {
      componentVerifiers,
      digestProviders,
    })).toThrow("distinct artifact, evidence, key and authority paths");
  });

  it("returns one fixed cause-free CLI failure without exposing paths or pins", () => {
    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-release-evidence-readiness.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...runtimeEnv() },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Release evidence is not ready",
      code: "RELEASE_EVIDENCE_NOT_READY",
    });
    expect(failure.stderr).not.toContain("/secure/qkern-release.zip");
    expect(failure.stderr).not.toContain(PINS[0]);
  });
});
