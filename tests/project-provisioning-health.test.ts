import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createGetProjectDatabaseProvisioningHealthHandler } from
  "@/app/api/v1/projects/provisioning/health/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { InvalidRecordError } from "@/lib/server/db/errors";
import type {
  ProjectDatabaseProvisioningHealthRecord,
} from "@/lib/server/db/models";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import type {
  ProjectDatabaseProvisioningHealth,
  ProjectDatabaseProvisioningService,
} from "@/lib/server/provisioning/service";
import { PostgresProjectDatabaseProvisioningService } from "@/lib/server/provisioning/services";
import { tenancyService } from "@/lib/server/tenancy-service";

const context = {
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  actor: { id: "user-1", ref: "owner@example.com", type: "user" as const },
};

function health(
  overrides: Partial<ProjectDatabaseProvisioningHealthRecord> = {},
): ProjectDatabaseProvisioningHealthRecord {
  return {
    totalCount: 1,
    pendingCount: 0,
    readyCount: 0,
    scheduledCount: 0,
    runningCount: 0,
    overduePendingCount: 0,
    expiredLeaseCount: 0,
    succeededCount: 1,
    failedCount: 0,
    recoveryExhaustedCount: 0,
    activeFailureCount: 0,
    activeProviderUnavailableCount: 0,
    activeProviderRejectedCount: 0,
    activeInvalidBindingCount: 0,
    activeBootstrapUnverifiedCount: 0,
    activeProvisioningTimeoutCount: 0,
    observedProvisionerCount: 1,
    activeProvisionerCount: 1,
    staleProvisionerCount: 0,
    oldestPendingAt: null,
    latestFailedAt: null,
    latestHeartbeatAt: "2026-07-26T10:00:00.000Z",
    measuredAt: "2026-07-26T10:00:01.000Z",
    ...overrides,
  };
}

function provider(record: ProjectDatabaseProvisioningHealthRecord) {
  const contexts: unknown[] = [];
  return {
    contexts,
    async withTenant<T>(
      tenant: unknown,
      operation: (repositories: ControlPlaneRepositories) => Promise<T>,
    ): Promise<T> {
      contexts.push(tenant);
      return operation({
        projectDatabaseProvisioning: { health: vi.fn().mockResolvedValue(record) },
      } as unknown as ControlPlaneRepositories);
    },
  };
}

describe("project provisioning health", () => {
  it("returns a redacted healthy aggregate in a tenant read-only transaction", async () => {
    const database = provider(health());
    const result = await new PostgresProjectDatabaseProvisioningService(database).getHealth(context);
    expect(result).toMatchObject({
      status: "healthy",
      totalCount: 1,
      activeProvisionerCount: 1,
      policy: {
        overdueAfterSeconds: 300,
        heartbeatStaleAfterSeconds: 120,
        provisionerObservationWindowSeconds: 86_400,
      },
    });
    expect(database.contexts).toEqual([{
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }]);
    expect(JSON.stringify(result)).not.toMatch(
      /"(organizationId|projectId|environment|jobId|provisionerId|leaseOwner|leaseToken|host|port|vault|credential)"/i,
    );
  });

  it("classifies stopped workers and unsafe bindings as critical", async () => {
    const noWorker = health({
      totalCount: 1,
      pendingCount: 1,
      readyCount: 1,
      succeededCount: 0,
      observedProvisionerCount: 0,
      activeProvisionerCount: 0,
      latestHeartbeatAt: null,
    });
    await expect(new PostgresProjectDatabaseProvisioningService(provider(noWorker)).getHealth(context))
      .resolves.toMatchObject({ status: "critical", pendingCount: 1, activeProvisionerCount: 0 });

    const unsafeBinding = health({
      totalCount: 1,
      pendingCount: 1,
      readyCount: 1,
      succeededCount: 0,
      activeFailureCount: 1,
      activeInvalidBindingCount: 1,
    });
    await expect(new PostgresProjectDatabaseProvisioningService(provider(unsafeBinding)).getHealth(context))
      .resolves.toMatchObject({ status: "critical", activeInvalidBindingCount: 1 });
  });

  it("rejects inconsistent aggregate projections instead of guessing health", async () => {
    const inconsistent = health({ totalCount: 2 });
    await expect(new PostgresProjectDatabaseProvisioningService(provider(inconsistent)).getHealth(context))
      .rejects.toBeInstanceOf(InvalidRecordError);
  });
});

async function ownerSession() {
  const nonce = crypto.randomUUID();
  const registration = await authRuntime.service.register({
    email: `provisioning-health-${nonce}@qkern.test`,
    password: "a sufficiently long provisioning health password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

const publicHealth: ProjectDatabaseProvisioningHealth = {
  status: "healthy",
  measuredAt: "2026-07-26T10:00:01.000Z",
  totalCount: 1,
  pendingCount: 0,
  readyCount: 0,
  scheduledCount: 0,
  runningCount: 0,
  overduePendingCount: 0,
  expiredLeaseCount: 0,
  succeededCount: 1,
  failedCount: 0,
  recoveryExhaustedCount: 0,
  activeFailureCount: 0,
  activeProviderUnavailableCount: 0,
  activeProviderRejectedCount: 0,
  activeInvalidBindingCount: 0,
  activeBootstrapUnverifiedCount: 0,
  activeProvisioningTimeoutCount: 0,
  observedProvisionerCount: 1,
  activeProvisionerCount: 1,
  staleProvisionerCount: 0,
  latestHeartbeatAt: "2026-07-26T10:00:00.000Z",
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

describe("project provisioning health route", () => {
  it("authenticates and returns the private aggregate without operational identities", async () => {
    const token = await ownerSession();
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn().mockResolvedValue(publicHealth),
      getStatus: vi.fn(),
      request: vi.fn(),
    };
    const response = await createGetProjectDatabaseProvisioningHealthHandler(service)(
      new NextRequest("https://qkern.test/api/v1/projects/provisioning/health", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ data: { provisioningHealth: publicHealth } });
    expect(JSON.stringify(body)).not.toMatch(
      /"(organizationId|projectId|environment|jobId|provisionerId|leaseOwner|leaseToken|host|port|vault|credential)"/i,
    );
  });

  it("rejects anonymous health reads", async () => {
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn(),
      getStatus: vi.fn(),
      request: vi.fn(),
    };
    const response = await createGetProjectDatabaseProvisioningHealthHandler(service)(
      new NextRequest("https://qkern.test/api/v1/projects/provisioning/health"),
    );
    expect(response.status).toBe(401);
    expect(service.getHealth).not.toHaveBeenCalled();
  });
});
