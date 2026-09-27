import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectDatabaseSettings } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/settings/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/** Die settings-Route (2.53) geht durch dieselbe Tuer wie `/database/activity`. */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `settings-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectRuntime: vi.fn(), inspectForeignDataWrappers: vi.fn(), inspectSchema: vi.fn(), inspectStatements: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectPolicies: vi.fn(), inspectActivity: vi.fn(), inspectSettings: method } as ProjectDataPlanePort;
}

const result = {
  source: "postgres",
  databaseName: "qkern_project",
  databaseOwner: "qkern",
  currentRole: "qkern_project_api_app",
  tls: { encrypted: true, version: "TLSv1.3", serverEnabled: true },
  limits: { maxConnections: 300, superuserReserved: 3, database: null, role: 20 },
  roles: [{
    name: "qkern_project_api_app", superuser: false, createDatabase: false, createRole: false,
    inherit: true, login: true, replication: false, bypassRowSecurity: false,
    connectionLimit: 20, validUntil: null,
  }],
  truncated: false,
};

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = "https://qkern.test/api/v1/projects/project/environments/development/database/settings";

describe("project database settings route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue(result);
    const response = await handleProjectDatabaseSettings(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload.data).toEqual(result);
    expect(Object.keys(payload.data).sort()).toEqual([
      "currentRole", "databaseName", "databaseOwner", "limits", "roles", "source", "tls", "truncated",
    ]);
    // Keine Adresse, kein Geheimnis: Die Antwort traegt Namen, Flags und Zahlen.
    expect(JSON.stringify(payload)).not.toMatch(/postgres(?:ql)?:\/\/|password|sslmode|client_addr|host|port/i);
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
    );
  });

  it("rejects every query parameter and anonymous callers without touching the data plane", async () => {
    const method = vi.fn();
    // Es gibt nichts zu waehlen; eine Angabe wird nicht stillschweigend ignoriert.
    const bad = await handleProjectDatabaseSettings(new NextRequest(`${url}?schema=public`), params, port(method));
    expect(bad.status).toBe(400);
    const anonymous = await handleProjectDatabaseSettings(new NextRequest(url), params, port(method));
    expect(anonymous.status).toBe(401);
    const environment = await handleProjectDatabaseSettings(new NextRequest(url),
      { params: Promise.resolve({ projectId: "project", environment: "nirgendwo" }) }, port(method));
    expect(environment.status).toBe(400);
    expect(method).not.toHaveBeenCalled();
  });

  it("says that the data plane is off with a clear state instead of a silent 500", async () => {
    const principal = await identity();
    const method = vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_DISABLED"));
    const response = await handleProjectDatabaseSettings(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });

  it("says that the database is not bound yet instead of pretending there are settings", async () => {
    const principal = await identity();
    const method = vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_NOT_READY"));
    const response = await handleProjectDatabaseSettings(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect([409, 503]).toContain(response.status);
    expect(await response.json()).toMatchObject({ code: "DATA_PLANE_NOT_READY" });
  });
});
