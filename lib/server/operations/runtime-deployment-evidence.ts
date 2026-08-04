import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  runtimeDeploymentBundleSha256,
  type BackgroundRuntimeComponent,
  type RuntimeDeploymentOptions,
} from "@/lib/server/operations/runtime-deployment";

const EVIDENCE_SCHEMA = "qkern.runtime-deployment-evidence/v1" as const;
const KEY_SCHEMA = "qkern.runtime-deployment-verifier-key/v1" as const;
const DEPLOYMENT = "production" as const;
const SCOPE = "background_runtimes" as const;
const COMPONENTS = [
  "project-provisioner",
  "migration-worker",
  "apply-publisher",
  "incident-publisher",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MIN_FILE_BYTES = 2;
const MAX_EVIDENCE_FILE_BYTES = 32_768;
const MAX_KEY_FILE_BYTES = 1_024;

export const RUNTIME_DEPLOYMENT_EVIDENCE_POLICY = Object.freeze({
  evidenceMaxAgeSeconds: 24 * 60 * 60,
  observationDurationMinSeconds: 30 * 60,
  observationDurationMaxSeconds: 2 * 60 * 60,
  certificationLagMaxSeconds: 15 * 60,
  futureClockSkewSeconds: 5 * 60,
});

export type RuntimeDeploymentComponentEvidence = Readonly<{
  name: BackgroundRuntimeComponent;
  desiredReplicas: 1;
  readyReplicas: 1;
  updatedReplicas: 1;
  availableReplicas: 1;
  imageDigestSha256: string;
  rolloutVerified: true;
  livenessProbeVerified: true;
  readinessProbeVerified: true;
  sigtermShutdownVerified: true;
  restartRecoveryVerified: true;
  serviceAccountTokenAbsent: true;
  securityContextVerified: true;
  secretProjectionVerified: true;
}>;

export type RuntimeDeploymentEvidence = Readonly<{
  evidenceId: string;
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  namespace: string;
  clusterIdentitySha256: string;
  deploymentBundleSha256: string;
  networkPolicySha256: string;
  imageProvenanceSha256: string;
  imageDigestSha256: string;
  observationStartedAt: string;
  observationCompletedAt: string;
  certifiedAt: string;
  observationDurationSeconds: number;
  componentCount: 4;
  components: readonly RuntimeDeploymentComponentEvidence[];
  networkPolicy: Readonly<{
    defaultDenyIngressVerified: true;
    defaultDenyEgressVerified: true;
    componentEgressAllowlistVerified: true;
    externalServiceSelectorsAbsent: true;
    ingressResourcesAbsent: true;
  }>;
  supplyChain: Readonly<{
    imageSignatureVerified: true;
    sbomVerified: true;
    vulnerabilityPolicyPassed: true;
    provenanceVerified: true;
  }>;
  monitoring: Readonly<{
    metricsScrapeVerified: true;
    probeAlertsVerified: true;
    crashLoopAlertsVerified: true;
  }>;
  result: "passed";
}>;

export type RuntimeDeploymentEvidenceEnvelope = Readonly<{
  schemaVersion: typeof EVIDENCE_SCHEMA;
  keyId: string;
  evidence: RuntimeDeploymentEvidence;
  signature: string;
}>;

export type RuntimeDeploymentEvidenceReadiness = Readonly<{
  status: "ready";
  deployment: typeof DEPLOYMENT;
  scope: typeof SCOPE;
  observedAt: string;
  certifiedAt: string;
  observationDurationSeconds: number;
  componentCount: 4;
  policy: typeof RUNTIME_DEPLOYMENT_EVIDENCE_POLICY;
}>;

export type RuntimeDeploymentEvidenceExpectation = Readonly<{
  deploymentOptions: RuntimeDeploymentOptions;
  clusterIdentitySha256: string;
  networkPolicySha256: string;
  imageProvenanceSha256: string;
}>;

type ExpectedRuntimeDeploymentPins = Readonly<{
  namespace: string;
  clusterIdentitySha256: string;
  deploymentBundleSha256: string;
  networkPolicySha256: string;
  imageProvenanceSha256: string;
  imageDigestSha256: string;
}>;

export class RuntimeDeploymentEvidenceUnavailableError extends Error {
  readonly code = "RUNTIME_DEPLOYMENT_EVIDENCE_UNAVAILABLE";

  constructor() {
    super("Runtime deployment evidence is unavailable.");
    this.name = "RuntimeDeploymentEvidenceUnavailableError";
  }
}

export interface RuntimeDeploymentEvidenceFileProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

export class RuntimeDeploymentEvidenceFileReader
implements RuntimeDeploymentEvidenceFileProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError(
        "Runtime deployment evidence files require bounded absolute paths.",
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
      throw new RuntimeDeploymentEvidenceUnavailableError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function runtimeDeploymentEvidenceFileReader(
  path: string,
  production = false,
): RuntimeDeploymentEvidenceFileReader {
  return new RuntimeDeploymentEvidenceFileReader(
    path,
    MAX_EVIDENCE_FILE_BYTES,
    production,
  );
}

export function runtimeDeploymentVerifierKeyFileReader(
  path: string,
  production = false,
): RuntimeDeploymentEvidenceFileReader {
  return new RuntimeDeploymentEvidenceFileReader(path, MAX_KEY_FILE_BYTES, production);
}

export class RuntimeDeploymentEvidenceVerifier {
  private readonly expectedPublicKeyDigest: Buffer;
  private readonly expected: ExpectedRuntimeDeploymentPins;

  constructor(
    private readonly evidenceProvider: RuntimeDeploymentEvidenceFileProvider,
    private readonly keyProvider: RuntimeDeploymentEvidenceFileProvider,
    expectedPublicKeySha256: string,
    expectation: RuntimeDeploymentEvidenceExpectation,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!evidenceProvider || typeof evidenceProvider.read !== "function" ||
        !keyProvider || typeof keyProvider.read !== "function" ||
        !SHA256.test(expectedPublicKeySha256) ||
        !expectation ||
        !SHA256.test(expectation.clusterIdentitySha256) ||
        !SHA256.test(expectation.networkPolicySha256) ||
        !SHA256.test(expectation.imageProvenanceSha256) ||
        new Set([
          expectedPublicKeySha256,
          expectation.clusterIdentitySha256,
          expectation.networkPolicySha256,
          expectation.imageProvenanceSha256,
        ]).size !== 4) {
      throw new ConfigurationError(
        "Runtime deployment evidence requires providers, distinct policy pins and a public-key pin.",
      );
    }
    const deploymentBundleDigest = runtimeDeploymentBundleSha256(
      expectation.deploymentOptions,
    );
    const imageDigest = imageDigestFrom(expectation.deploymentOptions.image);
    this.expectedPublicKeyDigest = Buffer.from(expectedPublicKeySha256, "hex");
    this.expected = Object.freeze({
      namespace: expectation.deploymentOptions.namespace,
      clusterIdentitySha256: expectation.clusterIdentitySha256,
      deploymentBundleSha256: deploymentBundleDigest,
      networkPolicySha256: expectation.networkPolicySha256,
      imageProvenanceSha256: expectation.imageProvenanceSha256,
      imageDigestSha256: imageDigest,
    });
  }

  async verify(signal?: AbortSignal): Promise<RuntimeDeploymentEvidenceReadiness> {
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
        canonicalRuntimeDeploymentEvidencePayload(envelope),
        publicKey,
        signature,
      )) {
        throw new Error("Invalid signature");
      }
      return readiness(envelope.evidence, this.expected, this.now());
    } catch {
      throw new RuntimeDeploymentEvidenceUnavailableError();
    }
  }
}

export function canonicalRuntimeDeploymentEvidencePayload(
  envelope: Pick<RuntimeDeploymentEvidenceEnvelope, "schemaVersion" | "keyId" | "evidence">,
): Buffer {
  const evidence = envelope.evidence;
  return Buffer.from(JSON.stringify([
    envelope.schemaVersion,
    envelope.keyId,
    evidence.evidenceId,
    evidence.deployment,
    evidence.scope,
    evidence.namespace,
    evidence.clusterIdentitySha256,
    evidence.deploymentBundleSha256,
    evidence.networkPolicySha256,
    evidence.imageProvenanceSha256,
    evidence.imageDigestSha256,
    evidence.observationStartedAt,
    evidence.observationCompletedAt,
    evidence.certifiedAt,
    evidence.observationDurationSeconds,
    evidence.componentCount,
    evidence.components.map((component) => [
      component.name,
      component.desiredReplicas,
      component.readyReplicas,
      component.updatedReplicas,
      component.availableReplicas,
      component.imageDigestSha256,
      component.rolloutVerified,
      component.livenessProbeVerified,
      component.readinessProbeVerified,
      component.sigtermShutdownVerified,
      component.restartRecoveryVerified,
      component.serviceAccountTokenAbsent,
      component.securityContextVerified,
      component.secretProjectionVerified,
    ]),
    [
      evidence.networkPolicy.defaultDenyIngressVerified,
      evidence.networkPolicy.defaultDenyEgressVerified,
      evidence.networkPolicy.componentEgressAllowlistVerified,
      evidence.networkPolicy.externalServiceSelectorsAbsent,
      evidence.networkPolicy.ingressResourcesAbsent,
    ],
    [
      evidence.supplyChain.imageSignatureVerified,
      evidence.supplyChain.sbomVerified,
      evidence.supplyChain.vulnerabilityPolicyPassed,
      evidence.supplyChain.provenanceVerified,
    ],
    [
      evidence.monitoring.metricsScrapeVerified,
      evidence.monitoring.probeAlertsVerified,
      evidence.monitoring.crashLoopAlertsVerified,
    ],
    evidence.result,
  ]), "utf8");
}

function parseEvidenceEnvelope(bytes: Uint8Array): RuntimeDeploymentEvidenceEnvelope {
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

function evidenceFrom(value: unknown): RuntimeDeploymentEvidence {
  if (!isObject(value)) throw new Error("Invalid evidence");
  exactKeys(value, [
    "evidenceId",
    "deployment",
    "scope",
    "namespace",
    "clusterIdentitySha256",
    "deploymentBundleSha256",
    "networkPolicySha256",
    "imageProvenanceSha256",
    "imageDigestSha256",
    "observationStartedAt",
    "observationCompletedAt",
    "certifiedAt",
    "observationDurationSeconds",
    "componentCount",
    "components",
    "networkPolicy",
    "supplyChain",
    "monitoring",
    "result",
  ]);
  if (typeof value.evidenceId !== "string" || !UUID.test(value.evidenceId) ||
      value.deployment !== DEPLOYMENT ||
      value.scope !== SCOPE ||
      typeof value.namespace !== "string" ||
      !DNS_LABEL.test(value.namespace) ||
      !shaFields([
        value.clusterIdentitySha256,
        value.deploymentBundleSha256,
        value.networkPolicySha256,
        value.imageProvenanceSha256,
        value.imageDigestSha256,
      ]) ||
      typeof value.observationStartedAt !== "string" ||
      !validTimestamp(value.observationStartedAt) ||
      typeof value.observationCompletedAt !== "string" ||
      !validTimestamp(value.observationCompletedAt) ||
      typeof value.certifiedAt !== "string" ||
      !validTimestamp(value.certifiedAt) ||
      !safeDuration(value.observationDurationSeconds) ||
      value.componentCount !== 4 ||
      !Array.isArray(value.components) ||
      value.components.length !== 4 ||
      value.result !== "passed") {
    throw new Error("Invalid evidence");
  }
  const components = value.components.map(componentFrom);
  return {
    evidenceId: value.evidenceId,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    namespace: value.namespace,
    clusterIdentitySha256: value.clusterIdentitySha256 as string,
    deploymentBundleSha256: value.deploymentBundleSha256 as string,
    networkPolicySha256: value.networkPolicySha256 as string,
    imageProvenanceSha256: value.imageProvenanceSha256 as string,
    imageDigestSha256: value.imageDigestSha256 as string,
    observationStartedAt: value.observationStartedAt,
    observationCompletedAt: value.observationCompletedAt,
    certifiedAt: value.certifiedAt,
    observationDurationSeconds: value.observationDurationSeconds as number,
    componentCount: 4,
    components,
    networkPolicy: networkPolicyFrom(value.networkPolicy),
    supplyChain: supplyChainFrom(value.supplyChain),
    monitoring: monitoringFrom(value.monitoring),
    result: "passed",
  };
}

function componentFrom(value: unknown): RuntimeDeploymentComponentEvidence {
  if (!isObject(value)) throw new Error("Invalid component evidence");
  exactKeys(value, [
    "name",
    "desiredReplicas",
    "readyReplicas",
    "updatedReplicas",
    "availableReplicas",
    "imageDigestSha256",
    "rolloutVerified",
    "livenessProbeVerified",
    "readinessProbeVerified",
    "sigtermShutdownVerified",
    "restartRecoveryVerified",
    "serviceAccountTokenAbsent",
    "securityContextVerified",
    "secretProjectionVerified",
  ]);
  if (!COMPONENTS.includes(value.name as BackgroundRuntimeComponent) ||
      value.desiredReplicas !== 1 ||
      value.readyReplicas !== 1 ||
      value.updatedReplicas !== 1 ||
      value.availableReplicas !== 1 ||
      typeof value.imageDigestSha256 !== "string" ||
      !SHA256.test(value.imageDigestSha256) ||
      value.rolloutVerified !== true ||
      value.livenessProbeVerified !== true ||
      value.readinessProbeVerified !== true ||
      value.sigtermShutdownVerified !== true ||
      value.restartRecoveryVerified !== true ||
      value.serviceAccountTokenAbsent !== true ||
      value.securityContextVerified !== true ||
      value.secretProjectionVerified !== true) {
    throw new Error("Invalid component evidence");
  }
  return value as RuntimeDeploymentComponentEvidence;
}

function networkPolicyFrom(value: unknown): RuntimeDeploymentEvidence["networkPolicy"] {
  if (!isObject(value)) throw new Error("Invalid network policy evidence");
  exactKeys(value, [
    "defaultDenyIngressVerified",
    "defaultDenyEgressVerified",
    "componentEgressAllowlistVerified",
    "externalServiceSelectorsAbsent",
    "ingressResourcesAbsent",
  ]);
  if (value.defaultDenyIngressVerified !== true ||
      value.defaultDenyEgressVerified !== true ||
      value.componentEgressAllowlistVerified !== true ||
      value.externalServiceSelectorsAbsent !== true ||
      value.ingressResourcesAbsent !== true) {
    throw new Error("Invalid network policy evidence");
  }
  return value as RuntimeDeploymentEvidence["networkPolicy"];
}

function supplyChainFrom(value: unknown): RuntimeDeploymentEvidence["supplyChain"] {
  if (!isObject(value)) throw new Error("Invalid supply-chain evidence");
  exactKeys(value, [
    "imageSignatureVerified",
    "sbomVerified",
    "vulnerabilityPolicyPassed",
    "provenanceVerified",
  ]);
  if (value.imageSignatureVerified !== true ||
      value.sbomVerified !== true ||
      value.vulnerabilityPolicyPassed !== true ||
      value.provenanceVerified !== true) {
    throw new Error("Invalid supply-chain evidence");
  }
  return value as RuntimeDeploymentEvidence["supplyChain"];
}

function monitoringFrom(value: unknown): RuntimeDeploymentEvidence["monitoring"] {
  if (!isObject(value)) throw new Error("Invalid monitoring evidence");
  exactKeys(value, [
    "metricsScrapeVerified",
    "probeAlertsVerified",
    "crashLoopAlertsVerified",
  ]);
  if (value.metricsScrapeVerified !== true ||
      value.probeAlertsVerified !== true ||
      value.crashLoopAlertsVerified !== true) {
    throw new Error("Invalid monitoring evidence");
  }
  return value as RuntimeDeploymentEvidence["monitoring"];
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
  evidence: RuntimeDeploymentEvidence,
  expected: ExpectedRuntimeDeploymentPins,
  now: Date,
): RuntimeDeploymentEvidenceReadiness {
  const observationStartedAt = Date.parse(evidence.observationStartedAt);
  const observationCompletedAt = Date.parse(evidence.observationCompletedAt);
  const certifiedAt = Date.parse(evidence.certifiedAt);
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt) ||
      evidence.namespace !== expected.namespace ||
      evidence.clusterIdentitySha256 !== expected.clusterIdentitySha256 ||
      evidence.deploymentBundleSha256 !== expected.deploymentBundleSha256 ||
      evidence.networkPolicySha256 !== expected.networkPolicySha256 ||
      evidence.imageProvenanceSha256 !== expected.imageProvenanceSha256 ||
      evidence.imageDigestSha256 !== expected.imageDigestSha256 ||
      observationStartedAt > observationCompletedAt ||
      observationCompletedAt > certifiedAt ||
      exactSeconds(observationCompletedAt - observationStartedAt) !==
        evidence.observationDurationSeconds ||
      evidence.observationDurationSeconds <
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMinSeconds ||
      evidence.observationDurationSeconds >
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMaxSeconds ||
      exactSeconds(certifiedAt - observationCompletedAt) >
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      certifiedAt > nowAt +
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.futureClockSkewSeconds * 1_000 ||
      nowAt - certifiedAt >
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.evidenceMaxAgeSeconds * 1_000 ||
      evidence.components.some((component, index) =>
        component.name !== COMPONENTS[index] ||
        component.imageDigestSha256 !== expected.imageDigestSha256)) {
    throw new Error("Evidence does not satisfy readiness policy");
  }
  return Object.freeze({
    status: "ready",
    deployment: DEPLOYMENT,
    scope: SCOPE,
    observedAt: evidence.observationCompletedAt,
    certifiedAt: evidence.certifiedAt,
    observationDurationSeconds: evidence.observationDurationSeconds,
    componentCount: 4,
    policy: RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
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
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds % 1_000 !== 0) {
    return Number.NaN;
  }
  return milliseconds / 1_000;
}

function shaFields(values: unknown[]): boolean {
  return values.every((value) => typeof value === "string" && SHA256.test(value));
}

function imageDigestFrom(image: string): string {
  const digest = image.split("@sha256:")[1];
  if (!digest || !SHA256.test(digest)) {
    throw new ConfigurationError("Runtime image must be digest-pinned.");
  }
  return digest;
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
