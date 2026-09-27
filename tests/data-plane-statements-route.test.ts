import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectDatabaseStatements } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/statements/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die statements-Route (2.67) geht durch dieselbe Tuer wie `database/activity`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `statements-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectSchema: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), inspectStatistics: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectPolicies: vi.fn(), inspectActivity: vi.fn(), inspectStatements: method } as ProjectDataPlanePort;
}

const result = {
  source: "postgres",
  installed: true,
  statements: [
    { id: "8134713591", calls: 12, totalTimeMs: 90_000, meanTimeUs: 7_500_000, rows: 120 },
    { id: "17", calls: 3, totalTimeMs: 12, meanTimeUs: 4000, rows: 3 },
  ],
  truncated: false,
};

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = "https://qkern.test/api/v1/projects/project/environments/development/database/statements";

describe("project database statements route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue(result);
    const response = await handleProjectDatabaseStatements(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload.data).toEqual(result);
    // Kein Abfragetext: Die Antwort traegt Kennungen und Zaehler, sonst nichts.
    for (const statement of payload.data.statements as Array<Record<string, unknown>>) {
      expect(Object.keys(statement).sort()).toEqual(["calls", "id", "meanTimeUs", "rows", "totalTimeMs"]);
    }
    expect(JSON.stringify(payload)).not.toMatch(/select|insert|update |from |query/i);
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
    );
  });

  it("hands the missing extension through as a fact instead of an empty success", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue({ source: "postgres", installed: false, statements: [], truncated: false });
    const response = await handleProjectDatabaseStatements(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    // `installed: false` steht in der Antwort; ohne dieses Feld koennte die
    // Ansicht "keine teure Abfrage" nicht von "niemand zaehlt mit" trennen.
    expect((await response.json()).data).toMatchObject({ installed: false, statements: [] });
  });

  it("rejects every query parameter and anonymous callers without touching the data plane", async () => {
    const method = vi.fn();
    const bad = await handleProjectDatabaseStatements(new NextRequest(`${url}?limit=5`), params, port(method));
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectDatabaseStatements(new NextRequest(url), params, port(method));
    expect(anonymous.status).toBe(401);
    const environment = await handleProjectDatabaseStatements(new NextRequest(url),
      { params: Promise.resolve({ projectId: "project", environment: "nirgendwo" }) }, port(method));
    expect(environment.status).toBe(400);
    expect(method).not.toHaveBeenCalled();
  });

  it("says that the data plane is off with a clear state instead of a silent 500", async () => {
    const principal = await identity();
    const method = vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_DISABLED"));
    const response = await handleProjectDatabaseStatements(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });
});
