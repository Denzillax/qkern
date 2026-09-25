import { recognisedByName } from "@/lib/server/errors/identity";
import type { ControlPlaneContext } from "@/lib/server/control-plane/model";

export type QueueApprovedChangeSetInput = {
  changeSetId: string;
};

export type QueueApprovedChangeSetResult =
  | { outcome: "queued"; changeSetId: string; jobId?: string }
  | { outcome: "already_queued"; changeSetId: string; jobId?: string }
  | { outcome: "already_applied"; changeSetId: string };

/**
 * HTTP-facing application port. Implementations must enforce tenant scope and
 * atomically verify approval before enqueueing; the route never executes SQL.
 */
export interface ChangeSetApplyService {
  queueApprovedChangeSet(
    context: ControlPlaneContext,
    input: QueueApprovedChangeSetInput,
  ): Promise<QueueApprovedChangeSetResult>;
}

export class ChangeSetNotApprovedError extends Error {
  readonly code = "CHANGE_SET_NOT_APPROVED";

  constructor() {
    super("The Change Set is not approved for apply.");
    this.name = "ChangeSetNotApprovedError";
  }
}
recognisedByName(ChangeSetNotApprovedError, "ChangeSetNotApprovedError");

export class ApplyServiceUnavailableError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE";

  constructor() {
    super("The migration queue service is not configured.");
    this.name = "ApplyServiceUnavailableError";
  }
}
recognisedByName(ApplyServiceUnavailableError, "ApplyServiceUnavailableError");
