import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthMfaHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/mfa/route";
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
 * Die Route des zweiten Faktors (2.52): dieselbe Tuer wie die uebrigen
 * `admin/*`-Routen, ein Feld im Koerper, ein Audit-Eintrag je Aenderung.
 * Was das Erzwingen bewirkt, prueft `project-auth-mfa-enforcement`; die
 * PostgreSQL-Seite der Fall "(2.52)" in postgres.integration.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `mfa-route-${nonce}@qkern.test`,
    password: "a sufficiently long mfa route test password",
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
  const audit = new MemoryProjectAuthAuditSink();
  const { privateKey } = generateKeyPairSync("ed25519");
  const service = new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(), audit,
    tokens: new ProjectAuthTokenService({ kid: "mfa-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 4)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/mfa`;
  const cookie = `${SESSION_COOKIE_NAME}=${principal.token}`;
  const read = (query = "") => new NextRequest(`${base}${query}`, { headers: { cookie } });
  const write = (body: unknown, origin = "https://qkern.test") => new NextRequest(base, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const params = { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) };
  return { principal, service, scope, base, cookie, read, write, params, handlers: createProjectAuthMfaHandlers(() => service) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin mfa route", () => {
  it("reads the switch and the two counts, no-store, without any secret", async () => {
    const built = await fixture();
    const email = `app-${randomUUID()}@example.test`;
    const signup = await built.service.signUp(built.scope, {
      email, password: "a sufficiently long password", redirectTo: "https://app.test/callback",
      rateLimitKey: randomUUID(),
    });
    await built.service.consumeEmailToken(built.scope, { token: signup.debugToken!, purpose: "email_verification" });

    const response = await built.handlers.GET(built.read(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort())
      .toEqual(["enrolled", "factors", "notEnrolled", "required", "updatedAt", "users"]);
    expect(body.data).toMatchObject({ required: false, updatedAt: null, users: 1, enrolled: 0, notEnrolled: 1 });
    expect(body.data.factors).toEqual(["totp"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain(email);
    expect(serialized).not.toMatch(/qk_|secret|recovery/i);
  });

  it("changes the switch and writes exactly one audit entry with the new state", async () => {
    const built = await fixture();
    const response = await built.handlers.PUT(built.write({ required: true }), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({ required: true });

    const again = await built.handlers.GET(built.read(), built.params);
    const policy = (await again.json()).data;
    expect(policy.required).toBe(true);
    expect(policy.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const off = await built.handlers.PUT(built.write({ required: false }), built.params);
    expect((await off.json()).data).toMatchObject({ required: false });

    const page = await built.service.listAuditEvents(built.scope, 50);
    const entries = page.events.filter((event) => event.action === "project_auth.mfa.enforcement_changed");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actorType: "admin", actorRef: built.principal.user.id, status: "succeeded",
      resourceRef: "project_auth_environment:development", metadata: { required: false },
    });
    expect(entries[1].metadata).toEqual({ required: true });
    // Keine Adresse des Console-Nutzers in der Kette, nur seine ID.
    expect(JSON.stringify(entries)).not.toContain("@");
  });

  it("refuses a body that is not exactly one boolean, and any query parameter on the read", async () => {
    const built = await fixture();
    for (const body of [{}, { required: "true" }, { required: 1 }, { required: true, extra: 1 }, "not json"]) {
      const response = await built.handlers.PUT(built.write(body), built.params);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid Project Auth request" });
    }
    for (const query of ["?required=true", "?limit=5"]) {
      const response = await built.handlers.GET(built.read(query), built.params);
      expect(response.status, query).toBe(400);
    }
    // Nach den abgewiesenen Koerpern steht der Schalter unveraendert.
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.required).toBe(false);
  });

  it("requires a console session, the project auth admin capability and a trusted origin", async () => {
    const built = await fixture();
    const anonymous = await built.handlers.GET(new NextRequest(built.base), built.params);
    expect(anonymous.status).toBe(401);
    const anonymousWrite = await built.handlers.PUT(new NextRequest(built.base, {
      method: "PUT", headers: { origin: "https://qkern.test", "content-type": "application/json" },
      body: JSON.stringify({ required: true }),
    }), built.params);
    expect(anonymousWrite.status).toBe(401);

    // Fremder Origin: abgewiesen, bevor irgendetwas gelesen wird.
    const crossSite = await built.handlers.PUT(built.write({ required: true }, "https://attacker.test"), built.params);
    expect(crossSite.status).toBe(403);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    expect((await built.handlers.GET(built.read(), built.params)).status).toBe(404);
    expect((await built.handlers.PUT(built.write({ required: true }), built.params)).status).toBe(404);
    vi.restoreAllMocks();

    // Keiner der abgewiesenen Versuche hat den Schalter bewegt oder etwas
    // in die Kette geschrieben.
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.required).toBe(false);
    const page = await built.service.listAuditEvents(built.scope, 50);
    expect(page.events.filter((event) => event.action === "project_auth.mfa.enforcement_changed")).toEqual([]);
  });
});
