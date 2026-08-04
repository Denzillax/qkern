import { MigrationLeaseLostError } from "@/lib/server/db/errors";
import {
  isMigrationOutboxDeliveryFailureCode,
  type MigrationOutboxDeliveryFailureCode,
  type MigrationOutboxDeliveryRetryProcessingResult,
  type MigrationOutboxRecord,
} from "@/lib/server/db/models";
import {
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 15 * 60_000;
const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 24 * 60 * 60_000;

/**
 * This deliberately mirrors MigrationOutboxRepository's fenced operations so
 * the repository can be injected directly without exposing its transaction.
 */
export interface MigrationOutboxLeasePort {
  processRetryCommands(
    publisherId: string,
    limit?: number,
  ): Promise<MigrationOutboxDeliveryRetryProcessingResult[]>;
  claimNext(publisherId: string, leaseDurationMs?: number): Promise<MigrationOutboxRecord | null>;
  markPublished(eventId: string, publisherId: string, leaseToken: string): Promise<MigrationOutboxRecord>;
  recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationOutboxDeliveryFailureCode,
    backoffMs?: number,
  ): Promise<MigrationOutboxRecord>;
  releaseWithBackoff(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<MigrationOutboxRecord>;
}

/** Reference-only message. SQL, connection data and credentials have no slot. */
export type MigrationApplyRequestedMessage = Readonly<{
  eventId: string;
  eventType: "migration.apply.requested";
  organizationId: string;
  migrationJobId: string;
}>;

export type MigrationOutboxAck = Readonly<{
  status: "ack";
  eventId: string;
}>;

export interface MigrationOutboxSink {
  publish(message: MigrationApplyRequestedMessage, options: { signal?: AbortSignal }): Promise<MigrationOutboxAck>;
}

/** Trusted, redacted classification boundary for sink failures persisted by the publisher. */
export class MigrationOutboxSinkError extends Error {
  readonly failureCode: MigrationOutboxDeliveryFailureCode;

  constructor(failureCode: MigrationOutboxDeliveryFailureCode) {
    super("Migration apply delivery failed.");
    this.name = "MigrationOutboxSinkError";
    this.failureCode = isMigrationOutboxDeliveryFailureCode(failureCode)
      ? failureCode
      : "PUBLISH_FAILED";
  }
}

export type MigrationOutboxPublisherLogEvent = Readonly<{
  event: "migration_outbox.claimed" | "migration_outbox.published" | "migration_outbox.retry_scheduled" |
    "migration_outbox.lease_lost" | "migration_outbox.completion_deferred" | "migration_outbox.aborted" |
    "migration_outbox.claim_failed" | "migration_outbox.dead_lettered" |
    "migration_outbox.retry_command_applied" | "migration_outbox.retry_command_rejected" |
    "migration_outbox.retry_command_failed";
  status: string;
  organizationId?: string;
  eventId?: string;
  migrationJobId?: string;
  commandId?: string;
  attempt?: number;
  failureCount?: number;
  expectedRetryCycle?: number;
  retryCycle?: number;
  errorCode?: MigrationOutboxDeliveryFailureCode | "QUEUE_UPDATE_FAILED";
}>;

export interface MigrationOutboxPublisherLogger {
  log(event: MigrationOutboxPublisherLogEvent): void;
}

export type MigrationOutboxPublisherResult =
  | { status: "idle" }
  | { status: "claim_failed" | "retry_command_failed" }
  | { status: "aborted"; eventId?: string }
  | { status: "published" | "retry_scheduled" | "dead_lettered" | "lease_lost" | "completion_deferred"; eventId: string };

export type MigrationOutboxPublisherOptions = {
  publisherId: string;
  leaseDurationMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  idleDelayMs?: number;
  logger?: MigrationOutboxPublisherLogger;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  probe?: RuntimeProbeObserver;
};

const silentLogger: MigrationOutboxPublisherLogger = { log: () => undefined };

/**
 * At-least-once outbox publisher. A sink acknowledgement is the only path to
 * markPublished; all database completions retain the claim's lease token.
 */
export class MigrationOutboxPublisher {
  private readonly publisherId: string;
  private readonly leaseDurationMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly idleDelayMs: number;
  private readonly logger: MigrationOutboxPublisherLogger;
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => Date;
  private readonly probe?: RuntimeProbeObserver;
  private activeOnce: Promise<MigrationOutboxPublisherResult> | null = null;
  private loopRunning = false;

  constructor(
    private readonly outbox: MigrationOutboxLeasePort,
    private readonly sink: MigrationOutboxSink,
    options: MigrationOutboxPublisherOptions,
  ) {
    this.publisherId = boundedReference(options.publisherId, "publisherId");
    this.leaseDurationMs = boundedInteger(options.leaseDurationMs ?? 30_000, MIN_LEASE_MS, MAX_LEASE_MS, "leaseDurationMs");
    this.retryBaseDelayMs = boundedInteger(options.retryBaseDelayMs ?? 1_000, MIN_DELAY_MS, MAX_DELAY_MS, "retryBaseDelayMs");
    this.retryMaxDelayMs = boundedInteger(options.retryMaxDelayMs ?? 60_000, this.retryBaseDelayMs, MAX_DELAY_MS, "retryMaxDelayMs");
    this.idleDelayMs = boundedInteger(options.idleDelayMs ?? 1_000, MIN_DELAY_MS, 60_000, "idleDelayMs");
    this.logger = options.logger ?? silentLogger;
    this.delay = options.delay ?? abortableDelay;
    this.now = options.now ?? (() => new Date());
    this.probe = options.probe;
  }

  /** Concurrent callers join the same operation; this instance never claims two events at once. */
  runOnce(signal?: AbortSignal): Promise<MigrationOutboxPublisherResult> {
    if (this.activeOnce) return this.activeOnce;
    const operation = this.processOnce(signal).finally(() => {
      if (this.activeOnce === operation) this.activeOnce = null;
    });
    this.activeOnce = operation;
    return operation;
  }

  /** Runs serially until aborted and waits without keeping an unabortable timer alive. */
  async run(signal: AbortSignal): Promise<void> {
    if (this.loopRunning) throw new Error("This outbox publisher is already running.");
    this.loopRunning = true;
    safeRuntimeProbe(this.probe, "runtimeStarted");
    try {
      while (!signal.aborted) {
        let result: MigrationOutboxPublisherResult;
        try {
          result = await this.runOnce(signal);
        } catch (error) {
          safeRuntimeProbe(this.probe, "iterationFailed");
          throw error;
        }
        if (signal.aborted || result.status === "aborted") break;
        safeRuntimeProbe(
          this.probe,
          result.status === "claim_failed" || result.status === "retry_command_failed"
            ? "iterationFailed"
            : "iterationSucceeded",
        );
        if (result.status === "idle" || result.status === "claim_failed" || result.status === "retry_command_failed") {
          try {
            await this.delay(this.idleDelayMs, signal);
          } catch (error) {
            if (isAbortError(error) || signal.aborted) break;
            throw error;
          }
        }
      }
    } finally {
      this.loopRunning = false;
      safeRuntimeProbe(this.probe, "runtimeStopped");
    }
  }

  private async processOnce(signal?: AbortSignal): Promise<MigrationOutboxPublisherResult> {
    if (signal?.aborted) return { status: "aborted" };

    let commands: MigrationOutboxDeliveryRetryProcessingResult[];
    try {
      commands = await this.outbox.processRetryCommands(this.publisherId, 20);
    } catch {
      safeLog(this.logger, {
        event: "migration_outbox.retry_command_failed",
        status: "retry_command_failed",
        errorCode: "QUEUE_UPDATE_FAILED",
      });
      return { status: "retry_command_failed" };
    }
    for (const command of commands) {
      safeLog(this.logger, {
        event: command.outcome === "applied"
          ? "migration_outbox.retry_command_applied"
          : "migration_outbox.retry_command_rejected",
        status: command.outcome,
        commandId: command.commandId,
        migrationJobId: command.migrationJobId,
        ...(command.eventId ? { eventId: command.eventId } : {}),
        expectedRetryCycle: command.expectedRetryCycle,
        ...(command.retryCycle !== undefined ? { retryCycle: command.retryCycle } : {}),
        errorCode: command.failureCode,
      });
    }
    if (signal?.aborted) return { status: "aborted" };

    let claim: MigrationOutboxRecord | null;
    try {
      claim = await this.outbox.claimNext(this.publisherId, this.leaseDurationMs);
    } catch {
      safeLog(this.logger, { event: "migration_outbox.claim_failed", status: "claim_failed" });
      return { status: "claim_failed" };
    }
    if (!claim) return signal?.aborted ? { status: "aborted" } : { status: "idle" };

    if (!validClaim(claim, this.publisherId, this.now())) {
      // An invalid/unfenced record must never be sent or mutated with guessed identifiers.
      safeLog(this.logger, eventLog(claim, "migration_outbox.lease_lost", "lease_lost"));
      return { status: "lease_lost", eventId: claim.id };
    }

    safeLog(this.logger, eventLog(claim, "migration_outbox.claimed", "claimed"));
    if (signal?.aborted) return this.releaseAfterAbort(claim);

    const message: MigrationApplyRequestedMessage = Object.freeze({
      eventId: claim.id,
      eventType: claim.eventType,
      organizationId: claim.organizationId,
      migrationJobId: claim.migrationJobId,
    });

    let ack: MigrationOutboxAck;
    try {
      ack = await this.sink.publish(message, { signal });
    } catch (error) {
      return signal?.aborted
        ? this.releaseAfterAbort(claim)
        : this.releaseAfterFailure(
          claim,
          error instanceof MigrationOutboxSinkError ? error.failureCode : "PUBLISH_FAILED",
        );
    }

    if (ack?.status !== "ack" || ack.eventId !== claim.id) {
      return this.releaseAfterFailure(claim, "INVALID_ACK");
    }

    try {
      await this.outbox.markPublished(claim.id, this.publisherId, claim.leaseToken!);
    } catch (error) {
      if (isLeaseLost(error)) return this.leaseLost(claim);
      safeLog(this.logger, eventLog(
        claim,
        "migration_outbox.completion_deferred",
        "completion_deferred",
        "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    safeLog(this.logger, eventLog(claim, "migration_outbox.published", "published"));
    return { status: "published", eventId: claim.id };
  }

  private releaseAfterAbort(claim: MigrationOutboxRecord): Promise<MigrationOutboxPublisherResult> {
    return this.release(claim, "aborted");
  }

  private async releaseAfterFailure(
    claim: MigrationOutboxRecord,
    errorCode: MigrationOutboxDeliveryFailureCode,
  ): Promise<MigrationOutboxPublisherResult> {
    let updated: MigrationOutboxRecord;
    try {
      updated = await this.outbox.recordFailure(
        claim.id,
        this.publisherId,
        claim.leaseToken!,
        errorCode,
        retryDelay(claim.attemptCount, this.retryBaseDelayMs, this.retryMaxDelayMs),
      );
    } catch (error) {
      if (isLeaseLost(error)) return this.leaseLost(claim);
      safeLog(this.logger, eventLog(
        claim, "migration_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    if (!validFailureTransition(claim, updated, errorCode)) {
      safeLog(this.logger, eventLog(
        claim, "migration_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    if (updated.status === "dead_lettered") {
      safeLog(this.logger, eventLog(updated, "migration_outbox.dead_lettered", "dead_lettered", errorCode));
      return { status: "dead_lettered", eventId: claim.id };
    }
    safeLog(this.logger, eventLog(updated, "migration_outbox.retry_scheduled", "retry_scheduled", errorCode));
    return { status: "retry_scheduled", eventId: claim.id };
  }

  private async release(
    claim: MigrationOutboxRecord,
    disposition: "aborted",
  ): Promise<MigrationOutboxPublisherResult> {
    try {
      await this.outbox.releaseWithBackoff(
        claim.id,
        this.publisherId,
        claim.leaseToken!,
        retryDelay(claim.attemptCount, this.retryBaseDelayMs, this.retryMaxDelayMs),
      );
    } catch (error) {
      if (isLeaseLost(error)) return this.leaseLost(claim);
      safeLog(this.logger, eventLog(
        claim,
        "migration_outbox.completion_deferred",
        "completion_deferred",
        "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }

    safeLog(this.logger, eventLog(claim, "migration_outbox.aborted", disposition));
    return { status: "aborted", eventId: claim.id };
  }

  private leaseLost(claim: MigrationOutboxRecord): MigrationOutboxPublisherResult {
    safeLog(this.logger, eventLog(claim, "migration_outbox.lease_lost", "lease_lost"));
    return { status: "lease_lost", eventId: claim.id };
  }
}

function validClaim(claim: MigrationOutboxRecord, publisherId: string, now: Date): boolean {
  return claim.status === "pending" && claim.eventType === "migration.apply.requested" &&
    claim.id.length > 0 && claim.organizationId.length > 0 && claim.migrationJobId.length > 0 &&
    claim.leaseOwner === publisherId && typeof claim.leaseToken === "string" && claim.leaseToken.length > 0 &&
    claim.leaseToken.length <= 500 && Number.isInteger(claim.attemptCount) && claim.attemptCount >= 1 &&
    Number.isInteger(claim.failureCount) && claim.failureCount >= 0 &&
    Number.isInteger(claim.maxFailures) && claim.maxFailures >= 1 && claim.maxFailures <= 100 &&
    claim.failureCount < claim.maxFailures && claim.attemptCount >= claim.failureCount &&
    ((claim.failureCount === 0 && claim.lastFailureCode === null) ||
      (claim.failureCount > 0 && isMigrationOutboxDeliveryFailureCode(claim.lastFailureCode))) &&
    claim.deadLetteredAt === null &&
    Number.isInteger(claim.retryCycleCount) && claim.retryCycleCount >= 0 &&
    Number.isInteger(claim.maxRetryCycles) && claim.maxRetryCycles >= 1 && claim.maxRetryCycles <= 10 &&
    claim.retryCycleCount <= claim.maxRetryCycles &&
    typeof claim.leaseExpiresAt === "string" && Number.isFinite(Date.parse(claim.leaseExpiresAt)) &&
    Date.parse(claim.leaseExpiresAt) > now.getTime();
}

function validFailureTransition(
  claim: MigrationOutboxRecord,
  updated: MigrationOutboxRecord,
  failureCode: MigrationOutboxDeliveryFailureCode,
): boolean {
  const shared = updated.id === claim.id && updated.organizationId === claim.organizationId &&
    updated.migrationJobId === claim.migrationJobId && updated.eventType === claim.eventType &&
    updated.createdAt === claim.createdAt && updated.failureCount === claim.failureCount + 1 &&
    updated.maxFailures === claim.maxFailures && updated.attemptCount === claim.attemptCount &&
    updated.lastFailureCode === failureCode && updated.retryCycleCount === claim.retryCycleCount &&
    updated.maxRetryCycles === claim.maxRetryCycles && updated.leaseOwner === null &&
    updated.leaseToken === null && updated.leaseExpiresAt === null && updated.publishedAt === null;
  if (!shared) return false;
  if (updated.status === "pending") {
    return updated.failureCount < updated.maxFailures && updated.deadLetteredAt === null;
  }
  return updated.status === "dead_lettered" && updated.failureCount === updated.maxFailures &&
    typeof updated.deadLetteredAt === "string" && Number.isFinite(Date.parse(updated.deadLetteredAt));
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 20);
  return Math.min(maximum, base * 2 ** exponent);
}

function eventLog(
  claim: MigrationOutboxRecord,
  event: MigrationOutboxPublisherLogEvent["event"],
  status: string,
  errorCode?: MigrationOutboxPublisherLogEvent["errorCode"],
): MigrationOutboxPublisherLogEvent {
  return {
    event,
    status,
    organizationId: claim.organizationId,
    eventId: claim.id,
    migrationJobId: claim.migrationJobId,
    attempt: claim.attemptCount,
    failureCount: claim.failureCount,
    retryCycle: claim.retryCycleCount,
    ...(errorCode ? { errorCode } : {}),
  };
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof MigrationLeaseLostError ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "MIGRATION_LEASE_LOST");
}

function boundedReference(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/u.test(trimmed)) {
    throw new Error(`${name} must be a bounded reference.`);
  }
  return trimmed;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function safeLog(logger: MigrationOutboxPublisherLogger, event: MigrationOutboxPublisherLogEvent): void {
  try {
    logger.log(event);
  } catch {
    // Observability must never control delivery or lease state.
  }
}
