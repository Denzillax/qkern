import { ConfigurationError } from "@/lib/server/db/errors";
import { createBackupRestoreEvidenceVerifierFromEnv } from
  "@/lib/server/backup/restore-evidence-runtime";
import { createRuntimeDeploymentEvidenceVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-evidence-runtime";
import { createProviderE2EEvidenceVerifierFromEnv } from
  "@/lib/server/operations/provider-e2e-evidence-runtime";
import { createSecurityAssessmentEvidenceVerifierFromEnv } from
  "@/lib/server/security/security-assessment-evidence-runtime";
import {
  ReleaseEvidenceVerifier,
  releaseArtifactFileDigester,
  releaseEvidenceFileDigester,
  type ReleaseEvidenceComponentVerifier,
  type ReleaseEvidenceDigestProvider,
} from "@/lib/server/operations/release-evidence-readiness";

export function createReleaseEvidenceVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    componentVerifiers?: readonly ReleaseEvidenceComponentVerifier[];
    digestProviders?: readonly ReleaseEvidenceDigestProvider[];
  } = {},
): ReleaseEvidenceVerifier {
  const releaseArtifactPath = env.QKERN_RELEASE_ARTIFACT_FILE?.trim() ?? "";
  const evidencePaths = [
    env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE?.trim() ?? "",
    env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE?.trim() ?? "",
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE?.trim() ?? "",
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE?.trim() ?? "",
  ] as const;
  const verifierKeyPaths = [
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE,
    env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  const protectedPaths = [
    releaseArtifactPath,
    ...evidencePaths,
    ...verifierKeyPaths,
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE?.trim(),
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE?.trim(),
    env.QKERN_VAULT_TOKEN_FILE?.trim(),
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE?.trim(),
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE?.trim(),
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE?.trim(),
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE?.trim(),
  ].filter(Boolean);
  if (new Set(protectedPaths).size !== protectedPaths.length) {
    throw new ConfigurationError(
      "Release evidence requires distinct artifact, evidence, key and authority paths.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new ReleaseEvidenceVerifier(
    dependencies.componentVerifiers ?? [
      createBackupRestoreEvidenceVerifierFromEnv(env),
      createRuntimeDeploymentEvidenceVerifierFromEnv(env),
      createProviderE2EEvidenceVerifierFromEnv(env),
      createSecurityAssessmentEvidenceVerifierFromEnv(env),
    ],
    dependencies.digestProviders ?? [
      releaseArtifactFileDigester(releaseArtifactPath, production),
      releaseEvidenceFileDigester(evidencePaths[0], production),
      releaseEvidenceFileDigester(evidencePaths[1], production),
      releaseEvidenceFileDigester(evidencePaths[2], production),
      releaseEvidenceFileDigester(evidencePaths[3], production),
    ],
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
  );
}
