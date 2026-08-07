import { describe, expect, it } from "vitest";
import { RealtimeRetentionRuntime } from "@/lib/server/realtime/retention-runtime";
import type { RealtimeScope } from "@/lib/server/realtime/model";

const scope = (projectId: string): RealtimeScope => ({
  organizationId: "org-1", projectId, environment: "development",
});

function log(removed = 0, fail = false) {
  const calls: Array<{ scope: RealtimeScope; before: Date }> = [];
  return {
    calls,
    async prune(target: RealtimeScope, before: Date) {
      calls.push({ scope: target, before });
      if (fail) throw new Error("unreachable");
      return removed;
    },
  };
}

const NOW = new Date("2026-08-06T12:00:00.000Z");

describe("RealtimeRetentionRuntime", () => {
  it("prunes every configured scope, not only the ones with listeners", async () => {
    // Gerade das Projekt ohne Zuhoerer waechst unbeobachtet. Die Liste kommt
    // deshalb aus der Konfiguration, nicht aus den Abonnements.
    const events = log(3);
    const changes = log(5);
    const runtime = new RealtimeRetentionRuntime({
      eventLog: events, changeSource: changes,
      scopes: [scope("a"), scope("b")],
      eventRetentionMs: 7 * 86_400_000, changeRetentionMs: 86_400_000,
      now: () => NOW,
    });

    await expect(runtime.runOnce()).resolves.toEqual({ events: 6, changes: 10 });
    expect(events.calls.map((call) => call.scope.projectId)).toEqual(["a", "b"]);
  });

  it("keeps the two windows apart", async () => {
    const events = log();
    const changes = log();
    const runtime = new RealtimeRetentionRuntime({
      eventLog: events, changeSource: changes,
      scopes: [scope("a")],
      eventRetentionMs: 7 * 86_400_000, changeRetentionMs: 86_400_000,
      now: () => NOW,
    });
    await runtime.runOnce();

    expect(events.calls[0].before.toISOString()).toBe("2026-07-30T12:00:00.000Z");
    expect(changes.calls[0].before.toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("carries on when one project fails", async () => {
    // Ein nicht erreichbares Projekt darf die uebrigen nicht aufhalten. Sonst
    // waechst der ganze Rest, weil einer klemmt.
    const events = log(0, true);
    const changes = log(4);
    const runtime = new RealtimeRetentionRuntime({
      eventLog: events, changeSource: changes,
      scopes: [scope("a"), scope("b")],
      eventRetentionMs: 60_000, changeRetentionMs: 60_000,
      now: () => NOW,
    });

    await expect(runtime.runOnce()).resolves.toEqual({ events: 0, changes: 8 });
    expect(changes.calls).toHaveLength(2);
  });

  it("leaves the change feed alone when no source is configured", async () => {
    const events = log(1);
    const runtime = new RealtimeRetentionRuntime({
      eventLog: events, scopes: [scope("a")],
      eventRetentionMs: 60_000, changeRetentionMs: 60_000, now: () => NOW,
    });
    await expect(runtime.runOnce()).resolves.toEqual({ events: 1, changes: 0 });
  });

  it("refuses a retention window that is not a window", async () => {
    // Eine Aufbewahrung von null Millisekunden loescht alles, auch das, was
    // gerade geschrieben wurde. Das ist kein Betriebswert, sondern ein Fehler.
    expect(() => new RealtimeRetentionRuntime({
      eventLog: log(), scopes: [], eventRetentionMs: 0, changeRetentionMs: 60_000,
    })).toThrow(RangeError);
  });

  it("stops between projects instead of finishing the round", async () => {
    const events = log(1);
    const runtime = new RealtimeRetentionRuntime({
      eventLog: events, scopes: [scope("a"), scope("b"), scope("c")],
      eventRetentionMs: 60_000, changeRetentionMs: 60_000, now: () => NOW,
    });
    runtime.stop();
    await expect(runtime.runOnce()).resolves.toEqual({ events: 0, changes: 0 });
  });
});
