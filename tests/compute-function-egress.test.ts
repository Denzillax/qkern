import { describe, expect, it } from "vitest";
import { MediatedFunctionEgress, isEgressRejection } from "@/lib/server/compute/function-egress";
import type { FunctionDefinition } from "@/lib/server/compute/model";

function definition(origins: readonly string[]): FunctionDefinition {
  return Object.freeze({
    organizationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    environment: "development" as const,
    id: "33333333-3333-4333-8333-333333333333",
    name: "probe",
    runtime: "nodejs24" as const,
    image: `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`,
    entrypoint: "handler.mjs",
    timeoutMs: 30_000,
    memoryMiB: 128,
    maxConcurrency: 1,
    egressOrigins: Object.freeze([...origins]),
    secretRefs: Object.freeze([]),
  });
}

const allowed = definition(["https://api.example.com"]);

function egress(options: ConstructorParameters<typeof MediatedFunctionEgress>[0] = {}) {
  return new MediatedFunctionEgress({
    fetchFn: async () => new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    }),
    ...options,
  });
}

describe("MediatedFunctionEgress", () => {
  it("lets an exactly allowlisted origin through", async () => {
    const outcome = await egress().request(allowed, { url: "https://api.example.com/v1/ping" });
    expect(outcome).toMatchObject({ status: 200, body: '{"ok":true}' });
  });

  it("refuses a neighbouring origin that only looks similar", async () => {
    // `api.example.com.evil.test` ist eine andere Origin. Ein Praefixvergleich
    // waere hier genau der Fehler.
    for (const url of [
      "https://api.example.com.evil.test/v1/ping",
      "https://evil.test/?x=https://api.example.com",
      "https://api.example.com:8443/v1/ping",
      "http://api.example.com/v1/ping",
      "https://user:pass@api.example.com/v1/ping",
    ]) {
      expect(await egress().request(allowed, { url })).toEqual({ error: "EGRESS_NOT_ALLOWED" });
    }
  });

  it("refuses everything when the definition allows nothing", async () => {
    expect(await egress().request(definition([]), { url: "https://api.example.com/v1/ping" }))
      .toEqual({ error: "EGRESS_NOT_ALLOWED" });
  });

  it("never follows a redirect", async () => {
    // Eine Umleitung koennte an ein Ziel fuehren, das nicht auf der Allowlist
    // steht — ihr zu folgen hiesse, die Policy zu umgehen.
    let seen: RequestInit | undefined;
    const service = egress({
      fetchFn: async (_url, init) => {
        seen = init as RequestInit;
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    });
    await service.request(allowed, { url: "https://api.example.com/v1/ping" });
    expect(seen?.redirect).toBe("error");
    expect(seen?.cache).toBe("no-store");
  });

  it("refuses a method outside the small allowed set", async () => {
    for (const method of ["TRACE", "CONNECT", "OPTIONS", "BREW"]) {
      expect(await egress().request(allowed, { url: "https://api.example.com/x", method }))
        .toEqual({ error: "EGRESS_INVALID" });
    }
  });

  it("refuses headers that belong to the runtime, not the function", async () => {
    const cases: Array<Record<string, string>> = [
      { host: "elsewhere.test" },
      { cookie: "session=stolen" },
      { "proxy-authorization": "Basic x" },
      { "content-length": "0" },
      { "x-bad\nname": "v" },
      { "x-injected": "a\r\nX-Other: b" },
    ];
    for (const headers of cases) {
      expect(await egress().request(allowed, { url: "https://api.example.com/x", headers }))
        .toEqual({ error: "EGRESS_INVALID" });
    }
  });

  it("bounds the request body", async () => {
    const outcome = await egress({ maxRequestBytes: 1024 }).request(allowed, {
      url: "https://api.example.com/x", method: "POST", body: "x".repeat(2_000),
    });
    expect(outcome).toEqual({ error: "EGRESS_INVALID" });
  });

  it("bounds the response instead of buffering whatever arrives", async () => {
    const flood = egress({
      maxResponseBytes: 1024,
      fetchFn: async () => new Response("y".repeat(4_000), {
        headers: { "content-type": "text/plain" },
      }),
    });
    expect(await flood.request(allowed, { url: "https://api.example.com/x" }))
      .toEqual({ error: "EGRESS_LIMIT" });
  });

  it("keeps the failure cause out of the outcome", async () => {
    const failing = egress({
      fetchFn: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:443"); },
    });
    const outcome = await failing.request(allowed, { url: "https://api.example.com/x" });
    expect(outcome).toEqual({ error: "EGRESS_FAILED" });
    expect(JSON.stringify(outcome)).not.toContain("ECONNREFUSED");
  });

  it("returns only a small, fixed set of response headers", async () => {
    const service = egress({
      fetchFn: async () => new Response("{}", {
        headers: {
          "content-type": "application/json",
          "set-cookie": "session=abc",
          "x-internal-backend": "pod-17",
        },
      }),
    });
    const outcome = await service.request(allowed, { url: "https://api.example.com/x" });
    if (isEgressRejection(outcome)) throw new Error("unexpected rejection");
    expect(Object.keys(outcome.headers)).toEqual(["content-type"]);
  });

  it("spends a budget that runs out", async () => {
    const budget = egress({ maxRequests: 2 }).budget();
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(false);
  });
});
