import { describe, expect, it } from "vitest";
import {
  AesGcmStatementCipher,
  approvalActionHash,
  statementCipherFromEnv,
} from "@/lib/server/control-plane/crypto";

const binding = {
  changeSetId: "9a973ec8-a409-4706-ad1d-ef6360ea430d",
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
  environment: "production" as const,
  statementSha256: "a".repeat(64),
};

describe("control-plane cryptography", () => {
  it("encrypts statements and authenticates their tenant binding", () => {
    const cipher = new AesGcmStatementCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("CREATE TABLE orders(id uuid)", binding);

    expect(Buffer.from(encrypted).includes(Buffer.from("CREATE TABLE"))).toBe(false);
    expect(cipher.decrypt(encrypted, binding)).toBe("CREATE TABLE orders(id uuid)");
    expect(() => cipher.decrypt(encrypted, { ...binding, projectId: "4c913350-711f-4935-919c-adbfaf7718ee" }))
      .toThrow("could not be authenticated");
  });

  it("fails closed when the PostgreSQL statement key is absent or malformed", () => {
    expect(() => statementCipherFromEnv({})).toThrow("QKERN_STATEMENT_ENCRYPTION_KEY is required");
    expect(() => statementCipherFromEnv({ QKERN_STATEMENT_ENCRYPTION_KEY: "too-short" }))
      .toThrow("must be 32 bytes");
  });

  it("binds approval hashes to every persisted action field", () => {
    const base = {
      ...binding,
      databaseInstanceRef: "managed:database-1",
      title: "Create orders",
      statementSha256: "a".repeat(64),
      createdBy: "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca",
      risk: "high" as const,
      expiresAt: "2099-01-01T00:00:00.000Z",
      requiredScope: "approval:decide" as const,
    };
    expect(approvalActionHash(base)).toHaveLength(64);
    expect(approvalActionHash(base)).not.toBe(approvalActionHash({ ...base, statementSha256: "b".repeat(64) }));
    expect(approvalActionHash(base)).not.toBe(approvalActionHash({ ...base, createdBy: null }));
    expect(approvalActionHash(base)).not.toBe(approvalActionHash({ ...base, databaseInstanceRef: "managed:database-2" }));
  });
});
