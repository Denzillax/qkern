import { recognisedByName } from "@/lib/server/errors/identity";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  BACKUP_RESTORE_EVIDENCE_POLICY,
  type BackupRestoreReadiness,
} from "@/lib/server/backup/restore-evidence";
import {
  RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
  type RuntimeDeploymentEvidenceReadiness,
} from "@/lib/server/operations/runtime-deployment-evidence";
import {
  PROVIDER_E2E_EVIDENCE_POLICY,
  type ProviderE2EEvidenceReadiness,
} from "@/lib/server/operations/provider-e2e-evidence";
import {
  SECURITY_ASSESSMENT_EVIDENCE_POLICY,
  type SecurityAssessmentEvidenceReadiness,
} from "@/lib/server/security/security-assessment-evidence";
import type { ProjectDatabaseProvisioningHealth } from "@/lib/server/provisioning/service";

const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 256;
const MAX_TOKEN_FILE_BYTES = 512;
const TOKEN_BYTE = /^[A-Za-z0-9._~-]$/;
const MAX_METRICS_BYTES = 16_384;

export const PROJECT_PROVISIONING_METRICS_CONTENT_TYPE =
  "application/openmetrics-text; version=1.0.0; charset=utf-8";

export class ProjectProvisioningMetricsTokenUnavailableError extends Error {
  readonly code = "METRICS_TOKEN_UNAVAILABLE";
  constructor() {
    super("Project provisioning metrics token is unavailable.");
    this.name = "ProjectProvisioningMetricsTokenUnavailableError";
  }
}
recognisedByName(ProjectProvisioningMetricsTokenUnavailableError, "ProjectProvisioningMetricsTokenUnavailableError");

export class ProjectProvisioningMetricsDataError extends Error {
  readonly code = "METRICS_DATA_INVALID";
  constructor() {
    super("Project provisioning metrics are unavailable.");
    this.name = "ProjectProvisioningMetricsDataError";
  }
}
recognisedByName(ProjectProvisioningMetricsDataError, "ProjectProvisioningMetricsDataError");

export interface ProjectProvisioningMetricsTokenProvider {
  getToken(options: { signal?: AbortSignal }): Uint8Array | Promise<Uint8Array>;
}

/** Rotatable bearer token source. Production refuses links and group/world-readable files. */
export class ProjectProvisioningMetricsTokenFileProvider
implements ProjectProvisioningMetricsTokenProvider {
  constructor(
    private readonly path: string,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0")) {
      throw new ConfigurationError(
        "QKERN_PROVISIONING_METRICS_TOKEN_FILE must be a bounded absolute path.",
      );
    }
  }

  async getToken(options: { signal?: AbortSignal }): Promise<Uint8Array> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let fileBytes: Buffer | undefined;
    try {
      if (options.signal?.aborted) throw new Error("Aborted");
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() ||
          metadata.size < MIN_TOKEN_BYTES ||
          metadata.size > MAX_TOKEN_FILE_BYTES ||
          (this.production && (metadata.mode & 0o077) !== 0)) {
        throw new Error("Invalid token file");
      }
      fileBytes = Buffer.alloc(metadata.size);
      const result = await handle.read(fileBytes, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal?.aborted) {
        throw new Error("Incomplete token file");
      }
      const token = trimmedToken(fileBytes);
      if (!validTokenBytes(token)) {
        token.fill(0);
        throw new Error("Invalid token");
      }
      return token;
    } catch {
      throw new ProjectProvisioningMetricsTokenUnavailableError();
    } finally {
      fileBytes?.fill(0);
      await handle?.close().catch(() => undefined);
    }
  }
}

export class ProjectProvisioningMetricsAuthenticator {
  constructor(private readonly tokenProvider: ProjectProvisioningMetricsTokenProvider) {
    if (!tokenProvider || typeof tokenProvider.getToken !== "function") {
      throw new ConfigurationError("A project provisioning metrics token provider is required.");
    }
  }

  async authorize(authorization: string | null, signal?: AbortSignal): Promise<boolean> {
    const presented = bearerToken(authorization);
    if (!presented) return false;
    let expected: Uint8Array | undefined;
    const presentedBytes = Buffer.from(presented, "ascii");
    let expectedDigest: Buffer | undefined;
    let presentedDigest: Buffer | undefined;
    try {
      expected = await this.tokenProvider.getToken({ signal });
      if (!validTokenBytes(expected)) throw new ProjectProvisioningMetricsTokenUnavailableError();
      expectedDigest = createHash("sha256").update(expected).digest();
      presentedDigest = createHash("sha256").update(presentedBytes).digest();
      return timingSafeEqual(expectedDigest, presentedDigest);
    } finally {
      expected?.fill(0);
      presentedBytes.fill(0);
      expectedDigest?.fill(0);
      presentedDigest?.fill(0);
    }
  }
}

export function renderProjectProvisioningOpenMetrics(
  health: ProjectDatabaseProvisioningHealth,
  backupRestoreReadiness?: BackupRestoreReadiness,
  runtimeDeploymentReadiness?: RuntimeDeploymentEvidenceReadiness,
  providerE2EReadiness?: ProviderE2EEvidenceReadiness,
  securityAssessmentReadiness?: SecurityAssessmentEvidenceReadiness,
): string {
  assertHealth(health);
  if (backupRestoreReadiness) assertBackupRestoreReadiness(backupRestoreReadiness);
  if (runtimeDeploymentReadiness) {
    assertRuntimeDeploymentReadiness(runtimeDeploymentReadiness);
  }
  if (providerE2EReadiness) assertProviderE2EReadiness(providerE2EReadiness);
  if (securityAssessmentReadiness) {
    assertSecurityAssessmentReadiness(securityAssessmentReadiness);
  }
  const measuredAtSeconds = Date.parse(health.measuredAt) / 1_000;
  const lines = [
    "# HELP qkern_project_provisioning_health_status Current one-hot provisioning health state.",
    "# TYPE qkern_project_provisioning_health_status gauge",
    ...(["healthy", "degraded", "critical"] as const).map((status) =>
      `qkern_project_provisioning_health_status{status="${status}"} ${health.status === status ? 1 : 0}`),
    "# HELP qkern_project_provisioning_jobs Provisioning jobs by fixed state.",
    "# TYPE qkern_project_provisioning_jobs gauge",
    `qkern_project_provisioning_jobs{state="total"} ${health.totalCount}`,
    `qkern_project_provisioning_jobs{state="pending"} ${health.pendingCount}`,
    `qkern_project_provisioning_jobs{state="ready"} ${health.readyCount}`,
    `qkern_project_provisioning_jobs{state="scheduled"} ${health.scheduledCount}`,
    `qkern_project_provisioning_jobs{state="running"} ${health.runningCount}`,
    `qkern_project_provisioning_jobs{state="succeeded"} ${health.succeededCount}`,
    `qkern_project_provisioning_jobs{state="failed"} ${health.failedCount}`,
    "# HELP qkern_project_provisioning_slo_breaches Active provisioning SLO breaches.",
    "# TYPE qkern_project_provisioning_slo_breaches gauge",
    `qkern_project_provisioning_slo_breaches{kind="overdue_pending"} ${health.overduePendingCount}`,
    `qkern_project_provisioning_slo_breaches{kind="expired_lease"} ${health.expiredLeaseCount}`,
    `qkern_project_provisioning_slo_breaches{kind="recovery_exhausted"} ${health.recoveryExhaustedCount}`,
    "# HELP qkern_project_provisioning_active_failures Active failures by fixed redacted code.",
    "# TYPE qkern_project_provisioning_active_failures gauge",
    `qkern_project_provisioning_active_failures{code="all"} ${health.activeFailureCount}`,
    `qkern_project_provisioning_active_failures{code="provider_unavailable"} ${health.activeProviderUnavailableCount}`,
    `qkern_project_provisioning_active_failures{code="provider_rejected"} ${health.activeProviderRejectedCount}`,
    `qkern_project_provisioning_active_failures{code="invalid_binding"} ${health.activeInvalidBindingCount}`,
    `qkern_project_provisioning_active_failures{code="bootstrap_unverified"} ${health.activeBootstrapUnverifiedCount}`,
    `qkern_project_provisioning_active_failures{code="provisioning_timeout"} ${health.activeProvisioningTimeoutCount}`,
    "# HELP qkern_project_provisioners Provisioner process counts by fixed liveness state.",
    "# TYPE qkern_project_provisioners gauge",
    `qkern_project_provisioners{state="observed"} ${health.observedProvisionerCount}`,
    `qkern_project_provisioners{state="active"} ${health.activeProvisionerCount}`,
    `qkern_project_provisioners{state="stale"} ${health.staleProvisionerCount}`,
    ...(backupRestoreReadiness ? [
      "# HELP qkern_backup_restore_readiness Signed backup/restore drill evidence satisfies the fixed policy.",
      "# TYPE qkern_backup_restore_readiness gauge",
      "qkern_backup_restore_readiness 1",
      "# HELP qkern_backup_restore_recovery_point_lag_seconds Verified backup snapshot lag.",
      "# TYPE qkern_backup_restore_recovery_point_lag_seconds gauge",
      `qkern_backup_restore_recovery_point_lag_seconds ${backupRestoreReadiness.recoveryPointLagSeconds}`,
      "# HELP qkern_backup_restore_duration_seconds Verified restore duration.",
      "# TYPE qkern_backup_restore_duration_seconds gauge",
      `qkern_backup_restore_duration_seconds ${backupRestoreReadiness.restoreDurationSeconds}`,
      "# HELP qkern_backup_restore_snapshot_timestamp_seconds Timestamp of the verified backup snapshot.",
      "# TYPE qkern_backup_restore_snapshot_timestamp_seconds gauge",
      `qkern_backup_restore_snapshot_timestamp_seconds ${Date.parse(backupRestoreReadiness.backupSnapshotAt) / 1_000}`,
      "# HELP qkern_backup_restore_verified_timestamp_seconds Timestamp of the completed verification.",
      "# TYPE qkern_backup_restore_verified_timestamp_seconds gauge",
      `qkern_backup_restore_verified_timestamp_seconds ${Date.parse(backupRestoreReadiness.verifiedAt) / 1_000}`,
    ] : []),
    ...(runtimeDeploymentReadiness ? [
      "# HELP qkern_runtime_deployment_readiness Signed live deployment evidence satisfies the fixed policy.",
      "# TYPE qkern_runtime_deployment_readiness gauge",
      "qkern_runtime_deployment_readiness 1",
      "# HELP qkern_runtime_deployment_component_count Certified background runtime components.",
      "# TYPE qkern_runtime_deployment_component_count gauge",
      `qkern_runtime_deployment_component_count ${runtimeDeploymentReadiness.componentCount}`,
      "# HELP qkern_runtime_deployment_observation_duration_seconds Certified live observation duration.",
      "# TYPE qkern_runtime_deployment_observation_duration_seconds gauge",
      `qkern_runtime_deployment_observation_duration_seconds ${runtimeDeploymentReadiness.observationDurationSeconds}`,
      "# HELP qkern_runtime_deployment_observed_timestamp_seconds Timestamp of the completed live observation.",
      "# TYPE qkern_runtime_deployment_observed_timestamp_seconds gauge",
      `qkern_runtime_deployment_observed_timestamp_seconds ${Date.parse(runtimeDeploymentReadiness.observedAt) / 1_000}`,
      "# HELP qkern_runtime_deployment_certified_timestamp_seconds Timestamp of the signed live certification.",
      "# TYPE qkern_runtime_deployment_certified_timestamp_seconds gauge",
      `qkern_runtime_deployment_certified_timestamp_seconds ${Date.parse(runtimeDeploymentReadiness.certifiedAt) / 1_000}`,
    ] : []),
    ...(providerE2EReadiness ? [
      "# HELP qkern_provider_e2e_readiness Signed real-service E2E evidence satisfies the fixed policy.",
      "# TYPE qkern_provider_e2e_readiness gauge",
      "qkern_provider_e2e_readiness 1",
      "# HELP qkern_provider_e2e_scenario_count Certified real-service scenarios.",
      "# TYPE qkern_provider_e2e_scenario_count gauge",
      `qkern_provider_e2e_scenario_count ${providerE2EReadiness.scenarioCount}`,
      "# HELP qkern_provider_e2e_run_duration_seconds Certified E2E run duration.",
      "# TYPE qkern_provider_e2e_run_duration_seconds gauge",
      `qkern_provider_e2e_run_duration_seconds ${providerE2EReadiness.testRunDurationSeconds}`,
      "# HELP qkern_provider_e2e_completed_timestamp_seconds Timestamp of the completed E2E run.",
      "# TYPE qkern_provider_e2e_completed_timestamp_seconds gauge",
      `qkern_provider_e2e_completed_timestamp_seconds ${Date.parse(providerE2EReadiness.testRunCompletedAt) / 1_000}`,
      "# HELP qkern_provider_e2e_certified_timestamp_seconds Timestamp of the signed E2E certification.",
      "# TYPE qkern_provider_e2e_certified_timestamp_seconds gauge",
      `qkern_provider_e2e_certified_timestamp_seconds ${Date.parse(providerE2EReadiness.certifiedAt) / 1_000}`,
      "# HELP qkern_provider_e2e_postgres_major_version Certified PostgreSQL major version.",
      "# TYPE qkern_provider_e2e_postgres_major_version gauge",
      `qkern_provider_e2e_postgres_major_version ${providerE2EReadiness.postgresMajorVersion}`,
    ] : []),
    ...(securityAssessmentReadiness ? [
      "# HELP qkern_security_assessment_readiness Signed release security assessment satisfies the fixed policy.",
      "# TYPE qkern_security_assessment_readiness gauge",
      "qkern_security_assessment_readiness 1",
      "# HELP qkern_security_assessment_count Certified security assessment checks.",
      "# TYPE qkern_security_assessment_count gauge",
      `qkern_security_assessment_count ${securityAssessmentReadiness.assessmentCount}`,
      "# HELP qkern_security_assessment_unresolved_critical_findings Unresolved Critical findings in the certified assessment.",
      "# TYPE qkern_security_assessment_unresolved_critical_findings gauge",
      `qkern_security_assessment_unresolved_critical_findings ${securityAssessmentReadiness.unresolvedCriticalFindings}`,
      "# HELP qkern_security_assessment_unresolved_high_findings Unresolved High findings in the certified assessment.",
      "# TYPE qkern_security_assessment_unresolved_high_findings gauge",
      `qkern_security_assessment_unresolved_high_findings ${securityAssessmentReadiness.unresolvedHighFindings}`,
      "# HELP qkern_security_assessment_duration_seconds Certified assessment duration.",
      "# TYPE qkern_security_assessment_duration_seconds gauge",
      `qkern_security_assessment_duration_seconds ${securityAssessmentReadiness.assessmentDurationSeconds}`,
      "# HELP qkern_security_assessment_completed_timestamp_seconds Timestamp of the completed security assessment.",
      "# TYPE qkern_security_assessment_completed_timestamp_seconds gauge",
      `qkern_security_assessment_completed_timestamp_seconds ${Date.parse(securityAssessmentReadiness.assessmentCompletedAt) / 1_000}`,
      "# HELP qkern_security_assessment_certified_timestamp_seconds Timestamp of the signed security certification.",
      "# TYPE qkern_security_assessment_certified_timestamp_seconds gauge",
      `qkern_security_assessment_certified_timestamp_seconds ${Date.parse(securityAssessmentReadiness.certifiedAt) / 1_000}`,
    ] : []),
    "# HELP qkern_project_provisioning_measurement_timestamp_seconds Control-plane measurement time.",
    "# TYPE qkern_project_provisioning_measurement_timestamp_seconds gauge",
    `qkern_project_provisioning_measurement_timestamp_seconds ${measuredAtSeconds}`,
    "# EOF",
    "",
  ];
  const output = lines.join("\n");
  if (Buffer.byteLength(output, "utf8") > MAX_METRICS_BYTES) {
    throw new ProjectProvisioningMetricsDataError();
  }
  return output;
}

function assertSecurityAssessmentReadiness(
  readiness: SecurityAssessmentEvidenceReadiness,
): void {
  const assessmentCompletedAt = Date.parse(readiness.assessmentCompletedAt);
  const certifiedAt = Date.parse(readiness.certifiedAt);
  const policy = readiness.policy;
  if (readiness.status !== "ready" ||
      readiness.deployment !== "production" ||
      readiness.scope !== "release_security" ||
      readiness.assessmentCount !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentCount ||
      readiness.unresolvedCriticalFindings !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.unresolvedCriticalFindings ||
      readiness.unresolvedHighFindings !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.unresolvedHighFindings ||
      !Number.isSafeInteger(readiness.assessmentDurationSeconds) ||
      readiness.assessmentDurationSeconds <
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMinSeconds ||
      readiness.assessmentDurationSeconds >
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMaxSeconds ||
      !Number.isFinite(assessmentCompletedAt) ||
      !Number.isFinite(certifiedAt) ||
      assessmentCompletedAt > certifiedAt ||
      certifiedAt - assessmentCompletedAt >
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.certificationLagMaxSeconds * 1_000 ||
      policy.evidenceMaxAgeSeconds !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.evidenceMaxAgeSeconds ||
      policy.assessmentDurationMinSeconds !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMinSeconds ||
      policy.assessmentDurationMaxSeconds !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentDurationMaxSeconds ||
      policy.certificationLagMaxSeconds !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      policy.futureClockSkewSeconds !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.futureClockSkewSeconds ||
      policy.assessmentCount !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.assessmentCount ||
      policy.unresolvedCriticalFindings !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.unresolvedCriticalFindings ||
      policy.unresolvedHighFindings !==
        SECURITY_ASSESSMENT_EVIDENCE_POLICY.unresolvedHighFindings) {
    throw new ProjectProvisioningMetricsDataError();
  }
}

function assertProviderE2EReadiness(
  readiness: ProviderE2EEvidenceReadiness,
): void {
  const testRunCompletedAt = Date.parse(readiness.testRunCompletedAt);
  const certifiedAt = Date.parse(readiness.certifiedAt);
  const policy = readiness.policy;
  if (readiness.status !== "ready" ||
      readiness.deployment !== "production" ||
      readiness.scope !== "managed_postgresql_e2e" ||
      readiness.postgresMajorVersion !==
        PROVIDER_E2E_EVIDENCE_POLICY.postgresMajorVersion ||
      readiness.scenarioCount !== PROVIDER_E2E_EVIDENCE_POLICY.scenarioCount ||
      !Number.isSafeInteger(readiness.testRunDurationSeconds) ||
      readiness.testRunDurationSeconds <
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMinSeconds ||
      readiness.testRunDurationSeconds >
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMaxSeconds ||
      !Number.isFinite(testRunCompletedAt) ||
      !Number.isFinite(certifiedAt) ||
      testRunCompletedAt > certifiedAt ||
      certifiedAt - testRunCompletedAt >
        PROVIDER_E2E_EVIDENCE_POLICY.certificationLagMaxSeconds * 1_000 ||
      policy.evidenceMaxAgeSeconds !==
        PROVIDER_E2E_EVIDENCE_POLICY.evidenceMaxAgeSeconds ||
      policy.testRunDurationMinSeconds !==
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMinSeconds ||
      policy.testRunDurationMaxSeconds !==
        PROVIDER_E2E_EVIDENCE_POLICY.testRunDurationMaxSeconds ||
      policy.certificationLagMaxSeconds !==
        PROVIDER_E2E_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      policy.futureClockSkewSeconds !==
        PROVIDER_E2E_EVIDENCE_POLICY.futureClockSkewSeconds ||
      policy.postgresMajorVersion !==
        PROVIDER_E2E_EVIDENCE_POLICY.postgresMajorVersion ||
      policy.scenarioCount !== PROVIDER_E2E_EVIDENCE_POLICY.scenarioCount) {
    throw new ProjectProvisioningMetricsDataError();
  }
}

function assertRuntimeDeploymentReadiness(
  readiness: RuntimeDeploymentEvidenceReadiness,
): void {
  const observedAt = Date.parse(readiness.observedAt);
  const certifiedAt = Date.parse(readiness.certifiedAt);
  const policy = readiness.policy;
  if (readiness.status !== "ready" ||
      readiness.deployment !== "production" ||
      readiness.scope !== "background_runtimes" ||
      readiness.componentCount !== 4 ||
      !Number.isSafeInteger(readiness.observationDurationSeconds) ||
      readiness.observationDurationSeconds <
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMinSeconds ||
      readiness.observationDurationSeconds >
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMaxSeconds ||
      !Number.isFinite(observedAt) ||
      !Number.isFinite(certifiedAt) ||
      observedAt > certifiedAt ||
      certifiedAt - observedAt >
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.certificationLagMaxSeconds * 1_000 ||
      policy.evidenceMaxAgeSeconds !==
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.evidenceMaxAgeSeconds ||
      policy.observationDurationMinSeconds !==
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMinSeconds ||
      policy.observationDurationMaxSeconds !==
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.observationDurationMaxSeconds ||
      policy.certificationLagMaxSeconds !==
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.certificationLagMaxSeconds ||
      policy.futureClockSkewSeconds !==
        RUNTIME_DEPLOYMENT_EVIDENCE_POLICY.futureClockSkewSeconds) {
    throw new ProjectProvisioningMetricsDataError();
  }
}

function assertBackupRestoreReadiness(readiness: BackupRestoreReadiness): void {
  const backupSnapshotAt = Date.parse(readiness.backupSnapshotAt);
  const verifiedAt = Date.parse(readiness.verifiedAt);
  const policy = readiness.policy;
  if (readiness.status !== "ready" ||
      readiness.deployment !== "production" ||
      readiness.scope !== "control_plane" ||
      !Number.isSafeInteger(readiness.recoveryPointLagSeconds) ||
      readiness.recoveryPointLagSeconds < 0 ||
      readiness.recoveryPointLagSeconds >
        BACKUP_RESTORE_EVIDENCE_POLICY.recoveryPointLagMaxSeconds ||
      !Number.isSafeInteger(readiness.restoreDurationSeconds) ||
      readiness.restoreDurationSeconds < 0 ||
      readiness.restoreDurationSeconds >
        BACKUP_RESTORE_EVIDENCE_POLICY.restoreDurationMaxSeconds ||
      !Number.isFinite(backupSnapshotAt) ||
      !Number.isFinite(verifiedAt) ||
      backupSnapshotAt > verifiedAt ||
      verifiedAt - backupSnapshotAt >
        BACKUP_RESTORE_EVIDENCE_POLICY.backupSnapshotMaxAgeAtVerificationSeconds * 1_000 ||
      policy.evidenceMaxAgeSeconds !== BACKUP_RESTORE_EVIDENCE_POLICY.evidenceMaxAgeSeconds ||
      policy.backupSnapshotMaxAgeAtVerificationSeconds !==
        BACKUP_RESTORE_EVIDENCE_POLICY.backupSnapshotMaxAgeAtVerificationSeconds ||
      policy.recoveryPointLagMaxSeconds !==
        BACKUP_RESTORE_EVIDENCE_POLICY.recoveryPointLagMaxSeconds ||
      policy.restoreDurationMaxSeconds !==
        BACKUP_RESTORE_EVIDENCE_POLICY.restoreDurationMaxSeconds ||
      policy.futureClockSkewSeconds !== BACKUP_RESTORE_EVIDENCE_POLICY.futureClockSkewSeconds) {
    throw new ProjectProvisioningMetricsDataError();
  }
}

function bearerToken(authorization: string | null): string | undefined {
  if (!authorization || authorization.length > MAX_TOKEN_BYTES + 16) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(authorization);
  return match?.[1];
}

function trimmedToken(source: Uint8Array): Uint8Array {
  let start = 0;
  let end = source.length;
  while (start < end && asciiWhitespace(source[start]!)) start += 1;
  while (end > start && asciiWhitespace(source[end - 1]!)) end -= 1;
  return Uint8Array.from(source.subarray(start, end));
}

function asciiWhitespace(value: number): boolean {
  return value === 0x09 || value === 0x0a || value === 0x0d || value === 0x20;
}

function validTokenBytes(value: Uint8Array): boolean {
  if (value.length < MIN_TOKEN_BYTES || value.length > MAX_TOKEN_BYTES) return false;
  for (const byte of value) {
    if (byte > 0x7f || !TOKEN_BYTE.test(String.fromCharCode(byte))) return false;
  }
  return true;
}

function assertHealth(health: ProjectDatabaseProvisioningHealth): void {
  const counts = [
    health.totalCount, health.pendingCount, health.readyCount, health.scheduledCount,
    health.runningCount, health.overduePendingCount, health.expiredLeaseCount,
    health.succeededCount, health.failedCount, health.recoveryExhaustedCount,
    health.activeFailureCount, health.activeProviderUnavailableCount,
    health.activeProviderRejectedCount, health.activeInvalidBindingCount,
    health.activeBootstrapUnverifiedCount, health.activeProvisioningTimeoutCount,
    health.observedProvisionerCount, health.activeProvisionerCount,
    health.staleProvisionerCount,
  ];
  if ((health.status !== "healthy" && health.status !== "degraded" && health.status !== "critical") ||
      counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      !Number.isFinite(Date.parse(health.measuredAt))) {
    throw new ProjectProvisioningMetricsDataError();
  }
}
