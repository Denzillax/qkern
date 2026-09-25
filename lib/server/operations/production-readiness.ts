import { recognisedByName } from "@/lib/server/errors/identity";
import { isDeepStrictEqual } from "node:util";
import { ConfigurationError } from "@/lib/server/db/errors";
import type { ReleaseEvidenceReadiness } from
  "@/lib/server/operations/release-evidence-readiness";
import type { RuntimeDeploymentReadiness } from
  "@/lib/server/operations/runtime-deployment";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_TRUE_FLAGS = [
  "QKERN_RUNTIME_PROBE_ENABLED",
  "QKERN_PROVISIONING_METRICS_ENABLED",
  "QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED",
  "QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED",
  "QKERN_PROVIDER_E2E_EVIDENCE_ENABLED",
  "QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED",
] as const;
const FORBIDDEN_INLINE_AUTHORITIES = [
  "QKERN_BACKUP_RESTORE_EVIDENCE",
  "QKERN_BACKUP_RESTORE_VERIFIER_KEY",
  "QKERN_RUNTIME_DEPLOYMENT_BUNDLE",
  "QKERN_RUNTIME_DEPLOYMENT_EVIDENCE",
  "QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY",
  "QKERN_PROVIDER_E2E_EVIDENCE",
  "QKERN_PROVIDER_E2E_VERIFIER_KEY",
  "QKERN_SECURITY_ASSESSMENT_EVIDENCE",
  "QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY",
  "QKERN_PRODUCTION_APPLY_AUTHORIZATION",
  "QKERN_PRODUCTION_APPLY_VERIFIER_KEY",
  "QKERN_VAULT_TOKEN",
  "VAULT_TOKEN",
] as const;

export const PRODUCTION_READINESS_POLICY = Object.freeze({
  runtimeComponentCount: 4,
  signedEvidenceCount: 4,
  pinnedArtifactCount: 5,
  organizationBindingCount: 1,
  postgresRuntimeRequired: true,
  databaseTlsRequired: true,
  httpsOriginsRequired: true,
  persistentCatalogRequired: true,
  productionApplyRemainsDisabled: true,
  dryRunOnly: true,
});

export type ProductionEnvironmentReadiness = Readonly<{
  status: "ready";
  deployment: "production";
  scope: "production_configuration";
  organizationBindingCount: 1;
  productionApplyEnabled: false;
}>;

export type ProductionReadiness = Readonly<{
  status: "ready_for_controlled_rollout";
  deployment: "production";
  scope: "controlled_rollout";
  runtimeComponentCount: 4;
  signedEvidenceCount: 4;
  pinnedArtifactCount: 5;
  organizationBindingCount: 1;
  productionApplyEnabled: false;
  policy: typeof PRODUCTION_READINESS_POLICY;
}>;

export class ProductionReadinessNotReadyError extends Error {
  readonly code = "PRODUCTION_READINESS_NOT_READY";

  constructor() {
    super("Production readiness is not ready.");
    this.name = "ProductionReadinessNotReadyError";
  }
}
recognisedByName(ProductionReadinessNotReadyError, "ProductionReadinessNotReadyError");

export interface ProductionReadinessGate<T> {
  verify(signal?: AbortSignal): Promise<T>;
}

/** Validates only secret-free rollout configuration; it never opens a socket. */
export class ProductionEnvironmentVerifier
implements ProductionReadinessGate<ProductionEnvironmentReadiness> {
  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {
    if (!env || typeof env !== "object") {
      throw new ConfigurationError("Production readiness requires an environment.");
    }
  }

  async verify(signal?: AbortSignal): Promise<ProductionEnvironmentReadiness> {
    try {
      if (signal?.aborted) throw new Error("Aborted");
      validateEnvironment(this.env);
      if (signal?.aborted) throw new Error("Aborted");
      return Object.freeze({
        status: "ready",
        deployment: "production",
        scope: "production_configuration",
        organizationBindingCount: 1,
        productionApplyEnabled: false,
      });
    } catch {
      throw new ProductionReadinessNotReadyError();
    }
  }
}

/**
 * Final dry-run gate. It verifies configuration, the hardened runtime bundle and
 * all external evidence, but intentionally cannot deploy or enable Production Apply.
 */
export class ProductionReadinessVerifier
implements ProductionReadinessGate<ProductionReadiness> {
  constructor(
    private readonly environmentVerifier:
      ProductionReadinessGate<ProductionEnvironmentReadiness>,
    private readonly runtimeDeploymentVerifier:
      ProductionReadinessGate<RuntimeDeploymentReadiness>,
    private readonly releaseEvidenceVerifier:
      ProductionReadinessGate<ReleaseEvidenceReadiness>,
  ) {
    if (!validGate(environmentVerifier) ||
        !validGate(runtimeDeploymentVerifier) ||
        !validGate(releaseEvidenceVerifier)) {
      throw new ConfigurationError(
        "Production readiness requires configuration, deployment and evidence gates.",
      );
    }
  }

  async verify(signal?: AbortSignal): Promise<ProductionReadiness> {
    try {
      const [environment, runtime, evidence] = await Promise.all([
        this.environmentVerifier.verify(signal),
        this.runtimeDeploymentVerifier.verify(signal),
        this.releaseEvidenceVerifier.verify(signal),
      ]);
      if (signal?.aborted || !validEnvironment(environment) ||
          !validRuntime(runtime) || !validEvidence(evidence)) {
        throw new Error("Production readiness policy mismatch");
      }
      return Object.freeze({
        status: "ready_for_controlled_rollout",
        deployment: "production",
        scope: "controlled_rollout",
        runtimeComponentCount: 4,
        signedEvidenceCount: 4,
        pinnedArtifactCount: 5,
        organizationBindingCount: 1,
        productionApplyEnabled: false,
        policy: PRODUCTION_READINESS_POLICY,
      });
    } catch {
      throw new ProductionReadinessNotReadyError();
    }
  }
}

function validateEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env.NODE_ENV !== "production" ||
      env.QKERN_RUNTIME_MODE !== "postgres" ||
      env.DATABASE_SSL !== "require" ||
      env.QKERN_PROJECT_DATABASE_CATALOG_SOURCE !== "control-plane" ||
      env.QKERN_PRODUCTION_APPLY_ENABLED !== "false" ||
      env.QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG === "true" ||
      env.QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON !== undefined ||
      env.QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON !== undefined ||
      REQUIRED_TRUE_FLAGS.some((name) => env[name] !== "true") ||
      FORBIDDEN_INLINE_AUTHORITIES.some((name) => env[name]?.trim())) {
    throw new Error("Unsafe production configuration");
  }

  const organizationIds = [
    env.QKERN_PROVISIONER_ORGANIZATION_ID?.trim() ?? "",
    env.QKERN_WORKER_ORGANIZATION_ID?.trim() ?? "",
    env.QKERN_PROVISIONING_METRICS_ORGANIZATION_ID?.trim() ?? "",
  ];
  if (organizationIds.some((value) => !UUID.test(value)) ||
      new Set(organizationIds).size !== 1) {
    throw new Error("Tenant binding mismatch");
  }

  const trustedProxyHops = env.QKERN_TRUST_PROXY_HOPS?.trim() ?? "";
  if (!/^[1-5]$/.test(trustedProxyHops)) {
    throw new Error("Trusted proxy boundary missing");
  }
  validateOrigins(env.QKERN_APP_ORIGINS);
}

function validateOrigins(raw: string | undefined): void {
  const values = (raw ?? "").split(",").map((value) => value.trim())
    .filter(Boolean);
  if (values.length < 1 || values.length > 20) {
    throw new Error("Production origins missing");
  }
  const origins = values.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/" ||
        url.hostname === "localhost" || !url.hostname.includes(".") ||
        (url.port && url.port !== "443")) {
      throw new Error("Invalid production origin");
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error("Duplicate production origin");
  }
}

function validGate(value: unknown): value is ProductionReadinessGate<unknown> {
  return Boolean(value) && typeof (value as { verify?: unknown }).verify === "function";
}

function validEnvironment(value: ProductionEnvironmentReadiness): boolean {
  return isDeepStrictEqual(value, {
    status: "ready",
    deployment: "production",
    scope: "production_configuration",
    organizationBindingCount: 1,
    productionApplyEnabled: false,
  });
}

function validRuntime(value: RuntimeDeploymentReadiness): boolean {
  return value?.status === "ready" && value.deployment === "production" &&
    value.componentCount === 4 &&
    isDeepStrictEqual(value.components, [
      "project-provisioner",
      "migration-worker",
      "apply-publisher",
      "incident-publisher",
    ]) && Object.keys(value.policy ?? {}).length === 11 &&
    Object.values(value.policy ?? {}).every((item) => item === true);
}

function validEvidence(value: ReleaseEvidenceReadiness): boolean {
  return isDeepStrictEqual(value, {
    status: "ready",
    deployment: "production",
    scope: "release_evidence",
    evidenceCount: 4,
    artifactCount: 5,
  });
}

