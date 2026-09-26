import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthAuditHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/audit/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Admin-Route des Auth-Audits (2.35): Console-Session mit
 * `project_auth_admin`, nur `project_auth.*` im Scope, neueste zuerst. Die
 * PostgreSQL-Seite deckt der Fall "(2.35)" in project-auth-postgres ab.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `audit-${nonce}@qkern.test`,
    password: "a sufficiently long audit route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

async function fixture() {
  const principal = await identity();
  const { privateKey } = generateKeyPairSync("ed25519");
  const audit = new MemoryProjectAuthAuditSink();
  const service = new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(), audit,
    tokens: new ProjectAuthTokenService({ kid: "audit-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 6)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/audit`;
  const call = (query = "", headers: Record<string, string> = {}) =>
    new NextRequest(`${base}${query}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, ...headers } });
  const params = { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) };
  return { principal, service, scope, call, params, handler: createProjectAuthAuditHandler(() => service) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin audit route", () => {
  it("lists project auth events newest first with a cursor, no-store and without emails or tokens", async () => {
    const built = await fixture();
    const email = `app-${randomUUID()}@example.test`;
    const signup = await built.service.signUp(built.scope, {
      email, password: "a sufficiently long password", redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    const session = await built.service.consumeEmailToken(built.scope, { token: signup.debugToken!, purpose: "email_verification" });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    await expect(built.service.passwordSignIn(built.scope, {
      email: "unknown@example.test", password: "a sufficiently long password", rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const response = await built.handler(built.call("?limit=2"), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.events.map((event: { action: string }) => event.action))
      .toEqual(["project_auth.login.failed", "project_auth.login.succeeded"]);
    expect(Object.keys(body.data.events[0]).sort())
      .toEqual(["action", "actorRef", "actorType", "createdAt", "id", "metadata", "resourceRef", "status"]);
    expect(body.data.nextCursor).toBe(body.data.events[1].id);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain("unknown@example.test");
    expect(serialized).not.toMatch(/qk_(refresh|verify)_|entry_hash|entryHash/);

    const next = await built.handler(built.call(`?limit=2&cursor=${body.data.nextCursor}`), built.params);
    const nextBody = await next.json();
    expect(nextBody.data.events.map((event: { action: string }) => event.action)).toEqual(["project_auth.signup.succeeded"]);
    expect(nextBody.data.nextCursor).toBeNull();
  });

  it("validates limit and cursor and rejects unknown parameters", async () => {
    const built = await fixture();
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=5&limit=6", "?cursor=nope", "?since=1"]) {
      const response = await built.handler(built.call(query), built.params);
      expect(response.status, query).toBe(400);
    }
    const defaults = await built.handler(built.call(), built.params);
    expect(defaults.status).toBe(200);
    expect((await defaults.json()).data).toEqual({ events: [], nextCursor: null });
  });

  it("requires a console session and the project auth admin capability", async () => {
    const built = await fixture();
    const anonymous = await built.handler(new NextRequest(
      `https://qkern.test/api/v1/projects/${built.principal.project.id}/environments/development/auth/admin/audit`,
    ), built.params);
    expect(anonymous.status).toBe(401);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    const developer = await built.handler(built.call(), built.params);
    expect(developer.status).toBe(404);
  });
});
