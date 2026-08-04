import { describe, expect, it, vi } from "vitest";
import { MigrationLeaseLostError } from "@/lib/server/db/errors";
import type { MigrationOutboxDeliveryRetryProcessingResult, MigrationOutboxRecord } from "@/lib/server/db/models";
import {
  MigrationOutboxPublisher,
  MigrationOutboxSinkError,
  type MigrationApplyRequestedMessage,
  type MigrationOutboxAck,
  type MigrationOutboxLeasePort,
  type MigrationOutboxPublisherLogEvent,
  type MigrationOutboxSink,
} from "@/lib/server/migrations/outbox-publisher";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const EVENT_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const LEASE_TOKEN = "a742d2d4-d8fc-4353-918d-b5b1f3a3959d";
const NOW = new Date("2026-07-17T12:00:00.000Z");

function event(overrides: Partial<MigrationOutboxRecord> = {}): MigrationOutboxRecord {
  return {
    id: EVENT_ID,
    organizationId: ORGANIZATION_ID,
    migrationJobId: JOB_ID,
    eventType: "migration.apply.requested",
    status: "pending",
    attemptCount: 1,
    failureCount: 0,
    maxFailures: 8,
    lastFailureCode: null,
    deadLetteredAt: null,
    retryCycleCount: 0,
    maxRetryCycles: 3,
    availableAt: NOW.toISOString(),
    leaseOwner: "publisher-1",
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2026-07-17T12:01:00.000Z",
    publishedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

class FakeOutbox implements MigrationOutboxLeasePort {
  readonly calls: Array<{ operation: string; arguments: unknown[] }> = [];
  markError: unknown;
  releaseError: unknown;
  failureError: unknown;
  commandError: unknown;
  commands: MigrationOutboxDeliveryRetryProcessingResult[] = [];
  lastClaim: MigrationOutboxRecord | null = null;

  constructor(public claim: MigrationOutboxRecord | null) {}

  async processRetryCommands(...args: [string, number?]) {
    this.calls.push({ operation: "commands", arguments: args });
    if (this.commandError) throw this.commandError;
    return this.commands;
  }

  async claimNext(...args: [string, number?]): Promise<MigrationOutboxRecord | null> {
    this.calls.push({ operation: "claim", arguments: args });
    const claimed = this.claim;
    this.lastClaim = claimed;
    this.claim = null;
    return claimed;
  }

  async markPublished(...args: [string, string, string]): Promise<MigrationOutboxRecord> {
    this.calls.push({ operation: "mark", arguments: args });
    if (this.markError) throw this.markError;
    return event({ status: "published", publishedAt: NOW.toISOString(), leaseOwner: null, leaseToken: null });
  }

  async recordFailure(...args: [string, string, string, "PUBLISH_FAILED" | "INVALID_ACK" |
    "SIGNING_KEY_UNAVAILABLE" | "DELIVERY_TIMEOUT" | "DESTINATION_REJECTED", number?]) {
    this.calls.push({ operation: "failure", arguments: args });
    if (this.failureError) throw this.failureError;
    const failureCount = (this.lastClaim?.failureCount ?? 0) + 1;
    const deadLettered = failureCount >= (this.lastClaim?.maxFailures ?? 8);
    return event({
      ...(this.lastClaim ?? {}),
      status: deadLettered ? "dead_lettered" : "pending",
      failureCount,
      lastFailureCode: args[3],
      deadLetteredAt: deadLettered ? NOW.toISOString() : null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  }

  async releaseWithBackoff(...args: [string, string, string, number?]): Promise<MigrationOutboxRecord> {
    this.calls.push({ operation: "release", arguments: args });
    if (this.releaseError) throw this.releaseError;
    return event({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null });
  }
}

class FakeSink implements MigrationOutboxSink {
  readonly messages: MigrationApplyRequestedMessage[] = [];
  error: unknown;
  ack: MigrationOutboxAck = { status: "ack", eventId: EVENT_ID };

  async publish(message: MigrationApplyRequestedMessage): Promise<MigrationOutboxAck> {
    this.messages.push(message);
    if (this.error) throw this.error;
    return this.ack;
  }
}

function publisher(
  outbox: MigrationOutboxLeasePort,
  sink: MigrationOutboxSink,
  overrides: Partial<ConstructorParameters<typeof MigrationOutboxPublisher>[2]> = {},
) {
  return new MigrationOutboxPublisher(outbox, sink, {
    publisherId: "publisher-1",
    now: () => NOW,
    ...overrides,
  });
}

describe("MigrationOutboxPublisher", () => {
  it("marks an event published only after a matching sink acknowledgement and sends references only", async () => {
    const poisonedClaim = {
      ...event(),
      encryptedStatement: "SELECT secret FROM credentials",
      databaseUrl: "postgres://admin:super-secret@host/database",
    } as MigrationOutboxRecord;
    const outbox = new FakeOutbox(poisonedClaim);
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "published", eventId: EVENT_ID });

    expect(sink.messages).toEqual([{
      eventId: EVENT_ID,
      eventType: "migration.apply.requested",
      organizationId: ORGANIZATION_ID,
      migrationJobId: JOB_ID,
    }]);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "mark"]);
    expect(outbox.calls[2].arguments).toEqual([EVENT_ID, "publisher-1", LEASE_TOKEN]);
  });

  it("records a failed publish with capped exponential backoff and redacted fixed logs", async () => {
    const outbox = new FakeOutbox(event({ attemptCount: 20 }));
    const sink = new FakeSink();
    sink.error = new Error("postgres://admin:super-secret@host/database SELECT * FROM credentials");
    const logs: MigrationOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, sink, {
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 500,
      logger: { log: (entry) => logs.push(entry) },
    }).runOnce()).resolves.toEqual({ status: "retry_scheduled", eventId: EVENT_ID });

    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "failure"]);
    expect(outbox.calls[2].arguments).toEqual([EVENT_ID, "publisher-1", LEASE_TOKEN, "PUBLISH_FAILED", 500]);
    expect(JSON.stringify(logs)).not.toContain("super-secret");
    expect(logs.at(-1)).toMatchObject({
      event: "migration_outbox.retry_scheduled",
      status: "retry_scheduled",
      errorCode: "PUBLISH_FAILED",
    });
  });

  it("persists trusted sink classifications and dead-letters at the bounded failure threshold", async () => {
    const outbox = new FakeOutbox(event({
      failureCount: 7, maxFailures: 8, attemptCount: 8, lastFailureCode: "DELIVERY_TIMEOUT",
    }));
    const sink = new FakeSink();
    sink.error = new MigrationOutboxSinkError("SIGNING_KEY_UNAVAILABLE");
    const logs: MigrationOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, sink, {
      logger: { log: (entry) => logs.push(entry) },
    }).runOnce()).resolves.toEqual({ status: "dead_lettered", eventId: EVENT_ID });

    expect(outbox.calls.at(-1)).toMatchObject({
      operation: "failure",
      arguments: [EVENT_ID, "publisher-1", LEASE_TOKEN, "SIGNING_KEY_UNAVAILABLE", 60_000],
    });
    expect(logs.at(-1)).toMatchObject({
      event: "migration_outbox.dead_lettered",
      status: "dead_lettered",
      failureCount: 8,
      errorCode: "SIGNING_KEY_UNAVAILABLE",
    });
  });

  it("processes exact-generation recovery commands before the next claim with redacted logs", async () => {
    const outbox = new FakeOutbox(null);
    outbox.commands = [{
      commandId: "542fa056-4d26-4853-87f4-1b6c86b2e7f4",
      migrationJobId: JOB_ID,
      eventId: EVENT_ID,
      outcome: "applied",
      failureCode: "DELIVERY_TIMEOUT",
      expectedRetryCycle: 1,
      retryCycle: 2,
    }, {
      commandId: "79feb146-7773-471a-a67e-8d9ee71d46e6",
      migrationJobId: JOB_ID,
      outcome: "rejected",
      failureCode: "DESTINATION_REJECTED",
      expectedRetryCycle: 0,
    }];
    const logs: MigrationOutboxPublisherLogEvent[] = [];

    await expect(publisher(outbox, new FakeSink(), {
      logger: { log: (entry) => logs.push(entry) },
    }).runOnce()).resolves.toEqual({ status: "idle" });

    expect(logs).toEqual([
      expect.objectContaining({ event: "migration_outbox.retry_command_applied", retryCycle: 2 }),
      expect.objectContaining({ event: "migration_outbox.retry_command_rejected", expectedRetryCycle: 0 }),
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/requestedBy|reasonCode|secret|provider|response/i);
  });

  it("fails closed when recovery command processing is unavailable", async () => {
    const outbox = new FakeOutbox(event());
    outbox.commandError = new Error("database unavailable");
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "retry_command_failed" });
    expect(sink.messages).toHaveLength(0);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands"]);
  });

  it("does not mark or release through a stale lease after the sink acknowledged", async () => {
    const outbox = new FakeOutbox(event());
    outbox.markError = new MigrationLeaseLostError();
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });

    expect(sink.messages).toHaveLength(1);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "mark"]);
  });

  it("reports lease loss instead of retrying through a stale failure fence", async () => {
    const outbox = new FakeOutbox(event());
    outbox.failureError = new MigrationLeaseLostError();
    const sink = new FakeSink();
    sink.error = new Error("broker unavailable");

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "failure"]);
  });

  it("refuses an already expired or foreign claim before publishing", async () => {
    const outbox = new FakeOutbox(event({
      leaseOwner: "publisher-2",
      leaseExpiresAt: "2026-07-17T11:59:59.000Z",
    }));
    const sink = new FakeSink();

    await expect(publisher(outbox, sink).runOnce()).resolves.toEqual({ status: "lease_lost", eventId: EVENT_ID });
    expect(sink.messages).toHaveLength(0);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim"]);
  });

  it("releases a claim and stops cleanly when aborted before publication", async () => {
    let resolveClaim!: (claim: MigrationOutboxRecord) => void;
    const outbox: MigrationOutboxLeasePort = {
      processRetryCommands: vi.fn(async () => []),
      claimNext: vi.fn(() => new Promise<MigrationOutboxRecord>((resolve) => { resolveClaim = resolve; })),
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
    expect(outbox.releaseWithBackoff).toHaveBeenCalledWith(EVENT_ID, "publisher-1", LEASE_TOKEN, 1_000);
  });

  it("idles without publishing and exits its loop as soon as the idle wait is aborted", async () => {
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
    const running = publisher(outbox, sink, { delay, probe }).run(controller.signal);

    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    controller.abort();

    await expect(running).resolves.toBeUndefined();
    expect(sink.messages).toHaveLength(0);
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim"]);
    expect(probe.runtimeStarted).toHaveBeenCalledOnce();
    expect(probe.iterationSucceeded).toHaveBeenCalledOnce();
    expect(probe.iterationFailed).not.toHaveBeenCalled();
    expect(probe.runtimeStopped).toHaveBeenCalledOnce();
  });

  it("joins concurrent runOnce calls instead of processing events in parallel", async () => {
    let acknowledge!: (ack: MigrationOutboxAck) => void;
    const outbox = new FakeOutbox(event());
    const sink: MigrationOutboxSink = {
      publish: vi.fn(() => new Promise<MigrationOutboxAck>((resolve) => { acknowledge = resolve; })),
    };
    const instance = publisher(outbox, sink);

    const first = instance.runOnce();
    const second = instance.runOnce();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(sink.publish).toHaveBeenCalledOnce());
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim"]);
    acknowledge({ status: "ack", eventId: EVENT_ID });

    await expect(first).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    await expect(second).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    expect(outbox.calls.filter((call) => call.operation === "claim")).toHaveLength(1);
  });

  it("does not let an observability failure control publication or lease completion", async () => {
    const outbox = new FakeOutbox(event());
    const sink = new FakeSink();
    const instance = publisher(outbox, sink, {
      logger: { log: () => { throw new Error("logger unavailable"); } },
    });

    await expect(instance.runOnce()).resolves.toEqual({ status: "published", eventId: EVENT_ID });
    expect(outbox.calls.map((call) => call.operation)).toEqual(["commands", "claim", "mark"]);
  });
});
