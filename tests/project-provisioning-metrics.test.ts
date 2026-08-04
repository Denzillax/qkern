import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGetProjectProvisioningMetricsHandler } from
  "@/app/api/internal/v1/projects/provisioning/metrics/route";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  BACKUP_RESTORE_EVIDENCE_POLICY,
  BackupRestoreEvidenceUnavailableError,
  BackupRestoreEvidenceVerifier,
  type BackupRestoreReadiness,
} from "@/lib/server/backup/restore-evidence";
import {
  RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
  RuntimeDeploymentEvidenceUnavailableError,
  RuntimeDeploymentEvidenceVerifier,
  type RuntimeDeploymentEvidenceReadiness,
} from "@/lib/server/operations/runtime-deployment-evidence";
import {
  PROVIDER_E2E_EVIDENCE_POLICY,
  ProviderE2EEvidenceUnavailableError,
  ProviderE2EEvidenceVerifier,
  type ProviderE2EEvidenceReadiness,
} from "@/lib/server/operations/provider-e2e-evidence";
import {
  SECURITY_ASSESSMENT_EVIDENCE_POLICY,
  SecurityAssessmentEvidenceUnavailableError,
  SecurityAssessmentEvidenceVerifier,
  type SecurityAssessmentEvidenceReadiness,
} from "@/lib/server/security/security-assessment-evidence";
import {
  PROJECT_PROVISIONING_METRICS_CONTENT_TYPE,
  ProjectProvisioningMetricsAuthenticator,
  ProjectProvisioningMetricsDataError,
  ProjectProvisioningMetricsTokenFileProvider,
  ProjectProvisioningMetricsTokenUnavailableError,
  renderProjectProvisioningOpenMetrics,
  type ProjectProvisioningMetricsTokenProvider,
} from "@/lib/server/provisioning/metrics-exporter";
import {
  createProjectProvisioningMetricsRuntime,
  type ProjectProvisioningMetricsRuntime,
} from "@/lib/server/provisioning/metrics-runtime";
import type {
  ProjectDatabaseProvisioningHealth,
  ProjectDatabaseProvisioningService,
} from "@/lib/server/provisioning/service";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const TOKEN = "metrics-token-0123456789-ABCDEFGHIJKLM";
const OTHER_TOKEN = "metrics-token-9876543210-ZYXWVUTSRQPON";
const tempDirectories: string[] = [];

const backupRestoreReadiness: BackupRestoreReadiness = {
  status: "ready",
  evidenceId: "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
  deployment: "production",
  scope: "control_plane",
  backupSnapshotAt: "2026-07-26T10:00:00.000Z",
  verifiedAt: "2026-07-26T10:40:00.000Z",
  recoveryPointLagSeconds: 300,
  restoreDurationSeconds: 1_200,
  policy: BACKUP_RESTORE_EVIDENCE_POLICY,
};

const runtimeDeploymentReadiness: RuntimeDeploymentEvidenceReadiness = {
  status: "ready",
  deployment: "production",
  scope: "background_runtimes",
  observedAt: "2026-07-26T11:00:00.000Z",
  certifiedAt: "2026-07-26T11:05:00.000Z",
  observationDurationSeconds: 3_600,
  componentCount: 4,
  policy: RUNTIME_DEPLOYMENT_EVIDENCE_POLICY,
};

const providerE2EReadiness: ProviderE2EEvidenceReadiness = {
  status: "ready",
  deployment: "production",
  scope: "managed_postgresql_e2e",
  testRunCompletedAt: "2026-07-26T11:30:00.000Z",
  certifiedAt: "2026-07-26T11:35:00.000Z",
  testRunDurationSeconds: 3_600,
  postgresMajorVersion: 17,
  scenarioCount: 15,
  policy: PROVIDER_E2E_EVIDENCE_POLICY,
};

const securityAssessmentReadiness: SecurityAssessmentEvidenceReadiness = {
  status: "ready",
  deployment: "production",
  scope: "release_security",
  assessmentCompletedAt: "2026-07-26T10:00:00.000Z",
  certifiedAt: "2026-07-26T11:00:00.000Z",
  assessmentDurationSeconds: 86_400,
  assessmentCount: 14,
  unresolvedCriticalFindings: 0,
  unresolvedHighFindings: 0,
  policy: SECURITY_ASSESSMENT_EVIDENCE_POLICY,
};

const health: ProjectDatabaseProvisioningHealth = {
  status: "degraded",
  measuredAt: "2026-07-26T12:00:00.000Z",
  totalCount: 4,
  pendingCount: 1,
  readyCount: 1,
  scheduledCount: 0,
  runningCount: 1,
  overduePendingCount: 1,
  expiredLeaseCount: 0,
  succeededCount: 2,
  failedCount: 0,
  recoveryExhaustedCount: 0,
  activeFailureCount: 1,
  activeProviderUnavailableCount: 1,
  activeProviderRejectedCount: 0,
  activeInvalidBindingCount: 0,
  activeBootstrapUnverifiedCount: 0,
  activeProvisioningTimeoutCount: 0,
  observedProvisionerCount: 2,
  activeProvisionerCount: 1,
  staleProvisionerCount: 1,
  oldestPendingAt: "2026-07-26T11:50:00.000Z",
  latestHeartbeatAt: "2026-07-26T11:59:50.000Z",
  policy: {
    overdueAfterSeconds: 300,
    heartbeatStaleAfterSeconds: 120,
    provisionerObservationWindowSeconds: 86_400,
    expiredLeasesAreCritical: true,
    exhaustedRecoveryIsCritical: true,
    activeWorkWithoutProvisionerIsCritical: true,
    bindingVerificationFailuresAreCritical: true,
  },
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function tokenProvider(token = TOKEN): ProjectProvisioningMetricsTokenProvider {
  return { getToken: vi.fn(async () => Buffer.from(token, "ascii")) };
}

function readyRuntime(
  provider: ProjectProvisioningMetricsTokenProvider = tokenProvider(),
  backupRestoreEvidenceVerifier?: BackupRestoreEvidenceVerifier,
  runtimeDeploymentEvidenceVerifier?: RuntimeDeploymentEvidenceVerifier,
  providerE2EEvidenceVerifier?: ProviderE2EEvidenceVerifier,
  securityAssessmentEvidenceVerifier?: SecurityAssessmentEvidenceVerifier,
): ProjectProvisioningMetricsRuntime {
  return createProjectProvisioningMetricsRuntime({
    QKERN_PROVISIONING_METRICS_ENABLED: "true",
    QKERN_RUNTIME_MODE: "postgres",
    QKERN_PROVISIONING_METRICS_ORGANIZATION_ID: ORGANIZATION_ID,
    ...(backupRestoreEvidenceVerifier
      ? { QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED: "true" }
      : {}),
    ...(runtimeDeploymentEvidenceVerifier
      ? { QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED: "true" }
      : {}),
    ...(providerE2EEvidenceVerifier
      ? { QKERN_PROVIDER_E2E_EVIDENCE_ENABLED: "true" }
      : {}),
    ...(securityAssessmentEvidenceVerifier
      ? { QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED: "true" }
      : {}),
  }, {
    tokenProvider: provider,
    ...(backupRestoreEvidenceVerifier ? { backupRestoreEvidenceVerifier } : {}),
    ...(runtimeDeploymentEvidenceVerifier
      ? { runtimeDeploymentEvidenceVerifier }
      : {}),
    ...(providerE2EEvidenceVerifier ? { providerE2EEvidenceVerifier } : {}),
    ...(securityAssessmentEvidenceVerifier
      ? { securityAssessmentEvidenceVerifier }
      : {}),
  });
}

function restoreVerifier(
  result: BackupRestoreReadiness = backupRestoreReadiness,
): BackupRestoreEvidenceVerifier {
  const verifier = new BackupRestoreEvidenceVerifier(
    { read: async () => Buffer.from("{}") },
    { read: async () => Buffer.from("{}") },
    "a".repeat(64),
  );
  vi.spyOn(verifier, "verify").mockResolvedValue(result);
  return verifier;
}

function deploymentVerifier(
  result: RuntimeDeploymentEvidenceReadiness = runtimeDeploymentReadiness,
): RuntimeDeploymentEvidenceVerifier {
  const verifier = new RuntimeDeploymentEvidenceVerifier(
    { read: async () => Buffer.from("{}") },
    { read: async () => Buffer.from("{}") },
    "a".repeat(64),
    {
      deploymentOptions: {
        namespace: "qkern",
        image: `registry.example.com/qkern/platform@sha256:${"a".repeat(64)}`,
        configMapName: "qkern-runtime-config",
        secretName: "qkern-runtime-secrets",
      },
      clusterIdentitySha256: "b".repeat(64),
      networkPolicySha256: "c".repeat(64),
      imageProvenanceSha256: "d".repeat(64),
    },
  );
  vi.spyOn(verifier, "verify").mockResolvedValue(result);
  return verifier;
}

function providerVerifier(
  result: ProviderE2EEvidenceReadiness = providerE2EReadiness,
): ProviderE2EEvidenceVerifier {
  const verifier = new ProviderE2EEvidenceVerifier(
    { read: async () => Buffer.from("{}") },
    { read: async () => Buffer.from("{}") },
    "8".repeat(64),
    {
      providerIdentitySha256: "1".repeat(64),
      providerConfigurationSha256: "2".repeat(64),
      brokerContractSha256: "3".repeat(64),
      vaultPolicySha256: "4".repeat(64),
      pagerRoutingSha256: "5".repeat(64),
      backupRestoreEvidenceSha256: "6".repeat(64),
      runtimeDeploymentEvidenceSha256: "7".repeat(64),
    },
  );
  vi.spyOn(verifier, "verify").mockResolvedValue(result);
  return verifier;
}

function securityVerifier(
  result: SecurityAssessmentEvidenceReadiness = securityAssessmentReadiness,
): SecurityAssessmentEvidenceVerifier {
  const verifier = new SecurityAssessmentEvidenceVerifier(
    { read: async () => Buffer.from("{}") },
    { read: async () => Buffer.from("{}") },
    "9".repeat(64),
    {
      releaseArtifactSha256: "1".repeat(64),
      sbomSha256: "2".repeat(64),
      dependencyAuditSha256: "3".repeat(64),
      sastReportSha256: "4".repeat(64),
      dastReportSha256: "5".repeat(64),
      secretScanReportSha256: "6".repeat(64),
      crossTenantReportSha256: "7".repeat(64),
      penetrationTestReportSha256: "8".repeat(64),
    },
  );
  vi.spyOn(verifier, "verify").mockResolvedValue(result);
  return verifier;
}

function service(result: ProjectDatabaseProvisioningHealth = health) {
  return {
    getHealth: vi.fn(async () => result),
    getStatus: vi.fn(),
    request: vi.fn(),
  } satisfies ProjectDatabaseProvisioningService;
}

function request(token?: string, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(
    "https://qkern.test/api/internal/v1/projects/provisioning/metrics",
    {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
    },
  );
}

describe("project provisioning OpenMetrics rendering", () => {
  it("exports only fixed aggregate names and labels", () => {
    const metrics = renderProjectProvisioningOpenMetrics(health);
    expect(metrics).toContain('qkern_project_provisioning_health_status{status="degraded"} 1');
    expect(metrics).toContain('qkern_project_provisioning_jobs{state="pending"} 1');
    expect(metrics).toContain(
      'qkern_project_provisioning_active_failures{code="provider_unavailable"} 1',
    );
    expect(metrics).toContain('qkern_project_provisioners{state="active"} 1');
    expect(metrics).toContain("qkern_project_provisioning_measurement_timestamp_seconds 1785067200");
    expect(metrics.endsWith("# EOF\n")).toBe(true);
    expect(metrics).not.toMatch(
      /organization|project_id|job_id|provisioner_id|environment|lease_owner|lease_token|host|port|vault|credential|token/i,
    );
  });

  it("rejects invalid counts and timestamps instead of emitting malformed metrics", () => {
    expect(() => renderProjectProvisioningOpenMetrics({
      ...health,
      totalCount: Number.NaN,
    })).toThrow(ProjectProvisioningMetricsDataError);
    expect(() => renderProjectProvisioningOpenMetrics({
      ...health,
      measuredAt: "not-a-date",
    })).toThrow(ProjectProvisioningMetricsDataError);
  });

  it("adds only fixed backup/restore readiness metrics after signed evidence verification", () => {
    const metrics = renderProjectProvisioningOpenMetrics(health, backupRestoreReadiness);
    expect(metrics).toContain("qkern_backup_restore_readiness 1");
    expect(metrics).toContain("qkern_backup_restore_recovery_point_lag_seconds 300");
    expect(metrics).toContain("qkern_backup_restore_duration_seconds 1200");
    expect(metrics).toContain("qkern_backup_restore_snapshot_timestamp_seconds 1785060000");
    expect(metrics).toContain("qkern_backup_restore_verified_timestamp_seconds 1785062400");
    expect(metrics).not.toContain(backupRestoreReadiness.evidenceId);
    expect(metrics).not.toMatch(/artifact|manifest|signature|public_key|key_id/i);
    expect(() => renderProjectProvisioningOpenMetrics(health, {
      ...backupRestoreReadiness,
      restoreDurationSeconds: 14_401,
    })).toThrow(ProjectProvisioningMetricsDataError);
  });

  it("adds only fixed live deployment metrics after signed evidence verification", () => {
    const metrics = renderProjectProvisioningOpenMetrics(
      health,
      undefined,
      runtimeDeploymentReadiness,
    );
    expect(metrics).toContain("qkern_runtime_deployment_readiness 1");
    expect(metrics).toContain("qkern_runtime_deployment_component_count 4");
    expect(metrics).toContain("qkern_runtime_deployment_observation_duration_seconds 3600");
    expect(metrics).toContain("qkern_runtime_deployment_observed_timestamp_seconds 1785063600");
    expect(metrics).toContain("qkern_runtime_deployment_certified_timestamp_seconds 1785063900");
    expect(metrics).not.toMatch(/cluster|namespace|bundle|provenance|signature|key_id/i);
    expect(() => renderProjectProvisioningOpenMetrics(health, undefined, {
      ...runtimeDeploymentReadiness,
      componentCount: 3,
    } as unknown as RuntimeDeploymentEvidenceReadiness))
      .toThrow(ProjectProvisioningMetricsDataError);
  });

  it("adds only fixed provider E2E and pager lifecycle metrics after certification", () => {
    const metrics = renderProjectProvisioningOpenMetrics(
      health,
      undefined,
      undefined,
      providerE2EReadiness,
    );
    expect(metrics).toContain("qkern_provider_e2e_readiness 1");
    expect(metrics).toContain("qkern_provider_e2e_scenario_count 15");
    expect(metrics).toContain("qkern_provider_e2e_run_duration_seconds 3600");
    expect(metrics).toContain("qkern_provider_e2e_postgres_major_version 17");
    expect(metrics).not.toMatch(
      /providerIdentity|providerConfiguration|pagerRouting|signature|key_id/i,
    );
    expect(() => renderProjectProvisioningOpenMetrics(
      health,
      undefined,
      undefined,
      { ...providerE2EReadiness, scenarioCount: 14 } as
        unknown as ProviderE2EEvidenceReadiness,
    )).toThrow(ProjectProvisioningMetricsDataError);
  });

  it("adds only fixed release security metrics after independent certification", () => {
    const metrics = renderProjectProvisioningOpenMetrics(
      health,
      undefined,
      undefined,
      undefined,
      securityAssessmentReadiness,
    );
    expect(metrics).toContain("qkern_security_assessment_readiness 1");
    expect(metrics).toContain("qkern_security_assessment_count 14");
    expect(metrics).toContain(
      "qkern_security_assessment_unresolved_critical_findings 0",
    );
    expect(metrics).toContain(
      "qkern_security_assessment_unresolved_high_findings 0",
    );
    expect(metrics).toContain("qkern_security_assessment_duration_seconds 86400");
    expect(metrics).not.toMatch(/report|sha256|signature|key_id|evidenceId/i);
    expect(() => renderProjectProvisioningOpenMetrics(
      health,
      undefined,
      undefined,
      undefined,
      { ...securityAssessmentReadiness, assessmentCount: 13 } as
        unknown as SecurityAssessmentEvidenceReadiness,
    )).toThrow(ProjectProvisioningMetricsDataError);
  });
});

describe("project provisioning metrics token boundary", () => {
  it("compares valid bearer tokens through fixed-size digests and zeroes provider bytes", async () => {
    const expected = Buffer.from(TOKEN, "ascii");
    const provider = {
      getToken: vi.fn()
        .mockResolvedValueOnce(expected)
        .mockResolvedValueOnce(Buffer.from(TOKEN, "ascii")),
    };
    const authenticator = new ProjectProvisioningMetricsAuthenticator(provider);
    await expect(authenticator.authorize(`Bearer ${TOKEN}`)).resolves.toBe(true);
    expect(expected.every((byte) => byte === 0)).toBe(true);
    await expect(authenticator.authorize(`Bearer ${OTHER_TOKEN}`)).resolves.toBe(false);
    await expect(authenticator.authorize(`Basic ${TOKEN}`)).resolves.toBe(false);
    expect(provider.getToken).toHaveBeenCalledTimes(2);
  });

  it("rereads a private no-follow token file so rotation is immediate", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-metrics-token-"));
    tempDirectories.push(directory);
    const tokenPath = path.join(directory, "token");
    await writeFile(tokenPath, `${TOKEN}\n`, { mode: 0o600 });
    const provider = new ProjectProvisioningMetricsTokenFileProvider(tokenPath, true);
    const first = await provider.getToken({});
    expect(Buffer.from(first).toString("ascii")).toBe(TOKEN);
    first.fill(0);
    await writeFile(tokenPath, OTHER_TOKEN, { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    const second = await provider.getToken({});
    expect(Buffer.from(second).toString("ascii")).toBe(OTHER_TOKEN);
    second.fill(0);
  });

  it("rejects group-readable files, links, malformed tokens and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-metrics-token-"));
    tempDirectories.push(directory);
    const tokenPath = path.join(directory, "token");
    await writeFile(tokenPath, TOKEN, { mode: 0o640 });
    await chmod(tokenPath, 0o640);
    await expect(new ProjectProvisioningMetricsTokenFileProvider(tokenPath, true).getToken({}))
      .rejects.toBeInstanceOf(ProjectProvisioningMetricsTokenUnavailableError);

    await chmod(tokenPath, 0o600);
    const linkPath = path.join(directory, "token-link");
    await symlink(tokenPath, linkPath);
    await expect(new ProjectProvisioningMetricsTokenFileProvider(linkPath, true).getToken({}))
      .rejects.toBeInstanceOf(ProjectProvisioningMetricsTokenUnavailableError);

    await writeFile(tokenPath, "too-short", { mode: 0o600 });
    await expect(new ProjectProvisioningMetricsTokenFileProvider(tokenPath).getToken({}))
      .rejects.toBeInstanceOf(ProjectProvisioningMetricsTokenUnavailableError);
    expect(() => new ProjectProvisioningMetricsTokenFileProvider("relative-token"))
      .toThrow(ConfigurationError);
  });
});

describe("project provisioning metrics runtime", () => {
  it("stays absent by default and requires persistent tenant-bound configuration", () => {
    expect(createProjectProvisioningMetricsRuntime({})).toEqual({
      enabled: false,
      misconfigured: false,
    });
    expect(() => createProjectProvisioningMetricsRuntime({
      QKERN_PROVISIONING_METRICS_ENABLED: "true",
      QKERN_RUNTIME_MODE: "memory",
    }, { tokenProvider: tokenProvider() })).toThrow("PostgreSQL runtime mode");
    expect(() => createProjectProvisioningMetricsRuntime({
      QKERN_PROVISIONING_METRICS_ENABLED: "true",
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_PROVISIONING_METRICS_ORGANIZATION_ID: "org",
    }, { tokenProvider: tokenProvider() })).toThrow("must be a UUID");
  });

  it("forbids inline or authority-reused tokens", () => {
    const base = {
      QKERN_PROVISIONING_METRICS_ENABLED: "true",
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_PROVISIONING_METRICS_ORGANIZATION_ID: ORGANIZATION_ID,
    };
    expect(() => createProjectProvisioningMetricsRuntime({
      ...base,
      QKERN_PROVISIONING_METRICS_TOKEN: TOKEN,
    }, { tokenProvider: tokenProvider() })).toThrow("Inline");
    expect(() => createProjectProvisioningMetricsRuntime({
      ...base,
      QKERN_PROVISIONING_METRICS_TOKEN_FILE: "/run/qkern/shared-token",
      QKERN_VAULT_TOKEN_FILE: "/run/qkern/shared-token",
    })).toThrow("dedicated token file");
    expect(() => createProjectProvisioningMetricsRuntime({
      ...base,
      QKERN_PROVISIONING_METRICS_TOKEN_FILE: "/run/qkern/shared-token",
      QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE: "/run/qkern/shared-token",
    })).toThrow("dedicated token file");
  });

  it("activates each signed evidence gate only through its explicit monitoring flag", () => {
    const verifier = restoreVerifier();
    const liveVerifier = deploymentVerifier();
    const providerEvidenceVerifier = providerVerifier();
    const securityEvidenceVerifier = securityVerifier();
    const runtime = readyRuntime(
      tokenProvider(),
      verifier,
      liveVerifier,
      providerEvidenceVerifier,
      securityEvidenceVerifier,
    );
    expect(runtime.enabled).toBe(true);
    if (!runtime.enabled) throw new Error("Expected enabled runtime");
    expect(runtime.backupRestoreEvidenceVerifier).toBe(verifier);
    expect(runtime.runtimeDeploymentEvidenceVerifier).toBe(liveVerifier);
    expect(runtime.providerE2EEvidenceVerifier).toBe(providerEvidenceVerifier);
    expect(runtime.securityAssessmentEvidenceVerifier)
      .toBe(securityEvidenceVerifier);
    const withoutEvidence = readyRuntime();
    if (!withoutEvidence.enabled) throw new Error("Expected enabled runtime");
    expect(withoutEvidence.backupRestoreEvidenceVerifier).toBeUndefined();
    expect(withoutEvidence.runtimeDeploymentEvidenceVerifier).toBeUndefined();
    expect(withoutEvidence.providerE2EEvidenceVerifier).toBeUndefined();
    expect(withoutEvidence.securityAssessmentEvidenceVerifier).toBeUndefined();
  });
});

describe("project provisioning metrics route", () => {
  it("returns 404 while disabled and never consults the service", async () => {
    const provisioning = service();
    const response = await createGetProjectProvisioningMetricsHandler({
      enabled: false,
      misconfigured: false,
    }, provisioning)(request());
    expect(response.status).toBe(404);
    expect(provisioning.getHealth).not.toHaveBeenCalled();
  });

  it("returns 503 for an enabled but invalid startup configuration", async () => {
    const response = await createGetProjectProvisioningMetricsHandler({
      enabled: false,
      misconfigured: true,
    }, service())(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("ignores cookies and tenant headers, requiring only the dedicated bearer", async () => {
    const provisioning = service();
    const handler = createGetProjectProvisioningMetricsHandler(readyRuntime(), provisioning);
    const response = await handler(request(undefined, {
      cookie: "__Host-qkern_session=fake-session",
      "x-qkern-organization": "9730b448-7fd0-4c4f-9553-33220752bdf6",
    }));
    expect(response.status).toBe(401);
    expect(provisioning.getHealth).not.toHaveBeenCalled();
  });

  it("exports tenant-fixed no-store metrics after dedicated authentication", async () => {
    const provisioning = service();
    const handler = createGetProjectProvisioningMetricsHandler(readyRuntime(), provisioning);
    const response = await handler(request(TOKEN, {
      "x-qkern-organization": "9730b448-7fd0-4c4f-9553-33220752bdf6",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(PROJECT_PROVISIONING_METRICS_CONTENT_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(provisioning.getHealth).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actor: { ref: "monitor:project-provisioning-metrics", type: "system" },
    });
    const body = await response.text();
    expect(body).toContain("qkern_project_provisioning_jobs");
    expect(body).not.toContain(ORGANIZATION_ID);
  });

  it("exports fixed restore-readiness metrics only after the signed verifier succeeds", async () => {
    const verifier = restoreVerifier();
    const response = await createGetProjectProvisioningMetricsHandler(
      readyRuntime(tokenProvider(), verifier),
      service(),
    )(request(TOKEN));
    expect(response.status).toBe(200);
    expect(verifier.verify).toHaveBeenCalledOnce();
    const body = await response.text();
    expect(body).toContain("qkern_backup_restore_readiness 1");
    expect(body).not.toContain(backupRestoreReadiness.evidenceId);
  });

  it("fails the scrape closed when enabled restore evidence is invalid or stale", async () => {
    const verifier = restoreVerifier();
    vi.mocked(verifier.verify).mockRejectedValueOnce(
      new BackupRestoreEvidenceUnavailableError(),
    );
    const response = await createGetProjectProvisioningMetricsHandler(
      readyRuntime(tokenProvider(), verifier),
      service(),
    )(request(TOKEN));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Project provisioning metrics unavailable",
    });
  });

  it("exports fixed runtime deployment metrics only after signed live evidence succeeds", async () => {
    const verifier = deploymentVerifier();
    const response = await createGetProjectProvisioningMetricsHandler(
      readyRuntime(tokenProvider(), undefined, verifier),
      service(),
    )(request(TOKEN));
    expect(response.status).toBe(200);
    expect(verifier.verify).toHaveBeenCalledOnce();
    const body = await response.text();
    expect(body).toContain("qkern_runtime_deployment_readiness 1");
    expect(body).not.toMatch(/cluster|namespace|bundle|provenance|signature|key_id/i);
  });

  it("fails the scrape closed when enabled runtime deployment evidence is invalid", async () => {
    const verifier = deploymentVerifier();
    vi.mocked(verifier.verify).mockRejectedValueOnce(
      new RuntimeDeploymentEvidenceUnavailableError(),
    );
    const response = await createGetProjectProvisioningMetricsHandler(
      readyRuntime(tokenProvider(), undefined, verifier),
      service(),
    )(request(TOKEN));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Project provisioning metrics unavailable",
    });
  });

  it("exports provider E2E readiness and fails closed when its signed evidence is invalid", async () => {
    const verifier = providerVerifier();
    const handler = createGetProjectProvisioningMetricsHandler(
      readyRuntime(tokenProvider(), undefined, undefined, verifier),
      service(),
    );
    const success = await handler(request(TOKEN));
    expect(success.status).toBe(200);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(await success.text()).toContain("qkern_provider_e2e_readiness 1");

    vi.mocked(verifier.verify).mockRejectedValueOnce(
      new ProviderE2EEvidenceUnavailableError(),
    );
    const failure = await handler(request(TOKEN));
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({
      error: "Project provisioning metrics unavailable",
    });
  });

  it("exports security readiness and fails closed when its certificate is invalid", async () => {
    const verifier = securityVerifier();
    const handler = createGetProjectProvisioningMetricsHandler(
      readyRuntime(
        tokenProvider(),
        undefined,
        undefined,
        undefined,
        verifier,
      ),
      service(),
    );
    const success = await handler(request(TOKEN));
    expect(success.status).toBe(200);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(await success.text()).toContain(
      "qkern_security_assessment_readiness 1",
    );

    vi.mocked(verifier.verify).mockRejectedValueOnce(
      new SecurityAssessmentEvidenceUnavailableError(),
    );
    const failure = await handler(request(TOKEN));
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({
      error: "Project provisioning metrics unavailable",
    });
  });

  it("reports token-file failure as unavailable without leaking its cause", async () => {
    const provider: ProjectProvisioningMetricsTokenProvider = {
      getToken: vi.fn(async () => {
        throw new ProjectProvisioningMetricsTokenUnavailableError();
      }),
    };
    const response = await createGetProjectProvisioningMetricsHandler(
      readyRuntime(provider),
      service(),
    )(request(TOKEN));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Project provisioning metrics unavailable",
    });
  });
});
