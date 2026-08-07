import { describe, expect, it } from "vitest";
import { WebhookRetentionRuntime } from "@/lib/server/compute/webhook-retention-runtime";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

const scope = (projectId: string): WebhookOutboxScope => ({
  organizationId: "org-1", projectId, environment: "development",
});
const NOW = new Date("2026-08-06T12:00:00.000Z");

function repository(removed = { delivered: 0, deadLettered: 0 }, fail = false) {
  const calls: Array<{ scope: WebhookOutboxScope; deliveredBefore: Date; deadLetteredBefore: Date }> = [];
  return {
    calls,
    async pruneDeliveries(target: WebhookOutboxScope, input: { deliveredBefore: Date; deadLetteredBefore: Date }) {
      calls.push({ scope: target, ...input });
      if (fail) throw new Error("unreachable");
      return removed;
    },
  };
}

describe("WebhookRetentionRuntime", () => {
  it("keeps the dead-letter window longer than the delivered one", async () => {
    // Eine tote Zustellung ist der Grund, warum jemand ueberhaupt in diese
    // Tabelle schaut. Sie darf nicht mit dem Alltagsrauschen verschwinden.
    const store = repository();
    const runtime = new WebhookRetentionRuntime({
      repository: store, scopes: [scope("a")],
      deliveredRetentionMs: 7 * 86_400_000,
      deadLetterRetentionMs: 30 * 86_400_000,
      now: () => NOW,
    });
    await runtime.runOnce();

    expect(store.calls[0].deliveredBefore.toISOString()).toBe("2026-07-30T12:00:00.000Z");
    expect(store.calls[0].deadLetteredBefore.toISOString()).toBe("2026-07-07T12:00:00.000Z");
  });

  it("adds up what every project gave back", async () => {
    const store = repository({ delivered: 4, deadLettered: 1 });
    const runtime = new WebhookRetentionRuntime({
      repository: store, scopes: [scope("a"), scope("b")],
      deliveredRetentionMs: 60_000, deadLetterRetentionMs: 60_000, now: () => NOW,
    });
    await expect(runtime.runOnce()).resolves.toEqual({ delivered: 8, deadLettered: 2 });
  });

  it("carries on when one project fails", async () => {
    const store = repository({ delivered: 0, deadLettered: 0 }, true);
    const runtime = new WebhookRetentionRuntime({
      repository: store, scopes: [scope("a"), scope("b")],
      deliveredRetentionMs: 60_000, deadLetterRetentionMs: 60_000, now: () => NOW,
    });
    await expect(runtime.runOnce()).resolves.toEqual({ delivered: 0, deadLettered: 0 });
    expect(store.calls).toHaveLength(2);
  });

  it("refuses a retention window that is not a window", async () => {
    expect(() => new WebhookRetentionRuntime({
      repository: repository(), scopes: [], deliveredRetentionMs: 0, deadLetterRetentionMs: 60_000,
    })).toThrow(RangeError);
  });

  it("stops between projects instead of finishing the round", async () => {
    const store = repository({ delivered: 1, deadLettered: 0 });
    const runtime = new WebhookRetentionRuntime({
      repository: store, scopes: [scope("a"), scope("b")],
      deliveredRetentionMs: 60_000, deadLetterRetentionMs: 60_000, now: () => NOW,
    });
    runtime.stop();
    await expect(runtime.runOnce()).resolves.toEqual({ delivered: 0, deadLettered: 0 });
  });
});
