import { ConfigurationError } from "@/lib/server/db/errors";
import {
  ProviderE2EEvidenceVerifier,
  providerE2EEvidenceFileReader,
  providerE2EVerifierKeyFileReader,
  type ProviderE2EEvidenceFileProvider,
} from "@/lib/server/operations/provider-e2e-evidence";

export function createProviderE2EEvidenceVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    evidenceProvider?: ProviderE2EEvidenceFileProvider;
    keyProvider?: ProviderE2EEvidenceFileProvider;
    now?: () => Date;
  } = {},
): ProviderE2EEvidenceVerifier {
  if (env.QKERN_PROVIDER_E2E_EVIDENCE?.trim() ||
      env.QKERN_PROVIDER_E2E_VERIFIER_KEY?.trim()) {
    throw new ConfigurationError("Inline provider E2E evidence authority is forbidden.");
  }
  const evidencePath = env.QKERN_PROVIDER_E2E_EVIDENCE_FILE?.trim() ?? "";
  const keyPath = env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE?.trim() ?? "";
  if (evidencePath && keyPath && evidencePath === keyPath) {
    throw new ConfigurationError(
      "Provider E2E evidence and verifier key files must be distinct.",
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
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE,
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if ((evidencePath && authorityPaths.includes(evidencePath)) ||
      (keyPath && authorityPaths.includes(keyPath))) {
    throw new ConfigurationError(
      "Provider E2E verification files cannot reuse another authority path.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new ProviderE2EEvidenceVerifier(
    dependencies.evidenceProvider ??
      providerE2EEvidenceFileReader(evidencePath, production),
    dependencies.keyProvider ??
      providerE2EVerifierKeyFileReader(keyPath, production),
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_SHA256?.trim() ?? "",
    {
      providerIdentitySha256:
        env.QKERN_PROVIDER_E2E_PROVIDER_ID_SHA256?.trim() ?? "",
      providerConfigurationSha256:
        env.QKERN_PROVIDER_E2E_PROVIDER_CONFIG_SHA256?.trim() ?? "",
      brokerContractSha256:
        env.QKERN_PROVIDER_E2E_BROKER_CONTRACT_SHA256?.trim() ?? "",
      vaultPolicySha256:
        env.QKERN_PROVIDER_E2E_VAULT_POLICY_SHA256?.trim() ?? "",
      pagerRoutingSha256:
        env.QKERN_PROVIDER_E2E_PAGER_ROUTING_SHA256?.trim() ?? "",
      backupRestoreEvidenceSha256:
        env.QKERN_PROVIDER_E2E_BACKUP_RESTORE_EVIDENCE_SHA256?.trim() ?? "",
      runtimeDeploymentEvidenceSha256:
        env.QKERN_PROVIDER_E2E_RUNTIME_DEPLOYMENT_EVIDENCE_SHA256?.trim() ?? "",
    },
    dependencies.now,
  );
}
