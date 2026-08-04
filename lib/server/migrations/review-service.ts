import type { ControlPlaneContext } from "@/lib/server/control-plane/model";
import type { MigrationReviewReasonCode } from "@/lib/server/db/models";
import type { Environment } from "@/lib/types";

export type MigrationReviewItem = {
  jobId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  state: "review_required";
  reconciliationAttempt: number;
  maxReconciliationAttempts: number;
  reviewCycle: number;
  maxReviewCycles: number;
  errorCode?: string;
  finishedAt: string;
  updatedAt: string;
};

export type RequestMigrationReconciliationResult =
  | { outcome: "requested" | "already_requested"; jobId: string; commandId: string }
  | { outcome: "already_scheduled" | "already_applied"; jobId: string };

export interface MigrationReviewService {
  listReviews(
    context: ControlPlaneContext,
    input: { projectId?: string; limit?: number },
  ): Promise<MigrationReviewItem[]>;
  requestReconciliation(
    context: ControlPlaneContext,
    input: { jobId: string; reasonCode: MigrationReviewReasonCode },
  ): Promise<RequestMigrationReconciliationResult>;
}

export class MigrationReviewNotReadyError extends Error {
  readonly code = "MIGRATION_REVIEW_NOT_READY";
  constructor() {
    super("The migration job is not in review_required state.");
    this.name = "MigrationReviewNotReadyError";
  }
}

export class MigrationReviewCyclesExhaustedError extends Error {
  readonly code = "MIGRATION_REVIEW_CYCLES_EXHAUSTED";
  constructor() {
    super("The bounded operator reconciliation cycles are exhausted.");
    this.name = "MigrationReviewCyclesExhaustedError";
  }
}
