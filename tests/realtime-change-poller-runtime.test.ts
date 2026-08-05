import { describe, expect, it } from "vitest";
import { RealtimeChangePollerRuntime } from "@/lib/server/realtime/change-poller-runtime";
import { RealtimeError } from "@/lib/server/realtime/model";

/** Poller-Attrappe mit vorgegebener Antwortfolge. */
function poller(results: Array<number | Error>) {
  let index = 0;
  const calls: number[] = [];
  let stopped = false;
  return {
    calls,
    get stopped() { return stopped; },
    stop() { stopped = true; },
    async poll() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      calls.push(index);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Ersetzt echtes Warten, zeichnet aber die angeforderten Wartezeiten auf. */
function clock() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => { waits.push(ms); },
  };
}

describe("RealtimeChangePollerRuntime", () => {
  it("polls again immediately while it still finds changes", async () => {
    // Ein Rueckstand soll nicht im Takt des Intervalls abgearbeitet werden.
    const driver = poller([5, 5, 0]);
    const time = clock();
    const runtime = new RealtimeChangePollerRuntime({
      poller: driver, idleIntervalMs: 500, sleep: async (ms) => {
        time.waits.push(ms);
        runtime.stop();
      },
    });

    await runtime.run();

    expect(driver.calls).toHaveLength(3);
    expect(time.waits).toEqual([500]);
  });

  it("waits the idle interval when there was nothing to do", async () => {
    const driver = poller([0]);
    const waits: number[] = [];
    const runtime = new RealtimeChangePollerRuntime({
      poller: driver, idleIntervalMs: 250, sleep: async (ms) => {
        waits.push(ms);
        runtime.stop();
      },
    });

    await runtime.run();
    expect(waits).toEqual([250]);
  });

  it("keeps running after an error and backs off longer", async () => {
    // Die Position wurde nicht fortgeschrieben, der naechste Lauf liest
    // denselben Bereich erneut. Ein dauerhaft fehlschlagender Lauf soll die
    // Datenbank aber nicht mit Wiederholungen belasten.
    const failures: unknown[] = [];
    const driver = poller([new Error("database unavailable")]);
    const waits: number[] = [];
    const runtime = new RealtimeChangePollerRuntime({
      poller: driver,
      idleIntervalMs: 100,
      errorIntervalMs: 4_000,
      onError: (error) => failures.push(error),
      sleep: async (ms) => {
        waits.push(ms);
        runtime.stop();
      },
    });

    await runtime.run();

    expect(failures).toHaveLength(1);
    expect(waits).toEqual([4_000]);
  });

  it("stops the poller as well when it is stopped", async () => {
    const driver = poller([0]);
    const runtime = new RealtimeChangePollerRuntime({
      poller: driver, sleep: async () => { runtime.stop(); },
    });

    await runtime.run();
    expect(driver.stopped).toBe(true);
    expect(runtime.active).toBe(false);
  });

  it("refuses to run twice at the same time", async () => {
    const driver = poller([0]);
    const runtime = new RealtimeChangePollerRuntime({
      poller: driver,
      sleep: async () => {
        await expect(runtime.run()).rejects.toBeInstanceOf(RealtimeError);
        runtime.stop();
      },
    });

    await runtime.run();
  });

  it("rejects an interval outside its bounds", () => {
    const driver = poller([0]);
    expect(() => new RealtimeChangePollerRuntime({ poller: driver, idleIntervalMs: 10 }))
      .toThrow(RealtimeError);
    expect(() => new RealtimeChangePollerRuntime({ poller: driver, errorIntervalMs: 10 }))
      .toThrow(RealtimeError);
  });

  it("wakes an ongoing wait instead of sleeping it out on shutdown", async () => {
    // Ohne das wuerde ein SIGTERM bis zum Ablauf des Intervalls haengen.
    const driver = poller([0]);
    const runtime = new RealtimeChangePollerRuntime({ poller: driver, idleIntervalMs: 30_000 });

    const finished = runtime.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAt = Date.now();
    runtime.stop();
    await finished;

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
