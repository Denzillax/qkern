import { recognisedByName } from "@/lib/server/errors/identity";
import { createHash, randomBytes } from "node:crypto";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";

export type WebhookOutboxScope = {
  organizationId: string;
  projectId: string;
  environment: "development" | "staging" | "production";
};

export type WebhookOutboxEntry = WebhookOutboxScope & {
  id: string;
  webhookId: string;
  eventType: string;
  payload: ProjectQueueJson;
  occurredAt: Date;
  attemptCount: number;
};

export type WebhookClaim = WebhookOutboxEntry & { leaseToken: string };

export type WebhookFailureCode =
  | "WEBHOOK_INVALID" | "WEBHOOK_TIMEOUT" | "WEBHOOK_REJECTED" | "WEBHOOK_SIGNING_FAILED";

export class WebhookOutboxError extends Error {
  constructor(readonly code: "WEBHOOK_OUTBOX_INVALID_INPUT" | "WEBHOOK_OUTBOX_LEASE_LOST"
    | "WEBHOOK_OUTBOX_CONFLICT", options?: { cause?: unknown }) {
    super(code, options);
    this.name = "WebhookOutboxError";
  }
}
recognisedByName(WebhookOutboxError, "WebhookOutboxError");

export interface WebhookOutboxRepository {
  enqueue(scope: WebhookOutboxScope, input: {
    id: string; webhookId: string; eventType: string; payload: ProjectQueueJson;
    occurredAt: Date; createdAt: Date;
  }): Promise<WebhookOutboxEntry>;
  claim(scope: WebhookOutboxScope, input: {
    workerId: string; limit: number; now: Date; visibilityMs: number;
    leases: ReadonlyArray<{ token: string; tokenHash: string }>;
  }): Promise<WebhookClaim[]>;
  settle(scope: WebhookOutboxScope, input: {
    deliveryId: string; workerId: string; tokenHash: string; now: Date;
    outcome: { status: "delivered" } | {
      status: "retry"; availableAt: Date; failureCode: WebhookFailureCode;
    } | { status: "dead_lettered"; failureCode: WebhookFailureCode };
  }): Promise<{ status: "delivered" | "retry" | "dead_lettered" }>;
  maxAttempts(scope: WebhookOutboxScope, webhookId: string): Promise<number | null>;
}

export type WebhookOutboxOptions = {
  repository: WebhookOutboxRepository;
  now?: () => Date;
  id?: () => string;
  leaseToken?: () => string;
  visibilityMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
};

const EVENT_TYPE = /^[a-z][a-z0-9._-]{0,63}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Warteschlange für Webhook-Zustellversuche.
 *
 * Folgt bewusst demselben Muster wie Project Queues: atomarer Claim,
 * workergebundene Lease, **serverberechnetes** Backoff und Dead Letter nach
 * einer festen Versuchsgrenze. Dieses Muster ist seit Release 1.17 über sechs
 * konkurrierende Instanzen zertifiziert; ein eigenes zu erfinden wäre die
 * schlechtere Wahl.
 *
 * Die Wartezeit bis zum nächsten Versuch berechnet der Server, nicht der
 * Zusteller. Ein Zusteller, der sie mitschickt, könnte sie auf null setzen und
 * einen langsamen Empfänger mit Wiederholungen überziehen.
 */
export class WebhookOutbox {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly leaseToken: () => string;
  private readonly visibilityMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(private readonly options: WebhookOutboxOptions) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => crypto.randomUUID());
    this.leaseToken = options.leaseToken ?? (() => randomBytes(32).toString("base64url"));
    this.visibilityMs = bounded(options.visibilityMs ?? 30_000, 1_000, 900_000);
    this.retryBaseMs = bounded(options.retryBaseMs ?? 5_000, 100, 300_000);
    this.retryMaxMs = bounded(options.retryMaxMs ?? 300_000, this.retryBaseMs, 3_600_000);
  }

  async enqueue(scope: WebhookOutboxScope, input: {
    webhookId: string; eventType: string; payload: ProjectQueueJson; occurredAt?: Date;
  }): Promise<WebhookOutboxEntry> {
    if (!EVENT_TYPE.test(input.eventType)) {
      throw new WebhookOutboxError("WEBHOOK_OUTBOX_INVALID_INPUT");
    }
    const now = this.now();
    return await this.options.repository.enqueue(scope, {
      id: this.id(),
      webhookId: input.webhookId,
      eventType: input.eventType,
      payload: input.payload,
      occurredAt: input.occurredAt ?? now,
      createdAt: now,
    });
  }

  async claim(scope: WebhookOutboxScope, input: {
    workerId: string; limit?: number;
  }): Promise<WebhookClaim[]> {
    const workerId = input.workerId.trim();
    const limit = bounded(input.limit ?? 1, 1, 10);
    if (!WORKER_ID.test(workerId)) throw new WebhookOutboxError("WEBHOOK_OUTBOX_INVALID_INPUT");
    const leases = Array.from({ length: limit }, () => {
      const token = this.leaseToken();
      return { token, tokenHash: hash(token) };
    });
    return await this.options.repository.claim(scope, {
      workerId, limit, now: this.now(), visibilityMs: this.visibilityMs, leases,
    });
  }

  /** Bestätigt eine erfolgreiche Zustellung. */
  async acknowledge(scope: WebhookOutboxScope, deliveryId: string, input: {
    workerId: string; leaseToken: string;
  }) {
    return await this.options.repository.settle(scope, {
      deliveryId, workerId: input.workerId.trim(), tokenHash: hash(input.leaseToken),
      now: this.now(), outcome: { status: "delivered" },
    });
  }

  /**
   * Meldet einen fehlgeschlagenen Versuch. Der Server entscheidet, ob ein
   * weiterer folgt und wann.
   *
   * Die Versuchsgrenze kommt aus der Definition, nicht vom Zusteller: Ein
   * Zusteller, der sie mitschickt, koennte sie beliebig hochsetzen und einen
   * dauerhaft fehlschlagenden Empfaenger endlos wiederholen.
   */
  async fail(scope: WebhookOutboxScope, deliveryId: string, input: {
    webhookId: string; workerId: string; leaseToken: string;
    failureCode: WebhookFailureCode; attemptCount: number;
  }) {
    const maxAttempts = await this.options.repository.maxAttempts(scope, input.webhookId);
    if (maxAttempts === null) throw new WebhookOutboxError("WEBHOOK_OUTBOX_CONFLICT");

    const now = this.now();
    const attempts = input.attemptCount;
    const settled = attempts >= maxAttempts
      ? { status: "dead_lettered" as const, failureCode: input.failureCode }
      : {
        status: "retry" as const,
        failureCode: input.failureCode,
        availableAt: new Date(now.getTime() + this.backoffMs(attempts)),
      };
    return await this.options.repository.settle(scope, {
      deliveryId, workerId: input.workerId.trim(), tokenHash: hash(input.leaseToken), now,
      outcome: settled,
    });
  }

  /** Exponentiell mit fester Obergrenze; die Grenze verhindert Wartezeiten von Stunden. */
  backoffMs(attempt: number): number {
    const factor = 2 ** Math.max(0, attempt - 1);
    return Math.min(this.retryMaxMs, this.retryBaseMs * factor);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WebhookOutboxError("WEBHOOK_OUTBOX_INVALID_INPUT");
  }
  return value;
}
