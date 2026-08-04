import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LoopbackRuntimeProbeServer,
  RuntimeProbeState,
  createLoopbackRuntimeProbeFromEnv,
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";

const servers: LoopbackRuntimeProbeServer[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
});

describe("runtime probe state", () => {
  it("requires a current successful iteration and fails closed on errors, clock rollback and stop", () => {
    let now = Date.parse("2026-07-26T14:00:00.000Z");
    const state = new RuntimeProbeState(1_000, () => new Date(now));

    expect(state.snapshot()).toEqual({ live: true, ready: false, phase: "starting" });
    state.runtimeStarted();
    expect(state.snapshot()).toEqual({ live: true, ready: false, phase: "running" });

    state.iterationSucceeded();
    expect(state.snapshot().ready).toBe(true);
    now += 1_000;
    expect(state.snapshot().ready).toBe(true);
    now += 1;
    expect(state.snapshot().ready).toBe(false);

    state.iterationSucceeded();
    state.iterationFailed();
    expect(state.snapshot().ready).toBe(false);
    state.iterationSucceeded();
    expect(state.snapshot().ready).toBe(true);
    now -= 1;
    expect(state.snapshot().ready).toBe(false);

    state.runtimeStopped();
    expect(state.snapshot()).toEqual({ live: false, ready: false, phase: "stopping" });
    state.iterationSucceeded();
    expect(state.snapshot().ready).toBe(false);
  });
});

describe("loopback runtime probe server", () => {
  it("serves only fixed no-store live/ready probes and never marks startup ready", async () => {
    const state = new RuntimeProbeState();
    const server = new LoopbackRuntimeProbeServer(state, 0);
    servers.push(server);
    const address = await server.start();
    expect(address.host).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    const base = `http://${address.host}:${address.port}`;

    const live = await fetch(`${base}/live`);
    expect(live.status).toBe(200);
    expect(await live.text()).toBe("live\n");
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(live.headers.get("x-content-type-options")).toBe("nosniff");

    const starting = await fetch(`${base}/ready`);
    expect(starting.status).toBe(503);
    expect(await starting.text()).toBe("not ready\n");

    state.runtimeStarted();
    state.iterationSucceeded();
    const ready = await fetch(`${base}/ready`, { method: "HEAD" });
    expect(ready.status).toBe(200);
    expect(await ready.text()).toBe("");

    const method = await fetch(`${base}/ready`, { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, HEAD");
    expect(await method.text()).not.toMatch(/phase|timestamp|process|worker|publisher/i);

    const unknown = await fetch(`${base}/ready?details=true`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("not found\n");
  });

  it("is absent by default and rejects every non-loopback or unsafe timing configuration", async () => {
    expect(createLoopbackRuntimeProbeFromEnv({})).toBeUndefined();
    expect(() => createLoopbackRuntimeProbeFromEnv({
      QKERN_RUNTIME_PROBE_ENABLED: "true",
      QKERN_RUNTIME_PROBE_HOST: "0.0.0.0",
    })).toThrow("only to 127.0.0.1");
    expect(() => createLoopbackRuntimeProbeFromEnv({
      QKERN_RUNTIME_PROBE_ENABLED: "true",
      QKERN_RUNTIME_PROBE_PORT: "80",
    })).toThrow("outside the allowed range");
    expect(() => createLoopbackRuntimeProbeFromEnv({
      QKERN_RUNTIME_PROBE_ENABLED: "true",
      QKERN_RUNTIME_PROBE_PORT: "not-a-port",
    })).toThrow("decimal integer");
    expect(() => createLoopbackRuntimeProbeFromEnv({
      QKERN_RUNTIME_PROBE_ENABLED: "true",
      QKERN_RUNTIME_PROBE_STALE_AFTER_MS: "999",
    })).toThrow("outside the allowed range");

    const probe = createLoopbackRuntimeProbeFromEnv({
      QKERN_RUNTIME_PROBE_ENABLED: "true",
      QKERN_RUNTIME_PROBE_HOST: "127.0.0.1",
      QKERN_RUNTIME_PROBE_PORT: "9465",
      QKERN_RUNTIME_PROBE_STALE_AFTER_MS: "30000",
    });
    expect(probe).toBeInstanceOf(LoopbackRuntimeProbeServer);
    await probe?.stop();
  });

  it("isolates observer failures from runtime outcomes", () => {
    const observer = {
      runtimeStarted: vi.fn(() => { throw new Error("probe unavailable"); }),
      iterationSucceeded: vi.fn(),
      iterationFailed: vi.fn(),
      runtimeStopped: vi.fn(),
    } satisfies RuntimeProbeObserver;
    expect(() => safeRuntimeProbe(observer, "runtimeStarted")).not.toThrow();
    expect(observer.runtimeStarted).toHaveBeenCalledOnce();
  });
});
