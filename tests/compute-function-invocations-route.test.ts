import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeFunctionInvocationHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/functions/[functionId]/invocations/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Aufrufprotokoll-Route (1.89): Admin-Session, `limit` als einziger
 * Parameter, no-store. Der Dienst ist gegen echtes PostgreSQL und im
 * Functions-Stack zertifiziert; Gegenstand hier ist die HTTP-Grenze.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `fn-log-${nonce}@qkern.test`,
    password: "a sufficiently long invocation log test password",
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

describe("compute function invocations route", () => {
  it("serves the invocation log with no-store through the admin session", async () => {
    const principal = await identity();
    const listFunctionInvocations = vi.fn().mockResolvedValue([{
      invocationId: randomUUID(), invokedBy: "service-role:key", startedAt: "2026-09-24T12:00:00.000Z",
      durationMs: 42, outcome: "completed", statusCode: 200, errorCode: null,
    }]);
    const service = { listFunctionInvocations } as unknown as ComputeDefinitionService;
    const response = await createComputeFunctionInvocationHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/functions/${functionId}/invocations?limit=5`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development", functionId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data[0]).toMatchObject({ outcome: "completed", statusCode: 200, durationMs: 42 });
    expect(listFunctionInvocations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      functionId, 5,
    );
  });

  it("rejects malformed limits, unknown parameters and anonymous callers before service access", async () => {
    const listFunctionInvocations = vi.fn();
    const handlers = createComputeFunctionInvocationHandlers({ listFunctionInvocations } as unknown as ComputeDefinitionService);
    const principal = await identity();
    const cookie = { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } };
    const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/functions/${functionId}/invocations`;
    const context = { params: Promise.resolve({ projectId: principal.project.id, environment: "development", functionId }) };
    for (const query of ["?limit=abc", "?limit=5&limit=6", "?cursor=x"]) {
      expect((await handlers.GET(new NextRequest(`${base}${query}`, cookie), context)).status, query).toBe(400);
    }
    expect((await handlers.GET(new NextRequest(base), context)).status).toBe(401);
    expect(listFunctionInvocations).not.toHaveBeenCalled();
  });
});
