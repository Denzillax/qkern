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

const EVIDENCE_SCHEMA = "qkern.provider-e2e-evidence/v1" as const;
const KEY_SCHEMA = "qkern.provider-e2e-verifier-key/v1" as const;
const DEPLOYMENT = "production" as const;
const SCOPE = "managed_postgresql_e2e" as const;
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

export const PROVIDER_E2E_EVIDENCE_POLICY = Object.freeze({
  evidenceMaxAgeSeconds: 24 * 60 * 60,
  testRunDurationMinSeconds: 10 * 60,
  testRunDurationMaxSeconds: 6 * 60 * 60,
  certificationLagMaxSeconds: 30 * 60,
  futureClockSkewSeconds: 5 * 60,
  postgresMajorVersion: 17,
  scenarioCount: 15,
});

export type ProviderE2EScenarios = Readonly<{
  provisioningSucceeded: true;
  provisioningIdempotencyVerified: true;
  invalidBrokerSignatureRejected: true;
  vaultCredentialIssued: true;
  vaultRotationVerified: true;
  previousVaultCredentialRevoked: true;
  tlsCertificatePinVerified: true;
  migrationApplyVerified: true;
  crashAfterCommitReconciled: true;
  leaseLossCancelled: true;
  rollbackRetryVerified: true;
  crossTenantIsolationVerified: true;
  applyDeliveryVerified: true;
  incidentPagerDeliveryVerified: true;
  metricsAlertLifecycleVerified: true;
}>;

export type ProviderE2EEvidence = Readonly<{
  evidenceId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  providerIdentitySha256: string;
  providerConfigurationSha256: string;
  brokerContractSha256: string;
  vaultPolicySha256: string;
  pagerRoutingSha256: string;
  backupRestoreEvidenceSha256: string;
  runtimeDeploymentEvidenceSha256: string;
  testRunStartedAt: string;
  testRunCompletedAt: string;
  certifiedAt: string;
  testRunDurationSeconds: number;
  postgresMajorVersion: 17;
  scenarioCount: 15;
  scenarios: ProviderE2EScenarios;
  result: "passed";
}>;

export type ProviderE2EEvidenceEnvelope = Readonly<{
  schemaVersion: typeof EVIDENCE_SCHEMA;
  keyId: string;
  evidence: ProviderE2EEvidence;
  signature: string;
}>;

export type ProviderE2EEvidenceExpectation = Readonly<{
  providerIdentitySha256: string;
  providerConfigurationSha256: string;
  brokerContractSha256: string;
  vaultPolicySha256: string;
  pagerRoutingSha256: string;
  backupRestoreEvidenceSha256: string;
  runtimeDeploymentEvidenceSha256: string;
}>;

export type ProviderE2EEvidenceReadiness = Readonly<{
  status: "ready";
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  testRunCompletedAt: string;
  certifiedAt: string;
  testRunDurationSeconds: number;
  postgresMajorVersion: 17;
  scenarioCount: 15;
  policy: typeof PROVIDER_E2E_EVIDENCE_POLICY;
}>;

export class ProviderE2EEvidenceUnavailableError extends Error {
  readonly code = "PROVIDER_E2E_EVIDENCE_UNAVAILABLE";

  /**
   * Woran es lag, in einem Wort (2.152).
   *
   * **Warum ueberhaupt.** Der Leser fing bisher jeden Fehler und warf diesen
   * hier, ohne zu sagen, welcher Schritt gescheitert ist. Auf dem
   * Ubuntu-Runner faellt dieser Fall seit 2.23 gelegentlich aus, und beide Male
   * stand im Protokoll nur, dass die Evidenz nicht bereit sei. Damit laesst
   * sich nichts untersuchen: Oeffnen, Groesse, Lesen und Abbruch sehen von
   * aussen gleich aus.
   *
   * **Warum nur ein Wort.** Der Pfad, der Inhalt und der Schluesselabdruck
   * duerfen nicht in eine Meldung, die irgendwo landet. Ein Schritt ist genug,
   * um beim naechsten Mal zu wissen, wo zu suchen ist.
   */
  constructor(readonly step: "open" | "size" | "read" | "aborted" | "unknown" = "unknown") {
    super("Provider E2E evidence is unavailable.");
    this.name = "ProviderE2EEvidenceUnavailableError";
  }
}
recognisedByName(ProviderE2EEvidenceUnavailableError, "ProviderE2EEvidenceUnavailableError");

export interface ProviderE2EEvidenceFileProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

/** Reads signed certification inputs without following links or accepting mutable files. */
export class ProviderE2EEvidenceFileReader
implements ProviderE2EEvidenceFileProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError(
        "Provider E2E evidence files require bounded absolute paths.",
      );
    }
  }

  async read(options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    // Der Schritt wandert mit: Jeder Wurf unten traegt ihn, und der Fang
    // draussen gibt ihn weiter, statt vier verschiedene Ursachen auf dieselbe
    // Meldung abzubilden.
    let step: "open" | "size" | "read" | "aborted" = "open";
    try {
      if (options.signal?.aborted) { step = "aborted"; throw new Error("Aborted"); }
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      step = "size";
      if (!metadata.isFile() ||
          metadata.size < MIN_FILE_BYTES ||
          metadata.size > this.maxBytes ||
          (this.production && (metadata.mode & 0o022) !== 0)) {
        throw new Error("Invalid evidence file");
      }
      step = "read";
      const bytes = Buffer.alloc(metadata.size);
      const result = await handle.read(bytes, 0, metadata.size, 0);
      if (options.signal?.aborted) { step = "aborted"; throw new Error("Aborted"); }
      if (result.bytesRead !== metadata.size) {
        throw new Error("Incomplete evidence file");
      }
      return bytes;
    } catch {
      throw new ProviderE2EEvidenceUnavailableError(step);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function providerE2EEvidenceFileReader(
  path: string,
  production = false,
): ProviderE2EEvidenceFileReader {
  return new ProviderE2EEvidenceFileReader(
    path,
    MAX_EVIDENCE_FILE_BYTES,
    production,
  );
}

export function providerE2EVerifierKeyFileReader(
  path: string,
  production = false,
): ProviderE2EEvidenceFileReader {
  return new ProviderE2EEvidenceFileReader(path, MAX_KEY_FILE_BYTES, production);
}

export class ProviderE2EEvidenceVerifier {
  private readonly expectedPublicKeyDigest: Buffer;
  private readonly expected: ProviderE2EEvidenceExpectation;

  constructor(
    private readonly evidenceProvider: ProviderE2EEvidenceFileProvider,
    private readonly keyProvider: ProviderE2EEvidenceFileProvider,
    expectedPublicKeySha256: string,
    expectation: ProviderE2EEvidenceExpectation,
    private readonly now: () => Date = () => new Date(),
  ) {
    const pins = expectation && [
      expectation.providerIdentitySha256,
      expectation.providerConfigurationSha256,
      expectation.brokerContractSha256,
      expectation.vaultPolicySha256,
      expectation.pagerRoutingSha256,
      expectation.backupRestoreEvidenceSha256,
      expectation.runtimeDeploymentEvidenceSha256,
    ];
    if (!evidenceProvider || typeof evidenceProvider.read !== "function" ||
        !keyProvider || typeof keyProvider.read !== "function" ||
        !SHA256.test(expectedPublicKeySha256) ||
        !pins ||
        pins.some((pin) => !SHA256.test(pin)) ||
        new Set([expectedPublicKeySha256, ...pins]).size !== 8) {
      throw new ConfigurationError(
        "Provider E2E evidence requires providers, seven distinct policy pins and a public-key pin.",
      );
    }
    this.expectedPublicKeyDigest = Buffer.from(expectedPublicKeySha256, "hex");
    this.expected = Object.freeze({ ...expectation });
  }

  async verify(signal?: AbortSignal): Promise<ProviderE2EEvidenceReadiness> {
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
        canonicalProviderE2EEvidencePayload(envelope),
        publicKey,
        signature,
      )) {
        throw new Error("Invalid signature");
      }
      return readiness(envelope.evidence, this.expected, this.now());
    } catch {
      throw new ProviderE2EEvidenceUnavailableError();
    }
  }
}

/** Exact deterministic payload that the independent certification runner signs. */
export function canonicalProviderE2EEvidencePayload(
  envelope: Pick<ProviderE2EEvidenceEnvelope, "schemaVersion" | "keyId" | "evidence">,
): Buffer {
  const evidence = envelope.evidence;
  return Buffer.from(JSON.stringify([
    envelope.schemaVersion,
    envelope.keyId,
    evidence.evidenceId,
    evidence.deployment,
    evidence.scope,
    evidence.providerIdentitySha256,
    evidence.providerConfigurationSha256,
    evidence.brokerContractSha256,
    evidence.vaultPolicySha256,
    evidence.pagerRoutingSha256,
    evidence.backupRestoreEvidenceSha256,
    evidence.runtimeDeploymentEvidenceSha256,
    evidence.testRunStartedAt,
    evidence.testRunCompletedAt,
    evidence.certifiedAt,
    evidence.testRunDurationSeconds,
    evidence.postgresMajorVersion,
    evidence.scenarioCount,
    [
      evidence.scenarios.provisioningSucceeded,
      evidence.scenarios.provisioningIdempotencyVerified,
      evidence.scenarios.invalidBrokerSignatureRejected,
      evidence.scenarios.vaultCredentialIssued,
      evidence.scenarios.vaultRotationVerified,
      evidence.scenarios.previousVaultCredentialRevoked,
      evidence.scenarios.tlsCertificatePinVerified,
      evidence.scenarios.migrationApplyVerified,
      evidence.scenarios.crashAfterCommitReconciled,
      evidence.scenarios.leaseLossCancelled,
      evidence.scenarios.rollbackRetryVerified,
      evidence.scenarios.crossTenantIsolationVerified,
      evidence.scenarios.applyDeliveryVerified,
      evidence.scenarios.incidentPagerDeliveryVerified,
      evidence.scenarios.metricsAlertLifecycleVerified,
    ],
    evidence.result,
  ]), "utf8");
}

function parseEvidenceEnvelope(bytes: Uint8Array): ProviderE2EEvidenceEnvelope {
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

function evidenceFrom(value: unknown): ProviderE2EEvidence {
  if (!isObject(value)) throw new Error("Invalid evidence");
  exactKeys(value, [
    "evidenceId",
    "deployment",
    "scope",
    "providerIdentitySha256",
    "providerConfigurationSha256",
    "brokerContractSha256",
    "vaultPolicySha256",
    "pagerRoutingSha256",
    "backupRestoreEvidenceSha256",
    "runtimeDeploymentEvidenceSha256",
    "testRunStartedAt",
    "testRunCompletedAt",
    "certifiedAt",
    "testRunDurationSeconds",
    "postgresMajorVersion",
    "scenarioCount",
    "scenarios",
    "result",
  ]);
  const digests = [
    value.providerIdentitySha256,
    value.providerConfigurationSha256,
    value.brokerContractSha256,
    value.vaultPolicySha256,
    value.pagerRoutingSha256,
    value.backupRestoreEvidenceSha256,
    value.runtimeDeploymentEvidenceSha256,
  ];
  if (typeof value.evidenceId !== "string" || !UUID.test(value.evidenceId) ||
      value.deployment !== DEPLOYMENT ||
      value.scope !== SCOPE ||
      digests.some((digest) => typeof digest !== "string" || !SHA256.test(digest)) ||
      new Set(digests).size !== 7 ||
      typeof value.testRunStartedAt !== "string" ||
      !validTimestamp(value.testRunStartedAt) ||
      typeof value.testRunCompletedAt !== "string" ||
      !validTimestamp(value.testRunCompletedAt) ||
      typeof value.certifiedAt !== "string" ||
      !validTimestamp(value.certifiedAt) ||
      !safeDuration(value.testRunDurationSeconds) ||
      value.postgresMajorVersion !== 17 ||
      value.scenarioCount !== 15 ||
      value.result !== "passed") {
    throw new Error("Invalid evidence");
  }
  return {
    evidenceId: value.evidenceId,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    providerIdentitySha256: value.providerIdentitySha256 as string,
    providerConfigurationSha256: value.providerConfigurationSha256 as string,
    brokerContractSha256: value.brokerContractSha256 as string,
    vaultPolicySha256: value.vaultPolicySha256 as string,
    pagerRoutingSha256: value.pagerRoutingSha256 as string,
    backupRestoreEvidenceSha256: value.backupRestoreEvidenceSha256 as string,
    runtimeDeploymentEvidenceSha256: value.runtimeDeploymentEvidenceSha256 as string,
    testRunStartedAt: value.testRunStartedAt,
    testRunCompletedAt: value.testRunCompletedAt,
    certifiedAt: value.certifiedAt,
    testRunDurationSeconds: value.testRunDurationSeconds as number,
    postgresMajorVersion: 17,
    scenarioCount: 15,
    scenarios: scenariosFrom(value.scenarios),
    result: "passed",
  };
}

function scenariosFrom(value: unknown): ProviderE2EScenarios {
  if (!isObject(value)) throw new Error("Invalid scenarios");
  const keys = [
    "provisioningSucceeded",
    "provisioningIdempotencyVerified",
    "invalidBrokerSignatureRejected",
    "vaultCredentialIssued",
    "vaultRotationVerified",
    "previousVaultCredentialRevoked",
    "tlsCertificatePinVerified",
    "migrationApplyVerified",
    "crashAfterCommitReconciled",
    "leaseLossCancelled",
    "rollbackRetryVerified",
    "crossTenantIsolationVerified",
    "applyDeliveryVerified",
    "incidentPagerDeliveryVerified",
    "metricsAlertLifecycleVerified",
  ];
  exactKeys(value, keys);
  if (keys.some((key) => value[key] !== true)) {
    throw new Error("Incomplete provider E2E scenarios");
  }
  return value as ProviderE2EScenarios;
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
  evidence: ProviderE2EEvidence,
  expected: ProviderE2EEvidenceExpectation,
  now: Date,
): ProviderE2EEvidenceReadiness {
  const testRunStartedAt = Date.parse(evidence.testRunStartedAt);
  const testRunCompletedAt = Date.parse(evidence.testRunCompletedAt);
  const certifiedAt = Date.parse(evidence.certifiedAt);
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt) ||
      evidence.providerIdentitySha256 !== expected.providerIdentitySha256 ||
      evidence.providerConfigurationSha256 !== expected.providerConfigurationSha256 ||
      evidence.brokerContractSha256 !== expected.brokerContractSha256 ||
      evidence.vaultPolicySha256 !== expected.vaultPolicySha256 ||
      evidence.pagerRoutingSha256 !== expected.pagerRoutingSha256 ||
      evidence.backupRestoreEvidenceSha256 !== expected.backupRestoreEvidenceSha256 ||
      evidence.runtimeDeploymentEvidenceSha256 !==
        expected.runtimeDeploymentEvidenceSha256 ||
      testRunStartedAt > testRunCompletedAt ||
      testRunCompletedAt > certifiedAt ||
      exactSeconds(testRunCompletedAt - testRunStartedAt) !==
        evidence.testRunDurationSeconds ||
      evidence.testRunDurationSeconds <
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMinSeconds ||
      evidence.testRunDurationSeconds >
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMaxSeconds ||
      exactSeconds(certifiedAt - testRunCompletedAt) >
        PROVIDER_E2E_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      certifiedAt >
        nowAt + PROVIDER_E2E_EVIDENCE_POLICY.futureClockSkewSeconds * 1_000 ||
      nowAt - certifiedAt >
        PROVIDER_E2E_EVIDENCE_POLICY.evidenceMaxAgeSeconds * 1_000) {
    throw new Error("Evidence does not satisfy readiness policy");
  }
  return Object.freeze({
    status: "ready",
    deployment: DEPLOYMENT,
    scope: SCOPE,
    testRunCompletedAt: evidence.testRunCompletedAt,
    certifiedAt: evidence.certifiedAt,
    testRunDurationSeconds: evidence.testRunDurationSeconds,
    postgresMajorVersion: 17,
    scenarioCount: 15,
    policy: PROVIDER_E2E_EVIDENCE_POLICY,
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
    (value as number) <= 24 * 60 * 60;
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
