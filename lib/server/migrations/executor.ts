import { hashesMatch, sha256 } from "@/lib/server/control-plane/crypto";
import { validateSingleSqlStatement } from "@/lib/security";

export type ProjectDatabaseExecutionInput = {
  /** Opaque server-side lookup reference. Connection strings are forbidden. */
  databaseInstanceRef: string;
  changeSetId: string;
  statement: string;
  statementSha256: string;
  /** Control-plane job identity bound to the durable target fence. */
  jobId: string;
  /** Strictly monotone per-job claim sequence, represented losslessly. */
  fenceEpoch: string;
  /** Opaque UUID generated for this exact control-plane lease. */
  leaseToken: string;
};

export type ProjectDatabaseExecutionResult = {
  status: "applied" | "already_applied";
};

export type ProjectDatabaseReconciliationInput = Pick<
  ProjectDatabaseExecutionInput,
  "databaseInstanceRef" | "changeSetId" | "statementSha256" | "jobId" | "fenceEpoch" | "leaseToken"
>;

export type ProjectDatabaseReconciliationResult = { status: "applied" | "not_applied" };

export type ExecutionOutcome = "not_started" | "rolled_back" | "unknown";
export type TargetFenceStatus = "confirmed" | "superseded" | "unknown";

/**
 * Executor implementations must use a local PostgreSQL transaction, set both
 * statement_timeout and lock_timeout with SET LOCAL, and execute exactly the
 * supplied statement. They must atomically record statementSha256 in a
 * target-database migration ledger so retries after a worker crash are safe.
 */
export interface ProjectDatabaseExecutor {
  execute(input: ProjectDatabaseExecutionInput): Promise<ProjectDatabaseExecutionResult>;
  /** Read-only target-ledger lookup. It must never execute the migration statement. */
  reconcile?(input: ProjectDatabaseReconciliationInput): Promise<ProjectDatabaseReconciliationResult>;
}

export class ProjectDatabaseExecutionError extends Error {
  readonly code: string;
  readonly outcome: ExecutionOutcome;
  readonly retryable: boolean;
  readonly fenceStatus: TargetFenceStatus;

  constructor(input: {
    code: string;
    outcome: ExecutionOutcome;
    retryable?: boolean;
    cause?: unknown;
    fenceStatus?: TargetFenceStatus;
  }) {
    super("The project database migration could not be completed.", { cause: input.cause });
    this.name = "ProjectDatabaseExecutionError";
    this.code = input.code;
    this.outcome = input.outcome;
    this.retryable = input.retryable === true &&
      (input.outcome === "rolled_back" || input.outcome === "not_started");
    this.fenceStatus = input.fenceStatus ?? "unknown";
  }
}

/** Default executor: no customer database operation is possible until wired. */
export class DisabledProjectDatabaseExecutor implements ProjectDatabaseExecutor {
  async execute(_input: ProjectDatabaseExecutionInput): Promise<ProjectDatabaseExecutionResult> {
    throw new ProjectDatabaseExecutionError({
      code: "PROJECT_DATABASE_EXECUTION_DISABLED",
      outcome: "not_started",
    });
  }

  async reconcile(_input: ProjectDatabaseReconciliationInput): Promise<ProjectDatabaseReconciliationResult> {
    throw new ProjectDatabaseExecutionError({
      code: "PROJECT_DATABASE_EXECUTION_DISABLED",
      outcome: "not_started",
    });
  }
}

/** Test-only fake that models the target ledger's idempotency contract. */
export class InMemoryProjectDatabaseExecutor implements ProjectDatabaseExecutor {
  readonly calls: ProjectDatabaseExecutionInput[] = [];
  readonly reconciliationCalls: ProjectDatabaseReconciliationInput[] = [];
  private readonly applied = new Map<string, string>();
  private readonly fences = new Map<string, { epoch: bigint; leaseToken: string; statementSha256: string }>();
  private nextError?: ProjectDatabaseExecutionError;

  failNext(error: ProjectDatabaseExecutionError): void {
    this.nextError = error;
  }

  async execute(input: ProjectDatabaseExecutionInput): Promise<ProjectDatabaseExecutionResult> {
    assertProjectDatabaseExecutionInput(input);
    this.calls.push({ ...input });
    const fenceKey = `${input.databaseInstanceRef}:${input.jobId}`;
    const epoch = BigInt(input.fenceEpoch);
    const fence = this.fences.get(fenceKey);
    if (fence && (fence.epoch > epoch || (fence.epoch === epoch &&
        (fence.leaseToken !== input.leaseToken || fence.statementSha256 !== input.statementSha256.toLowerCase())))) {
      throw new ProjectDatabaseExecutionError({
        code: "MIGRATION_FENCE_SUPERSEDED", outcome: "not_started", fenceStatus: "superseded",
      });
    }
    this.fences.set(fenceKey, { epoch, leaseToken: input.leaseToken, statementSha256: input.statementSha256.toLowerCase() });
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = undefined;
      throw new ProjectDatabaseExecutionError({
        code: error.code,
        outcome: error.outcome,
        retryable: error.retryable,
        fenceStatus: "confirmed",
      });
    }
    const key = `${input.databaseInstanceRef}:${input.changeSetId}`;
    const existingHash = this.applied.get(key);
    if (existingHash === input.statementSha256.toLowerCase()) return { status: "already_applied" };
    if (existingHash) throw new ProjectDatabaseExecutionError({ code: "MIGRATION_LEDGER_CONFLICT", outcome: "not_started" });
    this.applied.set(key, input.statementSha256.toLowerCase());
    return { status: "applied" };
  }

  async reconcile(input: ProjectDatabaseReconciliationInput): Promise<ProjectDatabaseReconciliationResult> {
    assertProjectDatabaseReconciliationInput(input);
    this.reconciliationCalls.push({ ...input });
    const existingHash = this.applied.get(`${input.databaseInstanceRef}:${input.changeSetId}`);
    if (!existingHash) return { status: "not_applied" };
    if (existingHash !== input.statementSha256.toLowerCase()) {
      throw new ProjectDatabaseExecutionError({ code: "MIGRATION_LEDGER_CONFLICT", outcome: "not_started" });
    }
    return { status: "applied" };
  }
}

export function assertProjectDatabaseExecutionInput(input: ProjectDatabaseExecutionInput): void {
  assertProjectDatabaseReconciliationInput(input);
  const validation = validateSingleSqlStatement(input.statement);
  if (!validation.valid || !hashesMatch(sha256(input.statement), input.statementSha256)) {
    throw new ProjectDatabaseExecutionError({ code: "INVALID_EXECUTION_INPUT", outcome: "not_started" });
  }
}

export function assertProjectDatabaseReconciliationInput(input: ProjectDatabaseReconciliationInput): void {
  if (!isOpaqueDatabaseReference(input.databaseInstanceRef)) {
    throw new ProjectDatabaseExecutionError({ code: "INVALID_DATABASE_REFERENCE", outcome: "not_started" });
  }
  if (!input.changeSetId || input.changeSetId.length > 200 || !/^[a-z0-9_-]+$/i.test(input.changeSetId)) {
    throw new ProjectDatabaseExecutionError({ code: "INVALID_CHANGE_SET_REFERENCE", outcome: "not_started" });
  }
  if (!/^[a-f0-9]{64}$/i.test(input.statementSha256)) {
    throw new ProjectDatabaseExecutionError({ code: "INVALID_EXECUTION_INPUT", outcome: "not_started" });
  }
  if (!isBoundedFenceReference(input.jobId) || !isBoundedFenceReference(input.leaseToken) || !isFenceEpoch(input.fenceEpoch)) {
    throw new ProjectDatabaseExecutionError({ code: "INVALID_FENCE_INPUT", outcome: "not_started" });
  }
}

function isBoundedFenceReference(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[a-z0-9_-]+$/i.test(value);
}

function isFenceEpoch(value: string): boolean {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try { return BigInt(value) <= 9_223_372_036_854_775_807n; } catch { return false; }
}

export function isOpaqueDatabaseReference(value: string): boolean {
  return value.length > 0 && value.length <= 200 &&
    /^[a-z0-9][a-z0-9._:/-]*$/i.test(value) &&
    !value.includes("://") && !value.includes("@") && !/^pending:/i.test(value);
}
