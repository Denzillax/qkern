import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itOnPosix } from "./support/posix";
import {
  BACKUP_RESTORE_EVIDENCE_POLICY,
  BackupRestoreEvidenceFileReader,
  BackupRestoreEvidenceUnavailableError,
  BackupRestoreEvidenceVerifier,
  backupRestoreEvidenceFileReader,
  backupRestoreVerifierKeyFileReader,
  canonicalBackupRestoreEvidencePayload,
  type BackupRestoreEvidence,
  type BackupRestoreEvidenceEnvelope,
  type BackupRestoreEvidenceFileProvider,
} from "@/lib/server/backup/restore-evidence";
import { createBackupRestoreEvidenceVerifierFromEnv } from
  "@/lib/server/backup/restore-evidence-runtime";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const KEY_ID = "restore-verifier-2026-07";
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function evidence(overrides: Partial<BackupRestoreEvidence> = {}): BackupRestoreEvidence {
  return {
    evidenceId: "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
    deployment: "production",
    scope: "control_plane",
    backupSnapshotAt: "2026-07-26T10:00:00.000Z",
    backupCompletedAt: "2026-07-26T10:05:00.000Z",
    restoreStartedAt: "2026-07-26T10:10:00.000Z",
    restoreCompletedAt: "2026-07-26T10:30:00.000Z",
    verifiedAt: "2026-07-26T10:40:00.000Z",
    recoveryPointLagSeconds: 300,
    restoreDurationSeconds: 1_200,
    backupArtifactSha256: "a".repeat(64),
    sourceDataManifestSha256: "b".repeat(64),
    restoredDataManifestSha256: "b".repeat(64),
    encrypted: true,
    checksumVerified: true,
    schemaVerified: true,
    rowCountsVerified: true,
    auditChainVerified: true,
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
    publicKeySha256: createHash("sha256").update(Buffer.from(jwk.x, "base64url")).digest("hex"),
    keyFile: Buffer.from(JSON.stringify({
      schemaVersion: "qkern.backup-restore-verifier-key/v1",
      keyId: KEY_ID,
      publicKey: jwk.x,
    })),
  };
}

function envelope(
  payload: BackupRestoreEvidence,
  privateKey: KeyObject,
  keyId = KEY_ID,
): BackupRestoreEvidenceEnvelope {
  const unsigned = {
    schemaVersion: "qkern.backup-restore-evidence/v1" as const,
    keyId,
    evidence: payload,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      canonicalBackupRestoreEvidencePayload(unsigned),
      privateKey,
    ).toString("base64url"),
  };
}

function provider(value: Uint8Array): BackupRestoreEvidenceFileProvider {
  return { read: vi.fn(async () => Uint8Array.from(value)) };
}

function verifierFor(
  payload: BackupRestoreEvidence = evidence(),
  options: { now?: Date; keyId?: string } = {},
) {
  const keys = keyPair();
  const signed = envelope(payload, keys.privateKey, options.keyId);
  return {
    keys,
    signed,
    verifier: new BackupRestoreEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(signed))),
      provider(keys.keyFile),
      keys.publicKeySha256,
      () => options.now ?? NOW,
    ),
  };
}

describe("backup/restore evidence verification", () => {
  it("accepts a fresh signed restore drill and returns only a bounded readiness projection", async () => {
    const { verifier } = verifierFor();
    await expect(verifier.verify()).resolves.toEqual({
      status: "ready",
      evidenceId: "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
      deployment: "production",
      scope: "control_plane",
      backupSnapshotAt: "2026-07-26T10:00:00.000Z",
      verifiedAt: "2026-07-26T10:40:00.000Z",
      recoveryPointLagSeconds: 300,
      restoreDurationSeconds: 1_200,
      policy: BACKUP_RESTORE_EVIDENCE_POLICY,
    });
    const result = await verifier.verify();
    expect(JSON.stringify(result)).not.toMatch(
      /artifact|manifest|signature|publicKey|keyId|file|secret|credential/i,
    );
  });

  it("rejects tampering, an unpinned key and a mismatched key id", async () => {
    const valid = verifierFor();
    const tampered = {
      ...valid.signed,
      evidence: {
        ...valid.signed.evidence,
        restoreDurationSeconds: 1_201,
      },
    };
    await expect(new BackupRestoreEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(tampered))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    await expect(new BackupRestoreEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(valid.signed))),
      provider(valid.keys.keyFile),
      "c".repeat(64),
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    const mismatch = verifierFor(evidence(), { keyId: "other-key" });
    await expect(mismatch.verifier.verify())
      .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);
  });

  it("rejects unknown fields and incomplete verification assertions", async () => {
    const valid = verifierFor();
    const withExtraField = {
      ...valid.signed,
      evidence: { ...valid.signed.evidence, providerResponse: "should-not-be-accepted" },
    };
    await expect(new BackupRestoreEvidenceVerifier(
      provider(Buffer.from(JSON.stringify(withExtraField))),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    const incomplete = verifierFor({
      ...evidence(),
      auditChainVerified: false,
    } as unknown as BackupRestoreEvidence);
    await expect(incomplete.verifier.verify())
      .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    const duplicateKeyJson = JSON.stringify(valid.signed).replace(
      '"keyId":"restore-verifier-2026-07"',
      '"keyId":"restore-verifier-2026-07","keyId":"restore-verifier-2026-07"',
    );
    await expect(new BackupRestoreEvidenceVerifier(
      provider(Buffer.from(duplicateKeyJson)),
      provider(valid.keys.keyFile),
      valid.keys.publicKeySha256,
      () => NOW,
    ).verify()).rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);
  });

  it("rejects stale, future, inconsistent and policy-breaking evidence even when signed", async () => {
    const cases: BackupRestoreEvidence[] = [
      evidence({ verifiedAt: "2026-07-18T10:40:00.000Z" }),
      evidence({
        backupSnapshotAt: "2026-07-26T12:01:00.000Z",
        backupCompletedAt: "2026-07-26T12:02:00.000Z",
        restoreStartedAt: "2026-07-26T12:03:00.000Z",
        restoreCompletedAt: "2026-07-26T12:04:00.000Z",
        verifiedAt: "2026-07-26T12:06:00.000Z",
        recoveryPointLagSeconds: 60,
        restoreDurationSeconds: 60,
      }),
      evidence({ recoveryPointLagSeconds: 301 }),
      evidence({
        restoreCompletedAt: "2026-07-26T09:30:00.000Z",
      }),
      evidence({
        restoredDataManifestSha256: "c".repeat(64),
      }),
      evidence({
        backupSnapshotAt: "2026-07-25T09:59:59.000Z",
        recoveryPointLagSeconds: 86_701,
      }),
      evidence({
        restoreCompletedAt: "2026-07-26T14:10:01.000Z",
        verifiedAt: "2026-07-26T14:11:00.000Z",
        restoreDurationSeconds: 14_401,
      }),
    ];
    for (const invalid of cases) {
      await expect(verifierFor(invalid).verifier.verify())
        .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);
    }
  });
});

describe("backup/restore evidence file boundary", () => {
  itOnPosix("accepts regular integrity-protected files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-restore-evidence-"));
    tempDirectories.push(directory);
    const evidencePath = path.join(directory, "evidence.json");
    await writeFile(evidencePath, "{}", { mode: 0o644 });
    await expect(backupRestoreEvidenceFileReader(evidencePath, true).read())
      .resolves.toEqual(Buffer.from("{}"));

    await chmod(evidencePath, 0o622);
    await expect(backupRestoreEvidenceFileReader(evidencePath, true).read())
      .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    await chmod(evidencePath, 0o644);
    const linkPath = path.join(directory, "evidence-link.json");
    await symlink(evidencePath, linkPath);
    await expect(backupRestoreEvidenceFileReader(linkPath).read())
      .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);

    expect(() => new BackupRestoreEvidenceFileReader("relative.json", 100))
      .toThrow("bounded absolute paths");
  });
});

describe("backup/restore evidence runtime and CLI", () => {
  it("forbids inline values and reuse of any existing authority file", () => {
    const keys = keyPair();
    const dependencies = {
      evidenceProvider: provider(Buffer.from("{}")),
      keyProvider: provider(keys.keyFile),
    };
    expect(() => createBackupRestoreEvidenceVerifierFromEnv({
      QKERN_BACKUP_RESTORE_EVIDENCE: "{}",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    }, dependencies)).toThrow("Inline");
    expect(() => createBackupRestoreEvidenceVerifierFromEnv({
      QKERN_BACKUP_RESTORE_EVIDENCE_FILE: "/run/qkern/shared",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE: "/run/qkern/key",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: keys.publicKeySha256,
      QKERN_VAULT_TOKEN_FILE: "/run/qkern/shared",
    })).toThrow("cannot reuse");
    expect(() => createBackupRestoreEvidenceVerifierFromEnv({
      QKERN_BACKUP_RESTORE_EVIDENCE_FILE: "/run/qkern/same",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE: "/run/qkern/same",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    })).toThrow("must be distinct");
  });

  itOnPosix("runs the machine-readable verifier and keeps failures cause-free", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-restore-cli-"));
    tempDirectories.push(directory);
    const keys = keyPair();
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const signed = envelope(evidence({
      backupSnapshotAt: new Date(now - 40 * 60_000).toISOString(),
      backupCompletedAt: new Date(now - 35 * 60_000).toISOString(),
      restoreStartedAt: new Date(now - 30 * 60_000).toISOString(),
      restoreCompletedAt: new Date(now - 10 * 60_000).toISOString(),
      verifiedAt: new Date(now - 5 * 60_000).toISOString(),
    }), keys.privateKey);
    const evidencePath = path.join(directory, "evidence.json");
    const keyPath = path.join(directory, "key.json");
    await writeFile(evidencePath, JSON.stringify(signed), { mode: 0o600 });
    await writeFile(keyPath, keys.keyFile, { mode: 0o644 });

    const baseEnv = {
      ...process.env,
      QKERN_BACKUP_RESTORE_EVIDENCE_FILE: evidencePath,
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE: keyPath,
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: keys.publicKeySha256,
    };
    const success = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-backup-restore-evidence.ts"],
      { cwd: process.cwd(), env: baseEnv, encoding: "utf8" },
    );
    expect(success.status, success.stderr).toBe(0);
    const body = JSON.parse(success.stdout);
    expect(body.data.backupRestoreReadiness).toMatchObject({
      status: "ready",
      scope: "control_plane",
    });
    expect(success.stderr).toBe("");

    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-backup-restore-evidence.ts"],
      {
        cwd: process.cwd(),
        env: { ...baseEnv, QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: "d".repeat(64) },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Backup/restore evidence is not ready",
      code: "BACKUP_RESTORE_EVIDENCE_NOT_READY",
    });
    expect(failure.stderr).not.toContain(evidencePath);
    expect(failure.stderr).not.toContain(keys.publicKeyBase64Url);
  });
});
