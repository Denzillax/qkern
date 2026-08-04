import { ConfigurationError } from "@/lib/server/db/errors";
import {
  createBackupRestoreEvidenceVerifierFromEnv,
} from "@/lib/server/backup/restore-evidence-runtime";
import type { BackupRestoreEvidenceVerifier } from "@/lib/server/backup/restore-evidence";
import { createRuntimeDeploymentEvidenceVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-evidence-runtime";
import type { RuntimeDeploymentEvidenceVerifier } from
  "@/lib/server/operations/runtime-deployment-evidence";
import { createProviderE2EEvidenceVerifierFromEnv } from
  "@/lib/server/operations/provider-e2e-evidence-runtime";
import type { ProviderE2EEvidenceVerifier } from
  "@/lib/server/operations/provider-e2e-evidence";
import { createSecurityAssessmentEvidenceVerifierFromEnv } from
  "@/lib/server/security/security-assessment-evidence-runtime";
import type { SecurityAssessmentEvidenceVerifier } from
  "@/lib/server/security/security-assessment-evidence";
import {
  ProjectProvisioningMetricsAuthenticator,
  ProjectProvisioningMetricsTokenFileProvider,
  type ProjectProvisioningMetricsTokenProvider,
} from "@/lib/server/provisioning/metrics-exporter";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR_REF = "monitor:project-provisioning-metrics" as const;

export type ProjectProvisioningMetricsRuntime =
  | Readonly<{ enabled: false; misconfigured: boolean }>
  | Readonly<{
      enabled: true;
      organizationId: string;
      actorRef: typeof ACTOR_REF;
      authenticator: ProjectProvisioningMetricsAuthenticator;
      backupRestoreEvidenceVerifier?: BackupRestoreEvidenceVerifier;
      runtimeDeploymentEvidenceVerifier?: RuntimeDeploymentEvidenceVerifier;
      providerE2EEvidenceVerifier?: ProviderE2EEvidenceVerifier;
      securityAssessmentEvidenceVerifier?: SecurityAssessmentEvidenceVerifier;
    }>;

export function createProjectProvisioningMetricsRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    tokenProvider?: ProjectProvisioningMetricsTokenProvider;
    backupRestoreEvidenceVerifier?: BackupRestoreEvidenceVerifier;
    runtimeDeploymentEvidenceVerifier?: RuntimeDeploymentEvidenceVerifier;
    providerE2EEvidenceVerifier?: ProviderE2EEvidenceVerifier;
    securityAssessmentEvidenceVerifier?: SecurityAssessmentEvidenceVerifier;
  } = {},
): ProjectProvisioningMetricsRuntime {
  if (env.QKERN_PROVISIONING_METRICS_ENABLED !== "true") {
    return { enabled: false, misconfigured: false };
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Project provisioning metrics require PostgreSQL runtime mode.");
  }
  if (env.QKERN_PROVISIONING_METRICS_TOKEN?.trim()) {
    throw new ConfigurationError("Inline project provisioning metrics tokens are forbidden.");
  }
  const organizationId = env.QKERN_PROVISIONING_METRICS_ORGANIZATION_ID?.trim() ?? "";
  if (!UUID.test(organizationId)) {
    throw new ConfigurationError(
      "QKERN_PROVISIONING_METRICS_ORGANIZATION_ID must be a UUID.",
    );
  }
  const path = env.QKERN_PROVISIONING_METRICS_TOKEN_FILE?.trim() ?? "";
  const secretPaths = [
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
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
  if (path && secretPaths.includes(path)) {
    throw new ConfigurationError("Project provisioning metrics require a dedicated token file.");
  }
  const tokenProvider = dependencies.tokenProvider ??
    new ProjectProvisioningMetricsTokenFileProvider(path, env.NODE_ENV === "production");
  const backupRestoreEvidenceVerifier =
    env.QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED === "true"
      ? dependencies.backupRestoreEvidenceVerifier ??
        createBackupRestoreEvidenceVerifierFromEnv(env)
      : undefined;
  const runtimeDeploymentEvidenceVerifier =
    env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED === "true"
      ? dependencies.runtimeDeploymentEvidenceVerifier ??
        createRuntimeDeploymentEvidenceVerifierFromEnv(env)
      : undefined;
  const providerE2EEvidenceVerifier =
    env.QKERN_PROVIDER_E2E_EVIDENCE_ENABLED === "true"
      ? dependencies.providerE2EEvidenceVerifier ??
        createProviderE2EEvidenceVerifierFromEnv(env)
      : undefined;
  const securityAssessmentEvidenceVerifier =
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED === "true"
      ? dependencies.securityAssessmentEvidenceVerifier ??
        createSecurityAssessmentEvidenceVerifierFromEnv(env)
      : undefined;
  return {
    enabled: true,
    organizationId,
    actorRef: ACTOR_REF,
    authenticator: new ProjectProvisioningMetricsAuthenticator(tokenProvider),
    ...(backupRestoreEvidenceVerifier ? { backupRestoreEvidenceVerifier } : {}),
    ...(runtimeDeploymentEvidenceVerifier
      ? { runtimeDeploymentEvidenceVerifier }
      : {}),
    ...(providerE2EEvidenceVerifier ? { providerE2EEvidenceVerifier } : {}),
    ...(securityAssessmentEvidenceVerifier
      ? { securityAssessmentEvidenceVerifier }
      : {}),
  };
}
