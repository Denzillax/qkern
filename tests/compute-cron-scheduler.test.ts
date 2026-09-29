import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CronScheduler, type CronProgress, type CronRepository } from
  "@/lib/server/compute/cron-scheduler";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "db/migrations/0031_project_cron.sql"), "utf8",
);

const scope = {
  organizationId: "org-1", projectId: "project-1", environment: "development" as const,
};

const principal: ProjectQueuePrincipal = {
  organizationId: scope.organizationId,
  actorRef: "service-role:cron",
  role: "service_role",
  subject: "cron",
};

function definition(overrides: Partial<CronProgress> = {}): CronProgress {
  return {
    ...scope,
    id: "cron-1",
    name: "nightly",
    expression: "*/5 * * * *",
    queue: "jobs",
    payload: { task: "run" },
    enabled: true,
    lastDispatchedAt: null,
    ...overrides,
  };
}

function repository(definitions: CronProgress[]) {
  const recorded: Array<{ id: string; at: Date }> = [];
  const implementation: CronRepository = {
    async listActive() { return definitions; },
    async recordDispatch(_principal, id, at) { recorded.push({ id, at }); },
  };
  return { recorded, repository: implementation };
}

function dispatcher(fail = false) {
  const dispatched: Array<{ id: string; at: Date }> = [];
  return {
    dispatched,
    async dispatch(target: CronProgress, at: Date) {
      if (fail) throw new Error("queue is full");
      dispatched.push({ id: target.id, at });
      return { status: "dispatched" as const, messageId: "m", scheduledAt: at.toISOString() };
    },
  };
}

describe("cron scheduler with a time zone", () => {
  it("computes due occurrences on the wall clock of the definition's zone", async () => {
    // 02:30 Berlin im August ist 00:30Z. Fortschritt gestern 00:30Z, jetzt
    // 00:31Z: genau ein Vorkommen, und zwar 00:30Z, nicht 02:30Z.
    const store = repository([definition({
      expression: "30 2 * * *", timeZone: "Europe/Berlin",
      lastDispatchedAt: new Date("2026-08-04T00:30:00.000Z"),
    })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: store.repository, dispatcher: sink,
      now: () => new Date("2026-08-05T00:31:00.000Z"),
    });
    const result = await scheduler.run(principal, scope);
    expect(result).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
    expect(sink.dispatched.map((entry) => entry.at.toISOString())).toEqual(["2026-08-05T00:30:00.000Z"]);
  });
});

describe("cron migration", () => {
  it("keeps expression, queue and payload immutable through the grant", () => {
    // Eine Aenderung erfolgt ueber Loeschen und Neuanlegen und damit ueber den
    // Audit-Weg.
    expect(migration).toContain("GRANT UPDATE (last_dispatched_at, enabled, updated_at)");
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*expression/);
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*payload/);
  });

  it("refuses progress that moves backwards", () => {
    // Ein Ruecksprung wuerde vergangene Vorkommen erneut ausloesen; das
    // Dedupe-Fenster der Queue ist endlich und faengt das nicht dauerhaft ab.
    expect(migration).toContain("cron progress must not move backwards");
    expect(migration).toContain("cron identity is immutable");
  });

  it("uses no lease: the queue is already the authority for exactly-once", () => {
    // Nur Sperr- und Lease-Konstrukte pruefen. `FOR UPDATE` kommt in der
    // RLS-Policy-Syntax vor und ist dort keine Sperrklausel.
    expect(migration).not.toMatch(/lease_token|lease_expires_at/);
    expect(migration).not.toMatch(/SELECT[^;]*FOR UPDATE|SKIP LOCKED/);
  });

  it("isolates tenants on every access path", () => {
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(migration).toContain(`project_cron_definitions_${action} ON project_cron_definitions`);
    }
  });
});

describe("CronScheduler", () => {
  const at = (iso: string) => new Date(iso);

  it("dispatches a due occurrence and records the progress", async () => {
    const feed = repository([definition({ lastDispatchedAt: at("2026-08-04T12:00:00.000Z") })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, now: () => at("2026-08-04T12:06:00.000Z"),
    });

    const result = await scheduler.run(principal, scope);

    expect(result).toMatchObject({ dispatched: 1, failed: 0 });
    expect(sink.dispatched[0]?.at.toISOString()).toBe("2026-08-04T12:05:00.000Z");
    expect(feed.recorded[0]?.at.toISOString()).toBe("2026-08-04T12:05:00.000Z");
  });

  it("does not work through the past for a fresh definition", async () => {
    // Eine neu angelegte Definition soll ab jetzt laufen, nicht die
    // Vergangenheit aufarbeiten: um 12:06 ist der Grenzzeitpunkt 12:05 bereits
    // vorbei und gehoert nicht ihr.
    const feed = repository([definition({ lastDispatchedAt: null })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, now: () => at("2026-08-04T12:06:00.000Z"),
    });

    await scheduler.run(principal, scope);
    expect(sink.dispatched).toHaveLength(0);
  });

  it("fires a fresh definition at the next boundary", async () => {
    const feed = repository([definition({ lastDispatchedAt: null })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, now: () => at("2026-08-04T12:10:30.000Z"),
    });

    await scheduler.run(principal, scope);
    expect(sink.dispatched.map((entry) => entry.at.toISOString()))
      .toEqual(["2026-08-04T12:10:00.000Z"]);
  });

  it("bounds catch-up after a long outage", async () => {
    // Nach einem Tag Ausfall waeren es bei Minutentakt ueber 1400 Nachrichten.
    // Ein Betreiber will, dass es wieder laeuft, nicht dass der Rueckstand
    // vollstaendig nachgeholt wird.
    const feed = repository([definition({
      expression: "*/1 * * * *", lastDispatchedAt: at("2026-08-03T12:00:00.000Z"),
    })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, maxCatchUp: 3,
      now: () => at("2026-08-04T12:00:00.000Z"),
    });

    const result = await scheduler.run(principal, scope);
    expect(result.dispatched).toBe(3);
    expect(sink.dispatched).toHaveLength(3);
  });

  it("skips a definition with no due occurrence", async () => {
    const feed = repository([definition({ lastDispatchedAt: at("2026-08-04T12:05:00.000Z") })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, now: () => at("2026-08-04T12:06:00.000Z"),
    });

    expect(await scheduler.run(principal, scope)).toMatchObject({ dispatched: 0, skipped: 1 });
  });

  it("ignores a disabled definition", async () => {
    const feed = repository([definition({ enabled: false })]);
    const sink = dispatcher();
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: sink, now: () => at("2026-08-04T12:06:00.000Z"),
    });

    await scheduler.run(principal, scope);
    expect(sink.dispatched).toHaveLength(0);
  });

  it("keeps running when one definition fails", async () => {
    // Eine volle Queue darf die uebrigen Definitionen nicht mitreissen.
    const failures: unknown[] = [];
    const feed = repository([
      definition({ id: "broken", lastDispatchedAt: at("2026-08-04T12:00:00.000Z") }),
      definition({ id: "healthy", lastDispatchedAt: at("2026-08-04T12:00:00.000Z") }),
    ]);
    let call = 0;
    const scheduler = new CronScheduler({
      repository: feed.repository,
      dispatcher: {
        async dispatch(target, when) {
          call += 1;
          if (call === 1) throw new Error("queue is full");
          return { status: "dispatched" as const, messageId: "m", scheduledAt: when.toISOString() };
        },
      },
      onError: (error) => failures.push(error),
      now: () => at("2026-08-04T12:06:00.000Z"),
    });

    const result = await scheduler.run(principal, scope);
    expect(result).toMatchObject({ dispatched: 1, failed: 1 });
    expect(failures).toHaveLength(1);
  });

  it("records progress only after a successful dispatch", async () => {
    const feed = repository([definition({ lastDispatchedAt: at("2026-08-04T12:00:00.000Z") })]);
    const scheduler = new CronScheduler({
      repository: feed.repository, dispatcher: dispatcher(true),
      onError: () => undefined, now: () => at("2026-08-04T12:06:00.000Z"),
    });

    await scheduler.run(principal, scope);
    // Sonst waere das Vorkommen verloren: der naechste Lauf haette es
    // uebersprungen, obwohl es nie ausgeloest wurde.
    expect(feed.recorded).toHaveLength(0);
  });

  it("rejects an implausible catch-up limit", () => {
    const feed = repository([]);
    expect(() => new CronScheduler({
      repository: feed.repository, dispatcher: dispatcher(), maxCatchUp: 0,
    })).toThrow();
    expect(() => new CronScheduler({
      repository: feed.repository, dispatcher: dispatcher(), maxCatchUp: 1_000,
    })).toThrow();
  });
});
