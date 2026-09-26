import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectRoles } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/roles/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die roles-Route (2.20) ist datenbankweit und geht durch dieselbe Tuer wie `/schema`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `roles-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectSchema: vi.fn(), queryReadOnly: vi.fn(), inspectStatistics: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectRoles: method } as ProjectDataPlanePort;
}

describe("project roles route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue({ source: "postgres", roles: [], truncated: false });
    const response = await handleProjectRoles(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/schema/roles", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, port(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
    );
  });

  it("rejects any query parameter and anonymous callers without touching the data plane", async () => {
    const method = vi.fn();
    const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
    const bad = await handleProjectRoles(new NextRequest("https://qkern.test/x/schema/roles?schema=public"), params, port(method));
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectRoles(new NextRequest("https://qkern.test/x/schema/roles"), params, port(method));
    expect(anonymous.status).toBe(401);
    expect(method).not.toHaveBeenCalled();
  });
});
