import { MigrationLeaseLostError } from "@/lib/server/db/errors";
import {
  isMigrationIncidentDeliveryFailureCode,
  type MigrationIncidentDeliveryFailureCode,
  type MigrationIncidentDeliveryRetryProcessingResult,
  type MigrationIncidentOutboxRecord,
} from "@/lib/server/db/models";
import {
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";
import type { Environment } from "@/lib/types";

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 15 * 60_000;
const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MigrationIncidentOutboxLeasePort {
  processRetryCommands(
    publisherId: string,
    limit?: number,
  ): Promise<MigrationIncidentDeliveryRetryProcessingResult[]>;
  claimNext(publisherId: string, leaseDurationMs?: number): Promise<MigrationIncidentOutboxRecord | null>;
  markPublished(eventId: string, publisherId: string, leaseToken: string): Promise<MigrationIncidentOutboxRecord>;
  recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationIncidentDeliveryFailureCode,
    backoffMs?: number,
  ): Promise<MigrationIncidentOutboxRecord>;
  releaseWithBackoff(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<MigrationIncidentOutboxRecord>;
}

/** Fixed reference-only contract for an injected Pager/Ticket adapter. */
export type MigrationIncidentOpenedMessage = Readonly<{
  eventId: string;
  eventType: "migration.incident.opened";
  organizationId: string;
  incidentId: string;
  migrationJobId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  incidentKind: "migration_outcome_unresolved";
  incidentSeverity: "critical";
  incidentCreatedAt: string;
}>;

export type MigrationIncidentOutboxAck = Readonly<{ status: "ack"; eventId: string }>;

export interface MigrationIncidentOutboxSink {
  publish(
    message: MigrationIncidentOpenedMessage,
    options: { signal?: AbortSignal },
  ): Promise<MigrationIncidentOutboxAck>;
}

/** Trusted, redacted classification boundary for sink failures persisted by the publisher. */
export class MigrationIncidentOutboxSinkError extends Error {
  readonly failureCode: MigrationIncidentDeliveryFailureCode;

  constructor(failureCode: MigrationIncidentDeliveryFailureCode, message = "Migration incident delivery failed.") {
    super(message);
    this.name = "MigrationIncidentOutboxSinkError";
    this.failureCode = isMigrationIncidentDeliveryFailureCode(failureCode)
      ? failureCode
      : "PUBLISH_FAILED";
  }
}

export type MigrationIncidentOutboxPublisherLogEvent = Readonly<{
  event: "migration_incident_outbox.claimed" | "migration_incident_outbox.published" |
    "migration_incident_outbox.retry_scheduled" | "migration_incident_outbox.lease_lost" |
    "migration_incident_outbox.completion_deferred" | "migration_incident_outbox.aborted" |
    "migration_incident_outbox.claim_failed" | "migration_incident_outbox.dead_lettered" |
    "migration_incident_outbox.retry_command_applied" | "migration_incident_outbox.retry_command_rejected" |
    "migration_incident_outbox.retry_command_failed";
  status: string;
  organizationId?: string;
  eventId?: string;
  incidentId?: string;
  migrationJobId?: string;
  commandId?: string;
  attempt?: number;
  failureCount?: number;
  expectedRetryCycle?: number;
  retryCycle?: number;
  errorCode?: MigrationIncidentDeliveryFailureCode | "QUEUE_UPDATE_FAILED";
}>;

export interface MigrationIncidentOutboxPublisherLogger {
  log(event: MigrationIncidentOutboxPublisherLogEvent): void;
}

export type MigrationIncidentOutboxPublisherResult =
  | { status: "idle" }
  | { status: "claim_failed" | "retry_command_failed" }
  | { status: "aborted"; eventId?: string }
  | { status: "published" | "retry_scheduled" | "dead_lettered" | "lease_lost" | "completion_deferred"; eventId: string };

export type MigrationIncidentOutboxPublisherOptions = {
  publisherId: string;
  leaseDurationMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  idleDelayMs?: number;
  logger?: MigrationIncidentOutboxPublisherLogger;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  probe?: RuntimeProbeObserver;
};

const silentLogger: MigrationIncidentOutboxPublisherLogger = { log: () => undefined };

/**
 * Serial, at-least-once incident notification publisher. Only an exact sink
 * acknowledgement can complete the fenced outbox lease.
 */
export class MigrationIncidentOutboxPublisher {
  private readonly publisherId: string;
  private readonly leaseDurationMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly idleDelayMs: number;
  private readonly logger: MigrationIncidentOutboxPublisherLogger;
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => Date;
  private readonly probe?: RuntimeProbeObserver;
  private activeOnce: Promise<MigrationIncidentOutboxPublisherResult> | null = null;
  private loopRunning = false;

  constructor(
    private readonly outbox: MigrationIncidentOutboxLeasePort,
    private readonly sink: MigrationIncidentOutboxSink,
    options: MigrationIncidentOutboxPublisherOptions,
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

  runOnce(signal?: AbortSignal): Promise<MigrationIncidentOutboxPublisherResult> {
    if (this.activeOnce) return this.activeOnce;
    const operation = this.processOnce(signal).finally(() => {
      if (this.activeOnce === operation) this.activeOnce = null;
    });
    this.activeOnce = operation;
    return operation;
  }

  async run(signal: AbortSignal): Promise<void> {
    if (this.loopRunning) throw new Error("This incident outbox publisher is already running.");
    this.loopRunning = true;
    safeRuntimeProbe(this.probe, "runtimeStarted");
    try {
      while (!signal.aborted) {
        let result: MigrationIncidentOutboxPublisherResult;
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

  private async processOnce(signal?: AbortSignal): Promise<MigrationIncidentOutboxPublisherResult> {
    if (signal?.aborted) return { status: "aborted" };

    let commands: MigrationIncidentDeliveryRetryProcessingResult[];
    try {
      commands = await this.outbox.processRetryCommands(this.publisherId, 20);
    } catch {
      safeLog(this.logger, {
        event: "migration_incident_outbox.retry_command_failed",
        status: "retry_command_failed",
        errorCode: "QUEUE_UPDATE_FAILED",
      });
      return { status: "retry_command_failed" };
    }
    for (const command of commands) {
      safeLog(this.logger, {
        event: command.outcome === "applied"
          ? "migration_incident_outbox.retry_command_applied"
          : "migration_incident_outbox.retry_command_rejected",
        status: command.outcome,
        commandId: command.commandId,
        incidentId: command.incidentId,
        ...(command.eventId ? { eventId: command.eventId } : {}),
        ...(command.expectedRetryCycle !== undefined
          ? { expectedRetryCycle: command.expectedRetryCycle }
          : {}),
        ...(command.retryCycle !== undefined ? { retryCycle: command.retryCycle } : {}),
        ...(command.failureCode ? { errorCode: command.failureCode } : {}),
      });
    }
    if (signal?.aborted) return { status: "aborted" };

    let claim: MigrationIncidentOutboxRecord | null;
    try {
      claim = await this.outbox.claimNext(this.publisherId, this.leaseDurationMs);
    } catch {
      safeLog(this.logger, { event: "migration_incident_outbox.claim_failed", status: "claim_failed" });
      return { status: "claim_failed" };
    }
    if (!claim) return signal?.aborted ? { status: "aborted" } : { status: "idle" };

    if (!validClaim(claim, this.publisherId, this.now())) {
      safeLog(this.logger, eventLog(claim, "migration_incident_outbox.lease_lost", "lease_lost"));
      return { status: "lease_lost", eventId: claim.id };
    }

    safeLog(this.logger, eventLog(claim, "migration_incident_outbox.claimed", "claimed"));
    if (signal?.aborted) return this.releaseAfterAbort(claim);

    const message: MigrationIncidentOpenedMessage = Object.freeze({
      eventId: claim.id,
      eventType: claim.eventType,
      organizationId: claim.organizationId,
      incidentId: claim.migrationIncidentId,
      migrationJobId: claim.migrationJobId,
      projectId: claim.projectId,
      environment: claim.environment,
      changeSetId: claim.changeSetId,
      incidentKind: claim.incidentKind,
      incidentSeverity: claim.incidentSeverity,
      incidentCreatedAt: claim.incidentCreatedAt,
    });

    let ack: MigrationIncidentOutboxAck;
    try {
      ack = await this.sink.publish(message, { signal });
    } catch (error) {
      return signal?.aborted
        ? this.releaseAfterAbort(claim)
        : this.releaseAfterFailure(
          claim,
          error instanceof MigrationIncidentOutboxSinkError ? error.failureCode : "PUBLISH_FAILED",
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
        claim, "migration_incident_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    safeLog(this.logger, eventLog(claim, "migration_incident_outbox.published", "published"));
    return { status: "published", eventId: claim.id };
  }

  private releaseAfterAbort(claim: MigrationIncidentOutboxRecord): Promise<MigrationIncidentOutboxPublisherResult> {
    return this.releaseAfterAbortClaim(claim);
  }

  private async releaseAfterFailure(
    claim: MigrationIncidentOutboxRecord,
    errorCode: MigrationIncidentDeliveryFailureCode,
  ): Promise<MigrationIncidentOutboxPublisherResult> {
    let updated: MigrationIncidentOutboxRecord;
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
        claim, "migration_incident_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    if (!validFailureTransition(claim, updated, errorCode)) {
      safeLog(this.logger, eventLog(
        claim, "migration_incident_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    if (updated.status === "dead_lettered") {
      safeLog(this.logger, eventLog(
        updated, "migration_incident_outbox.dead_lettered", "dead_lettered", errorCode,
      ));
      return { status: "dead_lettered", eventId: claim.id };
    }
    safeLog(this.logger, eventLog(
      updated, "migration_incident_outbox.retry_scheduled", "retry_scheduled", errorCode,
    ));
    return { status: "retry_scheduled", eventId: claim.id };
  }

  private async releaseAfterAbortClaim(
    claim: MigrationIncidentOutboxRecord,
  ): Promise<MigrationIncidentOutboxPublisherResult> {
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
        claim, "migration_incident_outbox.completion_deferred", "completion_deferred", "QUEUE_UPDATE_FAILED",
      ));
      return { status: "completion_deferred", eventId: claim.id };
    }
    safeLog(this.logger, eventLog(claim, "migration_incident_outbox.aborted", "aborted"));
    return { status: "aborted", eventId: claim.id };
  }

  private leaseLost(claim: MigrationIncidentOutboxRecord): MigrationIncidentOutboxPublisherResult {
    safeLog(this.logger, eventLog(claim, "migration_incident_outbox.lease_lost", "lease_lost"));
    return { status: "lease_lost", eventId: claim.id };
  }
}

function validClaim(claim: MigrationIncidentOutboxRecord, publisherId: string, now: Date): boolean {
  return claim.status === "pending" && claim.eventType === "migration.incident.opened" &&
    UUID.test(claim.id) && UUID.test(claim.organizationId) && UUID.test(claim.migrationIncidentId) &&
    UUID.test(claim.migrationJobId) && UUID.test(claim.projectId) && UUID.test(claim.changeSetId) &&
    ["development", "staging", "production"].includes(claim.environment) &&
    claim.incidentKind === "migration_outcome_unresolved" && claim.incidentSeverity === "critical" &&
    Number.isFinite(Date.parse(claim.incidentCreatedAt)) &&
    claim.leaseOwner === publisherId && typeof claim.leaseToken === "string" && UUID.test(claim.leaseToken) &&
    Number.isInteger(claim.attemptCount) && claim.attemptCount >= 1 &&
    Number.isInteger(claim.failureCount) && claim.failureCount >= 0 &&
    Number.isInteger(claim.maxFailures) && claim.maxFailures >= 1 && claim.maxFailures <= 100 &&
    claim.failureCount < claim.maxFailures && claim.attemptCount >= claim.failureCount &&
    ((claim.failureCount === 0 && claim.lastFailureCode === null) ||
      (claim.failureCount > 0 && isMigrationIncidentDeliveryFailureCode(claim.lastFailureCode))) &&
    claim.deadLetteredAt === null &&
    Number.isInteger(claim.retryCycleCount) && claim.retryCycleCount >= 0 &&
    Number.isInteger(claim.maxRetryCycles) && claim.maxRetryCycles >= 1 && claim.maxRetryCycles <= 10 &&
    claim.retryCycleCount <= claim.maxRetryCycles &&
    typeof claim.leaseExpiresAt === "string" && Number.isFinite(Date.parse(claim.leaseExpiresAt)) &&
    Date.parse(claim.leaseExpiresAt) > now.getTime();
}

function validFailureTransition(
  claim: MigrationIncidentOutboxRecord,
  updated: MigrationIncidentOutboxRecord,
  failureCode: MigrationIncidentDeliveryFailureCode,
): boolean {
  const shared = updated.id === claim.id && updated.organizationId === claim.organizationId &&
    updated.migrationIncidentId === claim.migrationIncidentId && updated.eventType === claim.eventType &&
    updated.migrationJobId === claim.migrationJobId && updated.projectId === claim.projectId &&
    updated.environment === claim.environment && updated.changeSetId === claim.changeSetId &&
    updated.incidentKind === claim.incidentKind && updated.incidentSeverity === claim.incidentSeverity &&
    updated.incidentCreatedAt === claim.incidentCreatedAt && updated.createdAt === claim.createdAt &&
    updated.failureCount === claim.failureCount + 1 && updated.maxFailures === claim.maxFailures &&
    updated.attemptCount === claim.attemptCount && updated.lastFailureCode === failureCode &&
    updated.retryCycleCount === claim.retryCycleCount && updated.maxRetryCycles === claim.maxRetryCycles &&
    updated.leaseOwner === null && updated.leaseToken === null && updated.leaseExpiresAt === null &&
    updated.publishedAt === null;
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
  claim: MigrationIncidentOutboxRecord,
  event: MigrationIncidentOutboxPublisherLogEvent["event"],
  status: string,
  errorCode?: MigrationIncidentOutboxPublisherLogEvent["errorCode"],
): MigrationIncidentOutboxPublisherLogEvent {
  return {
    event,
    status,
    organizationId: claim.organizationId,
    eventId: claim.id,
    incidentId: claim.migrationIncidentId,
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

function safeLog(
  logger: MigrationIncidentOutboxPublisherLogger,
  event: MigrationIncidentOutboxPublisherLogEvent,
): void {
  try {
    logger.log(event);
  } catch {
    // Observability must never control delivery or lease state.
  }
}
