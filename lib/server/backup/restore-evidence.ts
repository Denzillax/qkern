import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";

const EVIDENCE_SCHEMA = "qkern.backup-restore-evidence/v1" as const;
const KEY_SCHEMA = "qkern.backup-restore-verifier-key/v1" as const;
const SCOPE = "control_plane" as const;
const DEPLOYMENT = "production" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIN_FILE_BYTES = 2;
const MAX_EVIDENCE_FILE_BYTES = 16_384;
const MAX_KEY_FILE_BYTES = 1_024;

export const BACKUP_RESTORE_EVIDENCE_POLICY = Object.freeze({
  evidenceMaxAgeSeconds: 7 * 24 * 60 * 60,
  backupSnapshotMaxAgeAtVerificationSeconds: 24 * 60 * 60,
  recoveryPointLagMaxSeconds: 24 * 60 * 60,
  restoreDurationMaxSeconds: 4 * 60 * 60,
  futureClockSkewSeconds: 5 * 60,
});

export type BackupRestoreEvidence = Readonly<{
  evidenceId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  backupSnapshotAt: string;
  backupCompletedAt: string;
  restoreStartedAt: string;
  restoreCompletedAt: string;
  verifiedAt: string;
  recoveryPointLagSeconds: number;
  restoreDurationSeconds: number;
  backupArtifactSha256: string;
  sourceDataManifestSha256: string;
  restoredDataManifestSha256: string;
  encrypted: true;
  checksumVerified: true;
  schemaVerified: true;
  rowCountsVerified: true;
  auditChainVerified: true;
  result: "passed";
}>;

export type BackupRestoreEvidenceEnvelope = Readonly<{
  schemaVersion: typeof EVIDENCE_SCHEMA;
  keyId: string;
  evidence: BackupRestoreEvidence;
  signature: string;
}>;

export type BackupRestoreReadiness = Readonly<{
  status: "ready";
  evidenceId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  backupSnapshotAt: string;
  verifiedAt: string;
  recoveryPointLagSeconds: number;
  restoreDurationSeconds: number;
  policy: typeof BACKUP_RESTORE_EVIDENCE_POLICY;
}>;

export class BackupRestoreEvidenceUnavailableError extends Error {
  readonly code = "BACKUP_RESTORE_EVIDENCE_UNAVAILABLE";

  constructor() {
    super("Backup/restore evidence is unavailable.");
    this.name = "BackupRestoreEvidenceUnavailableError";
  }
}

export interface BackupRestoreEvidenceFileProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

/** Reads integrity-sensitive evidence or key material without following links. */
export class BackupRestoreEvidenceFileReader implements BackupRestoreEvidenceFileProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError("Backup/restore evidence files require bounded absolute paths.");
    }
  }

  async read(options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (options.signal?.aborted) throw new Error("Aborted");
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() ||
          metadata.size < MIN_FILE_BYTES ||
          metadata.size > this.maxBytes ||
          (this.production && (metadata.mode & 0o022) !== 0)) {
        throw new Error("Invalid evidence file");
      }
      const bytes = Buffer.alloc(metadata.size);
      const result = await handle.read(bytes, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal?.aborted) {
        throw new Error("Incomplete evidence file");
      }
      return bytes;
    } catch {
      throw new BackupRestoreEvidenceUnavailableError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function backupRestoreEvidenceFileReader(
  path: string,
  production = false,
): BackupRestoreEvidenceFileReader {
  return new BackupRestoreEvidenceFileReader(path, MAX_EVIDENCE_FILE_BYTES, production);
}

export function backupRestoreVerifierKeyFileReader(
  path: string,
  production = false,
): BackupRestoreEvidenceFileReader {
  return new BackupRestoreEvidenceFileReader(path, MAX_KEY_FILE_BYTES, production);
}

export class BackupRestoreEvidenceVerifier {
  private readonly expectedPublicKeyDigest: Buffer;

  constructor(
    private readonly evidenceProvider: BackupRestoreEvidenceFileProvider,
    private readonly keyProvider: BackupRestoreEvidenceFileProvider,
    expectedPublicKeySha256: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!evidenceProvider || typeof evidenceProvider.read !== "function" ||
        !keyProvider || typeof keyProvider.read !== "function" ||
        !SHA256.test(expectedPublicKeySha256)) {
      throw new ConfigurationError(
        "Backup/restore evidence requires providers and a lowercase SHA-256 public-key pin.",
      );
    }
    this.expectedPublicKeyDigest = Buffer.from(expectedPublicKeySha256, "hex");
  }

  async verify(signal?: AbortSignal): Promise<BackupRestoreReadiness> {
    try {
      const [evidenceBytes, keyBytes] = await Promise.all([
        this.evidenceProvider.read({ signal }),
        this.keyProvider.read({ signal }),
      ]);
      if (signal?.aborted) throw new Error("Aborted");
      const envelope = parseEvidenceEnvelope(evidenceBytes);
      const verifierKey = parseVerifierKey(keyBytes);
      if (envelope.keyId !== verifierKey.keyId) throw new Error("Key mismatch");

      const rawPublicKey = decodeBase64Url(verifierKey.publicKey, 32);
      const actualDigest = createHash("sha256").update(rawPublicKey).digest();
      if (!timingSafeEqual(actualDigest, this.expectedPublicKeyDigest)) {
        throw new Error("Public-key pin mismatch");
      }
      const publicKey = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: verifierKey.publicKey },
        format: "jwk",
      });
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Invalid public key");
      const signature = decodeBase64Url(envelope.signature, 64);
      if (!verifySignature(
        null,
        canonicalBackupRestoreEvidencePayload(envelope),
        publicKey,
        signature,
      )) {
        throw new Error("Invalid signature");
      }
      return readiness(envelope.evidence, this.now());
    } catch {
      throw new BackupRestoreEvidenceUnavailableError();
    }
  }
}

/**
 * Deterministic Ed25519 signing payload. External drill runners must sign the
 * UTF-8 JSON array returned here, with fields in exactly this order.
 */
export function canonicalBackupRestoreEvidencePayload(
  envelope: Pick<BackupRestoreEvidenceEnvelope, "schemaVersion" | "keyId" | "evidence">,
): Buffer {
  const evidence = envelope.evidence;
  return Buffer.from(JSON.stringify([
    envelope.schemaVersion,
    envelope.keyId,
    evidence.evidenceId,
    evidence.deployment,
    evidence.scope,
    evidence.backupSnapshotAt,
    evidence.backupCompletedAt,
    evidence.restoreStartedAt,
    evidence.restoreCompletedAt,
    evidence.verifiedAt,
    evidence.recoveryPointLagSeconds,
    evidence.restoreDurationSeconds,
    evidence.backupArtifactSha256,
    evidence.sourceDataManifestSha256,
    evidence.restoredDataManifestSha256,
    evidence.encrypted,
    evidence.checksumVerified,
    evidence.schemaVerified,
    evidence.rowCountsVerified,
    evidence.auditChainVerified,
    evidence.result,
  ]), "utf8");
}

function parseEvidenceEnvelope(bytes: Uint8Array): BackupRestoreEvidenceEnvelope {
  const envelope = parseObject(bytes);
  exactKeys(envelope, ["schemaVersion", "keyId", "evidence", "signature"]);
  if (envelope.schemaVersion !== EVIDENCE_SCHEMA ||
      typeof envelope.keyId !== "string" ||
      !KEY_ID.test(envelope.keyId) ||
      typeof envelope.signature !== "string" ||
      !BASE64URL_SIGNATURE.test(envelope.signature)) {
    throw new Error("Invalid evidence envelope");
  }
  const evidence = evidenceFrom(envelope.evidence);
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    keyId: envelope.keyId,
    evidence,
    signature: envelope.signature,
  };
}

function evidenceFrom(value: unknown): BackupRestoreEvidence {
  if (!isObject(value)) throw new Error("Invalid evidence");
  exactKeys(value, [
    "evidenceId",
    "deployment",
    "scope",
    "backupSnapshotAt",
    "backupCompletedAt",
    "restoreStartedAt",
    "restoreCompletedAt",
    "verifiedAt",
    "recoveryPointLagSeconds",
    "restoreDurationSeconds",
    "backupArtifactSha256",
    "sourceDataManifestSha256",
    "restoredDataManifestSha256",
    "encrypted",
    "checksumVerified",
    "schemaVerified",
    "rowCountsVerified",
    "auditChainVerified",
    "result",
  ]);
  const stringFields = [
    value.backupSnapshotAt,
    value.backupCompletedAt,
    value.restoreStartedAt,
    value.restoreCompletedAt,
    value.verifiedAt,
  ];
  if (typeof value.evidenceId !== "string" || !UUID.test(value.evidenceId) ||
      value.deployment !== DEPLOYMENT ||
      value.scope !== SCOPE ||
      stringFields.some((field) => typeof field !== "string" || !validTimestamp(field)) ||
      !safeDuration(value.recoveryPointLagSeconds) ||
      !safeDuration(value.restoreDurationSeconds) ||
      typeof value.backupArtifactSha256 !== "string" ||
      !SHA256.test(value.backupArtifactSha256) ||
      typeof value.sourceDataManifestSha256 !== "string" ||
      !SHA256.test(value.sourceDataManifestSha256) ||
      typeof value.restoredDataManifestSha256 !== "string" ||
      !SHA256.test(value.restoredDataManifestSha256) ||
      value.encrypted !== true ||
      value.checksumVerified !== true ||
      value.schemaVerified !== true ||
      value.rowCountsVerified !== true ||
      value.auditChainVerified !== true ||
      value.result !== "passed") {
    throw new Error("Invalid evidence");
  }
  return value as BackupRestoreEvidence;
}

function parseVerifierKey(bytes: Uint8Array): {
  schemaVersion: typeof KEY_SCHEMA;
  keyId: string;
  publicKey: string;
} {
  const key = parseObject(bytes);
  exactKeys(key, ["schemaVersion", "keyId", "publicKey"]);
  if (key.schemaVersion !== KEY_SCHEMA ||
      typeof key.keyId !== "string" ||
      !KEY_ID.test(key.keyId) ||
      typeof key.publicKey !== "string" ||
      !BASE64URL_PUBLIC_KEY.test(key.publicKey)) {
    throw new Error("Invalid verifier key");
  }
  decodeBase64Url(key.publicKey, 32);
  return {
    schemaVersion: KEY_SCHEMA,
    keyId: key.keyId,
    publicKey: key.publicKey,
  };
}

function readiness(evidence: BackupRestoreEvidence, now: Date): BackupRestoreReadiness {
  const snapshotAt = Date.parse(evidence.backupSnapshotAt);
  const backupCompletedAt = Date.parse(evidence.backupCompletedAt);
  const restoreStartedAt = Date.parse(evidence.restoreStartedAt);
  const restoreCompletedAt = Date.parse(evidence.restoreCompletedAt);
  const verifiedAt = Date.parse(evidence.verifiedAt);
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt) ||
      snapshotAt > backupCompletedAt ||
      backupCompletedAt > restoreStartedAt ||
      restoreStartedAt > restoreCompletedAt ||
      restoreCompletedAt > verifiedAt ||
      exactSeconds(backupCompletedAt - snapshotAt) !== evidence.recoveryPointLagSeconds ||
      exactSeconds(restoreCompletedAt - restoreStartedAt) !== evidence.restoreDurationSeconds ||
      evidence.sourceDataManifestSha256 !== evidence.restoredDataManifestSha256 ||
      evidence.recoveryPointLagSeconds > BACKUP_RESTORE_EVIDENCE_POLICY.recoveryPointLagMaxSeconds ||
      evidence.restoreDurationSeconds > BACKUP_RESTORE_EVIDENCE_POLICY.restoreDurationMaxSeconds ||
      exactSeconds(verifiedAt - snapshotAt) >
        BACKUP_RESTORE_EVIDENCE_POLICY.backupSnapshotMaxAgeAtVerificationSeconds ||
      verifiedAt > nowAt + BACKUP_RESTORE_EVIDENCE_POLICY.futureClockSkewSeconds * 1_000 ||
      nowAt - verifiedAt > BACKUP_RESTORE_EVIDENCE_POLICY.evidenceMaxAgeSeconds * 1_000) {
    throw new Error("Evidence does not satisfy readiness policy");
  }
  return {
    status: "ready",
    evidenceId: evidence.evidenceId,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    backupSnapshotAt: evidence.backupSnapshotAt,
    verifiedAt: evidence.verifiedAt,
    recoveryPointLagSeconds: evidence.recoveryPointLagSeconds,
    restoreDurationSeconds: evidence.restoreDurationSeconds,
    policy: BACKUP_RESTORE_EVIDENCE_POLICY,
  };
}

function parseObject(bytes: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(bytes).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  assertNoDuplicateJsonObjectKeys(text);
  if (!isObject(parsed)) throw new Error("Expected object");
  return parsed;
}

function assertNoDuplicateJsonObjectKeys(text: string): void {
  const stack: Array<{ type: "array" } | { type: "object"; keys: Set<string> }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") {
      stack.push({ type: "object", keys: new Set() });
      continue;
    }
    if (character === "[") {
      stack.push({ type: "array" });
      continue;
    }
    if (character === "}" || character === "]") {
      stack.pop();
      continue;
    }
    if (character !== '"') continue;

    const start = index;
    let escaped = false;
    for (index += 1; index < text.length; index += 1) {
      const stringCharacter = text[index];
      if (escaped) {
        escaped = false;
      } else if (stringCharacter === "\\") {
        escaped = true;
      } else if (stringCharacter === '"') {
        break;
      }
    }
    let next = index + 1;
    while (next < text.length && /\s/.test(text[next]!)) next += 1;
    if (text[next] !== ":") continue;
    const context = stack.at(-1);
    if (!context || context.type !== "object") throw new Error("Invalid JSON object");
    const key: unknown = JSON.parse(text.slice(start, index + 1));
    if (typeof key !== "string" || context.keys.has(key)) throw new Error("Duplicate JSON key");
    context.keys.add(key);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error("Unexpected fields");
  }
}

function validTimestamp(value: string): boolean {
  return ISO_UTC.test(value) && new Date(value).toISOString() === value;
}

function safeDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) <= 31 * 24 * 60 * 60;
}

function exactSeconds(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds % 1_000 !== 0) {
    return Number.NaN;
  }
  return milliseconds / 1_000;
}

function decodeBase64Url(value: string, expectedBytes: number): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw new Error("Invalid base64url");
  }
  return decoded;
}
