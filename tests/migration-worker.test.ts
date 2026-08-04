import { describe, expect, it, vi } from "vitest";
import { approvalActionHash, sha256, type StatementBinding, type StatementCipher } from "@/lib/server/control-plane/crypto";
import type {
  CompleteMigrationInput,
  DeferMigrationForReconciliationInput,
  FailMigrationInput,
  LeaseRenewalResult,
  MigrationQueuePort,
  RenewMigrationLeaseInput,
} from "@/lib/server/migrations/queue-port";
import {
  DisabledProjectDatabaseExecutor,
  InMemoryProjectDatabaseExecutor,
  ProjectDatabaseExecutionError,
  type ProjectDatabaseExecutionInput,
  type ProjectDatabaseExecutionResult,
  type ProjectDatabaseExecutor,
} from "@/lib/server/migrations/executor";
import type {
  ClaimedMigrationJob,
  EnqueueMigrationInput,
  EnqueueMigrationResult,
  LeaseMutationResult,
  MigrationJobStatus,
  ReconciliationDeferralResult,
} from "@/lib/server/migrations/model";
import { MigrationWorker, type MigrationWorkerLogEvent } from "@/lib/server/migrations/worker";
import {
  denyProductionApplyAuthorizer,
  type ProductionApplyAuthorizer,
} from "@/lib/server/migrations/production-apply-authorization";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const STATEMENT = "CREATE INDEX products_name_idx ON products(name)";
const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const CHANGE_SET_ID = "9a973ec8-a409-4706-ad1d-ef6360ea430d";
const APPROVAL_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const allowProductionApplyAuthorizer: ProductionApplyAuthorizer = {
  async assertAuthorized() {
    return undefined;
  },
};

class PlaintextTestCipher implements StatementCipher {
  constructor(private readonly events?: string[]) {}
  encrypt(statement: string, _binding: StatementBinding): Uint8Array {
    return Buffer.from(statement, "utf8");
  }
  decrypt(payload: Uint8Array, _binding: StatementBinding): string {
    this.events?.push("decrypt");
    return Buffer.from(payload).toString("utf8");
  }
}

class FakeQueue implements MigrationQueuePort {
  readonly applied: CompleteMigrationInput[] = [];
  readonly failed: FailMigrationInput[] = [];
  readonly deferred: DeferMigrationForReconciliationInput[] = [];
  readonly events: string[] = [];
  appliedResult: LeaseMutationResult = { status: "updated" };
  failedResult: LeaseMutationResult = { status: "updated" };
  deferredResult: ReconciliationDeferralResult = { status: "updated", state: "reconciliation_scheduled" };
  throwOnComplete = false;
  throwOnFail = false;
  throwOnDefer = false;
  renewResult: LeaseRenewalResult = { status: "updated", expiresAt: "2026-07-18T12:01:00.000Z" };
  throwOnRenew = false;
  readonly renewed: RenewMigrationLeaseInput[] = [];

  constructor(public claim: ClaimedMigrationJob | null) {}

  async enqueue(_input: EnqueueMigrationInput): Promise<EnqueueMigrationResult> {
    return { status: "not_found" };
  }
  async getStatus(_input: {
    organizationId: string;
    projectId: string;
    changeSetId: string;
  }): Promise<MigrationJobStatus | null> {
    return null;
  }
  async claimNext(input: { workerId: string; leaseDurationMs: number }): Promise<ClaimedMigrationJob | null> {
    this.events.push("claim");
    expect(input).toEqual({ workerId: "worker-1", leaseDurationMs: 60_000 });
    return this.claim;
  }
  async markApplied(input: CompleteMigrationInput): Promise<LeaseMutationResult> {
    this.events.push("complete");
    if (this.throwOnComplete) throw new Error("queue unavailable");
    this.applied.push(input);
    return this.appliedResult;
  }
  async renewLease(input: RenewMigrationLeaseInput): Promise<LeaseRenewalResult> {
    this.events.push("renew");
    this.renewed.push(input);
    if (this.throwOnRenew) throw new Error("database password=secret");
    return this.renewResult;
  }
  async markFailed(input: FailMigrationInput): Promise<LeaseMutationResult> {
    this.events.push("fail");
    if (this.throwOnFail) throw new Error("queue unavailable");
    this.failed.push(input);
    return this.failedResult;
  }
  async deferForReconciliation(
    input: DeferMigrationForReconciliationInput,
  ): Promise<ReconciliationDeferralResult> {
    this.events.push("defer");
    if (this.throwOnDefer) throw new Error("queue unavailable");
    this.deferred.push(input);
    return this.deferredResult;
  }
}

function job(statement = STATEMENT): ClaimedMigrationJob {
  const statementSha256 = sha256(statement);
  const expiresAt = "2026-07-18T12:00:00.000Z";
  const changeSet: ClaimedMigrationJob["changeSet"] = {
    id: CHANGE_SET_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    environment: "production",
    title: "Create product index",
    statementSha256,
    encryptedStatement: Buffer.from(statement, "utf8"),
    risk: "high",
    status: "approved",
    createdBy: "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca",
    agentSessionId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const actionHash = approvalActionHash({
    changeSetId: changeSet.id,
    organizationId: changeSet.organizationId,
    projectId: changeSet.projectId,
    environment: changeSet.environment,
    databaseInstanceRef: "managed:database-1",
    title: changeSet.title,
    statementSha256: changeSet.statementSha256,
    createdBy: changeSet.createdBy,
    risk: changeSet.risk,
    expiresAt,
    requiredScope: "approval:decide",
  });
  return {
    jobId: "job-1",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    environment: "production",
    databaseInstanceRef: "managed:database-1",
    reclaimed: false,
    changeSet,
    approval: {
      id: APPROVAL_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      changeSetId: CHANGE_SET_ID,
      environment: "production",
      actionHash,
      status: "approved",
      expiresAt,
      createdAt: NOW.toISOString(),
    },
    attempt: 1,
    maxAttempts: 3,
    reconciliationRequired: false,
    reconciliationAttempt: 0,
    maxReconciliationAttempts: 3,
    fenceEpoch: "1",
    lease: {
      workerId: "worker-1",
      token: "lease-1",
      expiresAt: "2026-07-17T12:01:00.000Z",
    },
  };
}

function worker(
  queue: FakeQueue,
  executor: ProjectDatabaseExecutor,
  cipher: StatementCipher = new PlaintextTestCipher(),
  logs: MigrationWorkerLogEvent[] = [],
) {
  return new MigrationWorker(queue, executor, cipher, {
    workerId: "worker-1",
    now: () => new Date(NOW),
    logger: { log: (event) => logs.push(event) },
  }, allowProductionApplyAuthorizer);
}

function expireApproval(claim: ClaimedMigrationJob): void {
  claim.approval.expiresAt = "2026-07-17T11:00:00.000Z";
  claim.approval.actionHash = approvalActionHash({
    changeSetId: claim.changeSet.id,
    organizationId: claim.changeSet.organizationId,
    projectId: claim.changeSet.projectId,
    environment: claim.changeSet.environment,
    databaseInstanceRef: claim.databaseInstanceRef,
    title: claim.changeSet.title,
    statementSha256: claim.changeSet.statementSha256,
    createdBy: claim.changeSet.createdBy,
    risk: claim.changeSet.risk,
    expiresAt: claim.approval.expiresAt,
    requiredScope: "approval:decide",
  });
}

describe("migration worker", () => {
  it("renews a lease during execution and stops the heartbeat before completion", async () => {
    const queue = new FakeQueue(job());
    let finishExecution!: () => void;
    let delayCalls = 0;
    const delay = (_ms: number, signal: AbortSignal): Promise<boolean> => {
      if (delayCalls++ === 0) return Promise.resolve(true);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true }));
    };
    const executor: ProjectDatabaseExecutor = {
      execute: () => new Promise((resolve) => {
        finishExecution = () => resolve({ status: "applied" });
      }),
    };
    const migrationWorker = new MigrationWorker(queue, executor, new PlaintextTestCipher(), {
      workerId: "worker-1",
      now: () => new Date(NOW),
      heartbeatIntervalMs: 1_000,
      heartbeatDelay: delay,
    }, allowProductionApplyAuthorizer);

    const running = migrationWorker.runOnce();
    await vi.waitFor(() => expect(queue.renewed).toHaveLength(1));
    finishExecution();
    await expect(running).resolves.toEqual({ status: "applied", jobId: "job-1" });

    expect(queue.renewed[0]).toEqual({
      jobId: "job-1", workerId: "worker-1", leaseToken: "lease-1", leaseDurationMs: 60_000,
    });
    expect(queue.events).toEqual(["claim", "renew", "complete"]);
  });

  it.each([
    ["lease loss", false, { status: "lease_lost" } as LeaseRenewalResult, "lease_lost"],
    ["renewal failure", true, { status: "updated", expiresAt: "unused" } as LeaseRenewalResult, "reconciliation_scheduled"],
  ])("drains execution after %s and never completes or fails the queue", async (_case, throws, result, expected) => {
    const queue = new FakeQueue(job());
    queue.throwOnRenew = throws;
    queue.renewResult = result;
    let finishExecution!: () => void;
    let delayCalls = 0;
    const executor: ProjectDatabaseExecutor = {
      execute: () => new Promise((resolve) => {
        finishExecution = () => resolve({ status: "applied" });
      }),
    };
    const migrationWorker = new MigrationWorker(queue, executor, new PlaintextTestCipher(), {
      workerId: "worker-1",
      now: () => new Date(NOW),
      heartbeatIntervalMs: 1_000,
      heartbeatDelay: (_ms, signal) => delayCalls++ === 0
        ? Promise.resolve(true)
        : new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })),
    }, allowProductionApplyAuthorizer);

    const running = migrationWorker.runOnce();
    await vi.waitFor(() => expect(queue.renewed).toHaveLength(1));
    let settled = false;
    void running.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishExecution();
    await expect(running).resolves.toEqual({ status: expected, jobId: "job-1" });
    expect(queue.applied).toHaveLength(0);
    expect(queue.failed).toHaveLength(0);
  });

  it("heartbeats a reclaimed ledger reconciliation before completing", async () => {
    const claim = job();
    claim.reclaimed = true;
    const queue = new FakeQueue(claim);
    let finishReconciliation!: () => void;
    let delayCalls = 0;
    const executor: ProjectDatabaseExecutor = {
      execute: async () => ({ status: "applied" }),
      reconcile: () => new Promise((resolve) => {
        finishReconciliation = () => resolve({ status: "applied" });
      }),
    };
    const migrationWorker = new MigrationWorker(queue, executor, new PlaintextTestCipher(), {
      workerId: "worker-1", now: () => new Date(NOW), heartbeatIntervalMs: 1_000,
      heartbeatDelay: (_ms, signal) => delayCalls++ === 0
        ? Promise.resolve(true)
        : new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })),
    }, allowProductionApplyAuthorizer);

    const running = migrationWorker.runOnce();
    await vi.waitFor(() => expect(queue.renewed).toHaveLength(1));
    finishReconciliation();
    await expect(running).resolves.toEqual({ status: "already_applied", jobId: "job-1" });
    expect(queue.events).toEqual(["claim", "renew", "complete"]);
  });

  it("verifies the approval and plaintext hash immediately before executing and completing the lease", async () => {
    const queue = new FakeQueue(job());
    const events = queue.events;
    class RecordingExecutor implements ProjectDatabaseExecutor {
      async execute(input: ProjectDatabaseExecutionInput): Promise<ProjectDatabaseExecutionResult> {
        events.push("execute");
        expect(input).toEqual({
          databaseInstanceRef: "managed:database-1",
          changeSetId: CHANGE_SET_ID,
          statement: STATEMENT,
          statementSha256: sha256(STATEMENT),
          jobId: "job-1",
          fenceEpoch: "1",
          leaseToken: "lease-1",
        });
        return { status: "applied" };
      }
    }

    await expect(worker(queue, new RecordingExecutor(), new PlaintextTestCipher(events)).runOnce())
      .resolves.toEqual({ status: "applied", jobId: "job-1" });

    expect(events).toEqual(["claim", "decrypt", "execute", "complete"]);
    expect(queue.applied[0]).toMatchObject({
      jobId: "job-1",
      workerId: "worker-1",
      leaseToken: "lease-1",
      statementSha256: sha256(STATEMENT),
    });
    expect(queue.failed).toHaveLength(0);
  });

  it("rejects a multiple-statement artifact without calling the executor", async () => {
    const queue = new FakeQueue(job("CREATE TABLE x(id int); DROP TABLE x"));
    let calls = 0;
    const executor: ProjectDatabaseExecutor = { execute: async () => { calls += 1; return { status: "applied" }; } };

    await expect(worker(queue, executor).runOnce()).resolves.toEqual({ status: "failed", jobId: "job-1" });

    expect(calls).toBe(0);
    expect(queue.failed[0]).toMatchObject({
      disposition: "failed",
      errorCode: "INVALID_MIGRATION_SQL",
      redactedMessage: "Migration artifact validation failed.",
    });
  });

  it("rejects a mutated action hash, tenant binding, expired lease, or non-opaque database reference", async () => {
    const variants = [
      (value: ClaimedMigrationJob) => { value.approval.actionHash = "d".repeat(64); },
      (value: ClaimedMigrationJob) => { value.approval.organizationId = "8f470bca-769e-482e-be8d-325efe5104fd"; },
      (value: ClaimedMigrationJob) => { value.lease.expiresAt = NOW.toISOString(); },
      (value: ClaimedMigrationJob) => { value.lease.workerId = "another-worker"; },
      (value: ClaimedMigrationJob) => { value.fenceEpoch = "0"; },
      (value: ClaimedMigrationJob) => { value.databaseInstanceRef = "postgres://user:secret@customer/db"; },
      (value: ClaimedMigrationJob) => { value.databaseInstanceRef = "pending:project"; },
    ];

    for (const mutate of variants) {
      const claim = job();
      mutate(claim);
      const queue = new FakeQueue(claim);
      const executor = new InMemoryProjectDatabaseExecutor();
      await expect(worker(queue, executor).runOnce()).resolves.toEqual({ status: "failed", jobId: "job-1" });
      expect(executor.calls).toHaveLength(0);
      expect(queue.failed[0]?.errorCode).toBe("INVALID_MIGRATION_ARTIFACT");
    }
  });

  it("fails closed when no project database executor is configured", async () => {
    const queue = new FakeQueue(job());

    await expect(worker(queue, new DisabledProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "failed", jobId: "job-1" });

    expect(queue.failed[0]).toMatchObject({
      disposition: "failed",
      errorCode: "PROJECT_DATABASE_EXECUTION_DISABLED",
      redactedMessage: "Migration execution failed.",
    });
  });

  it("reconciles a committed target after lease loss even when the approval has since expired", async () => {
    const claim = job();
    claim.reclaimed = true;
    expireApproval(claim);
    const executor = new InMemoryProjectDatabaseExecutor();
    await executor.execute({
      databaseInstanceRef: claim.databaseInstanceRef,
      changeSetId: claim.changeSet.id,
      statement: STATEMENT,
      statementSha256: claim.changeSet.statementSha256,
      jobId: claim.jobId,
      fenceEpoch: claim.fenceEpoch,
      leaseToken: claim.lease.token,
    });
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor).runOnce()).resolves.toEqual({ status: "already_applied", jobId: "job-1" });
    expect(executor.calls).toHaveLength(1);
    expect(executor.reconciliationCalls).toHaveLength(1);
    expect(queue.applied[0]?.executorResult).toBe("already_applied");
    expect(queue.failed).toHaveLength(0);
  });

  it("never executes an expired reclaimed job when its target ledger entry is absent", async () => {
    const claim = job();
    claim.reclaimed = true;
    expireApproval(claim);
    const executor = new InMemoryProjectDatabaseExecutor();
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor).runOnce()).resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });
    expect(executor.calls).toHaveLength(0);
    expect(executor.reconciliationCalls).toHaveLength(1);
    expect(queue.failed).toHaveLength(0);
  });

  it("reconciles a reclaimed claim before artifact validation and never terminally fails a missing ledger", async () => {
    const claim = job("CREATE TABLE x(id int); DROP TABLE x");
    claim.reclaimed = true;
    const events: string[] = [];
    const executor: ProjectDatabaseExecutor = {
      reconcile: async () => {
        events.push("reconcile");
        return { status: "not_applied" };
      },
      execute: async () => {
        events.push("execute");
        return { status: "applied" };
      },
    };
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor, new PlaintextTestCipher(events)).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });
    expect(events).toEqual(["reconcile", "decrypt"]);
    expect(queue.failed).toHaveLength(0);
  });

  it("reconciles a reclaimed valid job before safely executing when the ledger is absent", async () => {
    const claim = job();
    claim.reclaimed = true;
    const executor = new InMemoryProjectDatabaseExecutor();
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor).runOnce()).resolves.toEqual({ status: "applied", jobId: "job-1" });
    expect(executor.reconciliationCalls).toHaveLength(1);
    expect(executor.calls).toHaveLength(1);
    expect(queue.applied[0]?.executorResult).toBe("applied");
  });

  it("retries a reclaimed rollback only after the target confirms its durable fence", async () => {
    const claim = job();
    claim.reclaimed = true;
    const executor = new InMemoryProjectDatabaseExecutor();
    executor.failNext(new ProjectDatabaseExecutionError({
      code: "LOCK_TIMEOUT",
      outcome: "rolled_back",
      retryable: true,
    }));
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "retry_scheduled", jobId: "job-1" });
    expect(queue.failed[0]).toMatchObject({ disposition: "retry", errorCode: "LOCK_TIMEOUT" });
    expect(executor.reconciliationCalls).toHaveLength(1);
  });

  it("defers a reclaimed rollback when the target fence is not confirmed", async () => {
    const claim = job();
    claim.reclaimed = true;
    const executor: ProjectDatabaseExecutor = {
      reconcile: async () => ({ status: "not_applied" }),
      execute: async () => {
        throw new ProjectDatabaseExecutionError({
          code: "LOCK_TIMEOUT",
          outcome: "rolled_back",
          retryable: true,
          fenceStatus: "unknown",
        });
      },
    };
    const queue = new FakeQueue(claim);

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });
    expect(queue.failed).toHaveLength(0);
  });

  it("retries a known rolled-back retryable failure and respects maxAttempts", async () => {
    const retryQueue = new FakeQueue(job());
    const retryExecutor = new InMemoryProjectDatabaseExecutor();
    retryExecutor.failNext(new ProjectDatabaseExecutionError({
      code: "LOCK_TIMEOUT",
      outcome: "rolled_back",
      retryable: true,
    }));

    await expect(worker(retryQueue, retryExecutor).runOnce())
      .resolves.toEqual({ status: "retry_scheduled", jobId: "job-1" });
    expect(retryQueue.failed[0]).toMatchObject({
      disposition: "retry",
      errorCode: "LOCK_TIMEOUT",
      retryAt: "2026-07-17T12:00:01.000Z",
    });

    const exhausted = job();
    exhausted.attempt = exhausted.maxAttempts;
    const exhaustedQueue = new FakeQueue(exhausted);
    const exhaustedExecutor = new InMemoryProjectDatabaseExecutor();
    exhaustedExecutor.failNext(new ProjectDatabaseExecutionError({
      code: "LOCK_TIMEOUT",
      outcome: "rolled_back",
      retryable: true,
    }));
    await expect(worker(exhaustedQueue, exhaustedExecutor).runOnce())
      .resolves.toEqual({ status: "failed", jobId: "job-1" });
    expect(exhaustedQueue.failed[0]?.disposition).toBe("failed");
  });

  it("retries a trusted resolver failure only when execution provably never started", async () => {
    const queue = new FakeQueue(job());
    const executor = new InMemoryProjectDatabaseExecutor();
    executor.failNext(new ProjectDatabaseExecutionError({
      code: "PROJECT_DATABASE_RESOLUTION_FAILED",
      outcome: "not_started",
      retryable: true,
    }));

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "retry_scheduled", jobId: "job-1" });
    expect(queue.failed[0]).toMatchObject({
      disposition: "retry",
      errorCode: "PROJECT_DATABASE_RESOLUTION_FAILED",
      redactedMessage: "Migration execution did not start and will be retried.",
    });
  });

  it("defers an unknown execution outcome for ledger reconciliation and logs no raw SQL or driver message", async () => {
    const queue = new FakeQueue(job());
    const logs: MigrationWorkerLogEvent[] = [];
    const executor: ProjectDatabaseExecutor = {
      execute: async () => {
        throw new Error(`driver failed for ${STATEMENT} PASSWORD='super-secret'`);
      },
    };

    await expect(worker(queue, executor, new PlaintextTestCipher(), logs).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });

    expect(queue.failed).toHaveLength(0);
    expect(logs.at(-1)).toMatchObject({
      event: "migration.reconciliation_scheduled",
      errorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN",
    });
    const observable = JSON.stringify({ logs });
    expect(observable).not.toContain(STATEMENT);
    expect(observable).not.toContain("super-secret");
  });

  it("persists an unknown outcome with a fixed redacted reconciliation request", async () => {
    const queue = new FakeQueue(job());
    const executor: ProjectDatabaseExecutor = {
      execute: async () => { throw new Error("postgres://admin:secret@target/db"); },
    };

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });

    expect(queue.deferred).toHaveLength(1);
    expect(queue.deferred[0]).toMatchObject({
      jobId: "job-1",
      workerId: "worker-1",
      leaseToken: "lease-1",
      errorCode: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN",
      redactedMessage: "Migration outcome requires target-ledger reconciliation.",
      retryAt: "2026-07-17T12:00:01.000Z",
    });
    expect(JSON.stringify(queue.deferred)).not.toContain("admin:secret");
  });

  it("never executes SQL from a reconciliation-only claim when the target ledger is empty", async () => {
    const claim = job();
    claim.reconciliationRequired = true;
    claim.reconciliationAttempt = 1;
    const queue = new FakeQueue(claim);
    const executor = new InMemoryProjectDatabaseExecutor();

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });

    expect(executor.reconciliationCalls).toHaveLength(1);
    expect(executor.calls).toHaveLength(0);
    expect(queue.deferred[0]?.errorCode).toBe("MIGRATION_NOT_APPLIED");
  });

  it("quarantines an exhausted reconciliation-only claim for manual review", async () => {
    const claim = job();
    claim.reconciliationRequired = true;
    claim.reconciliationAttempt = claim.maxReconciliationAttempts;
    const queue = new FakeQueue(claim);
    queue.deferredResult = { status: "updated", state: "review_required" };
    const executor = new InMemoryProjectDatabaseExecutor();

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "review_required", jobId: "job-1" });
    expect(executor.calls).toHaveLength(0);
  });

  it("completes a reconciliation-only claim when the target ledger confirms the change", async () => {
    const claim = job();
    claim.reconciliationRequired = true;
    claim.reconciliationAttempt = 1;
    const queue = new FakeQueue(claim);
    const executor: ProjectDatabaseExecutor = {
      execute: async () => { throw new Error("execute must not be called"); },
      reconcile: async () => ({ status: "applied" }),
    };

    await expect(worker(queue, executor).runOnce())
      .resolves.toEqual({ status: "already_applied", jobId: "job-1" });
    expect(queue.applied[0]?.executorResult).toBe("already_applied");
    expect(queue.deferred).toHaveLength(0);
  });

  it("falls back to completion_deferred only when the reconciliation transition itself cannot be persisted", async () => {
    const claim = job();
    claim.reconciliationRequired = true;
    claim.reconciliationAttempt = 1;
    const queue = new FakeQueue(claim);
    queue.throwOnDefer = true;

    await expect(worker(queue, new InMemoryProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "completion_deferred", jobId: "job-1" });
  });

  it("does not mark a known commit as failed when the queue completion update is unavailable", async () => {
    const queue = new FakeQueue(job());
    queue.throwOnComplete = true;

    await expect(worker(queue, new InMemoryProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "reconciliation_scheduled", jobId: "job-1" });

    expect(queue.failed).toHaveLength(0);
  });

  it("does not let observability failure control migration execution", async () => {
    const queue = new FakeQueue(job());
    const migrationWorker = new MigrationWorker(
      queue,
      new InMemoryProjectDatabaseExecutor(),
      new PlaintextTestCipher(),
      {
        workerId: "worker-1",
        now: () => new Date(NOW),
        logger: { log: () => { throw new Error("telemetry unavailable"); } },
      },
      allowProductionApplyAuthorizer,
    );

    await expect(migrationWorker.runOnce()).resolves.toEqual({ status: "applied", jobId: "job-1" });
    expect(queue.applied).toHaveLength(1);
  });

  it("blocks a claimed production job immediately before execution by secure default", async () => {
    const queue = new FakeQueue(job());
    const execute = vi.fn();
    const migrationWorker = new MigrationWorker(
      queue,
      { execute },
      new PlaintextTestCipher(),
      { workerId: "worker-1", now: () => new Date(NOW) },
      denyProductionApplyAuthorizer,
    );

    await expect(migrationWorker.runOnce()).resolves.toEqual({
      status: "retry_scheduled",
      jobId: "job-1",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(queue.failed).toEqual([expect.objectContaining({
      disposition: "retry",
      errorCode: "PRODUCTION_APPLY_BLOCKED",
      redactedMessage: "Production apply authorization is unavailable.",
    })]);
  });

  it("reports a deferred completion when a failure cannot be persisted", async () => {
    const invalid = job();
    invalid.approval.actionHash = "d".repeat(64);
    const queue = new FakeQueue(invalid);
    queue.throwOnFail = true;

    await expect(worker(queue, new InMemoryProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "completion_deferred", jobId: "job-1" });
  });

  it("reports a stale completion lease and keeps terminal transitions idempotent", async () => {
    const queue = new FakeQueue(job());
    queue.appliedResult = { status: "lease_lost" };
    await expect(worker(queue, new InMemoryProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "lease_lost", jobId: "job-1" });

    const alreadyDone = new FakeQueue(job());
    alreadyDone.appliedResult = { status: "already_terminal", state: "applied" };
    await expect(worker(alreadyDone, new InMemoryProjectDatabaseExecutor()).runOnce())
      .resolves.toEqual({ status: "already_applied", jobId: "job-1" });
  });
});

describe("in-memory project database executor", () => {
  it("models an atomic statement-hash ledger for idempotent retries", async () => {
    const executor = new InMemoryProjectDatabaseExecutor();
    const input = {
      databaseInstanceRef: "managed:database-1",
      changeSetId: CHANGE_SET_ID,
      statement: STATEMENT,
      statementSha256: sha256(STATEMENT),
      jobId: "job-1",
      fenceEpoch: "1",
      leaseToken: "lease-1",
    };

    await expect(executor.execute(input)).resolves.toEqual({ status: "applied" });
    await expect(executor.execute(input)).resolves.toEqual({ status: "already_applied" });
    await expect(executor.execute({ ...input, jobId: "job-2", changeSetId: `${CHANGE_SET_ID}-second` }))
      .resolves.toEqual({ status: "applied" });
  });

  it("models a higher target fence rejecting a stale lease", async () => {
    const executor = new InMemoryProjectDatabaseExecutor();
    const base = {
      databaseInstanceRef: "managed:database-1", changeSetId: CHANGE_SET_ID, statement: STATEMENT,
      statementSha256: sha256(STATEMENT), jobId: "job-1",
    };
    await expect(executor.execute({ ...base, fenceEpoch: "2", leaseToken: "lease-2" }))
      .resolves.toEqual({ status: "applied" });
    await expect(executor.execute({ ...base, fenceEpoch: "1", leaseToken: "lease-1" }))
      .rejects.toMatchObject({ code: "MIGRATION_FENCE_SUPERSEDED", fenceStatus: "superseded" });
  });

  it("rejects connection strings, hash mismatches, and more than one statement", async () => {
    const executor = new InMemoryProjectDatabaseExecutor();
    await expect(executor.execute({
      databaseInstanceRef: "postgres://user:secret@host/db",
      changeSetId: CHANGE_SET_ID,
      statement: STATEMENT,
      statementSha256: sha256(STATEMENT),
      jobId: "job-1",
      fenceEpoch: "1",
      leaseToken: "lease-1",
    })).rejects.toMatchObject({ code: "INVALID_DATABASE_REFERENCE", outcome: "not_started" });
    await expect(executor.execute({
      databaseInstanceRef: "managed:database-1",
      changeSetId: CHANGE_SET_ID,
      statement: STATEMENT,
      statementSha256: "d".repeat(64),
      jobId: "job-1",
      fenceEpoch: "1",
      leaseToken: "lease-1",
    })).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT", outcome: "not_started" });
    await expect(executor.execute({
      databaseInstanceRef: "managed:database-1",
      changeSetId: CHANGE_SET_ID,
      statement: "SELECT 1; SELECT 2",
      statementSha256: sha256("SELECT 1; SELECT 2"),
      jobId: "job-1",
      fenceEpoch: "1",
      leaseToken: "lease-1",
    })).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT", outcome: "not_started" });
  });
});
