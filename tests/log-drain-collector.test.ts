import { describe, expect, it } from "vitest";
import {
  LogDrainCollector,
  type LogDrainBinding,
  type LogDrainSourceRow,
} from "@/lib/server/compute/log-drains";
import type { LogDrainSourceId } from "@/lib/console/log-drains";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Der Sammler (2.54): aus gelesenen Zeilen wird eine wartende Ladung in der
 * **vorhandenen** Webhook-Outbox.
 *
 * Geprueft wird hier, was ohne Datenbank pruefbar ist: dass gebuendelt wird
 * (nach Anzahl oder Alter), dass ein neuer Drain an der Spitze beginnt statt
 * die Vergangenheit nachzuschicken, dass ein abgeschalteter Drain nichts
 * erzeugt, und dass die Ladung nur die Felder der Quelle traegt. Dass der Weg
 * dahinter wirklich signiert und zustellt, belegt der PostgreSQL-Fall "(2.63)".
 */
const scope: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
};
const webhookId = "33333333-3333-4333-8333-333333333333";

type Enqueued = { webhookId: string; eventType: string; payload: unknown; occurredAt?: Date };

function reader(rows: Record<string, LogDrainSourceRow[]>, tip: string | null = null) {
  const read: Array<{ source: string; after: string | null }> = [];
  return {
    read,
    async tip() { return tip; },
    async read_(source: LogDrainSourceId, after: string | null) {
      read.push({ source, after });
      const pending = rows[source] ?? [];
      const start = after === null ? 0 : pending.findIndex((row) => row.cursor === after) + 1;
      return pending.slice(start);
    },
  };
}

function harness(options: {
  rows: Record<string, LogDrainSourceRow[]>;
  drains: LogDrainBinding[];
  tip?: string | null;
  maxBatchEntries?: number;
  maxBatchAgeMs?: number;
  now?: () => Date;
}) {
  const source = reader(options.rows, options.tip ?? null);
  const enqueued: Enqueued[] = [];
  const collector = new LogDrainCollector({
    reader: {
      tip: source.tip,
      read: (_scope, id, input) => source.read_(id, input.after),
    },
    drains: { activeDrains: async () => options.drains },
    outbox: { enqueue: async (_scope, input) => {
      enqueued.push(input as Enqueued);
      return undefined as never;
    } },
    scope,
    ...(options.maxBatchEntries ? { maxBatchEntries: options.maxBatchEntries } : {}),
    ...(options.maxBatchAgeMs ? { maxBatchAgeMs: options.maxBatchAgeMs } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { collector, enqueued, reads: source.read };
}

const auditRows: LogDrainSourceRow[] = [1, 2, 3].map((index) => Object.freeze({
  cursor: `2026-09-27T09:0${index}:00.000Z#row-${index}`,
  record: {
    id: `row-${index}`,
    createdAt: `2026-09-27T09:0${index}:00.000Z`,
    action: "project_auth.sign_in",
    actorType: "app_user",
    resourceRef: `project_auth_user:${index}`,
    status: "succeeded",
    // Was der Leser zu viel liefert, darf nicht hinausgehen.
    actorRef: "kundin@example.com",
  },
}));

const drain: LogDrainBinding = Object.freeze({
  webhookId, sources: Object.freeze(["auth_audit" as LogDrainSourceId]), schemaVersion: 1,
});

describe("log drain collector", () => {
  it("sends one batch over the existing outbox once the count is reached", async () => {
    const { collector, enqueued } = harness({
      rows: { auth_audit: auditRows }, drains: [drain], maxBatchEntries: 3,
    });
    expect(await collector.poll()).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].webhookId).toBe(webhookId);
    expect(enqueued[0].eventType).toBe("log.auth_audit");
    const payload = enqueued[0].payload as {
      schemaVersion: number; source: string; count: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.source).toBe("auth_audit");
    expect(payload.count).toBe(3);
    expect(Object.keys(payload.entries[0]).sort())
      .toEqual(["action", "actorType", "createdAt", "id", "resourceRef", "status"]);
    expect(JSON.stringify(payload)).not.toContain("example.com");
  });

  it("holds a batch below the count and lets the age release it", async () => {
    let clock = Date.parse("2026-09-27T10:00:00.000Z");
    const { collector, enqueued } = harness({
      rows: { auth_audit: auditRows }, drains: [drain],
      maxBatchEntries: 100, maxBatchAgeMs: 60_000, now: () => new Date(clock),
    });
    expect(await collector.poll()).toBe(0);
    expect(enqueued).toHaveLength(0);
    clock += 60_000;
    expect(await collector.poll()).toBe(1);
    expect((enqueued[0].payload as { count: number }).count).toBe(3);
    // Danach ist der Puffer leer, und eine Runde ohne neue Zeilen schweigt.
    clock += 600_000;
    expect(await collector.poll()).toBe(0);
    expect(enqueued).toHaveLength(1);
  });

  it("begins at the tip, so a new drain does not replay the past", async () => {
    const { collector, enqueued, reads } = harness({
      rows: { auth_audit: auditRows }, drains: [drain],
      tip: auditRows[1].cursor, maxBatchEntries: 1,
    });
    expect(await collector.poll()).toBe(1);
    expect(reads[0].after).toBe(auditRows[1].cursor);
    const payload = enqueued[0].payload as { entries: Array<{ id: string }> };
    expect(payload.entries.map((entry) => entry.id)).toEqual(["row-3"]);
  });

  it("reads on from the last cursor and never twice from the start", async () => {
    const { collector, reads } = harness({
      rows: { auth_audit: auditRows }, drains: [drain], maxBatchEntries: 1,
    });
    await collector.poll();
    await collector.poll();
    expect(reads[0].after).toBeNull();
    expect(reads[1].after).toBe(auditRows[2].cursor);
  });

  it("collects nothing for a drain that is switched off", async () => {
    // Ein abgeschalteter Drain erscheint gar nicht in `activeDrains`. Ohne
    // diese Regel staute sich waehrend der Pause genau das an, was die Pause
    // verhindern soll.
    const { collector, enqueued, reads } = harness({
      rows: { auth_audit: auditRows }, drains: [], maxBatchEntries: 1,
    });
    expect(await collector.poll()).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  it("drops a buffer whose drain was switched off instead of sending it", async () => {
    const drains = [drain];
    const source = reader({ auth_audit: auditRows });
    const enqueued: Enqueued[] = [];
    const collector = new LogDrainCollector({
      reader: { tip: source.tip, read: (_s, id, input) => source.read_(id, input.after) },
      drains: { activeDrains: async () => drains },
      outbox: { enqueue: async (_s, input) => {
        enqueued.push(input as Enqueued);
        return undefined as never;
      } },
      scope, maxBatchEntries: 100, maxBatchAgeMs: 3_600_000,
    });
    expect(await collector.poll()).toBe(0);
    drains.length = 0;
    expect(await collector.poll()).toBe(0);
    expect(await collector.flush()).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("flushes what is open when it is asked to, and stops when told", async () => {
    const { collector, enqueued } = harness({
      rows: { auth_audit: auditRows }, drains: [drain],
      maxBatchEntries: 100, maxBatchAgeMs: 3_600_000,
    });
    await collector.poll();
    expect(await collector.flush()).toBe(1);
    expect((enqueued[0].payload as { count: number }).count).toBe(3);
    collector.stop();
    expect(await collector.poll()).toBe(0);
  });

  it("refuses a batch size or an age outside its bounds", () => {
    const base = {
      reader: { tip: async () => null, read: async () => [] },
      drains: { activeDrains: async () => [] },
      outbox: { enqueue: async () => undefined as never },
      scope,
    };
    for (const options of [{ maxBatchEntries: 0 }, { maxBatchEntries: 1_001 },
      { maxBatchAgeMs: 999 }, { maxBatchEntries: 1.5 }, { readLimit: 0 }]) {
      expect(() => new LogDrainCollector({ ...base, ...options }),
        JSON.stringify(options)).toThrow(/LOG_DRAIN_COLLECTOR_INVALID_INPUT/);
    }
  });
});
