import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFunctionInvocationHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/invoke/[name]/route";
import type { ComputeDefinitionScope, FunctionDefinitionRecord } from
  "@/lib/server/compute/definitions";
import {
  FunctionInvocationService,
  functionInvocationStatus,
} from "@/lib/server/compute/function-invocation";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

const scope: ComputeDefinitionScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

const serviceRole: ProjectQueuePrincipal = {
  organizationId: "org-1", actorRef: "service-role:key-1", role: "service_role", subject: "key-1",
};

const record: FunctionDefinitionRecord = Object.freeze({
  ...scope,
  id: "33333333-3333-4333-8333-333333333333",
  name: "resize-image",
  runtime: "nodejs24" as const,
  image: `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`,
  entrypoint: "handler.mjs",
  timeoutMs: 30_000,
  memoryMiB: 128,
  maxConcurrency: 1,
  egressOrigins: Object.freeze([]),
  secretRefs: Object.freeze(["vault:functions/probe"]),
  enabled: true,
  createdAt: "2026-08-05T00:00:00.000Z",
});

function harness(options: { records?: FunctionDefinitionRecord[]; invoke?: () => Promise<never> } = {}) {
  const records = options.records ?? [record];
  const seen: unknown[] = [];
  const service = new FunctionInvocationService({
    repository: {
      async findFunctionByName(_principal, _scope, name) {
        return records.find((entry) => entry.name === name && entry.enabled) ?? null;
      },
    },
    invoker: {
      async invoke(definition, invocation) {
        seen.push({ definition, invocation });
        if (options.invoke) await options.invoke();
        return Object.freeze({ statusCode: 200, headers: {}, body: { ok: true } });
      },
    },
    now: () => new Date("2026-08-05T12:00:00.000Z"),
    id: () => "44444444-4444-4444-8444-444444444444",
  });
  return { service, seen };
}

describe("FunctionInvocationService", () => {
  it("resolves an enabled function and runs it with a server-assigned invocation", async () => {
    const { service, seen } = harness();
    const result = await service.invoke(serviceRole, scope, "resize-image", { width: 64 });

    expect(result).toMatchObject({ statusCode: 200 });
    expect(seen[0]).toMatchObject({
      invocation: {
        id: "44444444-4444-4444-8444-444444444444",
        functionId: record.id,
        requestedAt: "2026-08-05T12:00:00.000Z",
        payload: { width: 64 },
      },
    });
  });

  it("hands the sandbox references, never secret values", async () => {
    const { service, seen } = harness();
    await service.invoke(serviceRole, scope, "resize-image", {});
    expect((seen[0] as { definition: { secretRefs: string[] } }).definition.secretRefs)
      .toEqual(["vault:functions/probe"]);
  });

  it("reads the definition on every call instead of caching it", async () => {
    // Ein zwischengespeichertes Bild wuerde nach einem Abschalten weiterlaufen,
    // und ein Betreiber, der eine Function stoppt, will sie gestoppt haben.
    const records = [record];
    const { service } = harness({ records });
    await service.invoke(serviceRole, scope, "resize-image", {});

    records[0] = { ...record, enabled: false };
    await expect(service.invoke(serviceRole, scope, "resize-image", {}))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  it("hides a function from a principal that may not run it", async () => {
    // Eine Function laeuft mit der Autoritaet des Projekts, nicht mit der ihres
    // Aufrufers. Anonyme und Endnutzer duerfen sie deshalb nicht ausloesen.
    const { service } = harness();
    for (const role of ["anon", "authenticated"] as const) {
      await expect(service.invoke({ ...serviceRole, role }, scope, "resize-image", {}))
        .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
    }
  });

  it("hides a scope of another organization", async () => {
    const { service } = harness();
    await expect(service.invoke(serviceRole, { ...scope, organizationId: "org-2" }, "resize-image", {}))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  it("treats an implausible name as not found without asking the database", async () => {
    const { service, seen } = harness();
    await expect(service.invoke(serviceRole, scope, "../../etc/passwd", {}))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
    expect(seen).toEqual([]);
  });
});

describe("functionInvocationStatus", () => {
  it("separates a missing function from a failing one", () => {
    expect(functionInvocationStatus(new ComputeDefinitionError("COMPUTE_NOT_FOUND"))).toBe(404);
    expect(functionInvocationStatus(new FunctionInvocationError("FUNCTION_INVALID"))).toBe(422);
    expect(functionInvocationStatus(new FunctionInvocationError("FUNCTION_TIMEOUT"))).toBe(504);
    expect(functionInvocationStatus(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"))).toBe(502);
    expect(functionInvocationStatus(new Error("connection to docker daemon refused"))).toBe(500);
  });
});

describe("Function invocation route", () => {
  const context = {
    params: Promise.resolve({
      projectId: "prj-compute", environment: "development", name: "resize-image",
    }),
  };

  it("rejects an anonymous caller before reaching the service", async () => {
    const service = { invoke: vi.fn() } as unknown as FunctionInvocationService;
    const request = new NextRequest("https://qkern.example.test/api/compute/invoke/resize-image", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const response = await createFunctionInvocationHandler(service)(request, context);
    expect(response.status).toBe(401);
    expect(service.invoke).not.toHaveBeenCalled();
  });

  it("answers an unauthenticated call with nothing but the fact that it needs auth", async () => {
    const service = { invoke: vi.fn() } as unknown as FunctionInvocationService;
    const request = new NextRequest("https://qkern.example.test/api/compute/invoke/resize-image", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const response = await createFunctionInvocationHandler(service)(request, context);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("hides an unknown function behind the same answer as a missing project", async () => {
    // Die Fehlerabbildung selbst ist in `functionInvocationStatus` geprueft;
    // hier zaehlt, dass die Route keine Innenansicht durchreicht.
    const service = {
      invoke: async () => { throw new ComputeDefinitionError("COMPUTE_NOT_FOUND"); },
    } as unknown as FunctionInvocationService;
    const handler = createFunctionInvocationHandler(service);
    const response = await handler(
      new NextRequest("https://qkern.example.test/api/compute/invoke/resize-image", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }),
      { params: Promise.resolve({ projectId: "x", environment: "development", name: "a" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Resource not found" });
  });
});
