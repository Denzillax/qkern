import { describe, expect, it, vi } from "vitest";
import type { WebhookDefinition } from "@/lib/server/compute/model";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookDeliveryError } from "@/lib/server/compute/webhooks";
import {
  WebhookOutboxError,
  type WebhookClaim,
  type WebhookOutboxScope,
} from "@/lib/server/compute/webhook-outbox";

const scope: WebhookOutboxScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

const definition: WebhookDefinition = Object.freeze({
  ...scope,
  id: "hook-1",
  name: "order-events",
  url: "https://receiver.example.com/hooks",
  eventTypes: Object.freeze(["order.created"]),
  signingSecretRef: "vault:webhook/test",
  timeoutMs: 5_000,
});

function claim(overrides: Partial<WebhookClaim> = {}): WebhookClaim {
  return {
    ...scope,
    id: "delivery-1",
    webhookId: "hook-1",
    eventType: "order.created",
    payload: { id: 7 },
    occurredAt: new Date("2026-08-05T10:00:00.000Z"),
    attemptCount: 1,
    leaseToken: "a".repeat(43),
    ...overrides,
  };
}

type Settlement = { kind: "acknowledge" | "fail"; deliveryId: string; code?: string };

function harness(options: {
  claims?: WebhookClaim[][];
  deliver?: (definition: WebhookDefinition, delivery: unknown) => Promise<unknown>;
  find?: () => Promise<WebhookDefinition | null>;
  claimFails?: boolean;
  failThrows?: unknown;
} = {}) {
  const batches = options.claims ?? [[claim()]];
  const settlements: Settlement[] = [];
  const delivered: unknown[] = [];
  let round = 0;

  const outbox = {
    async claim() {
      if (options.claimFails) throw new Error("database unreachable");
      return batches[round++] ?? [];
    },
    async acknowledge(_scope: WebhookOutboxScope, deliveryId: string) {
      settlements.push({ kind: "acknowledge", deliveryId });
      return { status: "delivered" as const };
    },
    async fail(_scope: WebhookOutboxScope, deliveryId: string, input: { failureCode: string }) {
      if (options.failThrows) throw options.failThrows;
      settlements.push({ kind: "fail", deliveryId, code: input.failureCode });
      return { status: "retry" as const };
    },
  };

  const runtime = new WebhookDeliveryRuntime({
    outbox: outbox as never,
    deliverer: {
      async deliver(target: WebhookDefinition, delivery: unknown) {
        delivered.push(delivery);
        if (options.deliver) await options.deliver(target, delivery);
        return Object.freeze({ status: "delivered" as const, deliveryId: "delivery-1" });
      },
    } as never,
    definitions: { find: options.find ?? (async () => definition) },
    scope,
    workerId: "webhook-worker-1",
    idleIntervalMs: 50,
    errorIntervalMs: 100,
    sleep: async () => undefined,
  });

  return { runtime, settlements, delivered };
}

describe("WebhookDeliveryRuntime", () => {
  it("delivers a claimed entry and acknowledges it against its own lease", async () => {
    // Bis Release 1.19 gab es Outbox und Zusteller, aber nichts verband sie:
    // ein hinterlegtes Ereignis wurde nie gesendet.
    const { runtime, settlements, delivered } = harness();
    const result = await runtime.runOnce();

    expect(result).toEqual({ delivered: 1, failed: 0, skipped: 0 });
    expect(delivered[0]).toMatchObject({
      id: "delivery-1", eventType: "order.created",
      occurredAt: "2026-08-05T10:00:00.000Z",
    });
    expect(settlements).toEqual([{ kind: "acknowledge", deliveryId: "delivery-1" }]);
  });

  it("reports the failure code of the deliverer, not a generic one", async () => {
    const { runtime, settlements } = harness({
      deliver: async () => { throw new WebhookDeliveryError("WEBHOOK_TIMEOUT"); },
    });
    const result = await runtime.runOnce();

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(settlements).toEqual([
      { kind: "fail", deliveryId: "delivery-1", code: "WEBHOOK_TIMEOUT" },
    ]);
  });

  it("treats an unexpected throw as a rejected delivery rather than losing it", async () => {
    const { runtime, settlements } = harness({
      deliver: async () => { throw new TypeError("fetch is not a function"); },
    });
    await runtime.runOnce();
    expect(settlements).toEqual([
      { kind: "fail", deliveryId: "delivery-1", code: "WEBHOOK_REJECTED" },
    ]);
  });

  it("keeps working on the rest of the batch after one delivery fails", async () => {
    // Die uebrigen Zustellungen sollen nicht daran haengen, dass ein Empfaenger
    // langsam ist; jede hat ihre eigene Lease und ihren eigenen Zaehler.
    const { runtime, settlements } = harness({
      claims: [[claim(), claim({ id: "delivery-2" })]],
      deliver: async (_definition, delivery) => {
        if ((delivery as { id: string }).id === "delivery-1") {
          throw new WebhookDeliveryError("WEBHOOK_REJECTED");
        }
      },
    });
    const result = await runtime.runOnce();

    expect(result).toMatchObject({ delivered: 1, failed: 1 });
    expect(settlements.map((entry) => entry.deliveryId)).toEqual(["delivery-1", "delivery-2"]);
  });

  it("does not send when the definition was switched off after the claim", async () => {
    // Senden waere gegen den Willen des Betreibers, Verwerfen ebenso falsch:
    // Ein Abschalten ist ruecknehmbar. Die Zustellung bleibt liegen.
    const { runtime, settlements, delivered } = harness({ find: async () => null });
    const result = await runtime.runOnce();

    expect(result).toEqual({ delivered: 0, failed: 0, skipped: 1 });
    expect(delivered).toEqual([]);
    expect(settlements).toEqual([]);
  });

  it("swallows a lost lease instead of aborting the batch", async () => {
    // Die Zustellung gehoert dann bereits einem anderen Worker; ein Fehler hier
    // wuerde den Stapel abbrechen, ohne etwas zu verbessern.
    const { runtime } = harness({
      deliver: async () => { throw new WebhookDeliveryError("WEBHOOK_REJECTED"); },
      failThrows: new WebhookOutboxError("WEBHOOK_OUTBOX_LEASE_LOST"),
    });
    await expect(runtime.runOnce()).resolves.toMatchObject({ failed: 1 });
  });

  it("passes only the failure code to the observer, never payload or url", async () => {
    const seen: string[] = [];
    const runtime = new WebhookDeliveryRuntime({
      outbox: {
        async claim() { return [claim()]; },
        async acknowledge() { return { status: "delivered" as const }; },
        async fail() { return { status: "retry" as const }; },
      } as never,
      deliverer: {
        async deliver() { throw new WebhookDeliveryError("WEBHOOK_SIGNING_FAILED"); },
      } as never,
      definitions: { find: async () => definition },
      scope,
      workerId: "webhook-worker-1",
      onFailure: (code) => seen.push(code),
    });
    await runtime.runOnce();
    expect(seen).toEqual(["WEBHOOK_SIGNING_FAILED"]);
  });

  it("refuses an implausible batch size", () => {
    expect(() => new WebhookDeliveryRuntime({
      outbox: {} as never, deliverer: {} as never,
      definitions: { find: async () => null },
      scope, workerId: "w", batchSize: 500,
    })).toThrow(WebhookOutboxError);
  });

  it("waits only when a run found nothing to do", async () => {
    const waits: number[] = [];
    let round = 0;
    const runtime = new WebhookDeliveryRuntime({
      outbox: {
        async claim() { return round++ === 0 ? [claim()] : []; },
        async acknowledge() { return { status: "delivered" as const }; },
        async fail() { return { status: "retry" as const }; },
      } as never,
      deliverer: { async deliver() { return undefined; } } as never,
      definitions: { find: async () => definition },
      scope,
      workerId: "webhook-worker-1",
      idleIntervalMs: 60,
      sleep: async (ms) => { waits.push(ms); runtime.stop(); },
    });

    await runtime.run();
    // Der erste Durchlauf stellte zu und wartete nicht; erst der leere wartet.
    expect(waits).toEqual([60]);
  });

  it("waits longer after a failed claim than after an idle run", async () => {
    const waits: number[] = [];
    const runtime = new WebhookDeliveryRuntime({
      outbox: {
        async claim() { throw new Error("database unreachable"); },
        async acknowledge() { return { status: "delivered" as const }; },
        async fail() { return { status: "retry" as const }; },
      } as never,
      deliverer: { async deliver() { return undefined; } } as never,
      definitions: { find: async () => definition },
      scope,
      workerId: "webhook-worker-1",
      idleIntervalMs: 60,
      errorIntervalMs: 900,
      sleep: async (ms) => { waits.push(ms); runtime.stop(); },
    });

    await runtime.run();
    expect(waits).toEqual([900]);
  });

  it("wakes a pending wait when stopped", async () => {
    vi.useFakeTimers();
    try {
      const runtime = new WebhookDeliveryRuntime({
        outbox: {
          async claim() { return []; },
          async acknowledge() { return { status: "delivered" as const }; },
          async fail() { return { status: "retry" as const }; },
        } as never,
        deliverer: { async deliver() { return undefined; } } as never,
        definitions: { find: async () => definition },
        scope,
        workerId: "webhook-worker-1",
        idleIntervalMs: 50_000,
      });
      const running = runtime.run();
      await vi.advanceTimersByTimeAsync(1);
      runtime.stop();
      await expect(running).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a second concurrent run of the same instance", async () => {
    let second: Promise<unknown> = Promise.resolve();
    const runtime = new WebhookDeliveryRuntime({
      outbox: {
        async claim() { return []; },
        async acknowledge() { return { status: "delivered" as const }; },
        async fail() { return { status: "retry" as const }; },
      } as never,
      deliverer: { async deliver() { return undefined; } } as never,
      definitions: { find: async () => definition },
      scope,
      workerId: "webhook-worker-1",
      sleep: async () => {
        second = expect(runtime.run()).rejects.toBeInstanceOf(WebhookOutboxError);
        runtime.stop();
      },
    });

    await runtime.run();
    await second;
  });
});
