import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ConfigurationError, InvalidRecordError } from "@/lib/server/db/errors";
import type { Environment } from "@/lib/types";
import type { Risk } from "@/lib/types";

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type StatementBinding = {
  changeSetId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  statementSha256: string;
};

export interface StatementCipher {
  encrypt(statement: string, binding: StatementBinding): Uint8Array;
  decrypt(payload: Uint8Array, binding: StatementBinding): string;
}

function associatedData(binding: StatementBinding): Buffer {
  return Buffer.from(JSON.stringify({
    changeSetId: binding.changeSetId,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    environment: binding.environment,
    statementSha256: binding.statementSha256,
  }), "utf8");
}

export class AesGcmStatementCipher implements StatementCipher {
  constructor(private readonly key: Uint8Array) {
    if (key.byteLength !== 32) throw new ConfigurationError("The statement encryption key must contain exactly 32 bytes.");
  }

  encrypt(statement: string, binding: StatementBinding): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(associatedData(binding));
    const ciphertext = Buffer.concat([cipher.update(statement, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, ciphertext]);
  }

  decrypt(payload: Uint8Array, binding: StatementBinding): string {
    const encoded = Buffer.from(payload);
    if (encoded.byteLength <= 1 + IV_BYTES + TAG_BYTES || encoded[0] !== FORMAT_VERSION) {
      throw new InvalidRecordError("The encrypted statement has an unsupported or invalid format.");
    }
    try {
      const iv = encoded.subarray(1, 1 + IV_BYTES);
      const tag = encoded.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const ciphertext = encoded.subarray(1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(associatedData(binding));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      throw new InvalidRecordError("The encrypted statement could not be authenticated.", error);
    }
  }
}

export function statementCipherFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): StatementCipher {
  const encoded = env.QKERN_STATEMENT_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new ConfigurationError("QKERN_STATEMENT_ENCRYPTION_KEY is required for the PostgreSQL adapter.");
  }
  const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, "hex") : Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new ConfigurationError("QKERN_STATEMENT_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64.");
  }
  return new AesGcmStatementCipher(key);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function approvalActionHash(input: {
  changeSetId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  databaseInstanceRef: string;
  title: string;
  statementSha256: string;
  createdBy: string | null;
  risk: Risk;
  expiresAt: string;
  requiredScope: "approval:decide";
}): string {
  return sha256(JSON.stringify({
    changeSetId: input.changeSetId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.environment,
    databaseInstanceRef: input.databaseInstanceRef,
    title: input.title,
    statementSha256: input.statementSha256,
    createdBy: input.createdBy,
    risk: input.risk,
    expiresAt: input.expiresAt,
    requiredScope: input.requiredScope,
  }));
}

export function hashesMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return timingSafeEqual(leftBytes, rightBytes);
}
