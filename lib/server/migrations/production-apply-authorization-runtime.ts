import { ConfigurationError } from "@/lib/server/db/errors";
import {
  denyProductionApplyAuthorizer,
  ProductionApplyAuthorizationVerifier,
  productionApplyAuthorizationFileReader,
  productionApplyVerifierKeyFileReader,
  type ProductionApplyAuthorizationFileProvider,
  type ProductionApplyAuthorizer,
} from "@/lib/server/migrations/production-apply-authorization";

export function createProductionApplyAuthorizerFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    authorizationProvider?: ProductionApplyAuthorizationFileProvider;
    keyProvider?: ProductionApplyAuthorizationFileProvider;
    now?: () => Date;
  } = {},
): ProductionApplyAuthorizer {
  if (env.QKERN_PRODUCTION_APPLY_ENABLED !== "true") {
    return denyProductionApplyAuthorizer;
  }
  if (env.QKERN_PRODUCTION_APPLY_AUTHORIZATION?.trim() ||
      env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY?.trim()) {
    throw new ConfigurationError("Inline production apply authority is forbidden.");
  }
  const authorizationPath = env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE?.trim() ?? "";
  const keyPath = env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE?.trim() ?? "";
  if (authorizationPath && keyPath && authorizationPath === keyPath) {
    throw new ConfigurationError(
      "Production apply authorization and verifier key files must be distinct.",
    );
  }
  const authorityPaths = [
    env.QKERN_RUNTIME_DEPLOYMENT_FILE,
    env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE,
    env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE,
    env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE,
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE,
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE,
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE,
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE,
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if ((authorizationPath && authorityPaths.includes(authorizationPath)) ||
      (keyPath && authorityPaths.includes(keyPath))) {
    throw new ConfigurationError(
      "Production apply verification files cannot reuse another authority path.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new ProductionApplyAuthorizationVerifier(
    dependencies.authorizationProvider ??
      productionApplyAuthorizationFileReader(authorizationPath, production),
    dependencies.keyProvider ??
      productionApplyVerifierKeyFileReader(keyPath, production),
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_SHA256?.trim() ?? "",
    {
      releaseArtifactSha256:
        env.QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256?.trim() ?? "",
      backupRestoreEvidenceSha256:
        env.QKERN_PRODUCTION_APPLY_BACKUP_RESTORE_EVIDENCE_SHA256?.trim() ?? "",
      runtimeDeploymentEvidenceSha256:
        env.QKERN_PRODUCTION_APPLY_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256?.trim() ?? "",
      providerE2EEvidenceSha256:
        env.QKERN_PRODUCTION_APPLY_PROVIDER_E2E_EVIDENCE_SHA256?.trim() ?? "",
      securityAssessmentSha256:
        env.QKERN_PRODUCTION_APPLY_SECURITY_ASSESSMENT_SHA256?.trim() ?? "",
    },
    dependencies.now,
  );
}
