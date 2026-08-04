import type { ControlPlaneContext } from "@/lib/server/control-plane/model";
import type { ProjectDatabaseProvisioningErrorCode } from "@/lib/server/db/models";
import type { Environment } from "@/lib/types";

export type ProjectDatabaseProvisioningStatus = {
  projectId: string;
  environment: Environment;
  jobId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  attemptCount: number;
  maxAttempts: number;
  retryCycleCount: number;
  maxRetryCycles: number;
  lastErrorCode?: ProjectDatabaseProvisioningErrorCode;
  createdAt: string;
  updatedAt: string;
};

export type RequestProjectDatabaseProvisioningResult = ProjectDatabaseProvisioningStatus & {
  outcome: "requested" | "retry_requested" | "already_requested";
};

export type ProjectDatabaseProvisioningHealth = {
  status: "healthy" | "degraded" | "critical";
  measuredAt: string;
  totalCount: number;
  pendingCount: number;
  readyCount: number;
  scheduledCount: number;
  runningCount: number;
  overduePendingCount: number;
  expiredLeaseCount: number;
  succeededCount: number;
  failedCount: number;
  recoveryExhaustedCount: number;
  activeFailureCount: number;
  activeProviderUnavailableCount: number;
  activeProviderRejectedCount: number;
  activeInvalidBindingCount: number;
  activeBootstrapUnverifiedCount: number;
  activeProvisioningTimeoutCount: number;
  observedProvisionerCount: number;
  activeProvisionerCount: number;
  staleProvisionerCount: number;
  oldestPendingAt?: string;
  latestFailedAt?: string;
  latestHeartbeatAt?: string;
  policy: {
    overdueAfterSeconds: 300;
    heartbeatStaleAfterSeconds: 120;
    provisionerObservationWindowSeconds: 86400;
    expiredLeasesAreCritical: true;
    exhaustedRecoveryIsCritical: true;
    activeWorkWithoutProvisionerIsCritical: true;
    bindingVerificationFailuresAreCritical: true;
  };
};

export interface ProjectDatabaseProvisioningService {
  getHealth(context: ControlPlaneContext): Promise<ProjectDatabaseProvisioningHealth>;
  getStatus(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<ProjectDatabaseProvisioningStatus>;
  request(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<RequestProjectDatabaseProvisioningResult>;
}
