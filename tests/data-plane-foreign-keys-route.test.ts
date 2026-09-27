import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectForeignKeys } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/foreign-keys/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { DisabledProjectDataPlane, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die foreign-keys-Route (2.41) geht durch dieselbe Tuer wie `/schema` und
 * `/schema/policies` und prueft den Parameter `schema` genauso.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `foreign-keys-${nonce}@qkern.test`,
    password: "a sufficiently long catalog route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(method: ReturnType<typeof vi.fn>): ProjectDataPlanePort {
  return { inspectRuntime: vi.fn(), inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(), explainReadQuery: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectForeignKeys: method } as ProjectDataPlanePort;
}

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = (query = "") => `https://qkern.test/api/v1/projects/project/environments/development/schema/foreign-keys${query}`;

const RESULT = {
  source: "postgres", schema: "public", truncated: false,
  foreignKeys: [{
    name: "orders_customer_fkey", table: "orders", columns: ["tenant_id", "customer_id"],
    referencedSchema: "public", referencedTable: "customers", referencedColumns: ["tenant_id", "id"],
    onDelete: "cascade", onUpdate: "no_action",
  }],
};

describe("project foreign keys route", () => {
  it("binds the inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue(RESULT);
    const response = await handleProjectForeignKeys(new NextRequest(url("?schema=public"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toEqual(RESULT);
    // Die Spalten kommen in der Reihenfolge des Schluessels durch, ungeruehrt.
    expect(body.data.foreignKeys[0].columns).toEqual(["tenant_id", "customer_id"]);
    expect(body.data.foreignKeys[0].referencedColumns).toEqual(["tenant_id", "id"]);
    expect(method).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "public",
    );
  });

  it("defaults to the public schema when no parameter is given", async () => {
    const principal = await identity();
    const method = vi.fn().mockResolvedValue(RESULT);
    const response = await handleProjectForeignKeys(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, port(method));
    expect(response.status).toBe(200);
    expect(method).toHaveBeenCalledWith(expect.anything(), expect.anything(), "public");
  });

  it("rejects an unknown parameter, a repeated schema and an invalid name without touching the data plane", async () => {
    const method = vi.fn();
    for (const query of ["?schema=public&table=orders", "?schema=public&schema=Shop", "?schema=not%20a%20name", "?schema=1bad"]) {
      const response = await handleProjectForeignKeys(new NextRequest(url(query)), params, port(method));
      expect(response.status, query).toBe(400);
    }
    expect(method).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller without touching the data plane", async () => {
    const method = vi.fn();
    const response = await handleProjectForeignKeys(new NextRequest(url("?schema=public")), params, port(method));
    expect(response.status).toBe(401);
    expect(method).not.toHaveBeenCalled();
  });

  it("answers 503 when the data plane is disabled", async () => {
    const principal = await identity();
    const response = await handleProjectForeignKeys(new NextRequest(url("?schema=public"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, new DisabledProjectDataPlane());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("DATA_PLANE_DISABLED");
  });
});
