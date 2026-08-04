import { ConfigurationError } from "@/lib/server/db/errors";
import {
  RuntimeDeploymentFileReader,
  RuntimeDeploymentVerifier,
  type RuntimeDeploymentBundleProvider,
  type RuntimeDeploymentOptions,
} from "@/lib/server/operations/runtime-deployment";

export function runtimeDeploymentOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeDeploymentOptions {
  return {
    namespace: env.QKERN_RUNTIME_DEPLOYMENT_NAMESPACE?.trim() ?? "",
    image: env.QKERN_RUNTIME_IMAGE?.trim() ?? "",
    configMapName: env.QKERN_RUNTIME_CONFIG_MAP?.trim() ?? "",
    secretName: env.QKERN_RUNTIME_SECRET?.trim() ?? "",
  };
}

export function createRuntimeDeploymentVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { provider?: RuntimeDeploymentBundleProvider } = {},
): RuntimeDeploymentVerifier {
  if (env.QKERN_RUNTIME_DEPLOYMENT_BUNDLE?.trim()) {
    throw new ConfigurationError("Inline runtime deployment bundles are forbidden.");
  }
  const path = env.QKERN_RUNTIME_DEPLOYMENT_FILE?.trim() ?? "";
  const authorityPaths = [
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE,
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE,
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE,
    env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE,
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE,
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE,
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE,
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if (path && authorityPaths.includes(path)) {
    throw new ConfigurationError(
      "Runtime deployment verification cannot reuse an authority file path.",
    );
  }
  return new RuntimeDeploymentVerifier(
    dependencies.provider ?? new RuntimeDeploymentFileReader(
      path,
      env.NODE_ENV === "production",
    ),
    runtimeDeploymentOptionsFromEnv(env),
  );
}
