import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectTriggers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/triggers/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die Trigger-Route (2.9) geht durch dieselbe Tuer wie `/schema`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `triggers-${nonce}@qkern.test`,
    password: "a sufficiently long trigger route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

describe("project trigger route", () => {
  it("binds trigger inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const inspectTriggers = vi.fn().mockResolvedValue({ source: "postgres", schema: "public", triggers: [], truncated: false });
    const dataPlane = { inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers, inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const response = await handleProjectTriggers(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/schema/triggers?schema=public", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, dataPlane);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(inspectTriggers).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "public",
    );
  });

  it("rejects unknown parameters and anonymous callers without touching the data plane", async () => {
    const inspectTriggers = vi.fn();
    const dataPlane = { inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers, inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
    const bad = await handleProjectTriggers(new NextRequest("https://qkern.test/x/schema/triggers?schema=public&table=orders"), params, dataPlane);
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectTriggers(new NextRequest("https://qkern.test/x/schema/triggers"), params, dataPlane);
    expect(anonymous.status).toBe(401);
    expect(inspectTriggers).not.toHaveBeenCalled();
  });
});
