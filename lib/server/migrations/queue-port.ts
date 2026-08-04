import type {
  ClaimedMigrationJob,
  EnqueueMigrationInput,
  EnqueueMigrationResult,
  LeaseMutationResult,
  MigrationFailureDisposition,
  MigrationJobStatus,
  ReconciliationDeferralResult,
} from "@/lib/server/migrations/model";

export type ClaimMigrationInput = {
  workerId: string;
  leaseDurationMs: number;
};

export type MigrationLeaseIdentity = {
  jobId: string;
  workerId: string;
  leaseToken: string;
};

export type RenewMigrationLeaseInput = MigrationLeaseIdentity & {
  leaseDurationMs: number;
};

export type LeaseRenewalResult =
  | { status: "updated"; expiresAt: string }
  | { status: "lease_lost" };

export type CompleteMigrationInput = MigrationLeaseIdentity & {
  statementSha256: string;
  executorResult: "applied" | "already_applied";
  completedAt: string;
};

export type FailMigrationInput = MigrationLeaseIdentity & {
  disposition: MigrationFailureDisposition;
  errorCode: string;
  /** A fixed, redacted operator-facing message. Never persist a raw driver error. */
  redactedMessage: string;
  retryAt?: string;
  completedAt: string;
};

export type DeferMigrationForReconciliationInput = MigrationLeaseIdentity & {
  errorCode: string;
  /** A fixed, redacted operator-facing message. Never persist a raw driver error. */
  redactedMessage: string;
  retryAt: string;
  completedAt: string;
};

/**
 * Persistence boundary for the apply API and workers. PostgreSQL adapters must
 * claim with a lease in one transaction (normally FOR UPDATE SKIP LOCKED) and
 * compare job id, worker id, lease token and lease expiry on complete/fail.
 * Terminal transitions are idempotent and a stale lease returns `lease_lost`.
 */
export interface MigrationQueuePort {
  enqueue(input: EnqueueMigrationInput): Promise<EnqueueMigrationResult>;
  getStatus(input: {
    organizationId: string;
    projectId: string;
    changeSetId: string;
  }): Promise<MigrationJobStatus | null>;
  claimNext(input: ClaimMigrationInput): Promise<ClaimedMigrationJob | null>;
  renewLease(input: RenewMigrationLeaseInput): Promise<LeaseRenewalResult>;
  markApplied(input: CompleteMigrationInput): Promise<LeaseMutationResult>;
  markFailed(input: FailMigrationInput): Promise<LeaseMutationResult>;
  deferForReconciliation(input: DeferMigrationForReconciliationInput): Promise<ReconciliationDeferralResult>;
}
