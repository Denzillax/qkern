import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthPublicProvidersHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/oidc/providers/route";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";

/**
 * Der Login-Chooser aus 1.84 — dieselbe oeffentliche Grenze wie `authorize`:
 * Projekt-Key, Origin-Gate, CORS, no-store. Die Mutationsprobe dieses
 * Releases nimmt die Schluesselpruefung aus der Route — dann bekommt ein
 * anonymer Aufrufer die Liste, und genau dieser Fall faellt.
 */

const route = { params: Promise.resolve({ projectId: "project-1", environment: "development" }) };

function fixture() {
  const listOidcProviders = vi.fn().mockReturnValue([
    { id: "certification", issuer: "https://dex.qkern.test/dex" },
    { id: "partner", issuer: "https://partner.qkern.test/dex" },
  ]);
  const service = { listOidcProviders } as unknown as ProjectAuthService;
  const keys = {
    authenticate: vi.fn().mockResolvedValue({
      id: "key-1", organizationId: "org-1", projectId: "project-1",
      environment: "development", kind: "public", expiresAt: "2026-09-01T00:00:00.000Z",
    }),
  } as unknown as ProjectApiKeyService;
  return { service, keys, listOidcProviders };
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest(
    "https://qkern.test/api/v1/projects/project-1/environments/development/auth/oidc/providers",
    { headers: { origin: "https://app.test", "x-qkern-key": `qk_public_${"a".repeat(43)}`, ...headers } },
  );
}

describe("project auth public providers route", () => {
  beforeEach(() => { vi.stubEnv("QKERN_PROJECT_AUTH_ALLOWED_ORIGINS", "https://app.test"); });

  it("serves the projection to the exact project key with CORS and no-store", async () => {
    const built = fixture();
    const handler = createProjectAuthPublicProvidersHandler(() => built.service, built.keys);
    const response = await handler(request(), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: [
      { id: "certification", issuer: "https://dex.qkern.test/dex" },
      { id: "partner", issuer: "https://partner.qkern.test/dex" },
    ] });
  });

  it("refuses anonymous callers, foreign keys, foreign origins and query noise", async () => {
    const built = fixture();
    const handler = createProjectAuthPublicProvidersHandler(() => built.service, built.keys);

    const anonymous = new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/auth/oidc/providers",
      { headers: { origin: "https://app.test" } },
    );
    expect((await handler(anonymous, route)).status).toBe(401);

    const foreignKey = createProjectAuthPublicProvidersHandler(() => built.service, {
      authenticate: vi.fn().mockResolvedValue({
        id: "key-2", organizationId: "org-2", projectId: "other-project",
        environment: "development", kind: "public", expiresAt: "2026-09-01T00:00:00.000Z",
      }),
    } as unknown as ProjectApiKeyService);
    // 404, nicht 403: Ein fremder Schluessel erfaehrt nicht, dass es das
    // Projekt gibt — derselbe Vertrag wie an den uebrigen Auth-Routen.
    expect((await foreignKey(request(), route)).status).toBe(404);

    expect((await handler(request({ origin: "https://attacker.test" }), route)).status).toBe(403);

    const noisy = new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/auth/oidc/providers?limit=5",
      { headers: { origin: "https://app.test", "x-qkern-key": `qk_public_${"a".repeat(43)}` } },
    );
    expect((await handler(noisy, route)).status).toBe(400);
    expect(built.listOidcProviders).not.toHaveBeenCalled();
  });
});
