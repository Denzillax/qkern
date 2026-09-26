import { describe, expect, it } from "vitest";
import {
  DatabaseWebhookBridgeRuntime,
  databaseWebhookScopeKey,
  discoverDatabaseWebhookEnvironments,
  type DatabaseWebhookBridgeFailureCode,
  type DatabaseWebhookCouplingCensus,
  type DatabaseWebhookCursorStore,
} from "@/lib/server/compute/database-webhook-bridge-runtime";
import type { DatabaseWebhookBinding } from "@/lib/server/compute/database-webhook-bridge";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { RealtimeChange, RealtimeChangeSource } from "@/lib/server/realtime/change-source";

/**
 * Die Webhook-Bruecke als Prozess (2.53): Entdeckung und Takt.
 *
 * Geprueft wird hier genau das, was eine Datenbank nicht besser beantwortet:
 * **welche** Umgebungen gelesen werden, **in welcher Reihenfolge**, was
 * geschieht, wenn eine Projektdatenbank nicht erreichbar ist, und ob ein
 * Neustart dort weiterliest, wo der vorige aufgehoert hat. Dass am Ende eine
 * Zustellung in einer echten Control Plane liegt, sagt der Fall (2.53).
 */

const ALPHA: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "aaaaaaaa-1111-4111-8111-111111111111",
  environment: "development",
};
const BETA: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "bbbbbbbb-2222-4222-8222-222222222222",
  environment: "development",
};
const GAMMA: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "cccccccc-3333-4333-8333-333333333333",
  environment: "staging",
};
const SCOPES = [ALPHA, BETA, GAMMA];

const BINDING: DatabaseWebhookBinding = {
  webhookId: "22222222-2222-4222-8222-222222222222",
  schema: "public",
  table: "bestellungen",
  events: ["insert"],
};

function change(scope: WebhookOutboxScope, position: number): RealtimeChange {
  return {
    ...scope,
    position,
    schema: "public",
    table: "bestellungen",
    operation: "insert",
    key: { id: `row-${position}` },
    committedAt: new Date("2026-09-26T19:00:00.000Z"),
  } as RealtimeChange;
}

/** Ein Feed je Umgebung. Eine Umgebung kann unerreichbar geschaltet werden. */
class FakeSource implements RealtimeChangeSource {
  readonly feeds = new Map<string, RealtimeChange[]>();
  readonly unreachable = new Set<string>();
  readonly reads: string[] = [];

  seed(scope: WebhookOutboxScope, positions: readonly number[]) {
    this.feeds.set(databaseWebhookScopeKey(scope), positions.map((p) => change(scope, p)));
  }

  async read(scope: WebhookOutboxScope, after: number, limit: number): Promise<RealtimeChange[]> {
    const key = databaseWebhookScopeKey(scope);
    this.reads.push(key);
    if (this.unreachable.has(key)) throw new Error("connection refused");
    return (this.feeds.get(key) ?? []).filter((entry) => entry.position > after).slice(0, limit);
  }

  async prune(): Promise<number> {
    throw new Error("Die Bruecke raeumt den Feed nicht auf.");
  }
}

class FakeCensus implements DatabaseWebhookCouplingCensus {
  readonly counts = new Map<string, { total: number; enabled: number }>();
  readonly failing = new Set<string>();

  set(scope: WebhookOutboxScope, total: number, enabled: number) {
    this.counts.set(databaseWebhookScopeKey(scope), { total, enabled });
  }

  async couplingCounts(scope: WebhookOutboxScope) {
    const key = databaseWebhookScopeKey(scope);
    if (this.failing.has(key)) throw new Error("control plane unreachable");
    return this.counts.get(key) ?? { total: 0, enabled: 0 };
  }
}

class FakeCursors implements DatabaseWebhookCursorStore {
  readonly positions = new Map<string, number>();
  readonly failingSaves = new Set<string>();
  readonly failingLoads = new Set<string>();
  readonly saves: Array<{ key: string; position: number }> = [];

  async load(scope: WebhookOutboxScope): Promise<number> {
    const key = databaseWebhookScopeKey(scope);
    if (this.failingLoads.has(key)) throw new Error("cursor unreadable");
    return this.positions.get(key) ?? 0;
  }

  async save(scope: WebhookOutboxScope, position: number): Promise<void> {
    const key = databaseWebhookScopeKey(scope);
    if (this.failingSaves.has(key)) throw new Error("cursor unwritable");
    this.saves.push({ key, position });
    // Monoton, genau wie das GREATEST der echten Ablage.
    this.positions.set(key, Math.max(this.positions.get(key) ?? 0, position));
  }
}

function harness(options: {
  bindings?: (scope: WebhookOutboxScope) => DatabaseWebhookBinding[];
  now?: () => number;
} = {}) {
  const source = new FakeSource();
  const census = new FakeCensus();
  const cursors = new FakeCursors();
  const enqueued: Array<{ key: string; position: number }> = [];
  const failures: Array<{ code: DatabaseWebhookBridgeFailureCode; scopeIndex: number }> = [];
  const rounds: Array<{ scopeIndex: number; enqueued: number }> = [];

  const build = (overrides: Record<string, unknown> = {}) => new DatabaseWebhookBridgeRuntime({
    scopes: SCOPES,
    source,
    census,
    cursors,
    bindings: {
      activeBindings: async (scope) => options.bindings?.(scope) ?? [BINDING],
    },
    outbox: {
      enqueue: async (scope, input) => {
        enqueued.push({
          key: databaseWebhookScopeKey(scope),
          position: (input.payload as unknown as { position: number }).position,
        });
        return input as never;
      },
    },
    onFailure: (code, scopeIndex) => failures.push({ code, scopeIndex }),
    onEnqueued: (scopeIndex, count) => rounds.push({ scopeIndex, enqueued: count }),
    ...(options.now ? { now: options.now } : {}),
    ...overrides,
  });

  return { source, census, cursors, enqueued, failures, rounds, build };
}

describe("database webhook environment discovery", () => {
  it("keeps the environments that hold a coupling, in the configured order", async () => {
    const census = new FakeCensus();
    census.set(ALPHA, 2, 2);
    census.set(BETA, 0, 0);
    census.set(GAMMA, 1, 1);

    const discovered = await discoverDatabaseWebhookEnvironments(SCOPES, census);
    expect(discovered.scopes.map(databaseWebhookScopeKey)).toEqual([
      databaseWebhookScopeKey(ALPHA), databaseWebhookScopeKey(GAMMA),
    ]);
    expect(discovered.failures).toBe(0);
  });

  /**
   * Eine Umgebung, deren Kopplungen alle abgeschaltet sind, bleibt dabei.
   *
   * 2.50 hat die Regel aufgestellt: Abschalten heisst pausieren, nicht stauen.
   * Wer sie hier herausnimmt, kehrt sie um -- beim Wiedereinschalten liefe auf
   * einen Schlag los, was der Feed seither haelt.
   */
  it("keeps an environment whose couplings are all switched off", async () => {
    const census = new FakeCensus();
    census.set(ALPHA, 3, 0);
    const discovered = await discoverDatabaseWebhookEnvironments(SCOPES, census);
    expect(discovered.scopes).toEqual([ALPHA]);
  });

  it("keeps the last answer for an environment whose census fails", async () => {
    const census = new FakeCensus();
    census.set(ALPHA, 1, 1);
    census.failing.add(databaseWebhookScopeKey(ALPHA));
    const failures: DatabaseWebhookBridgeFailureCode[] = [];

    const withoutHistory = await discoverDatabaseWebhookEnvironments(
      SCOPES, census, new Set(), (code) => failures.push(code));
    expect(withoutHistory.scopes).toEqual([]);
    expect(withoutHistory.failures).toBe(1);
    expect(failures).toEqual(["DATABASE_WEBHOOK_BRIDGE_DISCOVERY_FAILED"]);

    const withHistory = await discoverDatabaseWebhookEnvironments(
      SCOPES, census, new Set([databaseWebhookScopeKey(ALPHA)]));
    expect(withHistory.scopes).toEqual([ALPHA]);
  });
});

describe("database webhook bridge runtime", () => {
  it("reads only the discovered environments and in the configured order", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    test.census.set(BETA, 0, 0);
    test.census.set(GAMMA, 1, 1);
    test.source.seed(ALPHA, [1]);
    test.source.seed(GAMMA, [1]);

    const runtime = test.build();
    const round = await runtime.runOnce();

    expect(runtime.watching).toEqual([
      databaseWebhookScopeKey(ALPHA), databaseWebhookScopeKey(GAMMA),
    ]);
    expect(round.polled).toEqual([
      databaseWebhookScopeKey(ALPHA), databaseWebhookScopeKey(GAMMA),
    ]);
    expect(round.enqueued).toBe(2);
    // Die nicht gekoppelte Umgebung sieht keine einzige Leseanfrage.
    expect(test.source.reads).not.toContain(databaseWebhookScopeKey(BETA));
  });

  it("advances the position of an environment whose couplings are all off, without enqueueing", async () => {
    const test = harness({ bindings: () => [] });
    test.census.set(ALPHA, 2, 0);
    test.source.seed(ALPHA, [1, 2, 3]);

    const runtime = test.build();
    const round = await runtime.runOnce();

    expect(round.enqueued).toBe(0);
    expect(test.enqueued).toEqual([]);
    expect(test.cursors.positions.get(databaseWebhookScopeKey(ALPHA))).toBe(3);
  });

  /**
   * Eine unerreichbare Projektdatenbank nimmt die anderen nicht mit.
   *
   * Das ist der Unterschied zwischen einem Prozess, der eine Umgebung
   * verliert, und einem, der alle verliert.
   */
  it("backs off one unreachable environment and keeps the others running", async () => {
    let clock = 1_000;
    const test = harness({ now: () => clock });
    test.census.set(ALPHA, 1, 1);
    test.census.set(BETA, 1, 1);
    test.source.seed(ALPHA, [1]);
    test.source.seed(BETA, [1]);
    test.source.unreachable.add(databaseWebhookScopeKey(ALPHA));

    const runtime = test.build({ errorIntervalMs: 1_000, discoveryIntervalMs: 250 });
    const first = await runtime.runOnce();
    expect(first.failed).toBe(1);
    expect(first.polled).toEqual([databaseWebhookScopeKey(BETA)]);
    expect(test.failures).toEqual([
      { code: "DATABASE_WEBHOOK_BRIDGE_UNREACHABLE", scopeIndex: 0 },
    ]);
    expect(test.enqueued).toEqual([{ key: databaseWebhookScopeKey(BETA), position: 1 }]);

    // Solange das Backoff laeuft, wird die Umgebung uebersprungen statt erneut
    // angefasst: Sonst belastete eine tote Datenbank jeden Takt.
    clock += 100;
    const second = await runtime.runOnce();
    expect(second.skipped).toEqual([databaseWebhookScopeKey(ALPHA)]);
    expect(second.failed).toBe(0);

    // Danach wird sie wieder gelesen -- und wenn sie zurueck ist, laeuft sie
    // weiter, ohne dass jemand eingreifen muss.
    clock += 1_000;
    test.source.unreachable.delete(databaseWebhookScopeKey(ALPHA));
    const third = await runtime.runOnce();
    expect(third.polled).toContain(databaseWebhookScopeKey(ALPHA));
    expect(test.enqueued).toContainEqual({ key: databaseWebhookScopeKey(ALPHA), position: 1 });
  });

  it("doubles the backoff of an environment that keeps failing", async () => {
    let clock = 0;
    const test = harness({ now: () => clock });
    test.census.set(ALPHA, 1, 1);
    test.source.seed(ALPHA, [1]);
    test.source.unreachable.add(databaseWebhookScopeKey(ALPHA));

    const runtime = test.build({
      errorIntervalMs: 1_000, maxErrorIntervalMs: 4_000, discoveryIntervalMs: 250,
    });
    // Erster Fehlschlag: 1000ms. Vorher wird uebersprungen, danach gelesen.
    await runtime.runOnce();
    clock += 999;
    expect((await runtime.runOnce()).skipped).toEqual([databaseWebhookScopeKey(ALPHA)]);
    clock += 1;
    expect((await runtime.runOnce()).failed).toBe(1);
    // Zweiter Fehlschlag: 2000ms.
    clock += 1_999;
    expect((await runtime.runOnce()).skipped).toEqual([databaseWebhookScopeKey(ALPHA)]);
    clock += 1;
    expect((await runtime.runOnce()).failed).toBe(1);
    // Dritter: 4000ms, und die Obergrenze haelt.
    clock += 3_999;
    expect((await runtime.runOnce()).skipped).toEqual([databaseWebhookScopeKey(ALPHA)]);
    clock += 1;
    expect((await runtime.runOnce()).failed).toBe(1);
    clock += 4_001;
    expect((await runtime.runOnce()).failed).toBe(1);
  });

  /**
   * Der Punkt des ganzen Cursors: Ein Neustart liest weiter, statt den Feed
   * ein zweites Mal einzureihen.
   */
  it("continues where the previous process stopped, without replaying or skipping", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    test.source.seed(ALPHA, [1, 2]);

    const first = test.build();
    expect((await first.runOnce()).enqueued).toBe(2);
    first.stop();
    expect(test.cursors.positions.get(databaseWebhookScopeKey(ALPHA))).toBe(2);

    // Zwei weitere Aenderungen, danach ein neuer Prozess mit derselben Ablage.
    test.source.seed(ALPHA, [1, 2, 3, 4]);
    const second = test.build();
    const round = await second.runOnce();

    expect(round.enqueued).toBe(2);
    expect(test.enqueued.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
  });

  it("does not start an environment whose stored position cannot be read", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    test.source.seed(ALPHA, [1, 2, 3]);
    test.cursors.failingLoads.add(databaseWebhookScopeKey(ALPHA));

    const runtime = test.build();
    const round = await runtime.runOnce();

    // Bei 0 zu beginnen hiesse, den ganzen Feed einzureihen. Lieber eine Runde
    // warten.
    expect(runtime.watching).toEqual([]);
    expect(round.polled).toEqual([]);
    expect(test.enqueued).toEqual([]);
    expect(test.failures).toEqual([
      { code: "DATABASE_WEBHOOK_BRIDGE_CURSOR_FAILED", scopeIndex: 0 },
    ]);
  });

  it("reports a position that could not be stored and stores it in the next round", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    test.source.seed(ALPHA, [1]);
    test.cursors.failingSaves.add(databaseWebhookScopeKey(ALPHA));

    const runtime = test.build({ discoveryIntervalMs: 3_600_000 });
    const first = await runtime.runOnce();
    expect(first.failed).toBe(1);
    expect(test.failures).toEqual([
      { code: "DATABASE_WEBHOOK_BRIDGE_CURSOR_FAILED", scopeIndex: 0 },
    ]);

    test.cursors.failingSaves.delete(databaseWebhookScopeKey(ALPHA));
    await runtime.runOnce();
    expect(test.cursors.positions.get(databaseWebhookScopeKey(ALPHA))).toBe(1);
  });

  it("drops an environment whose last coupling is gone and keeps its position", async () => {
    let clock = 0;
    const test = harness({ now: () => clock });
    test.census.set(ALPHA, 1, 1);
    test.source.seed(ALPHA, [1]);

    const runtime = test.build({ discoveryIntervalMs: 500 });
    await runtime.runOnce();
    expect(runtime.watching).toEqual([databaseWebhookScopeKey(ALPHA)]);

    test.census.set(ALPHA, 0, 0);
    clock += 500;
    await runtime.runOnce();
    expect(runtime.watching).toEqual([]);
    expect(test.cursors.positions.get(databaseWebhookScopeKey(ALPHA))).toBe(1);
  });

  it("reports what it enqueued per environment and stays silent about empty rounds", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    test.census.set(GAMMA, 1, 1);
    test.source.seed(GAMMA, [1, 2]);

    const runtime = test.build({ discoveryIntervalMs: 3_600_000 });
    await runtime.runOnce();
    expect(test.rounds).toEqual([{ scopeIndex: 2, enqueued: 2 }]);

    await runtime.runOnce();
    expect(test.rounds).toHaveLength(1);
  });

  it("returns from its loop on stop", async () => {
    const test = harness();
    test.census.set(ALPHA, 1, 1);
    const runtime = test.build({ idleIntervalMs: 50 });
    const loop = runtime.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    runtime.stop();
    await expect(loop).resolves.toBeUndefined();
  });

  it("refuses a second loop in the same instance", async () => {
    const test = harness();
    const runtime = test.build({ idleIntervalMs: 50 });
    const loop = runtime.run();
    await expect(runtime.run()).rejects.toThrowError(
      /DATABASE_WEBHOOK_BRIDGE_RUNTIME_INVALID_INPUT/);
    runtime.stop();
    await loop;
  });
});
