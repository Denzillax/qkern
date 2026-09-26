import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createProjectAuthSessionsHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/users/[userId]/sessions/route";
import { createProjectAuthSessionHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/users/[userId]/sessions/[sessionId]/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Admin-Routen der Sitzungen (2.34): Console-Session statt Projekt-Key,
 * dieselbe Grenze wie die Nutzerliste. Der Dienst laeuft echt auf dem
 * Speicher-Repository; die PostgreSQL-Seite deckt der Fall "(2.34)" in
 * project-auth-postgres ab.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `sessions-${nonce}@qkern.test`,
    password: "a sufficiently long sessions route test password",
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
  const service = new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "sessions-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 5)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  async function appUser(email: string) {
    const signup = await service.signUp(scope, {
      email, password: "a sufficiently long password", redirectTo: "https://app.test/callback",
      rateLimitKey: randomUUID(),
    });
    const session = await service.consumeEmailToken(scope, { token: signup.debugToken!, purpose: "email_verification" });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    return { session, principal: await service.verifyAccess(scope, session.accessToken) };
  }
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/users`;
  const call = (path: string, method: "GET" | "DELETE", headers: Record<string, string> = {}) =>
    new NextRequest(`${base}${path}`, {
      method, headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, origin: "https://qkern.test", ...headers },
    });
  const params = (extra: Record<string, string>) =>
    ({ params: Promise.resolve({ projectId: principal.project.id, environment: "development", ...extra }) });
  return { service, scope, appUser, call, params, handlers: createProjectAuthSessionsHandlers(() => service),
    one: createProjectAuthSessionHandler(() => service) };
}

describe("project auth admin sessions routes", () => {
  it("lists, revokes one family and revokes all sessions of a user, no-store and without tokens", async () => {
    const built = await fixture();
    const user = await built.appUser(`user-${randomUUID()}@example.test`);
    const bystander = await built.appUser(`bystander-${randomUUID()}@example.test`);
    const second = await built.service.passwordSignIn(built.scope, {
      email: user.principal.user.email, password: "a sufficiently long password", rateLimitKey: randomUUID(),
    });
    if ("mfaRequired" in second) throw new Error("unexpected MFA");
    const userId = user.principal.user.id;

    const listed = await built.handlers.GET(built.call(`/${userId}/sessions`, "GET"), built.params({ userId }));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    const body = await listed.json();
    expect(body.data.sessions).toHaveLength(2);
    expect(Object.keys(body.data.sessions[0]).sort())
      .toEqual(["assurance", "createdAt", "expiresAt", "familyId", "id", "replacedBySessionId"]);
    expect(JSON.stringify(body)).not.toContain("qk_refresh_");

    const sessionId = user.principal.session.id;
    const revoked = await built.one(built.call(`/${userId}/sessions/${sessionId}`, "DELETE"), built.params({ userId, sessionId }));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ data: { revoked: 1 } });
    await expect(built.service.refresh(built.scope, user.session.refreshToken)).rejects.toBeTruthy();

    const all = await built.handlers.DELETE(built.call(`/${userId}/sessions`, "DELETE"), built.params({ userId }));
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ data: { revoked: 1 } });
    const empty = await built.handlers.GET(built.call(`/${userId}/sessions`, "GET"), built.params({ userId }));
    expect((await empty.json()).data.sessions).toEqual([]);
    expect((await built.service.listSessions(built.scope, bystander.principal.user.id)).sessions).toHaveLength(1);
  });

  it("answers 404 for unknown users and foreign sessions, 400 for bad uuids", async () => {
    const built = await fixture();
    const user = await built.appUser(`user-${randomUUID()}@example.test`);
    const other = await built.appUser(`other-${randomUUID()}@example.test`);
    const unknown = randomUUID();
    const missing = await built.handlers.GET(built.call(`/${unknown}/sessions`, "GET"), built.params({ userId: unknown }));
    expect(missing.status).toBe(404);
    const missingAll = await built.handlers.DELETE(built.call(`/${unknown}/sessions`, "DELETE"), built.params({ userId: unknown }));
    expect(missingAll.status).toBe(404);

    const userId = user.principal.user.id;
    const foreign = other.principal.session.id;
    const crossed = await built.one(built.call(`/${userId}/sessions/${foreign}`, "DELETE"), built.params({ userId, sessionId: foreign }));
    expect(crossed.status).toBe(404);
    await expect(built.service.verifyAccess(built.scope, other.session.accessToken)).resolves.toBeTruthy();

    const badUser = await built.handlers.GET(built.call("/not-a-uuid/sessions", "GET"), built.params({ userId: "not-a-uuid" }));
    expect(badUser.status).toBe(400);
    const badSession = await built.one(built.call(`/${userId}/sessions/nope`, "DELETE"), built.params({ userId, sessionId: "nope" }));
    expect(badSession.status).toBe(400);
    const withQuery = await built.handlers.GET(built.call(`/${userId}/sessions?limit=5`, "GET"), built.params({ userId }));
    expect(withQuery.status).toBe(400);
  });

  it("rejects DELETE without a trusted origin before touching the service", async () => {
    const built = await fixture();
    const user = await built.appUser(`csrf-${randomUUID()}@example.test`);
    const userId = user.principal.user.id;
    const sessionId = user.principal.session.id;
    const foreignOrigin = { origin: "https://attacker.test" };
    const all = await built.handlers.DELETE(built.call(`/${userId}/sessions`, "DELETE", foreignOrigin), built.params({ userId }));
    expect(all.status).toBe(403);
    const one = await built.one(built.call(`/${userId}/sessions/${sessionId}`, "DELETE", foreignOrigin), built.params({ userId, sessionId }));
    expect(one.status).toBe(403);
    await expect(built.service.verifyAccess(built.scope, user.session.accessToken)).resolves.toBeTruthy();

    const anonymous = await built.handlers.GET(new NextRequest(
      `https://qkern.test/api/v1/projects/project/environments/development/auth/admin/users/${userId}/sessions`,
    ), { params: Promise.resolve({ projectId: "project", environment: "development", userId }) });
    expect(anonymous.status).toBe(401);
  });
});
