import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import { approvalActionHash } from "@/lib/server/control-plane/crypto";
import { MigrationLeaseLostError, MigrationNotReadyError } from "@/lib/server/db/errors";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import type { MigrationIncidentRecord, MigrationJobRecord } from "@/lib/server/db/models";
import { createMigrationIncidentService } from "@/lib/server/migrations/incident-runtime";
import {
  MigrationIncidentDeliveryNotRetryableError,
  MigrationIncidentResolutionNotVerifiableError,
} from "@/lib/server/migrations/incident-service";
import { MemoryMigrationIncidentService, PostgresMigrationIncidentService } from "@/lib/server/migrations/incident-services";
import { PostgresMigrationQueue } from "@/lib/server/migrations/postgres-queue";
import { createMigrationReviewService } from "@/lib/server/migrations/review-runtime";
import {
  MigrationReviewCyclesExhaustedError,
  MigrationReviewNotReadyError,
} from "@/lib/server/migrations/review-service";
import { MemoryMigrationReviewService, PostgresMigrationReviewService } from "@/lib/server/migrations/review-services";
import { MemoryChangeSetApplyService, PostgresChangeSetApplyService } from "@/lib/server/migrations/services";
import {
  ProductionApplyBlockedError,
  type ProductionApplyAuthorizer,
} from "@/lib/server/migrations/production-apply-authorization";

const context = { organizationId: "organization", actor: { id: "user", ref: "owner@example.com", type: "user" as const } };
const change = {
  id: "change", organizationId: "organization", projectId: "project", environment: "development" as const,
  title: "Create index", statementSha256: "a".repeat(64), encryptedStatement: Buffer.from("ciphertext"),
  risk: "medium" as const, status: "approved" as const, createdBy: "user", agentSessionId: null,
  createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
};
const approvalExpiresAt = "2099-07-18T00:00:00.000Z";
const approval = {
  id: "approval", organizationId: "organization", projectId: "project", changeSetId: "change",
  environment: "development" as const, status: "approved" as const, expiresAt: approvalExpiresAt,
  actionHash: approvalActionHash({
    changeSetId: change.id, organizationId: change.organizationId, projectId: change.projectId,
    environment: change.environment, databaseInstanceRef: "managed:database-1",
    title: change.title, statementSha256: change.statementSha256,
    createdBy: change.createdBy, risk: change.risk, expiresAt: approvalExpiresAt, requiredScope: "approval:decide",
  }),
  createdAt: "2026-07-17T00:00:00.000Z",
};

function job(overrides: Partial<MigrationJobRecord> = {}): MigrationJobRecord {
  return {
    id: "job", organizationId: "organization", projectId: "project", environment: "development",
    databaseInstanceRef: "managed:database-1",
    changeSetId: "change", approvalRequestId: "approval", claimSequence: "0",
    status: "queued", attemptCount: 0, maxAttempts: 5,
    reconciliationRequired: false, reconciliationAttemptCount: 0, maxReconciliationAttempts: 3,
    reviewCycleCount: 0, maxReviewCycles: 3,
    availableAt: "2026-07-17T00:00:00.000Z", leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    lastErrorCode: null, lastErrorMessage: null, startedAt: null, finishedAt: null,
    createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

function incident(overrides: Partial<MigrationIncidentRecord> = {}): MigrationIncidentRecord {
  return {
    id: "incident", organizationId: "organization", migrationJobId: "job",
    projectId: "project", environment: "development", changeSetId: "change",
    kind: "migration_outcome_unresolved", severity: "critical", status: "open",
    detectedReviewCycle: 3, detectedReconciliationAttempt: 3,
    acknowledgedBy: null, acknowledgementCode: null, acknowledgedAt: null,
    resolvedBy: null, resolutionCode: null, resolvedAt: null,
    createdAt: "2026-07-17T00:03:00.000Z", updatedAt: "2026-07-17T00:03:00.000Z",
    ...overrides,
  };
}

function provider(repositories: Partial<ControlPlaneRepositories>) {
  const defaults = {
    migrationReviewCommands: { processPending: vi.fn().mockResolvedValue([]) },
    migrationIncidentResolutionCommands: { processPending: vi.fn().mockResolvedValue([]) },
    migrationIncidents: { escalateExhausted: vi.fn().mockResolvedValue([]) },
  };
  return {
    async withTenant<T>(_tenant: unknown, operation: (value: ControlPlaneRepositories) => Promise<T>): Promise<T> {
      return operation({ ...defaults, ...repositories } as unknown as ControlPlaneRepositories);
    },
  };
}

describe("migration apply services", () => {
  it("queues an approved memory Change Set idempotently without executing it", async () => {
    const controlPlane = {
      getConsoleSnapshot: vi.fn().mockResolvedValue({
        changeSets: [{ ...change, statement: "[REDACTED]" }], projects: [], approvals: [{
          ...approval, risk: "medium", requestedBy: "owner@example.com", action: "Create index",
        }], audit: [],
      }),
    } as unknown as ControlPlaneService;
    const service = new MemoryChangeSetApplyService(controlPlane);

    const first = await service.queueApprovedChangeSet(context, { changeSetId: "change" });
    const second = await service.queueApprovedChangeSet(context, { changeSetId: "change" });
    expect(first).toMatchObject({ outcome: "queued", changeSetId: "change", jobId: expect.any(String) });
    if (first.outcome !== "queued") throw new Error("Expected a newly queued migration");
    expect(second).toEqual({ outcome: "already_queued", changeSetId: "change", jobId: first.jobId });
  });

  it("atomically enqueues and audits through the PostgreSQL repository boundary", async () => {
    const enqueueApproved = vi.fn().mockResolvedValue({ job: job(), created: true });
    const append = vi.fn().mockResolvedValue({});
    const service = new PostgresChangeSetApplyService(provider({
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      environments: { get: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) },
      approvals: { getForChangeSet: vi.fn().mockResolvedValue(approval) },
      migrationJobs: { enqueueApproved },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.queueApprovedChangeSet(context, { changeSetId: "change" })).resolves.toEqual({
      outcome: "queued", changeSetId: "change", jobId: "job",
    });
    expect(enqueueApproved).toHaveBeenCalledWith("change", "approval");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.apply.queued", metadata: { changeSetId: "change" },
    }));
  });

  it("blocks production before enqueue unless the exact release subject is authorized", async () => {
    const productionChange = {
      ...change,
      id: "9a973ec8-a409-4706-ad1d-ef6360ea430d",
      organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
      projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
      environment: "production" as const,
    };
    const productionApproval = {
      ...approval,
      id: "940cb242-32d6-41fd-b244-67d4913f7b91",
      organizationId: productionChange.organizationId,
      projectId: productionChange.projectId,
      changeSetId: productionChange.id,
      environment: "production" as const,
      actionHash: approvalActionHash({
        changeSetId: productionChange.id,
        organizationId: productionChange.organizationId,
        projectId: productionChange.projectId,
        environment: productionChange.environment,
        databaseInstanceRef: "managed:database-1",
        title: productionChange.title,
        statementSha256: productionChange.statementSha256,
        createdBy: productionChange.createdBy,
        risk: productionChange.risk,
        expiresAt: approvalExpiresAt,
        requiredScope: "approval:decide",
      }),
    };
    const enqueueApproved = vi.fn();
    const repositories = {
      changeSets: { get: vi.fn().mockResolvedValue(productionChange) },
      environments: { get: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) },
      approvals: { getForChangeSet: vi.fn().mockResolvedValue(productionApproval) },
      migrationJobs: { enqueueApproved },
    } as unknown as Partial<ControlPlaneRepositories>;

    await expect(new PostgresChangeSetApplyService(provider(repositories))
      .queueApprovedChangeSet(
        { ...context, organizationId: productionChange.organizationId },
        { changeSetId: productionChange.id },
      )).rejects.toBeInstanceOf(ProductionApplyBlockedError);
    expect(enqueueApproved).not.toHaveBeenCalled();

    const authorizer: ProductionApplyAuthorizer = {
      assertAuthorized: vi.fn().mockResolvedValue(undefined),
    };
    enqueueApproved.mockResolvedValue({
      job: job({
        id: "job-production",
        organizationId: productionChange.organizationId,
        projectId: productionChange.projectId,
        environment: "production",
        changeSetId: productionChange.id,
        approvalRequestId: productionApproval.id,
      }),
      created: false,
    });
    const allowed = new PostgresChangeSetApplyService(provider(repositories), authorizer);
    await expect(allowed.queueApprovedChangeSet(
      { ...context, organizationId: productionChange.organizationId },
      { changeSetId: productionChange.id },
    )).resolves.toMatchObject({ outcome: "already_queued", jobId: "job-production" });
    expect(authorizer.assertAuthorized).toHaveBeenCalledWith({
      organizationId: productionChange.organizationId,
      projectId: productionChange.projectId,
      environment: "production",
      changeSetId: productionChange.id,
      approvalId: productionApproval.id,
      databaseInstanceRef: "managed:database-1",
      statementSha256: productionChange.statementSha256,
      approvalActionHash: productionApproval.actionHash,
    });
  });

  it("refuses to queue an unprovisioned project environment", async () => {
    const service = new PostgresChangeSetApplyService(provider({
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      environments: { get: vi.fn().mockResolvedValue({ databaseInstanceRef: "pending:project" }) },
      approvals: { getForChangeSet: vi.fn().mockResolvedValue(approval) },
    } as unknown as Partial<ControlPlaneRepositories>));
    await expect(service.queueApprovedChangeSet(context, { changeSetId: "change" }))
      .rejects.toBeInstanceOf(MigrationNotReadyError);
  });

  it("refuses an approval whose immutable action hash no longer matches", async () => {
    const service = new PostgresChangeSetApplyService(provider({
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      environments: { get: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) },
      approvals: { getForChangeSet: vi.fn().mockResolvedValue({ ...approval, actionHash: "d".repeat(64) }) },
    } as unknown as Partial<ControlPlaneRepositories>));
    await expect(service.queueApprovedChangeSet(context, { changeSetId: "change" }))
      .rejects.toBeInstanceOf(MigrationNotReadyError);
  });

  it("hydrates a fenced tenant claim with the immutable artifacts and opaque database reference", async () => {
    const running = job({
      status: "running", attemptCount: 1, leaseOwner: "worker", leaseToken: "lease",
      leaseExpiresAt: "2099-07-18T00:00:00.000Z",
    });
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: {
        quarantineExpiredReconciliations: vi.fn().mockResolvedValue([]),
        claimNext: vi.fn().mockResolvedValue(running),
      },
      migrationReviewCommands: { processPending: vi.fn().mockResolvedValue([]) },
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      environments: { get: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) },
      approvals: { get: vi.fn().mockResolvedValue(approval) },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.claimNext({ workerId: "worker", leaseDurationMs: 60_000 })).resolves.toMatchObject({
      jobId: "job", organizationId: "organization", databaseInstanceRef: "managed:database-1",
      attempt: 1, maxAttempts: 5,
      lease: { workerId: "worker", token: "lease" },
      changeSet: { id: "change" }, approval: { id: "approval" },
    });
  });

  it("audits crash-exhausted reconciliation leases before claiming more work", async () => {
    const append = vi.fn().mockResolvedValue({});
    const reviewed = job({
      status: "review_required", attemptCount: 1,
      reconciliationRequired: true, reconciliationAttemptCount: 3, maxReconciliationAttempts: 3,
      lastErrorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
      finishedAt: "2026-07-17T00:01:00.000Z",
    });
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: {
        quarantineExpiredReconciliations: vi.fn().mockResolvedValue([reviewed]),
        claimNext: vi.fn().mockResolvedValue(null),
      },
      migrationReviewCommands: { processPending: vi.fn().mockResolvedValue([]) },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.claimNext({ workerId: "worker", leaseDurationMs: 60_000 })).resolves.toBeNull();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.apply.review_required",
      resourceRef: "job",
      metadata: expect.objectContaining({ errorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED" }),
    }));
  });

  it("lets the worker consume operator commands before claiming reconciliation work", async () => {
    const append = vi.fn().mockResolvedValue({});
    const queued = job({
      status: "queued", attemptCount: 1, reconciliationRequired: true,
      reconciliationAttemptCount: 0, reviewCycleCount: 1,
      lastErrorCode: "OPERATOR_RECONCILIATION_REQUESTED",
    });
    const command = {
      id: "command", organizationId: "organization", migrationJobId: "job",
      requestedBy: "owner@example.com", reasonCode: "manual_recheck" as const, status: "applied" as const,
      processedAt: "2026-07-17T00:02:00.000Z", createdAt: "2026-07-17T00:01:00.000Z",
      updatedAt: "2026-07-17T00:02:00.000Z",
    };
    const queue = new PostgresMigrationQueue(provider({
      migrationReviewCommands: { processPending: vi.fn().mockResolvedValue([{ command, job: queued }]) },
      migrationJobs: {
        quarantineExpiredReconciliations: vi.fn().mockResolvedValue([]),
        claimNext: vi.fn().mockResolvedValue(null),
      },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.claimNext({ workerId: "worker", leaseDurationMs: 60_000 })).resolves.toBeNull();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.review.reconciliation_scheduled",
      resourceRef: "command",
      metadata: expect.objectContaining({ reasonCode: "manual_recheck", reviewCycle: 1 }),
    }));
  });

  it("lets the worker schedule a bounded incident resolution verification without SQL execution", async () => {
    const append = vi.fn().mockResolvedValue({});
    const queued = job({
      status: "queued", attemptCount: 1, reconciliationRequired: true,
      reconciliationAttemptCount: 0, reviewCycleCount: 3,
      lastErrorCode: "INCIDENT_RESOLUTION_VERIFICATION_REQUESTED",
    });
    const command = {
      id: "resolution-command", organizationId: "organization", migrationIncidentId: "incident",
      requestedBy: "owner@example.com", reasonCode: "target_ledger_recheck" as const,
      status: "applied" as const, processedAt: "2026-07-17T00:02:00.000Z",
      createdAt: "2026-07-17T00:01:00.000Z", updatedAt: "2026-07-17T00:02:00.000Z",
    };
    const queue = new PostgresMigrationQueue(provider({
      migrationIncidentResolutionCommands: {
        processPending: vi.fn().mockResolvedValue([{ command, job: queued }]),
      },
      migrationIncidents: {
        get: vi.fn().mockResolvedValue(incident()),
        escalateExhausted: vi.fn().mockResolvedValue([]),
      },
      migrationJobs: {
        quarantineExpiredReconciliations: vi.fn().mockResolvedValue([]),
        claimNext: vi.fn().mockResolvedValue(null),
      },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.claimNext({ workerId: "worker", leaseDurationMs: 60_000 })).resolves.toBeNull();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.resolution_verification_scheduled",
      resourceRef: "resolution-command",
      metadata: expect.objectContaining({
        migrationIncidentId: "incident", migrationJobId: "job", reasonCode: "target_ledger_recheck",
      }),
    }));
    expect(JSON.stringify(append.mock.calls)).not.toMatch(/sql|databaseInstanceRef|credential[^s]/i);
  });

  it("opens and audits one immutable incident after bounded review recovery is exhausted", async () => {
    const append = vi.fn().mockResolvedValue({});
    const opened = incident();
    const escalateExhausted = vi.fn().mockResolvedValue([opened]);
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: {
        quarantineExpiredReconciliations: vi.fn().mockResolvedValue([]),
        claimNext: vi.fn().mockResolvedValue(null),
      },
      migrationIncidents: { escalateExhausted },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.claimNext({ workerId: "worker", leaseDurationMs: 60_000 })).resolves.toBeNull();
    expect(escalateExhausted).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.opened",
      resourceRef: "incident",
      status: "blocked",
      metadata: expect.objectContaining({
        migrationJobId: "job", severity: "critical", detectedReviewCycle: 3,
      }),
    }));
  });

  it("renews a worker lease through the tenant-scoped repository and maps stale fencing", async () => {
    const renewLease = vi.fn()
      .mockResolvedValueOnce(job({ status: "running", leaseOwner: "worker", leaseToken: "lease", leaseExpiresAt: "2099-07-18T00:01:00.000Z" }))
      .mockRejectedValueOnce(new MigrationLeaseLostError());
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: { renewLease },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");
    const input = { jobId: "job", workerId: "worker", leaseToken: "lease", leaseDurationMs: 45_000 };

    await expect(queue.renewLease(input)).resolves.toEqual({
      status: "updated", expiresAt: "2099-07-18T00:01:00.000Z",
    });
    await expect(queue.renewLease(input)).resolves.toEqual({ status: "lease_lost" });
    expect(renewLease).toHaveBeenCalledWith("job", "worker", "lease", 45_000);
  });

  it("resolves an incident atomically only after an already-applied ledger result", async () => {
    const running = job({
      status: "running", attemptCount: 1, reconciliationRequired: true,
      reconciliationAttemptCount: 1, leaseOwner: "worker", leaseToken: "lease",
      leaseExpiresAt: "2099-07-18T00:01:00.000Z",
    });
    const applied = job({
      status: "applied", attemptCount: 1, reconciliationRequired: false,
      finishedAt: "2026-07-17T00:03:00.000Z",
    });
    const resolved = incident({
      status: "resolved", resolvedBy: "worker",
      resolutionCode: "target_ledger_match", resolvedAt: "2026-07-17T00:03:00.000Z",
    });
    const resolveAppliedJob = vi.fn().mockResolvedValue(resolved);
    const append = vi.fn().mockResolvedValue({});
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(running), markApplied: vi.fn().mockResolvedValue(applied) },
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      migrationIncidents: { resolveAppliedJob },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.markApplied({
      jobId: "job", workerId: "worker", leaseToken: "lease",
      statementSha256: change.statementSha256, executorResult: "already_applied",
      completedAt: "2026-07-17T00:03:00.000Z",
    })).resolves.toEqual({ status: "updated" });
    expect(resolveAppliedJob).toHaveBeenCalledWith("job");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.resolved",
      resourceRef: "incident",
      metadata: {
        migrationJobId: "job", changeSetId: "change", resolutionCode: "target_ledger_match",
      },
    }));
  });

  it("does not run incident resolution for a newly executed migration", async () => {
    const running = job({
      status: "running", attemptCount: 1, reconciliationRequired: false,
      leaseOwner: "worker", leaseToken: "lease", leaseExpiresAt: "2099-07-18T00:01:00.000Z",
    });
    const applied = job({ status: "applied", attemptCount: 1, finishedAt: "2026-07-17T00:03:00.000Z" });
    const resolveAppliedJob = vi.fn();
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(running), markApplied: vi.fn().mockResolvedValue(applied) },
      changeSets: { get: vi.fn().mockResolvedValue(change) },
      migrationIncidents: { resolveAppliedJob },
      audit: { append: vi.fn().mockResolvedValue({}) },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.markApplied({
      jobId: "job", workerId: "worker", leaseToken: "lease",
      statementSha256: change.statementSha256, executorResult: "applied",
      completedAt: "2026-07-17T00:03:00.000Z",
    })).resolves.toEqual({ status: "updated" });
    expect(resolveAppliedJob).not.toHaveBeenCalled();
  });

  it("maps permanent worker failures to a terminal fenced repository mutation", async () => {
    const markFailed = vi.fn().mockResolvedValue(job({ status: "failed", finishedAt: "2026-07-17T00:01:00.000Z" }));
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(job({ status: "running" })), markFailed },
      audit: { append: vi.fn().mockResolvedValue({}) },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.markFailed({
      jobId: "job", workerId: "worker", leaseToken: "lease", disposition: "failed",
      errorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN", redactedMessage: "Migration execution failed.",
      completedAt: "2026-07-17T00:01:00.000Z",
    })).resolves.toEqual({ status: "updated" });
    expect(markFailed).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, backoffMs: 0 }));
  });

  it("exposes reconciliation and review state without leaking stored diagnostics", async () => {
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: {
        getForChangeSet: vi.fn().mockResolvedValue(job({
          status: "review_required",
          reconciliationRequired: true,
          reconciliationAttemptCount: 3,
          maxReconciliationAttempts: 3,
          lastErrorCode: "MIGRATION_NOT_APPLIED",
          lastErrorMessage: "internal target detail",
          finishedAt: "2026-07-17T00:01:00.000Z",
        })),
      },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.getStatus({ organizationId: "organization", projectId: "project", changeSetId: "change" }))
      .resolves.toEqual({
        jobId: "job", organizationId: "organization", projectId: "project", environment: "development",
        changeSetId: "change", state: "review_required", attempt: 0, maxAttempts: 5,
        reconciliationRequired: true, reconciliationAttempt: 3, maxReconciliationAttempts: 3,
        errorCode: "MIGRATION_NOT_APPLIED",
      });
  });

  it("persists and audits a fenced reconciliation deferral independently from normal retries", async () => {
    const deferForReconciliation = vi.fn().mockResolvedValue(job({
      status: "queued",
      attemptCount: 1,
      reconciliationRequired: true,
      reconciliationAttemptCount: 0,
      lastErrorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN",
    }));
    const append = vi.fn().mockResolvedValue({});
    const queue = new PostgresMigrationQueue(provider({
      migrationJobs: {
        get: vi.fn().mockResolvedValue(job({ status: "running", attemptCount: 1 })),
        deferForReconciliation,
      },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>), "organization");

    await expect(queue.deferForReconciliation({
      jobId: "job", workerId: "worker", leaseToken: "lease",
      errorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN",
      redactedMessage: "Migration outcome requires target-ledger reconciliation.",
      completedAt: "2026-07-17T00:01:00.000Z",
      retryAt: "2026-07-17T00:01:02.000Z",
    })).resolves.toEqual({ status: "updated", state: "reconciliation_scheduled" });

    expect(deferForReconciliation).toHaveBeenCalledWith(expect.objectContaining({ backoffMs: 2_000 }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.apply.reconciliation_scheduled",
      metadata: expect.objectContaining({ errorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN" }),
    }));
  });
});

describe("migration review services", () => {
  it("selects memory or PostgreSQL review adapters with the shared runtime mode", () => {
    expect(createMigrationReviewService({})).toBeInstanceOf(MemoryMigrationReviewService);
    expect(createMigrationReviewService(
      { QKERN_RUNTIME_MODE: "postgres" },
      { pool: {} as never },
    )).toBeInstanceOf(PostgresMigrationReviewService);
  });

  it("lists only redacted review DTO fields", async () => {
    const reviewed = job({
      status: "review_required",
      reconciliationRequired: true,
      reconciliationAttemptCount: 3,
      reviewCycleCount: 1,
      lastErrorCode: "MIGRATION_NOT_APPLIED",
      lastErrorMessage: "postgres://admin:secret@target/db",
      finishedAt: "2026-07-17T00:01:00.000Z",
    });
    const list = vi.fn().mockResolvedValue([reviewed]);
    const service = new PostgresMigrationReviewService(provider({
      migrationJobs: { list },
    } as unknown as Partial<ControlPlaneRepositories>));

    const result = await service.listReviews(context, { projectId: "project", limit: 25 });
    expect(result).toEqual([{
      jobId: "job", projectId: "project", environment: "development", changeSetId: "change",
      state: "review_required", reconciliationAttempt: 3, maxReconciliationAttempts: 3,
      reviewCycle: 1, maxReviewCycles: 3, errorCode: "MIGRATION_NOT_APPLIED",
      finishedAt: "2026-07-17T00:01:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    }]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("databaseInstanceRef");
    expect(list).toHaveBeenCalledWith({ projectId: "project", status: "review_required", limit: 25 });
  });

  it("enqueues and audits an operator command without mutating the job", async () => {
    const reviewed = job({
      status: "review_required", reconciliationRequired: true, reconciliationAttemptCount: 3,
      finishedAt: "2026-07-17T00:01:00.000Z",
    });
    const enqueue = vi.fn().mockResolvedValue({
      created: true,
      command: {
        id: "command", organizationId: "organization", migrationJobId: "job",
        requestedBy: "owner@example.com", reasonCode: "dependency_recovered", status: "pending",
        processedAt: null, createdAt: "2026-07-17T00:02:00.000Z", updatedAt: "2026-07-17T00:02:00.000Z",
      },
    });
    const append = vi.fn().mockResolvedValue({});
    const service = new PostgresMigrationReviewService(provider({
      migrationJobs: { get: vi.fn().mockResolvedValue(reviewed) },
      migrationReviewCommands: { enqueue },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.requestReconciliation(context, {
      jobId: "job", reasonCode: "dependency_recovered",
    })).resolves.toEqual({ outcome: "requested", jobId: "job", commandId: "command" });
    expect(enqueue).toHaveBeenCalledWith("job", "owner@example.com", "dependency_recovered");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.review.reconciliation_requested",
      metadata: expect.objectContaining({ migrationJobId: "job", nextReviewCycle: 1 }),
    }));
  });

  it("returns idempotent scheduled/applied states and blocks invalid or exhausted review jobs", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(job({ status: "queued", reconciliationRequired: true }))
      .mockResolvedValueOnce(job({ status: "applied", finishedAt: "2026-07-17T00:01:00.000Z" }))
      .mockResolvedValueOnce(job({ status: "failed", finishedAt: "2026-07-17T00:01:00.000Z" }))
      .mockResolvedValueOnce(job({
        status: "review_required", reconciliationRequired: true,
        reviewCycleCount: 3, maxReviewCycles: 3, finishedAt: "2026-07-17T00:01:00.000Z",
      }));
    const service = new PostgresMigrationReviewService(provider({
      migrationJobs: { get },
    } as unknown as Partial<ControlPlaneRepositories>));
    const input = { jobId: "job", reasonCode: "manual_recheck" as const };

    await expect(service.requestReconciliation(context, input)).resolves.toEqual({ outcome: "already_scheduled", jobId: "job" });
    await expect(service.requestReconciliation(context, input)).resolves.toEqual({ outcome: "already_applied", jobId: "job" });
    await expect(service.requestReconciliation(context, input)).rejects.toBeInstanceOf(MigrationReviewNotReadyError);
    await expect(service.requestReconciliation(context, input)).rejects.toBeInstanceOf(MigrationReviewCyclesExhaustedError);
  });
});

describe("migration incident services", () => {
  it("selects memory or PostgreSQL incident adapters with the shared runtime mode", () => {
    expect(createMigrationIncidentService({})).toBeInstanceOf(MemoryMigrationIncidentService);
    expect(createMigrationIncidentService(
      { QKERN_RUNTIME_MODE: "postgres" },
      { pool: {} as never },
    )).toBeInstanceOf(PostgresMigrationIncidentService);
  });

  it("lists only reference metadata and acknowledgement state", async () => {
    const acknowledged = incident({
      status: "acknowledged",
      acknowledgedBy: "owner@example.com",
      acknowledgementCode: "investigation_started",
      acknowledgedAt: "2026-07-17T00:04:00.000Z",
    });
    const list = vi.fn().mockResolvedValue([acknowledged]);
    const listStatuses = vi.fn().mockResolvedValue([{
      migrationIncidentId: "incident", eventId: "event", status: "published" as const,
      attemptCount: 1, failureCount: 0, maxFailures: 8, lastFailureCode: null,
      deadLetteredAt: null, retryCycleCount: 0, maxRetryCycles: 3,
      availableAt: "2026-07-17T00:03:00.000Z", publishedAt: "2026-07-17T00:03:30.000Z",
      retryCommandPending: false,
    }]);
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { list },
      migrationIncidentDeliveryVisibility: { listStatuses },
    } as unknown as Partial<ControlPlaneRepositories>));

    const result = await service.listIncidents(context, { projectId: "project", status: "acknowledged", limit: 25 });
    expect(result).toEqual([{
      incidentId: "incident", jobId: "job", projectId: "project", environment: "development",
      changeSetId: "change", kind: "migration_outcome_unresolved", severity: "critical",
      status: "acknowledged", detectedReviewCycle: 3, detectedReconciliationAttempt: 3,
      delivery: {
        eventId: "event", status: "published", attemptCount: 1, failureCount: 0, maxFailures: 8,
        retryCycleCount: 0, maxRetryCycles: 3, availableAt: "2026-07-17T00:03:00.000Z",
        publishedAt: "2026-07-17T00:03:30.000Z", retryCommandPending: false,
      },
      acknowledgementCode: "investigation_started", acknowledgedBy: "owner@example.com",
      acknowledgedAt: "2026-07-17T00:04:00.000Z",
      createdAt: "2026-07-17T00:03:00.000Z", updatedAt: "2026-07-17T00:03:00.000Z",
    }]);
    expect(JSON.stringify(result)).not.toContain("databaseInstanceRef");
    expect(JSON.stringify(result)).not.toContain("statement");
    expect(list).toHaveBeenCalledWith({ projectId: "project", status: "acknowledged", limit: 25 });
    expect(listStatuses).toHaveBeenCalledWith(["incident"]);
  });

  it("exposes only fixed worker resolution evidence for resolved incidents", async () => {
    const resolved = incident({
      status: "resolved",
      acknowledgedBy: "owner@example.com",
      acknowledgementCode: "investigation_started",
      acknowledgedAt: "2026-07-17T00:04:00.000Z",
      resolvedBy: "worker-1",
      resolutionCode: "target_ledger_match",
      resolvedAt: "2026-07-17T00:08:00.000Z",
    });
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { list: vi.fn().mockResolvedValue([resolved]) },
      migrationIncidentDeliveryVisibility: { listStatuses: vi.fn().mockResolvedValue([{
        migrationIncidentId: "incident", eventId: "event", status: "published",
        attemptCount: 1, failureCount: 0, maxFailures: 8, lastFailureCode: null,
        deadLetteredAt: null, retryCycleCount: 0, maxRetryCycles: 3,
        availableAt: "2026-07-17T00:03:00.000Z", publishedAt: "2026-07-17T00:03:30.000Z",
        retryCommandPending: false,
      }]) },
    } as unknown as Partial<ControlPlaneRepositories>));

    const result = await service.listIncidents(context, { status: "resolved" });
    expect(result[0]).toMatchObject({
      status: "resolved", resolutionCode: "target_ledger_match",
      resolvedBy: "worker-1", resolvedAt: "2026-07-17T00:08:00.000Z",
    });
    expect(JSON.stringify(result)).not.toMatch(/databaseInstanceRef|statement|diagnostic|credential/i);
  });

  it("derives redacted delivery health and fails closed on inconsistent counts", async () => {
    const health = vi.fn().mockResolvedValue({
      measuredAt: "2026-07-17T00:06:00.000Z",
      totalCount: 3, pendingCount: 1, readyCount: 1, scheduledCount: 0, inFlightCount: 0,
      overduePendingCount: 1, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 1, deadLetteredCount: 1, pendingRetryCommandCount: 1,
      recoveryExhaustedCount: 0,
      activeFailureCount: 1, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 1, activeDeliveryTimeoutCount: 0,
      activeDestinationRejectedCount: 0,
      oldestPendingAt: "2026-07-17T00:03:00.000Z",
      oldestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
      latestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
    });
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidentDeliveryVisibility: { health },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.getDeliveryHealth(context)).resolves.toEqual({
      status: "critical",
      measuredAt: "2026-07-17T00:06:00.000Z",
      totalCount: 3, pendingCount: 1, readyCount: 1, scheduledCount: 0, inFlightCount: 0,
      overduePendingCount: 1, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 1, deadLetteredCount: 1, pendingRetryCommandCount: 1,
      recoveryExhaustedCount: 0,
      activeFailureCount: 1, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 1, activeDeliveryTimeoutCount: 0,
      activeDestinationRejectedCount: 0,
      oldestPendingAt: "2026-07-17T00:03:00.000Z",
      oldestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
      latestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
      policy: {
        overdueAfterSeconds: 300,
        deadLettersAreCritical: true,
        signingKeyFailuresAreCritical: true,
        activeDeliveryFailuresAreDegraded: true,
      },
    });

    health.mockResolvedValueOnce({
      measuredAt: "2026-07-17T00:06:00.000Z",
      totalCount: 1, pendingCount: 1, readyCount: 1, scheduledCount: 1, inFlightCount: 0,
      overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 0, deadLetteredCount: 0, pendingRetryCommandCount: 0,
      recoveryExhaustedCount: 0,
      activeFailureCount: 0, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 0, activeDeliveryTimeoutCount: 0,
      activeDestinationRejectedCount: 0,
      oldestPendingAt: null, oldestDeadLetteredAt: null, latestDeadLetteredAt: null,
    });
    await expect(service.getDeliveryHealth(context)).rejects.toThrow("inconsistent");
  });

  it("grades active delivery failures and signing-key outages without raw diagnostics", async () => {
    const baseHealth = {
      measuredAt: "2026-07-17T00:06:00.000Z",
      totalCount: 1, pendingCount: 1, readyCount: 1, scheduledCount: 0, inFlightCount: 0,
      overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 0, deadLetteredCount: 0, pendingRetryCommandCount: 0,
      recoveryExhaustedCount: 0,
      activeFailureCount: 1, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 0, activeDeliveryTimeoutCount: 1,
      activeDestinationRejectedCount: 0,
      oldestPendingAt: "2026-07-17T00:03:00.000Z",
      oldestDeadLetteredAt: null, latestDeadLetteredAt: null,
    };
    const health = vi.fn()
      .mockResolvedValueOnce(baseHealth)
      .mockResolvedValueOnce({
        ...baseHealth,
        activeDeliveryTimeoutCount: 0,
        activeSigningKeyUnavailableCount: 1,
      });
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidentDeliveryVisibility: { health },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.getDeliveryHealth(context)).resolves.toMatchObject({
      status: "degraded",
      activeDeliveryTimeoutCount: 1,
    });
    await expect(service.getDeliveryHealth(context)).resolves.toMatchObject({
      status: "critical",
      activeSigningKeyUnavailableCount: 1,
    });
    expect(JSON.stringify(await health.mock.results[0]?.value)).not.toMatch(/secret|response|endpoint/i);
  });

  it("acknowledges and audits once without mutating a migration job", async () => {
    const acknowledged = incident({
      status: "acknowledged",
      acknowledgedBy: "owner@example.com",
      acknowledgementCode: "runbook_in_progress",
      acknowledgedAt: "2026-07-17T00:04:00.000Z",
    });
    const acknowledge = vi.fn().mockResolvedValue({ incident: acknowledged, created: true });
    const append = vi.fn().mockResolvedValue({});
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { acknowledge },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.acknowledgeIncident(context, {
      incidentId: "incident", acknowledgementCode: "runbook_in_progress",
    })).resolves.toEqual({ outcome: "acknowledged", incidentId: "incident" });
    expect(acknowledge).toHaveBeenCalledWith("incident", "owner@example.com", "runbook_in_progress");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.acknowledged",
      metadata: expect.objectContaining({ acknowledgementCode: "runbook_in_progress" }),
    }));
  });

  it("returns an idempotent acknowledgement without duplicating the audit", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      incident: incident({ status: "acknowledged", acknowledgedBy: "owner@example.com", acknowledgementCode: "investigation_started", acknowledgedAt: "2026-07-17T00:04:00.000Z" }),
      created: false,
    });
    const append = vi.fn();
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { acknowledge }, audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.acknowledgeIncident(context, {
      incidentId: "incident", acknowledgementCode: "investigation_started",
    })).resolves.toEqual({ outcome: "already_acknowledged", incidentId: "incident" });
    expect(append).not.toHaveBeenCalled();
  });

  it("requests and audits one reference-only dead-letter delivery retry", async () => {
    const command = {
      id: "command", organizationId: "organization", migrationIncidentId: "incident",
      requestedBy: "owner@example.com", reasonCode: "credentials_rotated" as const,
      expectedFailureCode: "SIGNING_KEY_UNAVAILABLE" as const,
      expectedRetryCycle: 1,
      status: "pending" as const, processedAt: null,
      createdAt: "2026-07-17T00:05:00.000Z", updatedAt: "2026-07-17T00:05:00.000Z",
    };
    const enqueue = vi.fn().mockResolvedValue({ command, created: true });
    const append = vi.fn().mockResolvedValue({});
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { get: vi.fn().mockResolvedValue(incident()) },
      migrationIncidentDeliveryCommands: { enqueue },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.requestDeliveryRetry(context, {
      incidentId: "incident", reasonCode: "credentials_rotated",
      expectedFailureCode: "SIGNING_KEY_UNAVAILABLE",
      expectedRetryCycle: 1,
    })).resolves.toEqual({
      outcome: "requested",
      incidentId: "incident",
      commandId: "command",
      expectedFailureCode: "SIGNING_KEY_UNAVAILABLE",
      expectedRetryCycle: 1,
    });
    expect(enqueue).toHaveBeenCalledWith(
      "incident", "owner@example.com", "credentials_rotated", "SIGNING_KEY_UNAVAILABLE", 1,
    );
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.delivery_retry_requested",
      resourceRef: "command",
      status: "pending",
      metadata: {
        migrationIncidentId: "incident", migrationJobId: "job", changeSetId: "change",
        reasonCode: "credentials_rotated",
        expectedFailureCode: "SIGNING_KEY_UNAVAILABLE",
        expectedRetryCycle: 1,
      },
    }));
    expect(JSON.stringify(append.mock.calls)).not.toMatch(/sql|databaseInstanceRef|credential[^s]/i);
  });

  it("maps a non-dead-lettered or exhausted delivery to a fixed retry error", async () => {
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { get: vi.fn().mockResolvedValue(incident()) },
      migrationIncidentDeliveryCommands: { enqueue: vi.fn().mockRejectedValue(new MigrationNotReadyError()) },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.requestDeliveryRetry(context, {
      incidentId: "incident", reasonCode: "destination_recovered",
      expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1,
    })).rejects.toBeInstanceOf(MigrationIncidentDeliveryNotRetryableError);
  });

  it("requests and audits one reference-only target-ledger resolution verification", async () => {
    const command = {
      id: "resolution-command", organizationId: "organization", migrationIncidentId: "incident",
      requestedBy: "owner@example.com", reasonCode: "target_ledger_recheck" as const,
      status: "pending" as const, processedAt: null,
      createdAt: "2026-07-17T00:06:00.000Z", updatedAt: "2026-07-17T00:06:00.000Z",
    };
    const enqueue = vi.fn().mockResolvedValue({ command, created: true });
    const append = vi.fn().mockResolvedValue({});
    const service = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { get: vi.fn().mockResolvedValue(incident()) },
      migrationIncidentResolutionCommands: { enqueue },
      audit: { append },
    } as unknown as Partial<ControlPlaneRepositories>));

    await expect(service.requestResolutionVerification(context, {
      incidentId: "incident", reasonCode: "target_ledger_recheck",
    })).resolves.toEqual({
      outcome: "requested", incidentId: "incident", commandId: "resolution-command",
    });
    expect(enqueue).toHaveBeenCalledWith("incident", "owner@example.com", "target_ledger_recheck");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: "migration.incident.resolution_verification_requested",
      resourceRef: "resolution-command",
      metadata: {
        migrationIncidentId: "incident", migrationJobId: "job", changeSetId: "change",
        reasonCode: "target_ledger_recheck",
      },
    }));
    expect(JSON.stringify(append.mock.calls)).not.toMatch(/sql|databaseInstanceRef|credential[^s]/i);
  });

  it("rejects resolution verification after resolution or when the bounded command is unavailable", async () => {
    const resolved = incident({
      status: "resolved", resolvedBy: "worker-1",
      resolutionCode: "target_ledger_match", resolvedAt: "2026-07-17T00:07:00.000Z",
    });
    const resolvedService = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { get: vi.fn().mockResolvedValue(resolved) },
    } as unknown as Partial<ControlPlaneRepositories>));
    await expect(resolvedService.requestResolutionVerification(context, {
      incidentId: "incident", reasonCode: "target_ledger_recheck",
    })).rejects.toBeInstanceOf(MigrationIncidentResolutionNotVerifiableError);

    const exhaustedService = new PostgresMigrationIncidentService(provider({
      migrationIncidents: { get: vi.fn().mockResolvedValue(incident()) },
      migrationIncidentResolutionCommands: { enqueue: vi.fn().mockRejectedValue(new MigrationNotReadyError()) },
    } as unknown as Partial<ControlPlaneRepositories>));
    await expect(exhaustedService.requestResolutionVerification(context, {
      incidentId: "incident", reasonCode: "target_ledger_recheck",
    })).rejects.toBeInstanceOf(MigrationIncidentResolutionNotVerifiableError);
  });
});
