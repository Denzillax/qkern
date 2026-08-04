import { ConfigurationError } from "@/lib/server/db/errors";
import {
  RuntimeDeploymentEvidenceVerifier,
  runtimeDeploymentEvidenceFileReader,
  runtimeDeploymentVerifierKeyFileReader,
  type RuntimeDeploymentEvidenceFileProvider,
} from "@/lib/server/operations/runtime-deployment-evidence";
import { runtimeDeploymentOptionsFromEnv } from
  "@/lib/server/operations/runtime-deployment-runtime";

export function createRuntimeDeploymentEvidenceVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    evidenceProvider?: RuntimeDeploymentEvidenceFileProvider;
    keyProvider?: RuntimeDeploymentEvidenceFileProvider;
    now?: () => Date;
  } = {},
): RuntimeDeploymentEvidenceVerifier {
  if (env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE?.trim() ||
      env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY?.trim()) {
    throw new ConfigurationError("Inline runtime deployment evidence authority is forbidden.");
  }
  const evidencePath = env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE?.trim() ?? "";
  const keyPath = env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE?.trim() ?? "";
  if (evidencePath && keyPath && evidencePath === keyPath) {
    throw new ConfigurationError(
      "Runtime deployment evidence and verifier key files must be distinct.",
    );
  }
  const authorityPaths = [
    env.QKERN_RUNTIME_DEPLOYMENT_FILE,
    env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE,
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE,
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE,
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE,
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE,
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE,
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE,
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if ((evidencePath && authorityPaths.includes(evidencePath)) ||
      (keyPath && authorityPaths.includes(keyPath))) {
    throw new ConfigurationError(
      "Runtime deployment verification files cannot reuse another authority path.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new RuntimeDeploymentEvidenceVerifier(
    dependencies.evidenceProvider ??
      runtimeDeploymentEvidenceFileReader(evidencePath, production),
    dependencies.keyProvider ??
      runtimeDeploymentVerifierKeyFileReader(keyPath, production),
    env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_SHA256?.trim() ?? "",
    {
      deploymentOptions: runtimeDeploymentOptionsFromEnv(env),
      clusterIdentitySha256:
        env.QKERN_RUNTIME_DEPLOYMENT_CLUSTER_ID_SHA256?.trim() ?? "",
      networkPolicySha256:
        env.QKERN_RUNTIME_DEPLOYMENT_NETWORK_POLICY_SHA256?.trim() ?? "",
      imageProvenanceSha256:
        env.QKERN_RUNTIME_IMAGE_PROVENANCE_SHA256?.trim() ?? "",
    },
    dependencies.now,
  );
}
