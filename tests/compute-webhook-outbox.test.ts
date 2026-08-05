import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WebhookOutbox,
  WebhookOutboxError,
  type WebhookOutboxRepository,
  type WebhookOutboxScope,
} from "@/lib/server/compute/webhook-outbox";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "db/migrations/0032_project_webhooks.sql"), "utf8",
);

const scope: WebhookOutboxScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

type Settlement = Parameters<WebhookOutboxRepository["settle"]>[1];

function repository(maxAttempts: number | null = 5) {
  const enqueued: unknown[] = [];
  const settlements: Settlement[] = [];
  const implementation: WebhookOutboxRepository = {
    async enqueue(_scope, input) {
      enqueued.push(input);
      return { ...scope, ...input, attemptCount: 0 };
    },
    async claim(_scope, input) {
      return input.leases.slice(0, 1).map((lease) => ({
        ...scope, id: "delivery-1", webhookId: "hook-1", eventType: "order.created",
        payload: { ok: true }, occurredAt: new Date("2026-08-04T12:00:00.000Z"),
        attemptCount: 0, leaseToken: lease.token,
      }));
    },
    async settle(_scope, input) {
      settlements.push(input);
      return { status: input.outcome.status };
    },
    async maxAttempts() { return maxAttempts; },
  };
  return { enqueued, settlements, repository: implementation };
}

function outbox(store = repository(), overrides = {}) {
  return new WebhookOutbox({
    repository: store.repository,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    id: () => "delivery-1",
    leaseToken: () => "a".repeat(43),
    ...overrides,
  });
}

describe("webhook migration", () => {
  it("stores only a secret reference, never the secret", () => {
    expect(migration).toContain("signing_secret_ref text NOT NULL");
    expect(migration).not.toMatch(/signing_secret\s+text|secret_value|secret_key/);
  });

  it("keeps the payload of a delivery immutable", () => {
    // Sonst koennte ein Wiederholungsversuch etwas anderes senden als der
    // erste, und die Signatur des Empfaengers wuerde eine andere Nachricht
    // bestaetigen als die ausgeloeste.
    expect(migration).toContain("webhook delivery content is immutable");
    expect(migration).toContain("webhook attempts must not move backwards");
    expect(migration).toContain("a settled webhook delivery is final");
  });

  it("grants the lock privilege that SELECT ... FOR UPDATE needs", () => {
    // Die Lehre aus Release 1.9, hier vorbeugend angewandt: eine Sperrklausel
    // verlangt zusaetzlich UPDATE-Recht und eine UPDATE-Policy.
    expect(migration).toContain("GRANT UPDATE (enabled) ON project_webhooks");
    expect(migration).toContain("project_webhooks_lock ON project_webhooks");
  });

  it("never lets the runtime change the payload through a column grant", () => {
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*payload[^)]*\) ON project_webhook_deliveries/);
  });

  it("isolates tenants on every access path", () => {
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(migration).toContain(`project_webhook_deliveries_${action} ON project_webhook_deliveries`);
    }
  });
});

describe("WebhookOutbox", () => {
  it("enqueues a delivery with a server-assigned identity and time", async () => {
    const store = repository();
    await outbox(store).enqueue(scope, {
      webhookId: "hook-1", eventType: "order.created", payload: { id: 7 },
    });
    expect(store.enqueued[0]).toMatchObject({
      id: "delivery-1", eventType: "order.created",
      occurredAt: new Date("2026-08-04T12:00:00.000Z"),
    });
  });

  it("refuses an implausible event type", async () => {
    await expect(outbox().enqueue(scope, {
      webhookId: "hook-1", eventType: "Order Created!", payload: {},
    })).rejects.toBeInstanceOf(WebhookOutboxError);
  });

  it("hands out a lease token that is never stored raw", async () => {
    const store = repository();
    const claims = await outbox(store).claim(scope, { workerId: "worker-1" });
    expect(claims[0]?.leaseToken).toBe("a".repeat(43));

    await outbox(store).acknowledge(scope, "delivery-1", {
      workerId: "worker-1", leaseToken: claims[0].leaseToken,
    });
    // Nur der Verifier erreicht das Repository.
    expect(store.settlements[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.settlements[0])).not.toContain("a".repeat(43));
  });

  it("refuses a claim batch beyond the allowed size", async () => {
    await expect(outbox().claim(scope, { workerId: "worker-1", limit: 50 }))
      .rejects.toBeInstanceOf(WebhookOutboxError);
  });

  it("computes the retry delay on the server, growing with each attempt", async () => {
    const store = repository();
    const service = outbox(store, { retryBaseMs: 1_000, retryMaxMs: 60_000 });

    await service.fail(scope, "delivery-1", {
      webhookId: "hook-1", workerId: "worker-1", leaseToken: "a".repeat(43),
      failureCode: "WEBHOOK_TIMEOUT", attemptCount: 1,
    });
    await service.fail(scope, "delivery-1", {
      webhookId: "hook-1", workerId: "worker-1", leaseToken: "a".repeat(43),
      failureCode: "WEBHOOK_TIMEOUT", attemptCount: 3,
    });

    const [first, second] = store.settlements;
    expect(first.outcome.status).toBe("retry");
    expect(second.outcome.status).toBe("retry");
    if (first.outcome.status !== "retry" || second.outcome.status !== "retry") return;
    expect(second.outcome.availableAt.getTime())
      .toBeGreaterThan(first.outcome.availableAt.getTime());
  });

  it("caps the retry delay so a receiver is not abandoned for hours", () => {
    const service = outbox(repository(), { retryBaseMs: 1_000, retryMaxMs: 10_000 });
    expect(service.backoffMs(20)).toBe(10_000);
  });

  it("dead-letters once the attempt limit of the definition is reached", async () => {
    // Die Grenze kommt aus der Definition, nicht vom Zusteller: sonst koennte
    // er sie hochsetzen und einen dauerhaft fehlschlagenden Empfaenger endlos
    // wiederholen.
    const store = repository(3);
    await outbox(store).fail(scope, "delivery-1", {
      webhookId: "hook-1", workerId: "worker-1", leaseToken: "a".repeat(43),
      failureCode: "WEBHOOK_REJECTED", attemptCount: 3,
    });
    expect(store.settlements[0].outcome.status).toBe("dead_lettered");
  });

  it("refuses to settle against an unknown webhook definition", async () => {
    const store = repository(null);
    await expect(outbox(store).fail(scope, "delivery-1", {
      webhookId: "gone", workerId: "worker-1", leaseToken: "a".repeat(43),
      failureCode: "WEBHOOK_REJECTED", attemptCount: 1,
    })).rejects.toBeInstanceOf(WebhookOutboxError);
    expect(store.settlements).toHaveLength(0);
  });
});
