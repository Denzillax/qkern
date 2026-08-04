import { describe, expect, it, vi } from "vitest";
import { InvalidRecordError, MigrationNotReadyError, ResourceNotFoundError } from "@/lib/server/db/errors";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import { MigrationApplyDeliveryNotRetryableError } from "@/lib/server/migrations/apply-delivery-service";
import {
  MemoryMigrationApplyDeliveryService,
  PostgresMigrationApplyDeliveryService,
} from "@/lib/server/migrations/apply-delivery-services";

const context = {
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  actor: { id: "user-1", ref: "owner@example.com", type: "user" as const },
};
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const EVENT_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const COMMAND_ID = "542fa056-4d26-4853-87f4-1b6c86b2e7f4";

function provider(repositories: Partial<ControlPlaneRepositories>) {
  const contexts: unknown[] = [];
  return {
    contexts,
    async withTenant<T>(tenant: unknown, operation: (value: ControlPlaneRepositories) => Promise<T>): Promise<T> {
      contexts.push(tenant);
      return operation(repositories as ControlPlaneRepositories);
    },
  };
}

function job() {
  return { id: JOB_ID, projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6", environment: "production", changeSetId: "9a973ec8-a409-4706-ad1d-ef6360ea430d" };
}

function health(overrides: Record<string, unknown> = {}) {
  return {
    totalCount: 2, pendingCount: 1, readyCount: 0, scheduledCount: 1, inFlightCount: 0,
    overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
    publishedCount: 1, deadLetteredCount: 0, recoveryExhaustedCount: 0,
    pendingRetryCommandCount: 0, activeFailureCount: 1, activePublishFailedCount: 0,
    activeInvalidAckCount: 0, activeSigningKeyUnavailableCount: 0,
    activeDeliveryTimeoutCount: 1, activeDestinationRejectedCount: 0,
    oldestPendingAt: "2026-07-20T12:00:00.000Z", oldestDeadLetteredAt: null,
    latestDeadLetteredAt: null, measuredAt: "2026-07-20T12:01:00.000Z",
    ...overrides,
  };
}

describe("migration apply delivery services", () => {
  it("returns no synthetic delivery in memory mode", async () => {
    const service = new MemoryMigrationApplyDeliveryService();
    await expect(service.getHealth()).resolves.toMatchObject({ status: "healthy", totalCount: 0 });
    await expect(service.getStatus()).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.requestRetry()).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("reads one tenant job through the narrow redacted delivery projection", async () => {
    const get = vi.fn().mockResolvedValue(job());
    const status = vi.fn().mockResolvedValue({
      migrationJobId: JOB_ID, eventId: EVENT_ID, status: "dead_lettered",
      attemptCount: 8, failureCount: 8, maxFailures: 8,
      lastFailureCode: "DELIVERY_TIMEOUT", deadLetteredAt: "2026-07-20T12:00:00.000Z",
      retryCycleCount: 1, maxRetryCycles: 3, availableAt: "2026-07-20T11:59:00.000Z",
      publishedAt: null, retryCommandPending: false,
    });
    const database = provider({
      migrationJobs: { get }, migrationOutboxDeliveryVisibility: { status },
    } as unknown as Partial<ControlPlaneRepositories>);

    const result = await new PostgresMigrationApplyDeliveryService(database).getStatus(context, JOB_ID);

    expect(result).toMatchObject({ migrationJobId: JOB_ID, eventId: EVENT_ID, status: "dead_lettered" });
    expect(database.contexts).toEqual([{ organizationId: context.organizationId, actorRef: context.actor.ref, readOnly: true }]);
    expect(JSON.stringify(result)).not.toMatch(/lease|token|broker|credential|provider|response/i);
  });

  it("classifies aggregate failures and rejects inconsistent health projections", async () => {
    const visibility = { health: vi.fn().mockResolvedValue(health()) };
    const database = provider({ migrationOutboxDeliveryVisibility: visibility } as unknown as Partial<ControlPlaneRepositories>);
    const service = new PostgresMigrationApplyDeliveryService(database);

    await expect(service.getHealth(context)).resolves.toMatchObject({
      status: "degraded", activeDeliveryTimeoutCount: 1,
      policy: { overdueAfterSeconds: 300 },
    });

    visibility.health.mockResolvedValueOnce(health({
      pendingCount: 0, scheduledCount: 0, deadLetteredCount: 1, publishedCount: 1,
    }));
    await expect(service.getHealth(context)).resolves.toMatchObject({ status: "critical" });

    visibility.health.mockResolvedValueOnce(health({ activeFailureCount: 2 }));
    await expect(service.getHealth(context)).rejects.toBeInstanceOf(InvalidRecordError);
  });

  it("queues and audits an exact dead-letter generation idempotently", async () => {
    const command = {
      id: COMMAND_ID, migrationJobId: JOB_ID, reasonCode: "destination_recovered",
      expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1,
    };
    const enqueue = vi.fn()
      .mockResolvedValueOnce({ command, created: true })
      .mockResolvedValueOnce({ command, created: false });
    const append = vi.fn().mockResolvedValue({});
    const database = provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(job()) },
      migrationOutboxDeliveryCommands: { enqueue },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>);
    const service = new PostgresMigrationApplyDeliveryService(database);
    const input = {
      migrationJobId: JOB_ID, reasonCode: "destination_recovered" as const,
      expectedFailureCode: "DELIVERY_TIMEOUT" as const, expectedRetryCycle: 1,
    };

    await expect(service.requestRetry(context, input)).resolves.toMatchObject({ outcome: "requested", commandId: COMMAND_ID });
    await expect(service.requestRetry(context, input)).resolves.toMatchObject({ outcome: "already_requested", commandId: COMMAND_ID });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.apply.delivery_retry_requested",
      metadata: expect.objectContaining({ expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1 }),
    }));
  });

  it("maps a changed or exhausted delivery snapshot to the stable not-retryable error", async () => {
    const database = provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(job()) },
      migrationOutboxDeliveryCommands: { enqueue: vi.fn().mockRejectedValue(new MigrationNotReadyError()) },
    } as unknown as Partial<ControlPlaneRepositories>);
    const service = new PostgresMigrationApplyDeliveryService(database);

    await expect(service.requestRetry(context, {
      migrationJobId: JOB_ID, reasonCode: "destination_recovered",
      expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1,
    })).rejects.toBeInstanceOf(MigrationApplyDeliveryNotRetryableError);
  });
});
