import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectFunctions } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/functions/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die Funktionen-Route (2.18) geht durch dieselbe Tuer wie `/schema`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `functions-${nonce}@qkern.test`,
    password: "a sufficiently long function route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

describe("project function route", () => {
  it("binds function inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const inspectFunctions = vi.fn().mockResolvedValue({ source: "postgres", schema: "public", functions: [], truncated: false });
    const dataPlane = { inspectRuntime: vi.fn(), inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions, inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const response = await handleProjectFunctions(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/schema/functions?schema=public", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, dataPlane);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(inspectFunctions).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "public",
    );
  });

  it("rejects unknown parameters and anonymous callers without touching the data plane", async () => {
    const inspectFunctions = vi.fn();
    const dataPlane = { inspectRuntime: vi.fn(), inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions, inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
    const bad = await handleProjectFunctions(new NextRequest("https://qkern.test/x/schema/functions?schema=public&name=touch"), params, dataPlane);
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectFunctions(new NextRequest("https://qkern.test/x/schema/functions"), params, dataPlane);
    expect(anonymous.status).toBe(401);
    expect(inspectFunctions).not.toHaveBeenCalled();
  });
});
