import { createHash, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthSignupHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/signup/route";
import { createProjectAuthTokenHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/token/route";
import { createGeneratedTableHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/rows/route";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };
const route = { params: Promise.resolve({ projectId: "project-1", environment: "development" }) };

function fixture() {
  const { privateKey } = generateKeyPairSync("ed25519");
  let id = 0;
  let token = 0;
  const service = new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "route-key", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 3)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date("2026-08-03T12:00:00.000Z"),
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    opaqueToken: (prefix) => `qk_${prefix}_${String.fromCharCode(97 + (token++ % 26)).repeat(43)}`,
  });
  const keys = {
    authenticate: vi.fn().mockResolvedValue({
      id: "key-1", organizationId: scope.organizationId, projectId: scope.projectId,
      environment: scope.environment, kind: "public", expiresAt: "2026-09-01T00:00:00.000Z",
    }),
  } as unknown as ProjectApiKeyService;
  return { service, keys };
}

function request(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`https://qkern.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: "https://app.test",
      "x-qkern-key": `qk_public_${"a".repeat(43)}`, ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("Project Auth routes and generated data bridge", () => {
  beforeEach(() => { vi.stubEnv("QKERN_PROJECT_AUTH_ALLOWED_ORIGINS", "https://app.test"); });

  it("binds public auth routes to the exact project key and emits explicit CORS", async () => {
    const built = fixture();
    const signup = createProjectAuthSignupHandler(() => built.service, built.keys);
    const response = await signup(request("/signup", {
      email: "route@example.test", password: "a sufficiently long password",
      redirectTo: "https://app.test/callback",
    }), route);
    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.test");
    const payload = await response.json();
    const verified = await built.service.consumeEmailToken(scope, {
      token: payload.data.debugToken, purpose: "email_verification",
    });
    expect(verified).not.toHaveProperty("mfaRequired");

    const token = createProjectAuthTokenHandler(() => built.service, built.keys);
    const login = await token(request("/token", {
      grantType: "password", email: "route@example.test", password: "a sufficiently long password",
    }), route);
    expect(login.status).toBe(200);
    expect((await login.json()).data).toMatchObject({ tokenType: "Bearer" });

    const denied = await signup(request("/signup", {
      email: "attacker@example.test", password: "a sufficiently long password",
      redirectTo: "https://app.test/callback",
    }, { origin: "https://attacker.test" }), route);
    expect(denied.status).toBe(403);
  });

  it("maps a verified app access token into server-issued RLS claims", async () => {
    const built = fixture();
    const signup = await built.service.signUp(scope, {
      email: "rls@example.test", password: "a sufficiently long password",
      redirectTo: "https://app.test/callback", rateLimitKey: "rls-signup",
    });
    const session = await built.service.consumeEmailToken(scope, {
      token: signup.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    const dataApi = {
      listRows: vi.fn().mockResolvedValue({
        source: "postgres", table: { schema: "public", name: "orders", rowSecurityEnabled: true, primaryKey: ["id"], columns: [] },
        rows: [], rowCount: 0, hasMore: false, nextCursor: null, maxRows: 20,
      }),
    } as unknown as GeneratedDataApiPort;
    const handlers = createGeneratedTableHandlers(async () => dataApi, built.keys, built.service);
    const response = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows",
      { headers: {
        authorization: `Bearer ${session.accessToken}`,
        "x-qkern-key": `qk_public_${"a".repeat(43)}`,
      } },
    ), { params: Promise.resolve({ projectId: "project-1", environment: "development", table: "orders" }) });
    expect(response.status).toBe(200);
    expect(dataApi.listRows).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1", actorRef: expect.stringContaining("project-auth-user:"),
      claims: expect.objectContaining({
        role: "authenticated", email: "rls@example.test", emailVerified: true, assurance: "aal1",
      }),
    }), expect.anything(), expect.anything());
  });
});
