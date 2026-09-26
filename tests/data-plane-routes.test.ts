import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectReadQuery } from "@/app/api/v1/projects/[projectId]/environments/[environment]/query/route";
import { handleProjectSchema } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { tenancyService } from "@/lib/server/tenancy-service";

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `data-plane-${nonce}@qkern.test`,
    password: "a sufficiently long data plane test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

describe("project data-plane routes", () => {
  it("binds schema inspection to the authenticated tenant and disables caching", async () => {
    const principal = await identity();
    const inspectSchema = vi.fn().mockResolvedValue({ source: "postgres", schema: "public", tables: [], truncated: false });
    const dataPlane = { inspectSchema, queryReadOnly: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const response = await handleProjectSchema(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/schema", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), { params: Promise.resolve({ projectId: "project", environment: "development" }) }, dataPlane);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(inspectSchema).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "public",
    );
  });

  it("allows a scope-bound project key to inspect schema for SDK and CLI generation", async () => {
    const inspectSchema = vi.fn().mockResolvedValue({ source: "postgres", schema: "public", tables: [], truncated: false });
    const dataPlane = { inspectSchema, queryReadOnly: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const keys = {
      authenticate: vi.fn().mockResolvedValue({
        id: "key-cli", organizationId: "org-cli", projectId: "project-cli",
        environment: "development", kind: "service",
      }),
    } as unknown as ProjectApiKeyService;
    const response = await handleProjectSchema(new NextRequest(
      "https://qkern.test/api/v1/projects/project-cli/environments/development/schema?schema=public",
      { headers: { "x-qkern-key": "qk_test_cli" } },
    ), { params: Promise.resolve({ projectId: "project-cli", environment: "development" }) }, dataPlane, keys);

    expect(response.status).toBe(200);
    expect(inspectSchema).toHaveBeenCalledWith(
      { organizationId: "org-cli", actorRef: "project-api-key:key-cli" },
      { projectId: "project-cli", environment: "development" },
      "public",
    );
  });

  it("forwards schema names with capitals exactly and refuses names outside the grammar (2.33)", async () => {
    const inspectSchema = vi.fn().mockResolvedValue({ source: "postgres", schema: "Shop", tables: [], truncated: false });
    const dataPlane = { inspectSchema, queryReadOnly: vi.fn(), inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const keys = {
      authenticate: vi.fn().mockResolvedValue({
        id: "key-cli", organizationId: "org-cli", projectId: "project-cli",
        environment: "development", kind: "service",
      }),
    } as unknown as ProjectApiKeyService;
    const call = (schema: string) => handleProjectSchema(new NextRequest(
      `https://qkern.test/api/v1/projects/project-cli/environments/development/schema?schema=${encodeURIComponent(schema)}`,
      { headers: { "x-qkern-key": "qk_test_cli" } },
    ), { params: Promise.resolve({ projectId: "project-cli", environment: "development" }) }, dataPlane, keys);

    expect((await call("Shop")).status).toBe(200);
    expect(inspectSchema).toHaveBeenCalledWith(expect.anything(), expect.anything(), "Shop");
    for (const schema of ['Shop"', "S".repeat(64), "Shop.Items", "1Shop"]) {
      expect((await call(schema)).status).toBe(400);
    }
    expect(inspectSchema).toHaveBeenCalledOnce();
  });

  it("requires trusted origin and forwards only bounded query inputs", async () => {
    const principal = await identity();
    const queryReadOnly = vi.fn().mockResolvedValue({
      source: "postgres", columns: ["id"], rows: [{ id: "1" }], rowCount: 1, truncated: false, maxRows: 20,
    });
    const dataPlane = { inspectSchema: vi.fn(), queryReadOnly, inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn() } as ProjectDataPlanePort;
    const route = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
    const denied = await handleProjectReadQuery(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/query", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, "content-type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify({ statement: "SELECT id FROM products", limit: 20 }),
    }), route, dataPlane);
    expect(denied.status).toBe(403);
    expect(queryReadOnly).not.toHaveBeenCalled();

    const response = await handleProjectReadQuery(new NextRequest("https://qkern.test/api/v1/projects/project/environments/development/query", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, "content-type": "application/json", origin: "https://qkern.test" },
      body: JSON.stringify({ statement: "SELECT id FROM products", limit: 20 }),
    }), route, dataPlane);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(queryReadOnly).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "SELECT id FROM products",
      20,
    );
  });
});
