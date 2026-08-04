import { describe, expect, it } from "vitest";
import { authAdapterFromEnv } from "@/lib/server/auth/runtime";
import { tenancyAdapterFromEnv } from "@/lib/server/tenancy-service";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

describe("runtime adapter selection", () => {
  it("keeps the demo explicit and selects persistent adapters together", () => {
    expect(authAdapterFromEnv({})).toBe("memory");
    expect(tenancyAdapterFromEnv({})).toBe("memory");
    expect(authAdapterFromEnv({ QKERN_RUNTIME_MODE: "postgres", QKERN_AUTH_DATABASE_URL: "postgresql://auth/db" })).toBe("postgres");
    expect(tenancyAdapterFromEnv({ QKERN_RUNTIME_MODE: "postgres" })).toBe("postgres");
  });

  it("fails closed for invalid or incomplete auth adapter configuration", () => {
    expect(() => authAdapterFromEnv({ QKERN_AUTH_ADAPTER: "other" })).toThrow("QKERN_AUTH_ADAPTER");
    expect(() => authAdapterFromEnv({ QKERN_AUTH_ADAPTER: "postgres" })).toThrow("QKERN_AUTH_DATABASE_URL");
    expect(() => tenancyAdapterFromEnv({ QKERN_TENANCY_ADAPTER: "other" })).toThrow("QKERN_TENANCY_ADAPTER");
  });

  it("rejects mixed adapters and memory mode at production runtime", () => {
    expect(() => runtimeModeFromEnv({ QKERN_AUTH_ADAPTER: "postgres", QKERN_CONTROL_PLANE_ADAPTER: "memory" })).toThrow("one consistent mode");
    expect(() => runtimeModeFromEnv({ NODE_ENV: "production", QKERN_RUNTIME_MODE: "memory" })).toThrow("Production requires");
    expect(runtimeModeFromEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe("memory");
  });
});
