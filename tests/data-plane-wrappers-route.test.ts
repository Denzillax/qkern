import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectForeignDataWrappers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/foreign-data-wrappers/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route fuer fremde Datenquellen (2.72) ist datenbankweit und geht durch
 * dieselbe Tuer wie `/schema`.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `wrappers-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectRuntime: vi.fn(), inspectDatabaseHealth: vi.fn(), inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectForeignDataWrappers: method } as ProjectDataPlanePort;
}

describe("project foreign data wrapper route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue({ source: "postgres", wrappers: [], servers: [], userMappings: [], tables: [], truncated: false });
    const response = await handleProjectForeignDataWrappers(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/schema/foreign-data-wrappers", {
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
    const bad = await handleProjectForeignDataWrappers(new NextRequest("https://qkern.test/x/schema/foreign-data-wrappers?schema=public"), params, port(method));
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectForeignDataWrappers(new NextRequest("https://qkern.test/x/schema/foreign-data-wrappers"), params, port(method));
    expect(anonymous.status).toBe(401);
    expect(method).not.toHaveBeenCalled();
  });
});
