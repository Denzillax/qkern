import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import { realtimeBindPlan } from "@/lib/server/realtime/production-gate";

/**
 * Das Production-Tor, Bedingung fuer Bedingung.
 *
 * Der Prozessnachweis der Abweisung — der ausgelieferte Worker weigert sich zu
 * lauschen und nennt die verletzte Bedingung — steht in
 * `tests/realtime-process-postgres.integration.test.ts`.
 */

const SECRET = Buffer.alloc(32, 7).toString("base64url");
const SCOPES = JSON.stringify([{
  organizationId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  environment: "development",
}]);

/** Eine Production-Umgebung, in der jede Bedingung erfuellt ist. */
function complete(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    QKERN_REALTIME_CURSOR_SECRET: SECRET,
    QKERN_REALTIME_RETENTION_SCOPES_JSON: SCOPES,
    ...overrides,
  };
}

describe("realtime production gate", () => {
  it("keeps the local default untouched", () => {
    expect(realtimeBindPlan({}, ["http://localhost:3000"]))
      .toEqual({ host: "127.0.0.1", production: false });
  });

  it("requires an explicit opt-in for any non-loopback bind, in every environment", () => {
    expect(() => realtimeBindPlan({ QKERN_REALTIME_BIND_HOST: "0.0.0.0" }, ["http://localhost:3000"]))
      .toThrow(ConfigurationError);
    expect(realtimeBindPlan({
      QKERN_REALTIME_BIND_HOST: "0.0.0.0", QKERN_REALTIME_PUBLIC_BIND: "true",
    }, ["http://localhost:3000"]).host).toBe("0.0.0.0");
  });

  it("opens production when every named condition holds", () => {
    expect(realtimeBindPlan(complete(), ["https://app.example.test"]))
      .toEqual({ host: "127.0.0.1", production: true });
    expect(realtimeBindPlan(complete({
      QKERN_REALTIME_BIND_HOST: "0.0.0.0",
      QKERN_REALTIME_PUBLIC_BIND: "true",
      QKERN_REALTIME_TLS_TERMINATED: "proxy",
    }), ["https://app.example.test"]).host).toBe("0.0.0.0");
  });

  it("names each violated condition instead of forbidding wholesale", () => {
    expect(() => realtimeBindPlan(complete({ QKERN_REALTIME_EPHEMERAL_LOG: "true" }),
      ["https://app.example.test"])).toThrow(/durable event log/);
    expect(() => realtimeBindPlan(complete({ QKERN_REALTIME_CURSOR_SECRET: undefined }),
      ["https://app.example.test"])).toThrow(/CURSOR_SECRET/);
    // Ein zu kurzes Geheimnis ist keines: 16 Bytes lassen sich raten.
    expect(() => realtimeBindPlan(complete({
      QKERN_REALTIME_CURSOR_SECRET: Buffer.alloc(16).toString("base64url"),
    }), ["https://app.example.test"])).toThrow(/CURSOR_SECRET/);
    expect(() => realtimeBindPlan(complete({ QKERN_REALTIME_RETENTION_SCOPES_JSON: "[]" }),
      ["https://app.example.test"])).toThrow(/RETENTION_SCOPES/);
    expect(() => realtimeBindPlan(complete(), []))
      .toThrow(/https-only origin allowlist/);
    // In Production ist ein http-Origin keiner.
    expect(() => realtimeBindPlan(complete(), ["http://localhost:3000"]))
      .toThrow(/https-only origin allowlist/);
    // Die Attestierung ist die letzte Tuer: alles andere erfuellt, aber
    // oeffentlich gebunden ohne TLS davor — abgewiesen.
    expect(() => realtimeBindPlan(complete({
      QKERN_REALTIME_BIND_HOST: "0.0.0.0", QKERN_REALTIME_PUBLIC_BIND: "true",
    }), ["https://app.example.test"])).toThrow(/TLS_TERMINATED/);
  });
});
