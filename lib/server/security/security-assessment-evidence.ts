import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";

const EVIDENCE_SCHEMA = "qkern.security-assessment-evidence/v1" as const;
const KEY_SCHEMA = "qkern.security-assessment-verifier-key/v1" as const;
const DEPLOYMENT = "production" as const;
const SCOPE = "release_security" as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIN_FILE_BYTES = 2;
const MAX_EVIDENCE_FILE_BYTES = 32_768;
const MAX_KEY_FILE_BYTES = 1_024;

export const SECURITY_ASSESSMENT_EVIDENCE_POLICY = Object.freeze({
  evidenceMaxAgeSeconds: 7 * 24 * 60 * 60,
  assessmentDurationMinSeconds: 60 * 60,
  assessmentDurationMaxSeconds: 30 * 24 * 60 * 60,
  certificationLagMaxSeconds: 24 * 60 * 60,
  futureClockSkewSeconds: 5 * 60,
  assessmentCount: 14,
  unresolvedCriticalFindings: 0,
  unresolvedHighFindings: 0,
});

export type SecurityAssessmentChecks = Readonly<{
  threatModelReviewed: true;
  dependencyAuditPassed: true;
  sastPassed: true;
  dastPassed: true;
  secretScanPassed: true;
  crossTenantIsolationPassed: true;
  restAuthorizationPassed: true;
  mcpAuthorizationPassed: true;
  mcpPromptInjectionPassed: true;
  ssrfEgressPassed: true;
  approvalRacePassed: true;
  backupIsolationPassed: true;
  sessionAndTokenSecurityPassed: true;
  penetrationTestPassed: true;
}>;

export type SecurityAssessmentEvidence = Readonly<{
  evidenceId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  releaseArtifactSha256: string;
  sbomSha256: string;
  dependencyAuditSha256: string;
  sastReportSha256: string;
  dastReportSha256: string;
  secretScanReportSha256: string;
  crossTenantReportSha256: string;
  penetrationTestReportSha256: string;
  assessmentStartedAt: string;
  assessmentCompletedAt: string;
  certifiedAt: string;
  assessmentDurationSeconds: number;
  assessmentCount: 14;
  unresolvedCriticalFindings: 0;
  unresolvedHighFindings: 0;
  checks: SecurityAssessmentChecks;
  result: "passed";
}>;

export type SecurityAssessmentEvidenceEnvelope = Readonly<{
  schemaVersion: typeof EVIDENCE_SCHEMA;
  keyId: string;
  evidence: SecurityAssessmentEvidence;
  signature: string;
}>;

export type SecurityAssessmentEvidenceExpectation = Readonly<{
  releaseArtifactSha256: string;
  sbomSha256: string;
  dependencyAuditSha256: string;
  sastReportSha256: string;
  dastReportSha256: string;
  secretScanReportSha256: string;
  crossTenantReportSha256: string;
  penetrationTestReportSha256: string;
}>;

export type SecurityAssessmentEvidenceReadiness = Readonly<{
  status: "ready";
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  assessmentCompletedAt: string;
  certifiedAt: string;
  assessmentDurationSeconds: number;
  assessmentCount: 14;
  unresolvedCriticalFindings: 0;
  unresolvedHighFindings: 0;
  policy: typeof SECURITY_ASSESSMENT_EVIDENCE_POLICY;
}>;

export class SecurityAssessmentEvidenceUnavailableError extends Error {
  readonly code = "SECURITY_ASSESSMENT_EVIDENCE_UNAVAILABLE";

  constructor() {
    super("Security assessment evidence is unavailable.");
    this.name = "SecurityAssessmentEvidenceUnavailableError";
  }
}

export interface SecurityAssessmentEvidenceFileProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

/** Reads independent audit evidence without following links or accepting mutable files. */
export class SecurityAssessmentEvidenceFileReader
implements SecurityAssessmentEvidenceFileProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError(
        "Security assessment evidence files require bounded absolute paths.",
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
        throw new Error("Invalid evidence file");
      }
      const bytes = Buffer.alloc(metadata.size);
      const result = await handle.read(bytes, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal?.aborted) {
        throw new Error("Incomplete evidence file");
      }
      return bytes;
    } catch {
      throw new SecurityAssessmentEvidenceUnavailableError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function securityAssessmentEvidenceFileReader(
  path: string,
  production = false,
): SecurityAssessmentEvidenceFileReader {
  return new SecurityAssessmentEvidenceFileReader(
    path,
    MAX_EVIDENCE_FILE_BYTES,
    production,
  );
}

export function securityAssessmentVerifierKeyFileReader(
  path: string,
  production = false,
): SecurityAssessmentEvidenceFileReader {
  return new SecurityAssessmentEvidenceFileReader(
    path,
    MAX_KEY_FILE_BYTES,
    production,
  );
}

export class SecurityAssessmentEvidenceVerifier {
  private readonly expectedPublicKeyDigest: Buffer;
  private readonly expected: SecurityAssessmentEvidenceExpectation;

  constructor(
    private readonly evidenceProvider: SecurityAssessmentEvidenceFileProvider,
    private readonly keyProvider: SecurityAssessmentEvidenceFileProvider,
    expectedPublicKeySha256: string,
    expectation: SecurityAssessmentEvidenceExpectation,
    private readonly now: () => Date = () => new Date(),
  ) {
    const pins = expectation && [
      expectation.releaseArtifactSha256,
      expectation.sbomSha256,
      expectation.dependencyAuditSha256,
      expectation.sastReportSha256,
      expectation.dastReportSha256,
      expectation.secretScanReportSha256,
      expectation.crossTenantReportSha256,
      expectation.penetrationTestReportSha256,
    ];
    if (!evidenceProvider || typeof evidenceProvider.read !== "function" ||
        !keyProvider || typeof keyProvider.read !== "function" ||
        !SHA256.test(expectedPublicKeySha256) ||
        !pins ||
        pins.some((pin) => !SHA256.test(pin)) ||
        new Set([expectedPublicKeySha256, ...pins]).size !== 9) {
      throw new ConfigurationError(
        "Security assessment evidence requires providers, eight distinct artifact pins and a public-key pin.",
      );
    }
    this.expectedPublicKeyDigest = Buffer.from(expectedPublicKeySha256, "hex");
    this.expected = Object.freeze({ ...expectation });
  }

  async verify(signal?: AbortSignal): Promise<SecurityAssessmentEvidenceReadiness> {
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
      if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("Invalid public key");
      }
      const signature = decodeBase64Url(envelope.signature, 64);
      if (!verifySignature(
        null,
        canonicalSecurityAssessmentEvidencePayload(envelope),
        publicKey,
        signature,
      )) {
        throw new Error("Invalid signature");
      }
      return readiness(envelope.evidence, this.expected, this.now());
    } catch {
      throw new SecurityAssessmentEvidenceUnavailableError();
    }
  }
}

/** Exact deterministic payload signed by the independent security assessor. */
export function canonicalSecurityAssessmentEvidencePayload(
  envelope: Pick<
    SecurityAssessmentEvidenceEnvelope,
    "schemaVersion" | "keyId" | "evidence"
  >,
): Buffer {
  const evidence = envelope.evidence;
  return Buffer.from(JSON.stringify([
    envelope.schemaVersion,
    envelope.keyId,
    evidence.evidenceId,
    evidence.deployment,
    evidence.scope,
    evidence.releaseArtifactSha256,
    evidence.sbomSha256,
    evidence.dependencyAuditSha256,
    evidence.sastReportSha256,
    evidence.dastReportSha256,
    evidence.secretScanReportSha256,
    evidence.crossTenantReportSha256,
    evidence.penetrationTestReportSha256,
    evidence.assessmentStartedAt,
    evidence.assessmentCompletedAt,
    evidence.certifiedAt,
    evidence.assessmentDurationSeconds,
    evidence.assessmentCount,
    evidence.unresolvedCriticalFindings,
    evidence.unresolvedHighFindings,
    [
      evidence.checks.threatModelReviewed,
      evidence.checks.dependencyAuditPassed,
      evidence.checks.sastPassed,
      evidence.checks.dastPassed,
      evidence.checks.secretScanPassed,
      evidence.checks.crossTenantIsolationPassed,
      evidence.checks.restAuthorizationPassed,
      evidence.checks.mcpAuthorizationPassed,
      evidence.checks.mcpPromptInjectionPassed,
      evidence.checks.ssrfEgressPassed,
      evidence.checks.approvalRacePassed,
      evidence.checks.backupIsolationPassed,
      evidence.checks.sessionAndTokenSecurityPassed,
      evidence.checks.penetrationTestPassed,
    ],
    evidence.result,
  ]), "utf8");
}

function parseEvidenceEnvelope(
  bytes: Uint8Array,
): SecurityAssessmentEvidenceEnvelope {
  const envelope = parseObject(bytes);
  exactKeys(envelope, ["schemaVersion", "keyId", "evidence", "signature"]);
  if (envelope.schemaVersion !== EVIDENCE_SCHEMA ||
      typeof envelope.keyId !== "string" ||
      !KEY_ID.test(envelope.keyId) ||
      typeof envelope.signature !== "string" ||
      !BASE64URL_SIGNATURE.test(envelope.signature)) {
    throw new Error("Invalid evidence envelope");
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    keyId: envelope.keyId,
    evidence: evidenceFrom(envelope.evidence),
    signature: envelope.signature,
  };
}

function evidenceFrom(value: unknown): SecurityAssessmentEvidence {
  if (!isObject(value)) throw new Error("Invalid evidence");
  exactKeys(value, [
    "evidenceId",
    "deployment",
    "scope",
    "releaseArtifactSha256",
    "sbomSha256",
    "dependencyAuditSha256",
    "sastReportSha256",
    "dastReportSha256",
    "secretScanReportSha256",
    "crossTenantReportSha256",
    "penetrationTestReportSha256",
    "assessmentStartedAt",
    "assessmentCompletedAt",
    "certifiedAt",
    "assessmentDurationSeconds",
    "assessmentCount",
    "unresolvedCriticalFindings",
    "unresolvedHighFindings",
    "checks",
    "result",
  ]);
  const digests = [
    value.releaseArtifactSha256,
    value.sbomSha256,
    value.dependencyAuditSha256,
    value.sastReportSha256,
    value.dastReportSha256,
    value.secretScanReportSha256,
    value.crossTenantReportSha256,
    value.penetrationTestReportSha256,
  ];
  if (typeof value.evidenceId !== "string" || !UUID.test(value.evidenceId) ||
      value.deployment !== DEPLOYMENT ||
      value.scope !== SCOPE ||
      digests.some((digest) => typeof digest !== "string" || !SHA256.test(digest)) ||
      new Set(digests).size !== 8 ||
      typeof value.assessmentStartedAt !== "string" ||
      !validTimestamp(value.assessmentStartedAt) ||
      typeof value.assessmentCompletedAt !== "string" ||
      !validTimestamp(value.assessmentCompletedAt) ||
      typeof value.certifiedAt !== "string" ||
      !validTimestamp(value.certifiedAt) ||
      !safeDuration(value.assessmentDurationSeconds) ||
      value.assessmentCount !== 14 ||
      value.unresolvedCriticalFindings !== 0 ||
      value.unresolvedHighFindings !== 0 ||
      value.result !== "passed") {
    throw new Error("Invalid evidence");
  }
  return {
    evidenceId: value.evidenceId,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    releaseArtifactSha256: value.releaseArtifactSha256 as string,
    sbomSha256: value.sbomSha256 as string,
    dependencyAuditSha256: value.dependencyAuditSha256 as string,
    sastReportSha256: value.sastReportSha256 as string,
    dastReportSha256: value.dastReportSha256 as string,
    secretScanReportSha256: value.secretScanReportSha256 as string,
    crossTenantReportSha256: value.crossTenantReportSha256 as string,
    penetrationTestReportSha256: value.penetrationTestReportSha256 as string,
    assessmentStartedAt: value.assessmentStartedAt,
    assessmentCompletedAt: value.assessmentCompletedAt,
    certifiedAt: value.certifiedAt,
    assessmentDurationSeconds: value.assessmentDurationSeconds as number,
    assessmentCount: 14,
    unresolvedCriticalFindings: 0,
    unresolvedHighFindings: 0,
    checks: checksFrom(value.checks),
    result: "passed",
  };
}

function checksFrom(value: unknown): SecurityAssessmentChecks {
  if (!isObject(value)) throw new Error("Invalid security checks");
  const keys = [
    "threatModelReviewed",
    "dependencyAuditPassed",
    "sastPassed",
    "dastPassed",
    "secretScanPassed",
    "crossTenantIsolationPassed",
    "restAuthorizationPassed",
    "mcpAuthorizationPassed",
    "mcpPromptInjectionPassed",
    "ssrfEgressPassed",
    "approvalRacePassed",
    "backupIsolationPassed",
    "sessionAndTokenSecurityPassed",
    "penetrationTestPassed",
  ];
  exactKeys(value, keys);
  if (keys.some((key) => value[key] !== true)) {
    throw new Error("Incomplete security assessment");
  }
  return value as SecurityAssessmentChecks;
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

function readiness(
  evidence: SecurityAssessmentEvidence,
  expected: SecurityAssessmentEvidenceExpectation,
  now: Date,
): SecurityAssessmentEvidenceReadiness {
  const assessmentStartedAt = Date.parse(evidence.assessmentStartedAt);
  const assessmentCompletedAt = Date.parse(evidence.assessmentCompletedAt);
  const certifiedAt = Date.parse(evidence.certifiedAt);
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt) ||
      evidence.releaseArtifactSha256 !== expected.releaseArtifactSha256 ||
      evidence.sbomSha256 !== expected.sbomSha256 ||
      evidence.dependencyAuditSha256 !== expected.dependencyAuditSha256 ||
      evidence.sastReportSha256 !== expected.sastReportSha256 ||
      evidence.dastReportSha256 !== expected.dastReportSha256 ||
      evidence.secretScanReportSha256 !== expected.secretScanReportSha256 ||
      evidence.crossTenantReportSha256 !== expected.crossTenantReportSha256 ||
      evidence.penetrationTestReportSha256 !==
        expected.penetrationTestReportSha256 ||
      assessmentStartedAt > assessmentCompletedAt ||
      assessmentCompletedAt > certifiedAt ||
      exactSeconds(assessmentCompletedAt - assessmentStartedAt) !==
        evidence.assessmentDurationSeconds ||
      evidence.assessmentDurationSeconds <
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMinSeconds ||
      evidence.assessmentDurationSeconds >
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMaxSeconds ||
      exactSeconds(certifiedAt - assessmentCompletedAt) >
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      certifiedAt >
        nowAt + SECURITY_ASSESSMENT_EVIDENCE_POLICY.futureClockSkewSeconds * 1_000 ||
      nowAt - certifiedAt >
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.evidenceMaxAgeSeconds * 1_000) {
    throw new Error("Evidence does not satisfy readiness policy");
  }
  return Object.freeze({
    status: "ready",
    deployment: DEPLOYMENT,
    scope: SCOPE,
    assessmentCompletedAt: evidence.assessmentCompletedAt,
    certifiedAt: evidence.certifiedAt,
    assessmentDurationSeconds: evidence.assessmentDurationSeconds,
    assessmentCount: 14,
    unresolvedCriticalFindings: 0,
    unresolvedHighFindings: 0,
    policy: SECURITY_ASSESSMENT_EVIDENCE_POLICY,
  });
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
    if (typeof key !== "string" || context.keys.has(key)) {
      throw new Error("Duplicate JSON key");
    }
    context.keys.add(key);
  }
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
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 ||
      milliseconds % 1_000 !== 0) {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
