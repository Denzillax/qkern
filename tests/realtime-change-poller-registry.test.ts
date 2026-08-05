import { describe, expect, it } from "vitest";
import {
  RealtimeChangePollerRegistry,
  type RealtimeChangeAudience,
} from "@/lib/server/realtime/change-poller-registry";
import type { RealtimeChangeSource } from "@/lib/server/realtime/change-source";
import { RealtimeError, type RealtimeScope } from "@/lib/server/realtime/model";

function scope(projectId: string): RealtimeScope {
  return { organizationId: "org-1", projectId, environment: "development" };
}

/** Quelle, die mitschreibt, fuer welche Projekte gelesen wurde. */
function source() {
  const read = new Set<string>();
  const implementation: RealtimeChangeSource = {
    async read(target) {
      read.add(target.projectId);
      return [];
    },
    async prune() { return 0; },
  };
  return { read, source: implementation };
}

function audience(scopes: RealtimeScope[]): RealtimeChangeAudience & { scopes: RealtimeScope[] } {
  const state = { scopes: [...scopes] };
  return {
    get scopes() { return state.scopes; },
    set scopes(next: RealtimeScope[]) { state.scopes = next; },
    changeSubscriptionScopes: () => state.scopes,
    async deliverChanges() { return []; },
  };
}

/** Laesst die gestarteten Schleifen einmal laufen. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("RealtimeChangePollerRegistry", () => {
  it("starts a poller for every watched project", async () => {
    const feed = source();
    const listeners = audience([scope("alpha"), scope("beta")]);
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source, audience: listeners, idleIntervalMs: 50,
    });

    registry.reconcile();
    await tick();

    expect(registry.watching).toHaveLength(2);
    expect([...feed.read].sort()).toEqual(["alpha", "beta"]);
    await registry.stop();
  });

  it("polls no project when nobody subscribes", async () => {
    // Alle Projekte zu pollen wuerde jede Projektdatenbank ohne Anlass belasten.
    const feed = source();
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source, audience: audience([]), idleIntervalMs: 50,
    });

    registry.reconcile();
    await tick();

    expect(registry.watching).toEqual([]);
    expect(feed.read.size).toBe(0);
    await registry.stop();
  });

  it("is idempotent and does not restart a running poller", async () => {
    const feed = source();
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source, audience: audience([scope("alpha")]), idleIntervalMs: 50,
    });

    registry.reconcile();
    const first = registry.watching;
    registry.reconcile();
    registry.reconcile();

    expect(registry.watching).toEqual(first);
    await registry.stop();
  });

  it("stops a poller once its last subscriber is gone", async () => {
    const feed = source();
    const listeners = audience([scope("alpha"), scope("beta")]);
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source, audience: listeners, idleIntervalMs: 50,
    });

    registry.reconcile();
    await tick();
    expect(registry.watching).toHaveLength(2);

    listeners.scopes = [scope("alpha")];
    registry.reconcile();

    expect(registry.watching).toHaveLength(1);
    await registry.stop();
  });

  it("deduplicates repeated scopes from several connections", async () => {
    const feed = source();
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source,
      audience: audience([scope("alpha"), scope("alpha"), scope("alpha")]),
      idleIntervalMs: 50,
    });

    registry.reconcile();
    expect(registry.watching).toHaveLength(1);
    await registry.stop();
  });

  it("fails loudly instead of silently dropping projects beyond the limit", async () => {
    const feed = source();
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source,
      audience: audience([scope("a"), scope("b"), scope("c")]),
      maxScopes: 2,
    });

    expect(() => registry.reconcile()).toThrow(RealtimeError);
    await registry.stop();
  });

  it("stops everything and waits for the loops on shutdown", async () => {
    const feed = source();
    const registry = new RealtimeChangePollerRegistry({
      source: feed.source, audience: audience([scope("alpha"), scope("beta")]), idleIntervalMs: 50,
    });

    registry.reconcile();
    await tick();
    await registry.stop();

    expect(registry.watching).toEqual([]);
    // Nach dem Stopp startet auch ein erneutes reconcile nichts mehr.
    registry.reconcile();
    expect(registry.watching).toEqual([]);
  });
});
