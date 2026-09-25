import { recognisedByName } from "@/lib/server/errors/identity";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConfigurationError } from "@/lib/server/db/errors";

const MAX_BUNDLE_BYTES = 1_048_576;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PINNED_IMAGE =
  /^[a-z0-9](?:[a-z0-9._:/-]{0,446})@sha256:([a-f0-9]{64})$/;
const COMPONENTS = [
  "project-provisioner",
  "migration-worker",
  "apply-publisher",
  "incident-publisher",
] as const;

export type BackgroundRuntimeComponent = typeof COMPONENTS[number];

export type RuntimeDeploymentOptions = Readonly<{
  namespace: string;
  image: string;
  configMapName: string;
  secretName: string;
}>;

export type RuntimeDeploymentReadiness = Readonly<{
  status: "ready";
  deployment: "production";
  componentCount: 4;
  components: readonly BackgroundRuntimeComponent[];
  policy: Readonly<{
    digestPinnedImage: true;
    nonRoot: true;
    readOnlyRootFilesystem: true;
    privilegeEscalationDisabled: true;
    capabilitiesDropped: true;
    serviceAccountTokenDisabled: true;
    hostNamespacesDisabled: true;
    loopbackExecProbes: true;
    oneContainerPerWorkload: true;
    oneReplicaPerWorkload: true;
    publicNetworkResourcesAbsent: true;
  }>;
}>;

export interface RuntimeDeploymentBundleProvider {
  read(options?: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

export class RuntimeDeploymentNotReadyError extends Error {
  readonly code = "RUNTIME_DEPLOYMENT_NOT_READY";

  constructor() {
    super("Background runtime deployment is not ready.");
    this.name = "RuntimeDeploymentNotReadyError";
  }
}
recognisedByName(RuntimeDeploymentNotReadyError, "RuntimeDeploymentNotReadyError");

export class RuntimeDeploymentFileReader implements RuntimeDeploymentBundleProvider {
  constructor(
    private readonly path: string,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0")) {
      throw new ConfigurationError(
        "Runtime deployment verification requires a bounded absolute file path.",
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
          metadata.size < 2 ||
          metadata.size > MAX_BUNDLE_BYTES ||
          (this.production && (metadata.mode & 0o022) !== 0)) {
        throw new Error("Invalid deployment bundle");
      }
      const bytes = Buffer.alloc(metadata.size);
      const result = await handle.read(bytes, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal?.aborted) {
        throw new Error("Incomplete deployment bundle");
      }
      return bytes;
    } catch {
      throw new RuntimeDeploymentNotReadyError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export class RuntimeDeploymentVerifier {
  private readonly options: RuntimeDeploymentOptions;

  constructor(
    private readonly provider: RuntimeDeploymentBundleProvider,
    options: RuntimeDeploymentOptions,
  ) {
    if (!provider || typeof provider.read !== "function") {
      throw new ConfigurationError("Runtime deployment verification requires a file provider.");
    }
    this.options = validatedOptions(options);
  }

  async verify(signal?: AbortSignal): Promise<RuntimeDeploymentReadiness> {
    try {
      const bytes = await this.provider.read({ signal });
      if (signal?.aborted) throw new Error("Aborted");
      const actual = parseBundle(bytes);
      const expected = generateRuntimeDeploymentBundle(this.options);
      if (!isDeepStrictEqual(actual, expected)) throw new Error("Deployment policy mismatch");
      return readiness();
    } catch {
      throw new RuntimeDeploymentNotReadyError();
    }
  }
}

export function generateRuntimeDeploymentBundle(
  input: RuntimeDeploymentOptions,
): Readonly<Record<string, unknown>> {
  const options = validatedOptions(input);
  const items: Array<Record<string, unknown>> = [];
  for (const component of COMPONENTS) {
    items.push(serviceAccount(component, options));
    items.push(deployment(component, options));
  }
  return Object.freeze({
    apiVersion: "v1",
    kind: "List",
    items,
  });
}

export function serializeRuntimeDeploymentBundle(
  input: RuntimeDeploymentOptions,
): string {
  return `${JSON.stringify(generateRuntimeDeploymentBundle(input), null, 2)}\n`;
}

export function runtimeDeploymentBundleSha256(
  input: RuntimeDeploymentOptions,
): string {
  return createHash("sha256")
    .update(serializeRuntimeDeploymentBundle(input), "utf8")
    .digest("hex");
}

function deployment(
  component: BackgroundRuntimeComponent,
  options: RuntimeDeploymentOptions,
): Record<string, unknown> {
  const name = `qkern-${component}`;
  const labels = runtimeLabels(component);
  const authorities = authorityFiles(component);
  const productionApplyAuthorities = component === "migration-worker"
    ? [
        "production-apply-authorization.json",
        "production-apply-verifier-key.json",
      ]
    : [];
  const volumeMounts: Array<Record<string, unknown>> = [{
    name: "runtime-tmp",
    mountPath: "/tmp",
  }];
  const volumes: Array<Record<string, unknown>> = [{
    name: "runtime-tmp",
    emptyDir: { medium: "Memory", sizeLimit: "64Mi" },
  }];
  if (authorities.length > 0) {
    volumeMounts.push({
      name: "runtime-authority",
      mountPath: "/run/qkern/authorities",
      readOnly: true,
    });
    volumes.push({
      name: "runtime-authority",
      secret: {
        secretName: options.secretName,
        defaultMode: 0o400,
        items: authorities.map((authority) => ({
          key: authority.secretKey,
          path: authority.fileName,
        })),
      },
    });
  }
  if (productionApplyAuthorities.length > 0) {
    volumeMounts.push({
      name: "production-apply-authority",
      mountPath: "/run/qkern/production-apply",
      readOnly: true,
    });
    volumes.push({
      name: "production-apply-authority",
      secret: {
        secretName: options.secretName,
        defaultMode: 0o400,
        optional: true,
        items: productionApplyAuthorities.map((fileName) => ({
          key: fileName,
          path: fileName,
        })),
      },
    });
  }

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace: options.namespace, labels },
    spec: {
      replicas: 1,
      revisionHistoryLimit: 2,
      progressDeadlineSeconds: 600,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { "qkern.io/runtime": component } },
      template: {
        metadata: { labels },
        spec: {
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          hostNetwork: false,
          hostPID: false,
          hostIPC: false,
          serviceAccountName: name,
          terminationGracePeriodSeconds: 90,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 10_001,
            runAsGroup: 10_001,
            fsGroup: 10_001,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [{
            name: component,
            image: options.image,
            imagePullPolicy: "IfNotPresent",
            command: ["node", "--import", "tsx", componentEntry(component)],
            env: componentEnvironment(component, options),
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "1000m", memory: "1Gi" },
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              privileged: false,
              capabilities: { drop: ["ALL"] },
            },
            livenessProbe: execProbe("live", 30, 3),
            readinessProbe: execProbe("ready", 15, 2),
            volumeMounts,
          }],
          volumes,
        },
      },
    },
  };
}

function serviceAccount(
  component: BackgroundRuntimeComponent,
  options: RuntimeDeploymentOptions,
): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: `qkern-${component}`,
      namespace: options.namespace,
      labels: runtimeLabels(component),
    },
    automountServiceAccountToken: false,
  };
}

function componentEnvironment(
  component: BackgroundRuntimeComponent,
  options: RuntimeDeploymentOptions,
): Array<Record<string, unknown>> {
  const common = [
    literal("NODE_ENV", "production"),
    literal("QKERN_RUNTIME_MODE", "postgres"),
    literal("DATABASE_SSL", "require"),
    literal("QKERN_RUNTIME_PROBE_ENABLED", "true"),
    literal("QKERN_RUNTIME_PROBE_HOST", "127.0.0.1"),
    literal("QKERN_RUNTIME_PROBE_PORT", "9464"),
    literal("QKERN_RUNTIME_PROBE_STALE_AFTER_MS", "120000"),
  ];
  if (component === "project-provisioner") {
    return [
      ...common,
      literal("QKERN_PROJECT_PROVISIONER_ENABLED", "true"),
      config("QKERN_PROVISIONER_ORGANIZATION_ID", options.configMapName, "organization-id"),
      field("QKERN_PROJECT_PROVISIONER_ID", "metadata.name"),
      secret("QKERN_PROVISIONER_DATABASE_URL", options.secretName, "provisioner-database-url"),
      config("QKERN_PROVISIONING_BROKER_URL", options.configMapName, "provisioning-broker-url"),
      config(
        "QKERN_PROVISIONING_BROKER_ALLOWED_HOSTS",
        options.configMapName,
        "provisioning-broker-allowed-hosts",
      ),
      literal(
        "QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE",
        "/run/qkern/authorities/provisioning-broker-key.json",
      ),
    ];
  }
  if (component === "migration-worker") {
    return [
      ...common,
      literal("QKERN_MIGRATION_WORKER_ENABLED", "true"),
      config("QKERN_WORKER_ORGANIZATION_ID", options.configMapName, "organization-id"),
      field("QKERN_MIGRATION_WORKER_ID", "metadata.name"),
      secret("QKERN_WORKER_DATABASE_URL", options.secretName, "worker-database-url"),
      secret(
        "QKERN_STATEMENT_ENCRYPTION_KEY",
        options.secretName,
        "statement-encryption-key",
      ),
      literal("QKERN_PROJECT_DATABASE_CATALOG_SOURCE", "control-plane"),
      config("QKERN_VAULT_DATABASE_URL", options.configMapName, "vault-database-url"),
      literal("QKERN_VAULT_TOKEN_FILE", "/run/qkern/authorities/vault-token"),
      config(
        "QKERN_PRODUCTION_APPLY_ENABLED",
        options.configMapName,
        "production-apply-enabled",
      ),
      literal(
        "QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE",
        "/run/qkern/production-apply/production-apply-authorization.json",
      ),
      literal(
        "QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE",
        "/run/qkern/production-apply/production-apply-verifier-key.json",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_VERIFIER_KEY_SHA256",
        options.configMapName,
        "production-apply-verifier-key-sha256",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256",
        options.configMapName,
        "production-apply-release-artifact-sha256",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256",
        options.configMapName,
        "production-apply-backup-restore-evidence-sha256",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256",
        options.configMapName,
        "production-apply-runtime-deployment-evidence-sha256",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256",
        options.configMapName,
        "production-apply-provider-e2e-evidence-sha256",
      ),
      config(
        "QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256",
        options.configMapName,
        "production-apply-security-assessment-sha256",
      ),
    ];
  }
  if (component === "apply-publisher") {
    return [
      ...common,
      literal("QKERN_OUTBOX_PUBLISHER_ENABLED", "true"),
      config("QKERN_WORKER_ORGANIZATION_ID", options.configMapName, "organization-id"),
      field("QKERN_OUTBOX_PUBLISHER_ID", "metadata.name"),
      secret("QKERN_WORKER_DATABASE_URL", options.secretName, "worker-database-url"),
      config("QKERN_APPLY_BROKER_URL", options.configMapName, "apply-broker-url"),
      config(
        "QKERN_APPLY_BROKER_ALLOWED_HOSTS",
        options.configMapName,
        "apply-broker-allowed-hosts",
      ),
      literal(
        "QKERN_APPLY_BROKER_SIGNING_KEY_FILE",
        "/run/qkern/authorities/apply-broker-key.json",
      ),
    ];
  }
  return [
    ...common,
    literal("QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED", "true"),
    config("QKERN_WORKER_ORGANIZATION_ID", options.configMapName, "organization-id"),
    field("QKERN_INCIDENT_OUTBOX_PUBLISHER_ID", "metadata.name"),
    secret("QKERN_WORKER_DATABASE_URL", options.secretName, "worker-database-url"),
    config("QKERN_INCIDENT_WEBHOOK_URL", options.configMapName, "incident-webhook-url"),
    config(
      "QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS",
      options.configMapName,
      "incident-webhook-allowed-hosts",
    ),
    config(
      "QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID",
      options.configMapName,
      "incident-webhook-hmac-key-id",
    ),
    secret(
      "QKERN_INCIDENT_WEBHOOK_HMAC_SECRET",
      options.secretName,
      "incident-webhook-hmac-secret",
    ),
  ];
}

function runtimeLabels(component: BackgroundRuntimeComponent): Record<string, string> {
  return {
    "app.kubernetes.io/name": "qkern-background-runtime",
    "app.kubernetes.io/part-of": "qkern",
    "app.kubernetes.io/component": component,
    "qkern.io/runtime": component,
  };
}

function componentEntry(component: BackgroundRuntimeComponent): string {
  return ({
    "project-provisioner": "workers/project-provisioning-runtime.mts",
    "migration-worker": "workers/migration-runtime.mts",
    "apply-publisher": "workers/apply-outbox-runtime.mts",
    "incident-publisher": "workers/incident-outbox-runtime.mts",
  } as const)[component];
}

function authorityFiles(
  component: BackgroundRuntimeComponent,
): Array<{ secretKey: string; fileName: string }> {
  if (component === "project-provisioner") {
    return [{
      secretKey: "provisioning-broker-key.json",
      fileName: "provisioning-broker-key.json",
    }];
  }
  if (component === "migration-worker") {
    return [{ secretKey: "vault-token", fileName: "vault-token" }];
  }
  if (component === "apply-publisher") {
    return [{ secretKey: "apply-broker-key.json", fileName: "apply-broker-key.json" }];
  }
  return [];
}

function execProbe(path: "live" | "ready", periodSeconds: number, failureThreshold: number) {
  return {
    exec: {
      command: [
        "node",
        "-e",
        `fetch('http://127.0.0.1:9464/${path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
    },
    initialDelaySeconds: 5,
    periodSeconds,
    timeoutSeconds: 2,
    successThreshold: 1,
    failureThreshold,
  };
}

function literal(name: string, value: string): Record<string, unknown> {
  return { name, value };
}

function config(name: string, map: string, key: string): Record<string, unknown> {
  return { name, valueFrom: { configMapKeyRef: { name: map, key } } };
}

function secret(name: string, secretName: string, key: string): Record<string, unknown> {
  return { name, valueFrom: { secretKeyRef: { name: secretName, key } } };
}

function field(name: string, fieldPath: string): Record<string, unknown> {
  return { name, valueFrom: { fieldRef: { apiVersion: "v1", fieldPath } } };
}

function validatedOptions(input: RuntimeDeploymentOptions): RuntimeDeploymentOptions {
  if (!input || !validNamespace(input.namespace) ||
      !validDnsName(input.configMapName) ||
      !validDnsName(input.secretName) ||
      input.configMapName === input.secretName ||
      typeof input.image !== "string" ||
      !validImage(input.image)) {
    throw new ConfigurationError(
      "Runtime deployments require distinct bounded names and one non-placeholder digest-pinned image.",
    );
  }
  return Object.freeze({ ...input });
}

function validNamespace(value: unknown): value is string {
  return typeof value === "string" && DNS_LABEL.test(value);
}

function validDnsName(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 253 &&
    value.split(".").every((part) => DNS_LABEL.test(part));
}

function validImage(image: string): boolean {
  const match = PINNED_IMAGE.exec(image);
  if (!match || image.includes("://") || image.includes(".invalid/")) return false;
  const digest = match[1]!;
  return !/^0{64}$/.test(digest);
}

function readiness(): RuntimeDeploymentReadiness {
  return Object.freeze({
    status: "ready",
    deployment: "production",
    componentCount: 4,
    components: Object.freeze([...COMPONENTS]),
    policy: Object.freeze({
      digestPinnedImage: true,
      nonRoot: true,
      readOnlyRootFilesystem: true,
      privilegeEscalationDisabled: true,
      capabilitiesDropped: true,
      serviceAccountTokenDisabled: true,
      hostNamespacesDisabled: true,
      loopbackExecProbes: true,
      oneContainerPerWorkload: true,
      oneReplicaPerWorkload: true,
      publicNetworkResourcesAbsent: true,
    }),
  });
}

function parseBundle(bytes: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(bytes).toString("utf8");
  assertNoDuplicateJsonObjectKeys(text);
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) throw new Error("Expected deployment object");
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
