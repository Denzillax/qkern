import { NextRequest, NextResponse } from "next/server";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { BackupRestoreEvidenceUnavailableError } from
  "@/lib/server/backup/restore-evidence";
import { RuntimeDeploymentEvidenceUnavailableError } from
  "@/lib/server/operations/runtime-deployment-evidence";
import { ProviderE2EEvidenceUnavailableError } from
  "@/lib/server/operations/provider-e2e-evidence";
import { SecurityAssessmentEvidenceUnavailableError } from
  "@/lib/server/security/security-assessment-evidence";
import {
  PROJECT_PROVISIONING_METRICS_CONTENT_TYPE,
  ProjectProvisioningMetricsDataError,
  ProjectProvisioningMetricsTokenUnavailableError,
  renderProjectProvisioningOpenMetrics,
} from "@/lib/server/provisioning/metrics-exporter";
import {
  createProjectProvisioningMetricsRuntime,
  type ProjectProvisioningMetricsRuntime,
} from "@/lib/server/provisioning/metrics-runtime";
import type { ProjectDatabaseProvisioningService } from "@/lib/server/provisioning/service";
import { projectDatabaseProvisioningService } from "@/lib/server/provisioning/runtime";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const notFound = () => NextResponse.json({ error: "Resource not found" }, {
  status: 404,
  headers: responseHeaders,
});

export function createGetProjectProvisioningMetricsHandler(
  runtime: ProjectProvisioningMetricsRuntime,
  service: ProjectDatabaseProvisioningService,
) {
  return async function GET(request: NextRequest) {
    if (!runtime.enabled) {
      return runtime.misconfigured
        ? NextResponse.json({ error: "Project provisioning metrics unavailable" }, {
            status: 503,
            headers: responseHeaders,
          })
        : notFound();
    }
    try {
      if (!await runtime.authenticator.authorize(
        request.headers.get("authorization"),
        request.signal,
      )) {
        return NextResponse.json({ error: "Authentication required" }, {
          status: 401,
          headers: {
            ...responseHeaders,
            "www-authenticate": 'Bearer realm="qkern-project-provisioning-metrics"',
          },
        });
      }
      const [
        health,
        backupRestoreReadiness,
        runtimeDeploymentReadiness,
        providerE2EReadiness,
        securityAssessmentReadiness,
      ] = await Promise.all([
        service.getHealth({
          organizationId: runtime.organizationId,
          actor: { ref: runtime.actorRef, type: "system" },
        }),
        runtime.backupRestoreEvidenceVerifier?.verify(request.signal),
        runtime.runtimeDeploymentEvidenceVerifier?.verify(request.signal),
        runtime.providerE2EEvidenceVerifier?.verify(request.signal),
        runtime.securityAssessmentEvidenceVerifier?.verify(request.signal),
      ]);
      return new NextResponse(renderProjectProvisioningOpenMetrics(
        health,
        backupRestoreReadiness,
        runtimeDeploymentReadiness,
        providerE2EReadiness,
        securityAssessmentReadiness,
      ), {
        status: 200,
        headers: {
          ...responseHeaders,
          "content-type": PROJECT_PROVISIONING_METRICS_CONTENT_TYPE,
        },
      });
    } catch (error) {
      const code = domainErrorCode(error);
      if (error instanceof ProjectProvisioningMetricsTokenUnavailableError ||
          error instanceof ProjectProvisioningMetricsDataError ||
          error instanceof BackupRestoreEvidenceUnavailableError ||
          error instanceof RuntimeDeploymentEvidenceUnavailableError ||
          error instanceof ProviderE2EEvidenceUnavailableError ||
          error instanceof SecurityAssessmentEvidenceUnavailableError ||
          code === "DEPENDENCY_UNAVAILABLE" ||
          code === "INVALID_RECORD") {
        return NextResponse.json({ error: "Project provisioning metrics unavailable" }, {
          status: 503,
          headers: responseHeaders,
        });
      }
      return NextResponse.json({ error: "Could not export project provisioning metrics" }, {
        status: 500,
        headers: responseHeaders,
      });
    }
  };
}

let runtime: ProjectProvisioningMetricsRuntime;
try {
  runtime = createProjectProvisioningMetricsRuntime();
} catch {
  runtime = { enabled: false, misconfigured: true };
}

export const GET = createGetProjectProvisioningMetricsHandler(
  runtime,
  projectDatabaseProvisioningService,
);
