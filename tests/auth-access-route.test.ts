import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectAuthAccess } from "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/access/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route von Auth -> Policies (2.62) geht durch dieselbe Tuer wie
 * `/schema/policies` und prueft denselben einen Parameter. Sie liest drei
 * Auskuenfte und rechnet sie im reinen Modul zusammen; hier steht, dass sie
 * genau diese drei liest, keine schreibt und die Antwort nicht zwischenspeichern
 * laesst.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `auth-access-${nonce}@qkern.test`,
    password: "a sufficiently long auth access route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(overrides: Partial<Record<keyof ProjectDataPlanePort, unknown>>): ProjectDataPlanePort {
  return {
    inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(),
    inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(),
    inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(),
    inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectPolicies: vi.fn(),
    ...overrides,
  } as ProjectDataPlanePort;
}

function ready() {
  const inspectSchema = vi.fn().mockResolvedValue({
    source: "postgres", schema: "public", truncated: false,
    tables: [
      { name: "notes", kind: "table", rowSecurityEnabled: true, columns: [], truncated: false },
      { name: "audit", kind: "table", rowSecurityEnabled: false, columns: [], truncated: false },
    ],
  });
  const inspectPolicies = vi.fn().mockResolvedValue({
    source: "postgres", schema: "public", truncated: false,
    policies: [{
      name: "own_rows", table: "notes", permissive: true, command: "select", roles: ["qkern_project_api_app"],
      usingExpression: "(owner = current_setting('request.jwt.claim.sub'::text, true))", checkExpression: null,
    }],
  });
  const inspectSettings = vi.fn().mockResolvedValue({
    source: "postgres", databaseName: "qkern", databaseOwner: "qkern", currentRole: "qkern_project_api_app",
    tls: { encrypted: false, version: null, serverEnabled: false },
    limits: { maxConnections: 300, superuserReserved: 3, database: null, role: null },
    roles: [], truncated: false,
  });
  return { inspectSchema, inspectPolicies, inspectSettings };
}

describe("project auth access route", () => {
  it("binds the three inspections to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const methods = ready();
    const response = await handleProjectAuthAccess(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/auth/access?schema=public", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, port(methods));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const context = expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email });
    const scope = { projectId: "project", environment: "development" };
    expect(methods.inspectSchema).toHaveBeenCalledWith(context, scope, "public");
    expect(methods.inspectPolicies).toHaveBeenCalledWith(context, scope, "public");
    expect(methods.inspectSettings).toHaveBeenCalledWith(context, scope);

    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data.source).toBe("postgres");
    expect(body.data.role).toBe("qkern_project_api_app");
    expect(body.data.claimRole).toBe("authenticated");
    expect(body.data.truncated).toBe(false);
    // Das Urteil kommt aus dem reinen Modul und steht je Tabelle da.
    expect(body.data.tables).toEqual([
      expect.objectContaining({ table: "notes", verdict: "readable", uncertain: true }),
      expect.objectContaining({ table: "audit", verdict: "refused", rowSecurityEnabled: false }),
    ]);
    expect(body.data.counts).toEqual({ refused: 1, locked: 0, readable: 1, writable: 0, open: 0 });
  });

  it("passes a named schema through and reports a truncated catalog read honestly", async () => {
    const principal = await identity();
    const methods = ready();
    methods.inspectPolicies.mockResolvedValue({ source: "postgres", schema: "reporting", policies: [], truncated: true });
    const response = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access?schema=reporting", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, port(methods));
    expect(response.status).toBe(200);
    expect(methods.inspectSchema).toHaveBeenCalledWith(expect.anything(), expect.anything(), "reporting");
    const body = await response.json() as { data: { truncated: boolean; schema: string } };
    expect(body.data.truncated).toBe(true);
    expect(body.data.schema).toBe("reporting");
  });

  it("rejects unknown parameters, a second schema and anonymous callers without touching the data plane", async () => {
    const methods = ready();
    const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
    const extra = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access?schema=public&table=orders"), params, port(methods));
    expect(extra.status).toBe(400);
    const twice = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access?schema=public&schema=reporting"), params, port(methods));
    expect(twice.status).toBe(400);
    const invalid = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access?schema=Not%20A%20Schema"), params, port(methods));
    expect(invalid.status).toBe(400);
    const environment = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access"),
      { params: Promise.resolve({ projectId: "project", environment: "sandbox" }) }, port(methods));
    expect(environment.status).toBe(400);
    const anonymous = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access"), params, port(methods));
    expect(anonymous.status).toBe(401);
    for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled();
  });

  it("maps a data plane failure through the shared error mapping", async () => {
    const principal = await identity();
    const methods = ready();
    methods.inspectSettings.mockRejectedValue(Object.assign(new Error("DATA_PLANE_DISABLED"), { name: "ProjectDataPlaneError", code: "DATA_PLANE_DISABLED" }));
    const response = await handleProjectAuthAccess(new NextRequest("https://qkern.test/x/auth/access", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, port(methods));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(200);
  });
});
