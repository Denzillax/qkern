import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BufferedUsageEmitter } from "@/lib/server/usage/buffered-emitter";
import type { UsageAdmission, UsageEmitterPort, UsageMeasurement } from "@/lib/server/usage/emitter";
import type { UsageScope } from "@/lib/server/usage/model";

const scope: UsageScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
};
const other: UsageScope = { ...scope, projectId: "33333333-3333-4333-8333-333333333333" };

type Written = { scope: UsageScope; input: UsageMeasurement };

function ledger(answers: UsageAdmission[] = []) {
  const written: Written[] = [];
  const emitter: UsageEmitterPort = {
    async admit(target, input) {
      written.push({ scope: target, input });
      return answers.shift() ?? { admitted: true, reason: null };
    },
  };
  return { emitter, written };
}

describe("BufferedUsageEmitter", () => {
  it("writes one batch instead of one booking per message", async () => {
    const { emitter, written } = ledger();
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    for (let index = 0; index < 25; index += 1) {
      await buffered.admit(scope, { metric: "realtime_messages", reference: `m-${index}` });
    }
    expect(written).toHaveLength(0);
    expect(buffered.buffered(scope, "realtime_messages")).toBe(25);

    await buffered.flush();
    expect(written).toHaveLength(1);
    expect(written[0].input).toMatchObject({ metric: "realtime_messages", quantity: 25 });
  });

  it("keeps scopes apart", async () => {
    const { emitter, written } = ledger();
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    await buffered.admit(scope, { metric: "realtime_messages", reference: "a" });
    await buffered.admit(other, { metric: "realtime_messages", reference: "b" });
    await buffered.flush();

    expect(written).toHaveLength(2);
    expect(new Set(written.map((entry) => entry.scope.projectId)))
      .toEqual(new Set([scope.projectId, other.projectId]));
  });

  it("writes on its own once the batch is large enough", async () => {
    const { emitter, written } = ledger();
    const buffered = new BufferedUsageEmitter({ inner: emitter, flushAtQuantity: 3 });
    for (let index = 0; index < 3; index += 1) {
      await buffered.admit(scope, { metric: "realtime_messages", reference: `m-${index}` });
    }
    expect(written).toHaveLength(1);
    expect(buffered.buffered(scope, "realtime_messages")).toBe(0);
  });

  it("always admits, because it cannot refuse what it already counted", async () => {
    const { emitter } = ledger([{ admitted: false, reason: "quota_exceeded" }]);
    const buffered = new BufferedUsageEmitter({ inner: emitter, flushAtQuantity: 1 });
    await expect(buffered.admit(scope, { metric: "realtime_messages", reference: "a" }))
      .resolves.toEqual({ admitted: true, reason: null });
  });

  it("retries a batch the ledger never received, with the same key", async () => {
    // `unavailable` heisst: nichts verbucht. Der Stapel behaelt seinen
    // Schluessel, ein doppelt angekommener zaehlt also trotzdem einmal.
    const { emitter, written } = ledger([{ admitted: true, reason: "unavailable" }]);
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    await buffered.admit(scope, { metric: "realtime_messages", reference: "a" });
    await buffered.flush();
    await buffered.flush();

    expect(written).toHaveLength(2);
    expect(written[0].input.reference).toBe(written[1].input.reference);
    expect(written[1].input.quantity).toBe(1);
  });

  it("does not retry a batch the ledger decided about", async () => {
    // Eine Ablehnung wiederholt zu senden brächte dieselbe Antwort und liefe
    // ewig. Genau deshalb ist ein hartes Limit hier nicht setzbar.
    const { emitter, written } = ledger([{ admitted: false, reason: "quota_exceeded" }]);
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    await buffered.admit(scope, { metric: "realtime_messages", reference: "a" });
    await buffered.flush();
    await buffered.flush();
    expect(written).toHaveLength(1);
  });

  it("does not merge a retried batch with newer messages", async () => {
    // Derselbe Schluessel mit anderer Menge waere ein Idempotenzkonflikt und
    // machte den Stapel dauerhaft unschreibbar.
    const { emitter, written } = ledger([{ admitted: true, reason: "unavailable" }]);
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    await buffered.admit(scope, { metric: "realtime_messages", reference: "a" });
    await buffered.flush();
    await buffered.admit(scope, { metric: "realtime_messages", reference: "b" });
    await buffered.flush();

    expect(written.map((entry) => entry.input.quantity)).toEqual([1, 1, 1]);
    expect(written[2].input.reference).not.toBe(written[1].input.reference);
  });

  it("writes what it has when it is stopped", async () => {
    const { emitter, written } = ledger();
    const buffered = new BufferedUsageEmitter({ inner: emitter });
    await buffered.admit(scope, { metric: "realtime_messages", reference: "a" });
    await buffered.stop();
    expect(written).toHaveLength(1);
  });
});

describe("api request metering placement", () => {
  /**
   * Release 1.32 hat den Helfer zertifiziert, nicht seine Platzierung. Dieser
   * Test schliesst genau diese Luecke — am Quelltext, nicht am Verhalten. Er
   * faengt den tatsaechlichen Fehlerfall: Jemand fuegt einen Kontext-Resolver
   * hinzu und denkt nicht daran.
   */
  const files = [
    "lib/server/project-queues/http.ts",
    "lib/server/project-storage/http.ts",
    "lib/server/data-plane/generated-http.ts",
  ];

  it("counts in every context resolver of a metered module", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Jeder Resolver reicht bis zum naechsten Top-Level-Export. Gezaehlt wird
      // nicht, wie oft gemessen wird — `generatedDataContext` misst in zwei
      // sich ausschliessenden Zweigen — sondern ob ueberhaupt.
      const starts = [...source.matchAll(/^export async function (\w*Context)\(/gm)];
      for (const [index, match] of starts.entries()) {
        const from = match.index!;
        const to = source.indexOf("\nexport ", from + 1);
        const body = source.slice(from, to === -1 ? source.length : to);
        seen += 1;
        if (!body.includes("admitApiRequest(")) missing.push(`${file}:${starts[index][1]}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
    expect(missing).toEqual([]);
  });
});
