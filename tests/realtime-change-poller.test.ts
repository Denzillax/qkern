import { describe, expect, it } from "vitest";
import type { RealtimeChange, RealtimeChangeSource } from "@/lib/server/realtime/change-source";
import { RealtimeChangePoller } from "@/lib/server/realtime/change-poller";
import { RealtimeError, type RealtimeScope } from "@/lib/server/realtime/model";

const scope: RealtimeScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

function change(position: number): RealtimeChange {
  return {
    ...scope,
    position,
    schema: "public",
    table: "items",
    operation: "insert",
    key: { id: `row-${position}` },
    committedAt: new Date("2026-08-04T12:00:00.000Z"),
  };
}

/** Quelle mit fester Menge an Änderungen, die Aufrufe mitschreibt. */
function source(total: number, overrides: Partial<RealtimeChangeSource> = {}) {
  const reads: Array<{ after: number; limit: number }> = [];
  const base: RealtimeChangeSource = {
    async read(_scope, after, limit) {
      reads.push({ after, limit });
      return Array.from({ length: total }, (_, index) => index + 1)
        .filter((position) => position > after)
        .slice(0, limit)
        .map(change);
    },
    async prune() { return 0; },
  };
  return { reads, source: { ...base, ...overrides } };
}

function consumer(overloaded: string[] = []) {
  const delivered: RealtimeChange[] = [];
  return {
    delivered,
    async deliverChanges(changes: readonly RealtimeChange[]) {
      delivered.push(...changes);
      return overloaded;
    },
  };
}

describe("RealtimeChangePoller", () => {
  it("delivers a batch and advances the position", async () => {
    const feed = source(3);
    const sink = consumer();
    const poller = new RealtimeChangePoller({ source: feed.source, consumer: sink, scope });

    expect(await poller.poll()).toBe(3);
    expect(sink.delivered.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(poller.currentPosition).toBe(3);
  });

  it("reads only after the position it already delivered", async () => {
    const feed = source(5);
    const poller = new RealtimeChangePoller({
      source: feed.source, consumer: consumer(), scope, batchSize: 2,
    });

    await poller.poll();
    await poller.poll();

    expect(feed.reads.map((read) => read.after)).toEqual([0, 2]);
  });

  it("does not advance the position when delivery fails", async () => {
    // Lieber eine Aenderung zweimal zustellen als sie zu verlieren: die
    // Zustellung ist fuer den Abonnenten beobachtbar, ein Verlust nicht.
    const feed = source(2);
    let attempt = 0;
    const poller = new RealtimeChangePoller({
      source: feed.source,
      consumer: {
        async deliverChanges() {
          attempt += 1;
          if (attempt === 1) throw new Error("sink unavailable");
          return [];
        },
      },
      scope,
    });

    await expect(poller.poll()).rejects.toThrow("sink unavailable");
    expect(poller.currentPosition).toBe(0);

    expect(await poller.poll()).toBe(2);
    expect(feed.reads.map((read) => read.after)).toEqual([0, 0]);
  });

  it("returns zero once the feed is caught up", async () => {
    const feed = source(1);
    const poller = new RealtimeChangePoller({ source: feed.source, consumer: consumer(), scope });

    expect(await poller.poll()).toBe(1);
    expect(await poller.poll()).toBe(0);
  });

  it("does not run two polls at once", async () => {
    let concurrent = 0;
    let peak = 0;
    const poller = new RealtimeChangePoller({
      source: {
        async read() {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrent -= 1;
          return [change(1)];
        },
        async prune() { return 0; },
      },
      consumer: consumer(),
      scope,
    });

    await Promise.all([poller.poll(), poller.poll(), poller.poll()]);
    expect(peak).toBe(1);
  });

  it("reports every backpressured connection", async () => {
    const closed: string[] = [];
    const poller = new RealtimeChangePoller({
      source: source(1).source,
      consumer: consumer(["connection-7"]),
      scope,
      onOverloaded: (id) => closed.push(id),
    });

    await poller.poll();
    expect(closed).toEqual(["connection-7"]);
  });

  it("drains the feed in bounded batches", async () => {
    const feed = source(7);
    const poller = new RealtimeChangePoller({
      source: feed.source, consumer: consumer(), scope, batchSize: 3,
    });

    expect(await poller.drain()).toBe(7);
    expect(poller.currentPosition).toBe(7);
  });

  it("stops draining at the batch limit instead of running unbounded", async () => {
    // Ohne Grenze koennte ein schnell wachsender Feed den Aufruf beliebig lange
    // festhalten und andere Arbeit aushungern.
    const feed = source(100);
    const poller = new RealtimeChangePoller({
      source: feed.source, consumer: consumer(), scope, batchSize: 5,
    });

    expect(await poller.drain(2)).toBe(10);
    expect(poller.currentPosition).toBe(10);
  });

  it("refuses a source that returns a position it already passed", async () => {
    // Eine ruecklaeufige Position wuerde die Schleife endlos wiederholen lassen.
    const poller = new RealtimeChangePoller({
      source: {
        async read() { return [change(1)]; },
        async prune() { return 0; },
      },
      consumer: consumer(),
      scope,
      startPosition: 5,
    });

    await expect(poller.poll()).rejects.toBeInstanceOf(RealtimeError);
  });

  it("stops after shutdown", async () => {
    const poller = new RealtimeChangePoller({ source: source(3).source, consumer: consumer(), scope });
    poller.stop();
    expect(await poller.poll()).toBe(0);
  });

  it("never prunes: retention is an operational task", async () => {
    let pruned = 0;
    const poller = new RealtimeChangePoller({
      source: {
        async read() { return [change(1)]; },
        async prune() { pruned += 1; return 0; },
      },
      consumer: consumer(),
      scope,
    });

    await poller.drain();
    // Die Instanz weiss nicht, was andere Instanzen noch brauchen.
    expect(pruned).toBe(0);
  });
});
