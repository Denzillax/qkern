import { describe, expect, it } from "vitest";
import { MemoryControlPlaneService } from "@/lib/server/control-plane/memory";
import { controlPlaneAdapterFromEnv, createControlPlaneService } from "@/lib/server/control-plane/runtime";

const context = {
  organizationId: "org_moqro",
  actor: { id: "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca", ref: "owner@example.com", type: "user" as const },
};

describe("control-plane runtime selection", () => {
  it("keeps the in-memory adapter available as an explicit async demo adapter", async () => {
    const service = createControlPlaneService({ QKERN_CONTROL_PLANE_ADAPTER: "memory" });
    expect(service).toBeInstanceOf(MemoryControlPlaneService);
    const snapshot = await service.getConsoleSnapshot(context);
    expect(snapshot.projects[0]?.organizationId).toBe(context.organizationId);
    expect(snapshot.changeSets.length).toBeGreaterThan(0);
    expect("changes" in snapshot).toBe(false);
  });

  it("fails closed before constructing PostgreSQL dependencies when a runtime database URL is absent", () => {
    expect(() => createControlPlaneService({ QKERN_CONTROL_PLANE_ADAPTER: "postgres" }))
      .toThrow("QKERN_RUNTIME_DATABASE_URL is required when QKERN_RUNTIME_MODE=postgres");
  });

  it("rejects unknown adapter names", () => {
    expect(() => controlPlaneAdapterFromEnv({ QKERN_CONTROL_PLANE_ADAPTER: "automatic" }))
      .toThrow("must be either memory or postgres");
  });
});
