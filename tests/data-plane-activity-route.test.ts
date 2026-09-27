import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectDatabaseActivity } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/activity/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die activity-Route (2.46) geht durch dieselbe Tuer wie `/schema/policies`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `activity-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectPolicies: vi.fn(), inspectActivity: method } as ProjectDataPlanePort;
}

const result = {
  source: "postgres",
  database: {
    commits: 12, rollbacks: 0, blocksRead: 10, blocksHit: 90, deadlocks: 0,
    tempFiles: 0, tempBytes: 0, backends: 3, maxConnections: 300, statsReset: "2026-09-26T08:00:00Z",
  },
  connections: [{ role: "qkern_project_api_app", state: "idle", count: 3, oldestSeconds: 12 }],
  truncated: false,
};

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = "https://qkern.test/api/v1/projects/project/environments/development/database/activity";

describe("project database activity route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue(result);
    const response = await handleProjectDatabaseActivity(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload.data).toEqual(result);
    // Keine Sitzung, kein Abfragetext: Die Antwort traegt nur Zaehler und Gruppen.
    expect(JSON.stringify(payload)).not.toMatch(/query|client_addr|backend_xmin|pid/i);
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
    );
  });

  it("rejects every query parameter and anonymous callers without touching the data plane", async () => {
    const method = vi.fn();
    // Es gibt nichts zu waehlen; eine Angabe wird nicht stillschweigend ignoriert.
    const bad = await handleProjectDatabaseActivity(new NextRequest(`${url}?schema=public`), params, port(method));
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectDatabaseActivity(new NextRequest(url), params, port(method));
    expect(anonymous.status).toBe(401);
    const environment = await handleProjectDatabaseActivity(new NextRequest(url),
      { params: Promise.resolve({ projectId: "project", environment: "nirgendwo" }) }, port(method));
    expect(environment.status).toBe(400);
    expect(method).not.toHaveBeenCalled();
  });

  it("says that the data plane is off with a clear state instead of a silent 500", async () => {
    const principal = await identity();
    const method = vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_DISABLED"));
    const response = await handleProjectDatabaseActivity(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });
});
