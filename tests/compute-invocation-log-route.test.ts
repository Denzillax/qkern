import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeInvocationLogHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/invocations/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ConfigurationError } from "@/lib/server/db/errors";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route des Aufrufprotokolls ueber alle Functions (2.51).
 *
 * Der Dienst ist gegen echtes PostgreSQL zertifiziert; Gegenstand hier ist
 * die HTTP-Grenze: Admin-Session, vier Parameter und kein fuenfter, no-store,
 * ein abgeschalteter Compute-Dienst als klarer Zustand statt als 500.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `fn-log-page-${nonce}@qkern.test`,
    password: "a sufficiently long invocation log page test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const functionId = "00000000-0000-4000-8000-000000000f01";

const page = (rows: unknown[]) => ({
  rows, limit: 2, offset: 0, hasMore: true, counts: { completed: 7, failed: 2 },
});

const row = {
  functionId, functionName: "bestellungen", invocationId: randomUUID(),
  invokedBy: "service-role:key", startedAt: "2026-09-24T12:00:00.000Z", durationMs: 42,
  outcome: "completed", statusCode: 200, errorCode: null,
};

describe("compute invocation log route", () => {
  it("serves one page with counts and no-store through the admin session", async () => {
    const principal = await identity();
    const readFunctionInvocationLog = vi.fn().mockResolvedValue(page([row]));
    const service = { readFunctionInvocationLog } as unknown as ComputeDefinitionService;
    const response = await createComputeInvocationLogHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations?limit=2&offset=0&outcome=completed&function=${functionId}`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.counts).toEqual({ completed: 7, failed: 2 });
    expect(body.data.hasMore).toBe(true);
    expect(body.data.rows[0]).toMatchObject({ outcome: "completed", durationMs: 42, functionName: "bestellungen" });
    expect(readFunctionInvocationLog).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      { functionId, outcome: "completed", limit: 2, offset: 0 },
    );
  });

  it("falls back to the default page when no parameter is given", async () => {
    const principal = await identity();
    const readFunctionInvocationLog = vi.fn().mockResolvedValue(page([]));
    const response = await createComputeInvocationLogHandlers(
      { readFunctionInvocationLog } as unknown as ComputeDefinitionService,
    ).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });

    expect(response.status).toBe(200);
    expect(readFunctionInvocationLog).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { functionId: null, outcome: null, limit: 50, offset: 0 },
    );
  });

  it("rejects unknown parameters, repeated parameters and malformed values before service access", async () => {
    const readFunctionInvocationLog = vi.fn();
    const handlers = createComputeInvocationLogHandlers(
      { readFunctionInvocationLog } as unknown as ComputeDefinitionService);
    const principal = await identity();
    const cookie = { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } };
    const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations`;
    const context = { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) };
    for (const query of [
      "?cursor=x", "?limit=abc", "?limit=5&limit=6", "?offset=-1", "?offset=x",
      "?outcome=running", "?outcome=completed&outcome=failed", "?function=not-a-uuid",
      "?function=" + functionId + "&function=" + functionId,
    ]) {
      expect((await handlers.GET(new NextRequest(`${base}${query}`, cookie), context)).status, query).toBe(400);
    }
    expect(readFunctionInvocationLog).not.toHaveBeenCalled();
  });

  it("denies the anonymous caller without touching the service", async () => {
    const readFunctionInvocationLog = vi.fn();
    const principal = await identity();
    const response = await createComputeInvocationLogHandlers(
      { readFunctionInvocationLog } as unknown as ComputeDefinitionService,
    ).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations`,
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });

    expect(response.status).toBe(401);
    expect(readFunctionInvocationLog).not.toHaveBeenCalled();
  });

  it("hides a project the caller does not own behind the same 404 as a malformed path", async () => {
    // Wer nicht darf, soll nicht erfahren, dass es die Ressource gibt: Kein
    // 403, sondern derselbe 404 wie fuer einen unbrauchbaren Pfad.
    const principal = await identity();
    const readFunctionInvocationLog = vi.fn();
    const handlers = createComputeInvocationLogHandlers(
      { readFunctionInvocationLog } as unknown as ComputeDefinitionService);
    const cookie = { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } };
    for (const projectId of ["ab", "not a project id"]) {
      const response = await handlers.GET(new NextRequest(
        `https://qkern.test/api/v1/projects/${encodeURIComponent(projectId)}/environments/development/compute/invocations`,
        cookie,
      ), { params: Promise.resolve({ projectId, environment: "development" }) });
      expect(response.status, projectId).toBe(404);
      expect(await response.json(), projectId).toEqual({ error: "Resource not found" });
    }
    expect(readFunctionInvocationLog).not.toHaveBeenCalled();
  });

  it("turns a disabled compute service into a clear 503, not a 500", async () => {
    // Ohne QKERN_COMPUTE_DEFINITIONS_ENABLED wirft die Laufzeit eine
    // ConfigurationError. Die Console unterscheidet daran "nicht
    // eingeschaltet" von "gerade nicht erreichbar"; ein 500 waere fuer beides
    // dieselbe Sackgasse.
    const principal = await identity();
    const readFunctionInvocationLog = vi.fn().mockRejectedValue(
      new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly."));
    const response = await createComputeInvocationLogHandlers(
      { readFunctionInvocationLog } as unknown as ComputeDefinitionService,
    ).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Compute definitions are disabled");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
