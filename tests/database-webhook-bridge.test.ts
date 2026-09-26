import { describe, expect, it } from "vitest";
import {
  DatabaseWebhookBridge,
  changeToDelivery,
  type DatabaseWebhookBinding,
} from "@/lib/server/compute/database-webhook-bridge";
import type { RealtimeChange, RealtimeChangeSource } from "@/lib/server/realtime/change-source";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Die Kopplung (2.50): aus einer erfassten Aenderung wird eine wartende
 * Zustellung.
 *
 * Der Punkt dieser Datei ist die Nutzlast. Sie traegt, was der Feed traegt, und
 * sonst nichts -- kein Spaltenwert, kein Vorher-Bild, kein Nachher-Bild. Das
 * laesst sich hier, ohne Datenbank, vollstaendig festnageln.
 */
const scope: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "prj-database-webhooks",
  environment: "development",
};

const binding: DatabaseWebhookBinding = {
  webhookId: "22222222-2222-4222-8222-222222222222",
  schema: "public",
  table: "bestellungen",
  events: ["insert", "delete"],
};

function change(overrides: Partial<RealtimeChange> = {}): RealtimeChange {
  return {
    ...scope,
    position: 7,
    schema: "public",
    table: "bestellungen",
    operation: "insert",
    key: { id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" },
    committedAt: new Date("2026-09-26T19:00:00.000Z"),
    ...overrides,
  } as RealtimeChange;
}

class FakeSource implements RealtimeChangeSource {
  constructor(private readonly changes: RealtimeChange[]) {}
  reads: Array<{ after: number; limit: number }> = [];

  async read(_scope: unknown, after: number, limit: number): Promise<RealtimeChange[]> {
    this.reads.push({ after, limit });
    return this.changes.filter((entry) => entry.position > after).slice(0, limit);
  }

  async prune(): Promise<number> {
    throw new Error("Die Bruecke raeumt den Feed nicht auf.");
  }
}

function outbox() {
  const enqueued: Array<Record<string, unknown>> = [];
  return {
    enqueued,
    enqueue: async (_scope: WebhookOutboxScope, input: Record<string, unknown>) => {
      enqueued.push(input);
      return input as never;
    },
  };
}

describe("change to delivery", () => {
  it("carries the six facts of the feed and nothing else", () => {
    const delivery = changeToDelivery(binding, change());
    expect(delivery).not.toBeNull();
    expect(delivery!.webhookId).toBe(binding.webhookId);
    expect(delivery!.eventType).toBe("db.insert");
    expect(delivery!.occurredAt.toISOString()).toBe("2026-09-26T19:00:00.000Z");
    expect(Object.keys(delivery!.payload)).toEqual([
      "schema", "table", "operation", "key", "position", "committedAt",
    ]);
    expect(delivery!.payload).toEqual({
      schema: "public",
      table: "bestellungen",
      operation: "insert",
      key: { id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" },
      position: 7,
      committedAt: "2026-09-26T19:00:00.000Z",
    });
  });

  it("cannot carry a row value, because the change does not hold one", () => {
    // Eine Aenderung mit angehaengten Spaltenwerten -- so wie sie aus einem
    // zweiten, eigenen Trigger kaeme. Die Abbildung nimmt sie nicht mit.
    const hostile = {
      ...change(),
      record: { iban: "CH93 0076 2011 6238 5295 7", gehalt: 120_000 },
      old: { iban: "CH93 0076 2011 6238 5295 7" },
    } as unknown as RealtimeChange;
    const delivery = changeToDelivery(binding, hostile);
    const encoded = JSON.stringify(delivery!.payload);
    expect(encoded).not.toContain("iban");
    expect(encoded).not.toContain("gehalt");
    expect(encoded).not.toContain("CH93");
  });

  it("does not let the caller change the feed entry through the payload", () => {
    const source = change();
    const delivery = changeToDelivery(binding, source)!;
    expect(() => {
      (delivery.payload.key as Record<string, unknown>).id = "verschoben";
    }).toThrowError();
    expect(source.key).toEqual({ id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" });
  });

  it("ignores a change that this coupling has nothing to do with", () => {
    expect(changeToDelivery(binding, change({ table: "rechnungen" }))).toBeNull();
    expect(changeToDelivery(binding, change({ schema: "Shop" }))).toBeNull();
    // `update` steht nicht auf der Liste dieser Kopplung.
    expect(changeToDelivery(binding, change({ operation: "update" }))).toBeNull();
    expect(changeToDelivery(binding, change({ operation: "delete" }))).not.toBeNull();
  });

  it("refuses a change whose position or time makes no sense", () => {
    expect(changeToDelivery(binding, change({ position: 0 }))).toBeNull();
    expect(changeToDelivery(binding, change({ position: 1.5 }))).toBeNull();
    expect(changeToDelivery(binding, change({ committedAt: new Date(NaN) }))).toBeNull();
    expect(changeToDelivery(binding,
      change({ committedAt: "gestern" as unknown as Date }))).toBeNull();
    expect(changeToDelivery(binding,
      change({ key: null as unknown as Record<string, never> }))).toBeNull();
  });
});

describe("database webhook bridge", () => {
  it("enqueues one delivery per matching coupling and advances only afterwards", async () => {
    const source = new FakeSource([
      change({ position: 3 }),
      change({ position: 4, operation: "update" }),
      change({ position: 5, table: "rechnungen" }),
      change({ position: 6, operation: "delete" }),
    ]);
    const queue = outbox();
    const second: DatabaseWebhookBinding = {
      webhookId: "33333333-3333-4333-8333-333333333333",
      schema: "public", table: "bestellungen", events: ["insert", "update", "delete"],
    };
    const bridge = new DatabaseWebhookBridge({
      source, outbox: queue, scope, batchSize: 10,
      bindings: { activeBindings: async () => [binding, second] },
    });

    expect(await bridge.poll()).toBe(5);
    expect(bridge.currentPosition).toBe(6);
    expect(queue.enqueued.map((entry) => `${entry.webhookId}:${entry.eventType}`)).toEqual([
      `${binding.webhookId}:db.insert`,
      `${second.webhookId}:db.insert`,
      `${second.webhookId}:db.update`,
      `${binding.webhookId}:db.delete`,
      `${second.webhookId}:db.delete`,
    ]);
  });

  it("reads the same range again when the run failed", async () => {
    // Die Position wandert erst nach dem Einreihen weiter. Lieber eine
    // Zustellung doppelt als eine verlorene; genau so haelt es der
    // Realtime-Poller.
    const source = new FakeSource([change({ position: 3 })]);
    let attempts = 0;
    const bridge = new DatabaseWebhookBridge({
      source, scope,
      bindings: { activeBindings: async () => [binding] },
      outbox: {
        enqueue: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Datenbank kurz weg");
          return {} as never;
        },
      },
    });
    await expect(bridge.poll()).rejects.toThrowError("Datenbank kurz weg");
    expect(bridge.currentPosition).toBe(0);
    expect(await bridge.poll()).toBe(1);
    expect(bridge.currentPosition).toBe(3);
  });

  it("advances past a range that no coupling wants, so switching on starts now", async () => {
    // Ohne diesen Schritt bekaeme eine spaeter angelegte Kopplung beim ersten
    // Lauf die ganze Vergangenheit des Feeds auf einmal.
    const source = new FakeSource([change({ position: 9, table: "rechnungen" })]);
    const queue = outbox();
    const bridge = new DatabaseWebhookBridge({
      source, outbox: queue, scope, bindings: { activeBindings: async () => [] },
    });
    expect(await bridge.poll()).toBe(0);
    expect(bridge.currentPosition).toBe(9);
    expect(queue.enqueued).toEqual([]);
  });

  it("drains in bounded batches and stops when the feed is caught up", async () => {
    const changes = Array.from({ length: 5 }, (_entry, index) => change({ position: index + 1 }));
    const source = new FakeSource(changes);
    const queue = outbox();
    const bridge = new DatabaseWebhookBridge({
      source, outbox: queue, scope, batchSize: 2,
      bindings: { activeBindings: async () => [binding] },
    });
    expect(await bridge.drain()).toBe(5);
    expect(bridge.currentPosition).toBe(5);
    expect(source.reads.map((read) => read.after)).toEqual([0, 2, 4, 5]);
    expect(source.reads.every((read) => read.limit === 2)).toBe(true);
  });

  it("stops for good once stopped and refuses a nonsensical batch size", async () => {
    const bridge = new DatabaseWebhookBridge({
      source: new FakeSource([change()]), outbox: outbox(), scope,
      bindings: { activeBindings: async () => [binding] },
    });
    bridge.stop();
    expect(await bridge.poll()).toBe(0);
    expect(() => new DatabaseWebhookBridge({
      source: new FakeSource([]), outbox: outbox(), scope, batchSize: 0,
      bindings: { activeBindings: async () => [] },
    })).toThrowError();
    expect(() => new DatabaseWebhookBridge({
      source: new FakeSource([]), outbox: outbox(), scope, batchSize: 501,
      bindings: { activeBindings: async () => [] },
    })).toThrowError();
  });
});
