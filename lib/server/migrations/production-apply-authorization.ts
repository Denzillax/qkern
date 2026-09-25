import { recognisedByName } from "@/lib/server/errors/identity";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";
import type { Environment } from "@/lib/types";

const AUTHORIZATION_SCHEMA = "qkern.production-apply-authorization/v1" as const;
const KEY_SCHEMA = "qkern.production-apply-verifier-key/v1" as const;
const DEPLOYMENT = "production" as const;
const SCOPE = "migration_apply" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIN_FILE_BYTES = 2;
const MAX_AUTHORIZATION_FILE_BYTES = 32_768;
const MAX_KEY_FILE_BYTES = 1_024;

export const PRODUCTION_APPLY_AUTHORIZATION_POLICY = Object.freeze({
  authorizationMaxAgeSeconds: 4 * 60 * 60,
  authorizationMaxValiditySeconds: 4 * 60 * 60,
  futureClockSkewSeconds: 5 * 60,
});

export type ProductionApplySubject = Readonly<{
  organizationId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  approvalId: string;
  databaseInstanceRef: string;
  statementSha256: string;
  approvalActionHash: string;
}>;

export interface ProductionApplyAuthorizer {
  assertAuthorized(subject: ProductionApplySubject, signal?: AbortSignal): Promise<void>;
}

export class ProductionApplyBlockedError extends Error {
  readonly code = "PRODUCTION_APPLY_BLOCKED";

  constructor() {
    super("Production apply is not authorized.");
    this.name = "ProductionApplyBlockedError";
  }
}
recognisedByName(ProductionApplyBlockedError, "ProductionApplyBlockedError");

/**
 * Secure default for every runtime. Development and staging keep their normal
 * workflow, while a production target requires an explicitly composed verifier.
 */
export const denyProductionApplyAuthorizer: ProductionApplyAuthorizer = Object.freeze({
  async assertAuthorized(subject: ProductionApplySubject): Promise<void> {
    if (subject.environment === DEPLOYMENT) throw new ProductionApplyBlockedError();
  },
});

export type ProductionApplyAuthorizationAssertions = Readonly<{
  backupRestoreVerified: true;
  runtimeDeploymentVerified: true;
  realPostgresVerified: true;
  providerProvisioningVerified: true;
  vaultRotationVerified: true;
  applyBrokerDeliveryVerified: true;
  incidentPagerDeliveryVerified: true;
  crossTenantIsolationVerified: true;
  staleWorkerCancellationVerified: true;
  vulnerabilityPolicyPassed: true;
  penetrationTestPassed: true;
}>;

export type ProductionApplyAuthorization = Readonly<{
  authorizationId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  organizationId: string;
  projectId: string;
  changeSetId: string;
  approvalId: string;
  databaseInstanceRefSha256: string;
  statementSha256: string;
  approvalActionHash: string;
  releaseArtifactSha256: string;
  backupRestoreEvidenceSha256: string;
  runtimeDeploymentEvidenceSha256: string;
  providerE2EEvidenceSha256: string;
  securityAssessmentSha256: string;
  issuedAt: string;
  expiresAt: string;
  assertions: ProductionApplyAuthorizationAssertions;
  result: "passed";
}>;

export type ProductionApplyAuthorizationEnvelope = Readonly<{
  schemaVersion: typeof AUTHORIZATION_SCHEMA;
  keyId: string;
  authorization: ProductionApplyAuthorization;
  signature: string;
}>;

export type ProductionApplyAuthorizationExpectation = Readonly<{
  releaseArtifactSha256: string;
  backupRestoreEvidenceSha256: string;
  runtimeDeploymentEvidenceSha256: string;
  providerE2EEvidenceSha256: string;
  securityAssessmentSha256: string;
}>;

export interface ProductionApplyAuthorizationFileProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

/** Reads release authority without following links or accepting mutable production files. */
export class ProductionApplyAuthorizationFileReader
implements ProductionApplyAuthorizationFileProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError(
        "Production apply authorization files require bounded absolute paths.",
      );
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
        throw new Error("Invalid authorization file");
      }
      const bytes = Buffer.alloc(metadata.size);
      const result = await handle.read(bytes, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal?.aborted) {
        throw new Error("Incomplete authorization file");
      }
      return bytes;
    } catch {
      throw new ProductionApplyBlockedError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function productionApplyAuthorizationFileReader(
  path: string,
  production = false,
): ProductionApplyAuthorizationFileReader {
  return new ProductionApplyAuthorizationFileReader(
    path,
    MAX_AUTHORIZATION_FILE_BYTES,
    production,
  );
}

export function productionApplyVerifierKeyFileReader(
  path: string,
  production = false,
): ProductionApplyAuthorizationFileReader {
  return new ProductionApplyAuthorizationFileReader(path, MAX_KEY_FILE_BYTES, production);
}

export class ProductionApplyAuthorizationVerifier implements ProductionApplyAuthorizer {
  private readonly expectedPublicKeyDigest: Buffer;
  private readonly expectation: ProductionApplyAuthorizationExpectation;

  constructor(
    private readonly authorizationProvider: ProductionApplyAuthorizationFileProvider,
    private readonly keyProvider: ProductionApplyAuthorizationFileProvider,
    expectedPublicKeySha256: string,
    expectation: ProductionApplyAuthorizationExpectation,
    private readonly now: () => Date = () => new Date(),
  ) {
    const expectedDigests = [
      expectedPublicKeySha256,
      expectation?.releaseArtifactSha256,
      expectation?.backupRestoreEvidenceSha256,
      expectation?.runtimeDeploymentEvidenceSha256,
      expectation?.providerE2EEvidenceSha256,
      expectation?.securityAssessmentSha256,
    ];
    if (!authorizationProvider || typeof authorizationProvider.read !== "function" ||
        !keyProvider || typeof keyProvider.read !== "function" ||
        expectedDigests.some((value) => typeof value !== "string" || !SHA256.test(value)) ||
        new Set(expectedDigests).size !== expectedDigests.length) {
      throw new ConfigurationError(
        "Production apply requires providers, a public-key pin and five distinct release evidence pins.",
      );
    }
    this.expectedPublicKeyDigest = Buffer.from(expectedPublicKeySha256, "hex");
    this.expectation = Object.freeze({ ...expectation });
  }

  async assertAuthorized(subject: ProductionApplySubject, signal?: AbortSignal): Promise<void> {
    if (subject.environment !== DEPLOYMENT) return;
    try {
      validSubject(subject);
      const [authorizationBytes, keyBytes] = await Promise.all([
        this.authorizationProvider.read({ signal }),
        this.keyProvider.read({ signal }),
      ]);
      if (signal?.aborted) throw new Error("Aborted");
      const envelope = parseAuthorizationEnvelope(authorizationBytes);
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
      if (!verifySignature(
        null,
        canonicalProductionApplyAuthorizationPayload(envelope),
        publicKey,
        decodeBase64Url(envelope.signature, 64),
      )) {
        throw new Error("Invalid signature");
      }
      assertAuthorization(envelope.authorization, subject, this.expectation, this.now());
    } catch {
      throw new ProductionApplyBlockedError();
    }
  }
}

/** Canonical bytes that the independent release authority must sign with Ed25519. */
export function canonicalProductionApplyAuthorizationPayload(
  envelope: Pick<ProductionApplyAuthorizationEnvelope, "schemaVersion" | "keyId" | "authorization">,
): Buffer {
  const authorization = envelope.authorization;
  return Buffer.from(JSON.stringify([
    envelope.schemaVersion,
    envelope.keyId,
    authorization.authorizationId,
    authorization.deployment,
    authorization.scope,
    authorization.organizationId,
    authorization.projectId,
    authorization.changeSetId,
    authorization.approvalId,
    authorization.databaseInstanceRefSha256,
    authorization.statementSha256,
    authorization.approvalActionHash,
    authorization.releaseArtifactSha256,
    authorization.backupRestoreEvidenceSha256,
    authorization.runtimeDeploymentEvidenceSha256,
    authorization.providerE2EEvidenceSha256,
    authorization.securityAssessmentSha256,
    authorization.issuedAt,
    authorization.expiresAt,
    [
      authorization.assertions.backupRestoreVerified,
      authorization.assertions.runtimeDeploymentVerified,
      authorization.assertions.realPostgresVerified,
      authorization.assertions.providerProvisioningVerified,
      authorization.assertions.vaultRotationVerified,
      authorization.assertions.applyBrokerDeliveryVerified,
      authorization.assertions.incidentPagerDeliveryVerified,
      authorization.assertions.crossTenantIsolationVerified,
      authorization.assertions.staleWorkerCancellationVerified,
      authorization.assertions.vulnerabilityPolicyPassed,
      authorization.assertions.penetrationTestPassed,
    ],
    authorization.result,
  ]), "utf8");
}

function parseAuthorizationEnvelope(bytes: Uint8Array): ProductionApplyAuthorizationEnvelope {
  const envelope = parseObject(bytes);
  exactKeys(envelope, ["schemaVersion", "keyId", "authorization", "signature"]);
  if (envelope.schemaVersion !== AUTHORIZATION_SCHEMA ||
      typeof envelope.keyId !== "string" ||
      !KEY_ID.test(envelope.keyId) ||
      typeof envelope.signature !== "string" ||
      !BASE64URL_SIGNATURE.test(envelope.signature)) {
    throw new Error("Invalid authorization envelope");
  }
  return {
    schemaVersion: AUTHORIZATION_SCHEMA,
    keyId: envelope.keyId,
    authorization: authorizationFrom(envelope.authorization),
    signature: envelope.signature,
  };
}

function authorizationFrom(value: unknown): ProductionApplyAuthorization {
  if (!isObject(value)) throw new Error("Invalid authorization");
  exactKeys(value, [
    "authorizationId",
    "deployment",
    "scope",
    "organizationId",
    "projectId",
    "changeSetId",
    "approvalId",
    "databaseInstanceRefSha256",
    "statementSha256",
    "approvalActionHash",
    "releaseArtifactSha256",
    "backupRestoreEvidenceSha256",
    "runtimeDeploymentEvidenceSha256",
    "providerE2EEvidenceSha256",
    "securityAssessmentSha256",
    "issuedAt",
    "expiresAt",
    "assertions",
    "result",
  ]);
  const ids = [value.authorizationId, value.organizationId, value.projectId, value.changeSetId, value.approvalId];
  const digests = [
    value.databaseInstanceRefSha256,
    value.statementSha256,
    value.approvalActionHash,
    value.releaseArtifactSha256,
    value.backupRestoreEvidenceSha256,
    value.runtimeDeploymentEvidenceSha256,
    value.providerE2EEvidenceSha256,
    value.securityAssessmentSha256,
  ];
  if (ids.some((candidate) => typeof candidate !== "string" || !UUID.test(candidate)) ||
      digests.some((candidate) => typeof candidate !== "string" || !SHA256.test(candidate)) ||
      value.deployment !== DEPLOYMENT ||
      value.scope !== SCOPE ||
      typeof value.issuedAt !== "string" ||
      !validTimestamp(value.issuedAt) ||
      typeof value.expiresAt !== "string" ||
      !validTimestamp(value.expiresAt) ||
      value.result !== "passed") {
    throw new Error("Invalid authorization");
  }
  return {
    authorizationId: value.authorizationId as string,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    organizationId: value.organizationId as string,
    projectId: value.projectId as string,
    changeSetId: value.changeSetId as string,
    approvalId: value.approvalId as string,
    databaseInstanceRefSha256: value.databaseInstanceRefSha256 as string,
    statementSha256: value.statementSha256 as string,
    approvalActionHash: value.approvalActionHash as string,
    releaseArtifactSha256: value.releaseArtifactSha256 as string,
    backupRestoreEvidenceSha256: value.backupRestoreEvidenceSha256 as string,
    runtimeDeploymentEvidenceSha256: value.runtimeDeploymentEvidenceSha256 as string,
    providerE2EEvidenceSha256: value.providerE2EEvidenceSha256 as string,
    securityAssessmentSha256: value.securityAssessmentSha256 as string,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    assertions: assertionsFrom(value.assertions),
    result: "passed",
  };
}

function assertionsFrom(value: unknown): ProductionApplyAuthorizationAssertions {
  if (!isObject(value)) throw new Error("Invalid authorization assertions");
  const keys: Array<keyof ProductionApplyAuthorizationAssertions> = [
    "backupRestoreVerified",
    "runtimeDeploymentVerified",
    "realPostgresVerified",
    "providerProvisioningVerified",
    "vaultRotationVerified",
    "applyBrokerDeliveryVerified",
    "incidentPagerDeliveryVerified",
    "crossTenantIsolationVerified",
    "staleWorkerCancellationVerified",
    "vulnerabilityPolicyPassed",
    "penetrationTestPassed",
  ];
  exactKeys(value, keys);
  if (keys.some((key) => value[key] !== true)) {
    throw new Error("Invalid authorization assertions");
  }
  return value as ProductionApplyAuthorizationAssertions;
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
  return { schemaVersion: KEY_SCHEMA, keyId: key.keyId, publicKey: key.publicKey };
}

function assertAuthorization(
  authorization: ProductionApplyAuthorization,
  subject: ProductionApplySubject,
  expected: ProductionApplyAuthorizationExpectation,
  now: Date,
): void {
  const issuedAt = Date.parse(authorization.issuedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt) ||
      authorization.organizationId !== subject.organizationId ||
      authorization.projectId !== subject.projectId ||
      authorization.changeSetId !== subject.changeSetId ||
      authorization.approvalId !== subject.approvalId ||
      authorization.databaseInstanceRefSha256 !== sha256(subject.databaseInstanceRef) ||
      authorization.statementSha256 !== subject.statementSha256 ||
      authorization.approvalActionHash !== subject.approvalActionHash ||
      authorization.releaseArtifactSha256 !== expected.releaseArtifactSha256 ||
      authorization.backupRestoreEvidenceSha256 !== expected.backupRestoreEvidenceSha256 ||
      authorization.runtimeDeploymentEvidenceSha256 !== expected.runtimeDeploymentEvidenceSha256 ||
      authorization.providerE2EEvidenceSha256 !== expected.providerE2EEvidenceSha256 ||
      authorization.securityAssessmentSha256 !== expected.securityAssessmentSha256 ||
      issuedAt > expiresAt ||
      expiresAt - issuedAt > PRODUCTION_APPLY_AUTHORIZATION_POLICY.authorizationMaxValiditySeconds * 1_000 ||
      issuedAt > nowAt + PRODUCTION_APPLY_AUTHORIZATION_POLICY.futureClockSkewSeconds * 1_000 ||
      nowAt - issuedAt > PRODUCTION_APPLY_AUTHORIZATION_POLICY.authorizationMaxAgeSeconds * 1_000 ||
      expiresAt <= nowAt) {
    throw new Error("Authorization does not satisfy release policy");
  }
}

function validSubject(subject: ProductionApplySubject): void {
  if (!UUID.test(subject.organizationId) ||
      !UUID.test(subject.projectId) ||
      !UUID.test(subject.changeSetId) ||
      !UUID.test(subject.approvalId) ||
      !subject.databaseInstanceRef ||
      subject.databaseInstanceRef.length > 512 ||
      !SHA256.test(subject.statementSha256) ||
      !SHA256.test(subject.approvalActionHash)) {
    throw new Error("Invalid production apply subject");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
      if (escaped) escaped = false;
      else if (stringCharacter === "\\") escaped = true;
      else if (stringCharacter === '"') break;
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

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
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

function decodeBase64Url(value: string, expectedBytes: number): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw new Error("Invalid base64url");
  }
  return decoded;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
