import type { ApprovalRequestRecord, ChangeSetRecord } from "@/lib/server/db/models";
import type { Environment } from "@/lib/types";

export type EnqueueMigrationInput = {
  organizationId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  requestedBy: string;
};

export type EnqueueMigrationResult =
  | { status: "queued"; jobId: string }
  | { status: "already_queued"; jobId: string }
  | { status: "already_applied"; jobId: string }
  | { status: "not_approved" }
  | { status: "not_found" };

export type MigrationJobState =
  | "queued"
  | "claimed"
  | "retry_scheduled"
  | "reconciliation_scheduled"
  | "reconciling"
  | "review_required"
  | "applied"
  | "failed";

export type MigrationJobStatus = {
  jobId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  state: MigrationJobState;
  attempt: number;
  maxAttempts: number;
  reconciliationRequired: boolean;
  reconciliationAttempt: number;
  maxReconciliationAttempts: number;
  errorCode?: string;
};

/**
 * A queue claim contains an immutable snapshot of the artifacts to verify. The
 * encrypted SQL is control-plane data; databaseInstanceRef is an opaque lookup
 * reference and must never contain a connection string or credentials.
 */
export type ClaimedMigrationJob = {
  jobId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  databaseInstanceRef: string;
  /** True when this claim recovered a previously expired running lease. */
  reclaimed: boolean;
  changeSet: ChangeSetRecord;
  approval: ApprovalRequestRecord;
  attempt: number;
  maxAttempts: number;
  /** A reconciliation-only claim must never invoke execute(), even when the target ledger is empty. */
  reconciliationRequired: boolean;
  reconciliationAttempt: number;
  maxReconciliationAttempts: number;
  /** Canonical positive int8 decimal used by the target-side fence. */
  fenceEpoch: string;
  lease: {
    workerId: string;
    token: string;
    expiresAt: string;
  };
};

export type LeaseMutationResult =
  | { status: "updated" }
  | { status: "already_terminal"; state: "applied" | "failed" | "review_required" }
  | { status: "lease_lost" };

export type ReconciliationDeferralResult =
  | { status: "updated"; state: "reconciliation_scheduled" | "review_required" }
  | { status: "already_terminal"; state: "applied" | "failed" | "review_required" }
  | { status: "lease_lost" };

export type MigrationWorkerResult =
  | { status: "idle" }
  | { status: "applied" | "already_applied"; jobId: string }
  | { status: "retry_scheduled" | "reconciliation_scheduled" | "review_required" |
      "failed" | "lease_lost" | "completion_deferred"; jobId: string };

export type MigrationFailureDisposition = "retry" | "failed";

export class MigrationArtifactError extends Error {
  readonly code: string;

  constructor(code = "INVALID_MIGRATION_ARTIFACT") {
    super("The migration artifact could not be verified.");
    this.name = "MigrationArtifactError";
    this.code = code;
  }
}
