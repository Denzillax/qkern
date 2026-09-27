import { describe, expect, it } from "vitest";
import {
  LogDrainCollectorRuntime,
  discoverLogDrainEnvironments,
  logDrainKey,
  logDrainScopeKey,
  type LogDrainCensus,
  type LogDrainCollectorFailureCode,
} from "@/lib/server/compute/log-drain-collector-runtime";
import type {
  LogDrainBinding,
  LogDrainBindingSource,
  LogDrainCursorStore,
  LogDrainSourceReader,
  LogDrainSourceRow,
} from "@/lib/server/compute/log-drains";
import type { LogDrainSourceId } from "@/lib/console/log-drains";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Der Log-Drain-Sammler als Prozess (2.64): Entdeckung und Takt.
 *
 * Geprueft wird hier genau das, was eine Datenbank nicht besser beantwortet:
 * **welche** Umgebungen und **welche** Drains gelesen werden, **in welcher
 * Reihenfolge**, was geschieht, wenn ein einzelner Drain scheitert, ob ein
 * Neustart dort weiterliest, wo der vorige aufgehoert hat, und ob ein Drain
 * mit unlesbarer Position lieber gar nicht anfaengt. Dass am Ende eine
 * signierte Ladung bei einem echten Empfaenger liegt, sagen die Faelle (2.63)
 * und (2.64).
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

const FIRST_DRAIN = "11111111-aaaa-4aaa-8aaa-111111111111";
const SECOND_DRAIN = "22222222-bbbb-4bbb-8bbb-222222222222";

function drain(webhookId: string, sources: LogDrainSourceId[] = ["auth_audit"]): LogDrainBinding {
  return Object.freeze({ webhookId, sources: Object.freeze(sources), schemaVersion: 1 });
}

function auditRow(index: number): LogDrainSourceRow {
  const at = `2026-09-27T09:${String(index).padStart(2, "0")}:00.000Z`;
  return Object.freeze({
    cursor: `${at}#row-${index}`,
    record: Object.freeze({
      id: `row-${index}`,
      createdAt: at,
      action: "project_auth.sign_in",
      actorType: "app_user",
      resourceRef: `project_auth_user:${index}`,
      status: "succeeded",
    }),
  });
}

/** Eine Quelle je Umgebung. Eine Umgebung kann unlesbar geschaltet werden. */
class FakeReader implements LogDrainSourceReader {
  readonly rows = new Map<string, LogDrainSourceRow[]>();
  readonly unreadable = new Set<string>();
  readonly reads: Array<{ key: string; after: string | null }> = [];

  seed(scope: WebhookOutboxScope, source: LogDrainSourceId, rows: readonly LogDrainSourceRow[]) {
    this.rows.set(`${logDrainScopeKey(scope)} ${source}`, [...rows]);
  }

  append(scope: WebhookOutboxScope, source: LogDrainSourceId, row: LogDrainSourceRow) {
    const key = `${logDrainScopeKey(scope)} ${source}`;
    this.rows.set(key, [...(this.rows.get(key) ?? []), row]);
  }

  async tip(scope: WebhookOutboxScope, source: LogDrainSourceId): Promise<string | null> {
    const rows = this.rows.get(`${logDrainScopeKey(scope)} ${source}`) ?? [];
    return rows.length === 0 ? null : rows[rows.length - 1].cursor;
  }

  async read(scope: WebhookOutboxScope, source: LogDrainSourceId, input: {
    after: string | null; limit: number;
  }): Promise<readonly LogDrainSourceRow[]> {
    const key = `${logDrainScopeKey(scope)} ${source}`;
    this.reads.push({ key, after: input.after });
    if (this.unreadable.has(key)) throw new Error("control plane unreachable");
    const rows = this.rows.get(key) ?? [];
    return rows
      .filter((row) => input.after === null || row.cursor > input.after)
      .slice(0, input.limit);
  }
}

class FakeCensus implements LogDrainCensus {
  readonly counts = new Map<string, { total: number; enabled: number }>();
  readonly failing = new Set<string>();

  set(scope: WebhookOutboxScope, total: number, enabled: number) {
    this.counts.set(logDrainScopeKey(scope), { total, enabled });
  }

  async drainCounts(scope: WebhookOutboxScope) {
    const key = logDrainScopeKey(scope);
    if (this.failing.has(key)) throw new Error("control plane unreachable");
    return this.counts.get(key) ?? { total: 0, enabled: 0 };
  }
}

class FakeBindings implements LogDrainBindingSource {
  readonly drains = new Map<string, LogDrainBinding[]>();
  readonly failing = new Set<string>();

  set(scope: WebhookOutboxScope, bindings: LogDrainBinding[]) {
    this.drains.set(logDrainScopeKey(scope), bindings);
  }

  async activeDrains(scope: WebhookOutboxScope): Promise<LogDrainBinding[]> {
    const key = logDrainScopeKey(scope);
    if (this.failing.has(key)) throw new Error("control plane unreachable");
    return this.drains.get(key) ?? [];
  }
}

/** Die dauerhafte Position, monoton wie das GREATEST der echten Ablage. */
class FakeCursors implements LogDrainCursorStore {
  readonly positions = new Map<string, string>();
  readonly forwarded = new Set<string>();
  readonly failingLoads = new Set<string>();
  readonly failingAdvances = new Set<string>();
  readonly writes: Array<{ key: string; position: string; kind: "begin" | "advance" }> = [];

  private key(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId) {
    return `${logDrainKey(scope, webhookId)} ${source}`;
  }

  async load(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId) {
    const key = this.key(scope, webhookId, source);
    if (this.failingLoads.has(key)) throw new Error("cursor unreadable");
    return this.positions.has(key) ? this.positions.get(key)! : null;
  }

  async begin(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId,
    position: string) {
    const key = this.key(scope, webhookId, source);
    this.writes.push({ key, position, kind: "begin" });
    // DO NOTHING: ein vorhandener Anfangsstand wird nicht ueberschrieben.
    if (!this.positions.has(key)) this.positions.set(key, position);
  }

  async advance(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId,
    position: string) {
    const key = this.key(scope, webhookId, source);
    if (this.failingAdvances.has(key)) throw new Error("cursor unwritable");
    this.writes.push({ key, position, kind: "advance" });
    const current = this.positions.get(key);
    if (current === undefined || position > current) this.positions.set(key, position);
    this.forwarded.add(key);
  }
}

type Enqueued = { webhookId: string; eventType: string; payload: { entries: Array<{ id: string }> } };

function harness(options: {
  reader?: FakeReader;
  census?: FakeCensus;
  bindings?: FakeBindings;
  cursors?: FakeCursors;
  enqueued?: Enqueued[];
  failures?: Array<{ code: LogDrainCollectorFailureCode; scopeIndex: number }>;
  now?: () => number;
  maxBatchEntries?: number;
} = {}) {
  const reader = options.reader ?? new FakeReader();
  const census = options.census ?? new FakeCensus();
  const bindings = options.bindings ?? new FakeBindings();
  const cursors = options.cursors ?? new FakeCursors();
  const enqueued = options.enqueued ?? [];
  const failures = options.failures ?? [];
  const rounds: number[] = [];
  const runtime = new LogDrainCollectorRuntime({
    scopes: SCOPES,
    reader,
    drains: bindings,
    census,
    cursors,
    outbox: { enqueue: async (_scope, input) => {
      enqueued.push(input as unknown as Enqueued);
      return undefined as never;
    } },
    // Eine Zeile ist eine Ladung: Der Takt der Buendelung ist woanders
    // geprueft, hier geht es um die Reihenfolge und die Position.
    maxBatchEntries: options.maxBatchEntries ?? 1,
    ...(options.now ? { now: options.now } : {}),
    onFailure: (code, scopeIndex) => { failures.push({ code, scopeIndex }); },
    onEnqueued: (_scopeIndex, count) => { rounds.push(count); },
  });
  return { runtime, reader, census, bindings, cursors, enqueued, failures, rounds };
}

describe("log drain collector runtime", () => {
  it("polls only the environments that hold at least one drain", async () => {
    const census = new FakeCensus();
    census.set(ALPHA, 2, 1);
    census.set(BETA, 0, 0);
    census.set(GAMMA, 1, 0);

    const discovered = await discoverLogDrainEnvironments(SCOPES, census);
    expect(discovered.failures).toBe(0);
    // In der Reihenfolge der Scope-Liste, und ohne die Umgebung ohne Drain.
    expect(discovered.scopes.map(logDrainScopeKey))
      .toEqual([logDrainScopeKey(ALPHA), logDrainScopeKey(GAMMA)]);
  });

  it("keeps the previous answer when the control plane cannot be asked", async () => {
    const census = new FakeCensus();
    census.set(ALPHA, 1, 1);
    census.failing.add(logDrainScopeKey(ALPHA));
    census.failing.add(logDrainScopeKey(BETA));
    const seen: LogDrainCollectorFailureCode[] = [];

    // Eine laufende Umgebung bleibt laufen, eine stillgelegte bleibt still.
    const discovered = await discoverLogDrainEnvironments(
      SCOPES, census, new Set([logDrainScopeKey(ALPHA)]), (code) => seen.push(code));
    expect(discovered.scopes.map(logDrainScopeKey)).toEqual([logDrainScopeKey(ALPHA)]);
    expect(discovered.failures).toBe(2);
    expect(new Set(seen)).toEqual(new Set(["LOG_DRAIN_COLLECTOR_DISCOVERY_FAILED"]));
  });

  it("reads every drain of every watched environment in a fixed order", async () => {
    const kit = harness();
    kit.census.set(ALPHA, 2, 2);
    kit.census.set(BETA, 0, 0);
    kit.census.set(GAMMA, 1, 1);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN), drain(SECOND_DRAIN)]);
    kit.bindings.set(GAMMA, [drain(FIRST_DRAIN)]);

    const round = await kit.runtime.runOnce();
    expect(kit.runtime.watching).toEqual([logDrainScopeKey(ALPHA), logDrainScopeKey(GAMMA)]);
    // Erst die Drains von ALPHA in der Reihenfolge der Liste, dann GAMMA. BETA
    // hat keinen Drain und kommt nicht vor.
    expect(round.polled).toEqual([
      logDrainKey(ALPHA, FIRST_DRAIN),
      logDrainKey(ALPHA, SECOND_DRAIN),
      logDrainKey(GAMMA, FIRST_DRAIN),
    ]);
    expect(round.failed).toBe(0);
    expect(kit.reader.reads.some((read) => read.key.startsWith(logDrainScopeKey(BETA)))).toBe(false);
  });

  it("starts a new drain at the tip and writes that start down at once", async () => {
    const kit = harness();
    kit.census.set(ALPHA, 1, 1);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN)]);
    kit.reader.seed(ALPHA, "auth_audit", [auditRow(1), auditRow(2)]);

    // Ein neuer Drain schickt dem Empfaenger nicht als erste Handlung das
    // ganze bisherige Protokoll.
    expect((await kit.runtime.runOnce()).enqueued).toBe(0);
    expect(kit.enqueued).toEqual([]);
    const key = `${logDrainKey(ALPHA, FIRST_DRAIN)} auth_audit`;
    expect(kit.cursors.writes).toEqual([
      { key, position: auditRow(2).cursor, kind: "begin" },
    ]);
    // Und zwar wirklich festgehalten: Ohne dieses Schreiben spraenge ein
    // Neustart auf die inzwischen gewachsene Spitze.
    expect(kit.cursors.positions.get(key)).toBe(auditRow(2).cursor);
    expect(kit.cursors.forwarded.has(key)).toBe(false);
  });

  it("forwards what appears after the start and advances the durable position", async () => {
    const kit = harness();
    kit.census.set(ALPHA, 1, 1);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN)]);
    kit.reader.seed(ALPHA, "auth_audit", [auditRow(1)]);
    await kit.runtime.runOnce();

    kit.reader.append(ALPHA, "auth_audit", auditRow(2));
    const round = await kit.runtime.runOnce();
    expect(round.enqueued).toBe(1);
    expect(kit.enqueued).toHaveLength(1);
    expect(kit.enqueued[0].webhookId).toBe(FIRST_DRAIN);
    expect(kit.enqueued[0].payload.entries.map((entry) => entry.id)).toEqual(["row-2"]);
    const key = `${logDrainKey(ALPHA, FIRST_DRAIN)} auth_audit`;
    expect(kit.cursors.positions.get(key)).toBe(auditRow(2).cursor);
    expect(kit.cursors.forwarded.has(key)).toBe(true);
    expect(kit.rounds).toEqual([1]);
  });

  it("backs one failing drain off while the others keep running", async () => {
    let clock = 1_000;
    const kit = harness({ now: () => clock });
    kit.census.set(ALPHA, 2, 2);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN), drain(SECOND_DRAIN, ["storage_objects"])]);
    kit.reader.seed(ALPHA, "auth_audit", [auditRow(1)]);
    kit.reader.seed(ALPHA, "storage_objects", [auditRow(1)]);
    await kit.runtime.runOnce();

    // Die eine Quelle antwortet nicht mehr, die andere schon.
    kit.reader.unreadable.add(`${logDrainScopeKey(ALPHA)} storage_objects`);
    kit.reader.append(ALPHA, "auth_audit", auditRow(2));
    const failing = await kit.runtime.runOnce();
    expect(failing.polled).toEqual([logDrainKey(ALPHA, FIRST_DRAIN)]);
    expect(failing.failed).toBe(1);
    expect(failing.enqueued).toBe(1);
    expect(kit.failures).toEqual([
      { code: "LOG_DRAIN_COLLECTOR_UNREACHABLE", scopeIndex: 0 },
    ]);

    // Und in der naechsten Runde wird der gescheiterte Drain uebersprungen,
    // der gesunde nicht.
    kit.reader.append(ALPHA, "auth_audit", auditRow(3));
    const next = await kit.runtime.runOnce();
    expect(next.skipped).toEqual([logDrainKey(ALPHA, SECOND_DRAIN)]);
    expect(next.polled).toEqual([logDrainKey(ALPHA, FIRST_DRAIN)]);
    expect(next.failed).toBe(0);

    // Nach der Wartezeit ist er wieder dran -- und laeuft, wenn die Quelle
    // zurueck ist.
    clock += 600_000;
    kit.reader.unreadable.clear();
    const recovered = await kit.runtime.runOnce();
    expect(recovered.skipped).toEqual([]);
    expect(recovered.polled).toContain(logDrainKey(ALPHA, SECOND_DRAIN));
  });

  it("does not start a drain whose position cannot be read", async () => {
    const kit = harness();
    kit.census.set(ALPHA, 2, 2);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN), drain(SECOND_DRAIN)]);
    kit.reader.seed(ALPHA, "auth_audit", [auditRow(1), auditRow(2)]);
    kit.cursors.failingLoads.add(`${logDrainKey(ALPHA, FIRST_DRAIN)} auth_audit`);

    const round = await kit.runtime.runOnce();
    expect(round.failed).toBe(1);
    expect(kit.failures).toEqual([
      { code: "LOG_DRAIN_COLLECTOR_CURSOR_FAILED", scopeIndex: 0 },
    ]);
    // Kein Ersatzwert: weder die Spitze noch der Anfang. Der Drain hat keine
    // Position bekommen und nichts gesendet.
    expect(kit.cursors.writes.map((write) => write.key))
      .toEqual([`${logDrainKey(ALPHA, SECOND_DRAIN)} auth_audit`]);
    expect(kit.enqueued).toEqual([]);
    // Der zweite Drain derselben Umgebung laeuft trotzdem.
    expect(round.polled).toEqual([logDrainKey(ALPHA, SECOND_DRAIN)]);
  });

  it("continues after a restart without a replay and without a skip", async () => {
    const reader = new FakeReader();
    const census = new FakeCensus();
    const bindings = new FakeBindings();
    const cursors = new FakeCursors();
    const enqueued: Enqueued[] = [];
    census.set(ALPHA, 1, 1);
    bindings.set(ALPHA, [drain(FIRST_DRAIN)]);
    reader.seed(ALPHA, "auth_audit", [auditRow(1)]);

    const first = harness({ reader, census, bindings, cursors, enqueued });
    await first.runtime.runOnce();
    reader.append(ALPHA, "auth_audit", auditRow(2));
    await first.runtime.runOnce();
    first.runtime.stop();
    expect(enqueued.map((entry) => entry.payload.entries[0].id)).toEqual(["row-2"]);

    // Waehrend der Pause entsteht eine Zeile. Sie darf nicht verloren gehen.
    reader.append(ALPHA, "auth_audit", auditRow(3));

    // Ein **neuer** Prozess mit derselben Ablage: nichts im Speicher, alles in
    // der Control Plane.
    const second = harness({ reader, census, bindings, cursors, enqueued });
    await second.runtime.runOnce();
    reader.append(ALPHA, "auth_audit", auditRow(4));
    await second.runtime.runOnce();

    // Genau drei Ladungen, in der Reihenfolge der Ereignisse. Eine vierte
    // waere eine Wiederholung, zwei waeren ein verlorener Eintrag.
    expect(enqueued.map((entry) => entry.payload.entries[0].id))
      .toEqual(["row-2", "row-3", "row-4"]);
    expect(reader.reads.filter((read) => read.after === null)).toEqual([]);
  });

  it("drops the buffer of a drain that was switched off instead of sending it", async () => {
    const kit = harness({ maxBatchEntries: 10 });
    kit.census.set(ALPHA, 1, 1);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN)]);
    kit.reader.seed(ALPHA, "auth_audit", [auditRow(1)]);
    await kit.runtime.runOnce();
    kit.reader.append(ALPHA, "auth_audit", auditRow(2));
    // Gesammelt, aber die Ladung ist noch nicht voll.
    await kit.runtime.runOnce();
    expect(kit.enqueued).toEqual([]);

    // Abgeschaltet: der Drain verschwindet aus der Liste der aktiven.
    kit.bindings.set(ALPHA, []);
    const round = await kit.runtime.runOnce();
    expect(round.polled).toEqual([]);
    expect(kit.enqueued, "eine Ladung nach dem Abschalten").toEqual([]);
    expect(kit.runtime.watchingDrains).toEqual([]);
    // Und die Position ist nicht fortgeschrieben worden: Was im Puffer lag,
    // ist nicht hinausgegangen und wird beim Wiedereinschalten neu gelesen.
    expect(kit.cursors.forwarded.size).toBe(0);
  });

  it("stops a repeated run and refuses to run twice at the same time", async () => {
    const kit = harness();
    kit.census.set(ALPHA, 1, 1);
    kit.bindings.set(ALPHA, [drain(FIRST_DRAIN)]);
    const running = kit.runtime.run();
    await expect(kit.runtime.run()).rejects.toMatchObject({
      code: "LOG_DRAIN_COLLECTOR_RUNTIME_INVALID_INPUT",
    });
    kit.runtime.stop();
    await expect(running).resolves.toBeUndefined();
  });
});
