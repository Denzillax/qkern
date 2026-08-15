import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createProjectAuthProvidersHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/providers/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die Admin-Route der Provider-Auswahl (1.83) — Console-Session statt
 * Projekt-Key, dieselbe Grenze wie die Nutzerliste daneben. Der Dienst ist
 * gegen echte Dex-Provider im Auth-Stack zertifiziert; Gegenstand hier ist
 * die HTTP-Grenze.
 */

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `providers-${nonce}@qkern.test`,
    password: "a sufficiently long provider route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

describe("project auth admin providers route", () => {
  it("serves the provider projection with no-store through the console session", async () => {
    const principal = await identity();
    const listOidcProviders = vi.fn().mockReturnValue([
      { id: "certification", issuer: "https://dex.qkern.test/dex" },
    ]);
    const service = { listOidcProviders } as unknown as ProjectAuthService;
    const response = await createProjectAuthProvidersHandler(() => service)(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/providers`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      data: [{ id: "certification", issuer: "https://dex.qkern.test/dex" }],
    });
  });

  it("rejects query parameters and anonymous callers before touching the service", async () => {
    const listOidcProviders = vi.fn();
    const service = { listOidcProviders } as unknown as ProjectAuthService;
    const handler = createProjectAuthProvidersHandler(() => service);
    const anonymous = await handler(new NextRequest(
      "https://qkern.test/api/v1/projects/project/environments/development/auth/admin/providers",
    ), { params: Promise.resolve({ projectId: "project", environment: "development" }) });
    expect(anonymous.status).toBe(401);

    const principal = await identity();
    const withQuery = await handler(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/providers?limit=5`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(withQuery.status).toBe(400);
    expect(listOidcProviders).not.toHaveBeenCalled();
  });
});
