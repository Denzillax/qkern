import { ConfigurationError } from "@/lib/server/db/errors";
import {
  SecurityAssessmentEvidenceVerifier,
  securityAssessmentEvidenceFileReader,
  securityAssessmentVerifierKeyFileReader,
  type SecurityAssessmentEvidenceFileProvider,
} from "@/lib/server/security/security-assessment-evidence";

export function createSecurityAssessmentEvidenceVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    evidenceProvider?: SecurityAssessmentEvidenceFileProvider;
    keyProvider?: SecurityAssessmentEvidenceFileProvider;
    now?: () => Date;
  } = {},
): SecurityAssessmentEvidenceVerifier {
  if (env.QKERN_SECURITY_ASSESSMENT_EVIDENCE?.trim() ||
      env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY?.trim()) {
    throw new ConfigurationError(
      "Inline security assessment evidence authority is forbidden.",
    );
  }
  const evidencePath =
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE?.trim() ?? "";
  const keyPath =
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE?.trim() ?? "";
  if (evidencePath && keyPath && evidencePath === keyPath) {
    throw new ConfigurationError(
      "Security assessment evidence and verifier key files must be distinct.",
    );
  }
  const authorityPaths = [
    env.QKERN_RUNTIME_DEPLOYMENT_FILE,
    env.QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_FILE,
    env.QKERN_RUNTIME_DEPLOYMENT_VERIFIER_KEY_FILE,
    env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE,
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE,
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE,
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE,
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE,
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE,
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if ((evidencePath && authorityPaths.includes(evidencePath)) ||
      (keyPath && authorityPaths.includes(keyPath))) {
    throw new ConfigurationError(
      "Security assessment verification files cannot reuse another authority path.",
    );
  }
  const releaseArtifactSha256 =
    env.QKERN_SECURITY_ASSESSMENT_RELEASE_ARTIFACT_SHA256?.trim() ?? "";
  const productionReleaseArtifactSha256 =
    env.QKERN_PRODUCTION_APPLY_RELEASE_ARTIFACT_SHA256?.trim();
  if (productionReleaseArtifactSha256 &&
      productionReleaseArtifactSha256 !== releaseArtifactSha256) {
    throw new ConfigurationError(
      "Security assessment and Production Apply must bind the same release artifact.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new SecurityAssessmentEvidenceVerifier(
    dependencies.evidenceProvider ??
      securityAssessmentEvidenceFileReader(evidencePath, production),
    dependencies.keyProvider ??
      securityAssessmentVerifierKeyFileReader(keyPath, production),
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_SHA256?.trim() ?? "",
    {
      releaseArtifactSha256,
      sbomSha256: env.QKERN_SECURITY_ASSESSMENT_SBOM_SHA256?.trim() ?? "",
      dependencyAuditSha256:
        env.QKERN_SECURITY_ASSESSMENT_DEPENDENCY_AUDIT_SHA256?.trim() ?? "",
      sastReportSha256:
        env.QKERN_SECURITY_ASSESSMENT_SAST_REPORT_SHA256?.trim() ?? "",
      dastReportSha256:
        env.QKERN_SECURITY_ASSESSMENT_DAST_REPORT_SHA256?.trim() ?? "",
      secretScanReportSha256:
        env.QKERN_SECURITY_ASSESSMENT_SECRET_SCAN_REPORT_SHA256?.trim() ?? "",
      crossTenantReportSha256:
        env.QKERN_SECURITY_ASSESSMENT_CROSS_TENANT_REPORT_SHA256?.trim() ?? "",
      penetrationTestReportSha256:
        env.QKERN_SECURITY_ASSESSMENT_PENTEST_REPORT_SHA256?.trim() ?? "",
    },
    dependencies.now,
  );
}
