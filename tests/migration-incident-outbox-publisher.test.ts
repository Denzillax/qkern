import { describe, expect, it, vi } from "vitest";
import { MigrationLeaseLostError } from "@/lib/server/db/errors";
import type {
  MigrationIncidentDeliveryFailureCode,
  MigrationIncidentDeliveryRetryProcessingResult,
  MigrationIncidentOutboxRecord,
} from "@/lib/server/db/models";
import {
  MigrationIncidentOutboxPublisher,
  MigrationIncidentOutboxSinkError,
  type MigrationIncidentOpenedMessage,
  type MigrationIncidentOutboxAck,
  type MigrationIncidentOutboxLeasePort,
  type MigrationIncidentOutboxPublisherLogEvent,
  type MigrationIncidentOutboxSink,
} from "@/lib/server/migrations/incident-outbox-publisher";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const INCIDENT_ID = "46e84eba-2e7a-42e6-a010-0fbf0c3de6ce";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const CHANGE_SET_ID = "9a973ec8-a409-4706-ad1d-ef6360ea430d";
const EVENT_ID = "d594a341-2637-42ca-804a-ab98537734b6";
const LEASE_TOKEN = "a742d2d4-d8fc-4353-918d-b5b1f3a3959d";
const NOW = new Date("2026-07-19T12:00:00.000Z");

function event(overrides: Partial<MigrationIncidentOutboxRecord> = {}): MigrationIncidentOutboxRecord {
  return {
    id: EVENT_ID,
    organizationId: ORGANIZATION_ID,
    migrationIncidentId: INCIDENT_ID,
    eventType: "migration.incident.opened",
    status: "pending",
    attemptCount: 1,
    failureCount: 0,
    maxFailures: 8,
    lastFailureCode: null,
    deadLetteredAt: null,
    retryCycleCount: 0,
    maxRetryCycles: 3,
    availableAt: NOW.toISOString(),
    leaseOwner: "incident-publisher-1",
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2026-07-19T12:01:00.000Z",
    publishedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    migrationJobId: JOB_ID,
    projectId: PROJECT_ID,
    environment: "production",
    changeSetId: CHANGE_SET_ID,
    incidentKind: "migration_outcome_unresolved",
    incidentSeverity: "critical",
    incidentCreatedAt: "2026-07-19T11:59:00.000Z",
    ...overrides,
  };
}

class FakeOutbox implements MigrationIncidentOutboxLeasePort {
  readonly calls: Array<{ operation: string; arguments: unknown[] }> = [];
  commands: MigrationIncidentDeliveryRetryProcessingResult[] = [];
  commandError: unknown;
  markError: unknown;
  releaseError: unknown;
  failureError: unknown;
  private lastClaim: MigrationIncidentOutboxRecord | null = null;

  constructor(public claim: MigrationIncidentOutboxRecord | null) {}

  async processRetryCommands(...args: [string, number?]): Promise<MigrationIncidentDeliveryRetryProcessingResult[]> {
    this.calls.push({ operation: "commands", arguments: args });
    if (this.commandError) throw this.commandError;
    return this.commands;
  }

  async claimNext(...args: [string, number?]): Promise<MigrationIncidentOutboxRecord | null> {
    this.calls.push({ operation: "claim", arguments: args });
    const claimed = this.claim;
    this.lastClaim = claimed;
    this.claim = null;
    return claimed;
  }

  async recordFailure(...args: [string, string, string, MigrationIncidentDeliveryFailureCode, number?]): Promise<MigrationIncidentOutboxRecord> {
    this.calls.push({ operation: "failure", arguments: args });
    if (this.failureError) throw this.failureError;
    const claimed = this.lastClaim ?? event();
    const failureCount = claimed.failureCount + 1;
    const deadLettered = failureCount >= claimed.maxFailures;
    return event({
      ...claimed,
      status: deadLettered ? "dead_lettered" : "pending",
      failureCount,
      lastFailureCode: args[3],
      deadLetteredAt: deadLettered ? NOW.toISOString() : null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  }

  async markPublished(...args: [string, string, string]): Promise<MigrationIncidentOutboxRecord> {
    this.calls.push({ operation: "mark", arguments: args });
    if (this.markError) throw this.markError;
    return event({
      status: "published", publishedAt: NOW.toISOString(),
      leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    });
  }

  async releaseWithBackoff(...args: [string, string, string, number?]): Promise<MigrationIncidentOutboxRecord> {
    this.calls.push({ operation: "release", arguments: args });
    if (this.releaseError) throw this.releaseError;
    return event({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null });
  }
}

class FakeSink implements MigrationIncidentOutboxSink {
  readonly messages: MigrationIncidentOpenedMessage[] = [];
  error: unknown;
  ack: MigrationIncidentOutboxAck = { status: "ack", eventId: EVENT_ID };

  async publish(message: MigrationIncidentOpenedMessage): Promise<MigrationIncidentOutboxAck> {
    this.messages.push(message);
    if (this.error) throw this.error;
    return this.ack;
  }
}

function publisher(
  outbox: MigrationIncidentOutboxLeasePort,
  sink: MigrationIncidentOutboxSink,
  overrides: Partial<ConstructorParameters<typeof MigrationIncidentOutboxPublisher>[2]> = {},
) {
  return new MigrationIncidentOutboxPublisher(outbox, sink, {
    publisherId: "incident-publisher-1",
    now: () => NOW,
    ...overrides,
  });
}

describe("MigrationIncidentOutboxPublisher", () => {
  it("publishes only the fixed reference contract and completes after an exact acknowledgement", async () => {
    const poisoned = {
      ...event(),
      encryptedStatement: "SELECT secret FROM credentials",
      databaseUrl: "postgres://admin:super-secret@target/database",
      acknowledgedBy: "secret-operator@example.com",
      rawError: "internal target diagnostic",
    } as MigrationIncidentOutboxRecord;
    const outbox = new FakeOutbox(poisoned);
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    expect(sink.messages).toEqual([{
      eventId: EVENT_ID,
      eventType: "migration.incident.opened",
      organizationId: ORGANIZATION_ID,
      incidentId: INCIDENT_ID,
      migrationJobId: JOB_ID,
      projectId: PROJECT_ID,
      environment: "production",
      changeSetId: CHANGE_SET_ID,
      incidentKind: "migration_outcome_unresolved",
      incidentSeverity: "critical",
      incidentCreatedAt: "2026-07-19T11:59:00.000Z",
    }]);
    expect(JSON.stringify(sink.messages)).not.toContain("super-secret");
    expect(JSON.stringify(sink.messages)).not.toContain("acknowledgedBy");
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "mark"]);
    expect(outbox.calls[2].arguments).toEqual([EVENT_ID, "incident-publisher-1", LEASE_TOKEN]);
  });

  it("releases failed delivery with capped backoff and fixed redacted logs", async () => {
    const outbox = new FakeOutbox(event({ attemptCount: 20 }));
    const sink = new FakeSink();
    sink.error = new Error("postgres://admin:super-secret@target/database");
    const logs: MigrationIncidentOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, sink, {
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 500,
      logger: { log: (entry) => logs.push(entry) },
    }).runOnce()).resolves.toEqual({ status: "retry_scheduled", eventId: EVENT_ID });

    expect(outbox.calls[2].arguments).toEqual([
      EVENT_ID, "incident-publisher-1", LEASE_TOKEN, "PUBLISH_FAILED", 500,
    ]);
    expect(JSON.stringify(logs)).not.toContain("super-secret");
    expect(logs.at(-1)).toMatchObject({
      event: "migration_incident_outbox.retry_scheduled",
      errorCode: "PUBLISH_FAILED",
    });
  });

  it.each<MigrationIncidentDeliveryFailureCode>([
    "SIGNING_KEY_UNAVAILABLE",
    "DELIVERY_TIMEOUT",
    "DESTINATION_REJECTED",
    "INVALID_ACK",
  ])("persists trusted redacted sink classification %s without diagnostics", async (failureCode) => {
    const canary = "vault-or-provider-diagnostic-canary";
    const outbox = new FakeOutbox(event());
    const sink = new FakeSink();
    sink.error = new MigrationIncidentOutboxSinkError(failureCode, canary);
    const logs: MigrationIncidentOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, sink, { logger: { log: (entry) => logs.push(entry) } }).runOnce())
      .resolves.toEqual({ status: "retry_scheduled", eventId: EVENT_ID });
    expect(outbox.calls[2].arguments[3]).toBe(failureCode);
    expect(logs.at(-1)).toMatchObject({ errorCode: failureCode });
    expect(JSON.stringify(logs)).not.toContain(canary);
  });

  it("downgrades a runtime-forged sink classification to the generic safe code", async () => {
    const canary = "FORGED_SECRET_CLASSIFICATION";
    const outbox = new FakeOutbox(event());
    const sink = new FakeSink();
    sink.error = new MigrationIncidentOutboxSinkError(
      canary as MigrationIncidentDeliveryFailureCode,
      "provider secret diagnostic",
    );
    const logs: MigrationIncidentOutboxPublisherLogEvent[] = [];

    await publisher(outbox, sink, { logger: { log: (entry) => logs.push(entry) } }).runOnce();
    expect(outbox.calls[2].arguments[3]).toBe("PUBLISH_FAILED");
    expect(JSON.stringify(logs)).not.toContain(canary);
  });

  it("treats a mismatched acknowledgement as retryable and never marks published", async () => {
    const outbox = new FakeOutbox(event());
    const sink = new FakeSink();
    sink.ack = { status: "ack", eventId: "wrong-event" };

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "retry_scheduled", eventId: EVENT_ID });
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "failure"]);
  });

  it("refuses malformed, foreign or expired claims before sending", async () => {
    const outbox = new FakeOutbox(event({
      migrationIncidentId: "not-a-uuid",
      leaseOwner: "different-publisher",
      leaseExpiresAt: "2026-07-19T11:59:59.000Z",
    }));
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });
    expect(sink.messages).toHaveLength(0);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim"]);
  });

  it("never completes through a stale mark or release fence", async () => {
    const marked = new FakeOutbox(event());
    marked.markError = new MigrationLeaseLostError();
    await expect(publisher(marked, new FakeSink()).runOnce())
      .resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });

    const released = new FakeOutbox(event());
    released.failureError = new MigrationLeaseLostError();
    const sink = new FakeSink();
    sink.error = new Error("sink unavailable");
    await expect(publisher(released, sink).runOnce())
      .resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });
  });

  it("releases a claim and stops when aborted before publication", async () => {
    let resolveClaim!: (claim: MigrationIncidentOutboxRecord) => void;
    const outbox: MigrationIncidentOutboxLeasePort = {
      processRetryCommands: vi.fn().mockResolvedValue([]),
      claimNext: vi.fn(() => new Promise<MigrationIncidentOutboxRecord>((resolve) => { resolveClaim = resolve; })),
      markPublished: vi.fn(),
      recordFailure: vi.fn(),
      releaseWithBackoff: vi.fn(async () => event({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null })),
    };
    const sink = new FakeSink();
    const controller = new AbortController();
    const running = publisher(outbox, sink).runOnce(controller.signal);

    await vi.waitFor(() => expect(outbox.claimNext).toHaveBeenCalledOnce());
    controller.abort();
    resolveClaim(event());

    await expect(running).resolves.toEqual({ status: "aborted", eventId: EVENT_ID });
    expect(sink.messages).toHaveLength(0);
    expect(outbox.releaseWithBackoff).toHaveBeenCalledWith(
      EVENT_ID, "incident-publisher-1", LEASE_TOKEN, 1_000,
    );
  });

  it("joins concurrent runOnce calls and never publishes in parallel", async () => {
    let acknowledge!: (ack: MigrationIncidentOutboxAck) => void;
    const outbox = new FakeOutbox(event());
    const sink: MigrationIncidentOutboxSink = {
      publish: vi.fn(() => new Promise<MigrationIncidentOutboxAck>((resolve) => { acknowledge = resolve; })),
    };
    const instance = publisher(outbox, sink);

    const first = instance.runOnce();
    const second = instance.runOnce();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(sink.publish).toHaveBeenCalledOnce());
    acknowledge({ status: "ack", eventId: EVENT_ID });

    await expect(first).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    await expect(second).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    expect(outbox.calls.filter((call) => call.operation === "claim")).toHaveLength(1);
  });

  it("dead-letters the event after the bounded consecutive failure count", async () => {
    const outbox = new FakeOutbox(event({ attemptCount: 8, failureCount: 7, maxFailures: 8, lastFailureCode: "PUBLISH_FAILED" }));
    const sink = new FakeSink();
    sink.error = new Error("provider unavailable");
    const logs: MigrationIncidentOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, sink, { logger: { log: (entry) => logs.push(entry) } }).runOnce())
      .resolves.toEqual({ status: "dead_lettered", eventId: EVENT_ID });
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "failure"]);
    expect(logs.at(-1)).toMatchObject({
      event: "migration_incident_outbox.dead_lettered",
      status: "dead_lettered",
      failureCount: 8,
      errorCode: "PUBLISH_FAILED",
    });
  });

  it("processes bounded retry commands before claiming and emits reference-only telemetry", async () => {
    const outbox = new FakeOutbox(null);
    outbox.commands = [{
      commandId: "f1d111a2-18d8-46fb-88b3-544409a71ae7",
      incidentId: INCIDENT_ID,
      eventId: EVENT_ID,
      outcome: "applied",
      expectedRetryCycle: 0,
      retryCycle: 1,
      failureCode: "DELIVERY_TIMEOUT",
    }, {
      commandId: "62051aa9-acb1-490d-a0bb-cd0029b87c51",
      incidentId: INCIDENT_ID,
      outcome: "rejected",
    }];
    const logs: MigrationIncidentOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, new FakeSink(), { logger: { log: (entry) => logs.push(entry) } }).runOnce())
      .resolves.toEqual({ status: "idle" });
    expect(logs).toEqual([
      expect.objectContaining({
        event: "migration_incident_outbox.retry_command_applied",
        expectedRetryCycle: 0,
        retryCycle: 1,
        errorCode: "DELIVERY_TIMEOUT",
      }),
      expect.objectContaining({ event: "migration_incident_outbox.retry_command_rejected", status: "rejected" }),
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/requestedBy|reasonCode|credential/i);
  });

  it("does not claim when retry-command processing fails", async () => {
    const outbox = new FakeOutbox(event());
    outbox.commandError = new Error("database diagnostics");
    await expect(publisher(outbox, new FakeSink()).runOnce()).resolves.toEqual({ status: "retry_command_failed" });
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands"]);
  });

  it("idles until abort and isolates logger failures", async () => {
    const outbox = new FakeOutbox(null);
    const sink = new FakeSink();
    const controller = new AbortController();
    const probe = {
      runtimeStarted: vi.fn(),
      iterationSucceeded: vi.fn(),
      iterationFailed: vi.fn(),
      runtimeStopped: vi.fn(),
    };
    const delay = vi.fn((_milliseconds: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const running = publisher(outbox, sink, {
      delay,
      logger: { log: () => { throw new Error("logger unavailable"); } },
      probe,
    }).run(controller.signal);

    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    controller.abort();

    await expect(running).resolves.toBeUndefined();
    expect(sink.messages).toHaveLength(0);
    expect(probe.runtimeStarted).toHaveBeenCalledOnce();
    expect(probe.iterationSucceeded).toHaveBeenCalledOnce();
    expect(probe.iterationFailed).not.toHaveBeenCalled();
    expect(probe.runtimeStopped).toHaveBeenCalledOnce();
  });
});
