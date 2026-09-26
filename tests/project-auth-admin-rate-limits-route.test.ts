import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthRateLimitHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/rate-limits/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { DEFAULT_PROJECT_AUTH_RATE_LIMITS } from "@/lib/server/project-auth/rate-limits";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthRateLimitError,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route der Grenzen je Zeitfenster (2.56): dieselbe Tuer wie die uebrigen
 * `admin/*`-Routen, alle drei Arten in einem Koerper, ein Audit-Eintrag je
 * Aenderung — und eine Grenze, die an der Anmeldung wirklich greift. Die
 * reine Entscheidung prueft `project-auth-rate-limits`; die PostgreSQL-Seite
 * der Fall "(2.56)" in postgres.integration.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

function limitsOf(max: number, windowSeconds: number) {
  return {
    sign_in: { max, windowSeconds },
    mail: { max, windowSeconds },
    refresh: { max, windowSeconds },
  };
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `rate-route-${nonce}@qkern.test`,
    password: "a sufficiently long rate route test password",
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
    tokens: new ProjectAuthTokenService({ kid: "rate-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}`
    + "/environments/development/auth/admin/rate-limits";
  const cookie = `${SESSION_COOKIE_NAME}=${principal.token}`;
  const read = (query = "") => new NextRequest(`${base}${query}`, { headers: { cookie } });
  const write = (body: unknown, origin = "https://qkern.test") => new NextRequest(base, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const params = { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) };
  return {
    principal, service, scope, base, cookie, read, write, params,
    handlers: createProjectAuthRateLimitHandlers(() => service),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin rate limits route", () => {
  it("reads the limits, the defaults and the bounds, no-store, and starts unconfigured", async () => {
    const built = await fixture();
    const response = await built.handlers.GET(built.read(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort())
      .toEqual(["bounds", "configured", "defaults", "kinds", "limits", "updatedAt"]);
    expect(body.data).toEqual({
      limits: DEFAULT_PROJECT_AUTH_RATE_LIMITS,
      defaults: DEFAULT_PROJECT_AUTH_RATE_LIMITS,
      bounds: { max: { min: 1, max: 10_000 }, windowSeconds: { min: 60, max: 86_400 } },
      kinds: ["sign_in", "mail", "refresh"],
      configured: false,
      updatedAt: null,
    });
  });

  it("replaces all three limits and writes exactly one audit entry with the six numbers", async () => {
    const built = await fixture();
    const response = await built.handlers.PUT(built.write({ limits: limitsOf(3, 600) }), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({ limits: limitsOf(3, 600), configured: true });

    const again = await built.handlers.GET(built.read(), built.params);
    const stored = (await again.json()).data;
    expect(stored.limits).toEqual(limitsOf(3, 600));
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const page = await built.service.listAuditEvents(built.scope, 50);
    const entries = page.events.filter((event) => event.action === "project_auth.rate_limits.changed");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorType: "admin", actorRef: built.principal.user.id, status: "succeeded",
      resourceRef: "project_auth_environment:development",
      metadata: {
        signInMax: 3, signInWindow: 600, mailMax: 3, mailWindow: 600,
        refreshMax: 3, refreshWindow: 600,
      },
    });
    // Keine Adresse des Console-Nutzers in der Kette.
    expect(JSON.stringify(entries)).not.toContain("@");
  });

  it("refuses a body that is not exactly all three limits, and any query parameter", async () => {
    const built = await fixture();
    for (const body of [
      {},
      { limits: {} },
      { limits: { sign_in: { max: 3, windowSeconds: 600 } } },
      { limits: { ...limitsOf(3, 600), other: { max: 1, windowSeconds: 60 } } },
      { limits: { ...limitsOf(3, 600), sign_in: { max: 0, windowSeconds: 600 } } },
      { limits: { ...limitsOf(3, 600), sign_in: { max: 10_001, windowSeconds: 600 } } },
      { limits: { ...limitsOf(3, 600), mail: { max: 3, windowSeconds: 59 } } },
      { limits: { ...limitsOf(3, 600), mail: { max: 3, windowSeconds: 86_401 } } },
      { limits: { ...limitsOf(3, 600), refresh: { max: 1.5, windowSeconds: 600 } } },
      { limits: { ...limitsOf(3, 600), refresh: { max: 3, windowSeconds: 600, extra: 1 } } },
      { limits: limitsOf(3, 600), extra: 1 },
      "not json",
    ]) {
      const response = await built.handlers.PUT(built.write(body), built.params);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({ error: "Invalid Project Auth request" });
    }
    for (const query of ["?limits=x", "?limit=5"]) {
      const response = await built.handlers.GET(built.read(query), built.params);
      expect(response.status, query).toBe(400);
    }
    // Nichts davon ist gespeichert.
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.configured).toBe(false);
  });

  it("names the kind when the service refuses a limit", async () => {
    const built = await fixture();
    // Das Schema der Route und die Pruefung des Dienstes sagen dasselbe, und
    // darum kommt ein vom Dienst abgelehnter Wert durch die Route gar nicht
    // erst hindurch. Geprueft wird hier trotzdem, was die Route tut, wenn der
    // Dienst ablehnt: Der typisierte Grund samt Art muss ankommen, sonst
    // koennte die Console nicht sagen, welche Zahl nicht geht.
    vi.spyOn(built.service, "setRateLimits").mockRejectedValue(
      new ProjectAuthRateLimitError("max_out_of_range", "mail"),
    );
    const response = await built.handlers.PUT(built.write({ limits: limitsOf(3, 600) }), built.params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Project Auth rate limit",
      reason: "max_out_of_range",
      field: "mail",
    });
  });

  it("requires a console session, the project auth admin capability and a trusted origin", async () => {
    const built = await fixture();
    expect((await built.handlers.GET(new NextRequest(built.base), built.params)).status).toBe(401);
    const anonymousWrite = await built.handlers.PUT(new NextRequest(built.base, {
      method: "PUT", headers: { origin: "https://qkern.test", "content-type": "application/json" },
      body: JSON.stringify({ limits: limitsOf(3, 600) }),
    }), built.params);
    expect(anonymousWrite.status).toBe(401);

    const crossSite = await built.handlers.PUT(built.write({ limits: limitsOf(3, 600) }, "https://attacker.test"), built.params);
    expect(crossSite.status).toBe(403);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    expect((await built.handlers.GET(built.read(), built.params)).status).toBe(404);
    expect((await built.handlers.PUT(built.write({ limits: limitsOf(3, 600) }), built.params)).status).toBe(404);
    vi.restoreAllMocks();

    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.configured).toBe(false);
    const page = await built.service.listAuditEvents(built.scope, 50);
    expect(page.events.filter((event) => event.action === "project_auth.rate_limits.changed")).toEqual([]);
  });

  it("enforces the stored limit where a sign-in is really decided", async () => {
    const built = await fixture();
    const email = `app-${randomUUID()}@example.test`;
    const password = "a sufficiently long password";
    const signUp = await built.service.signUp(built.scope, {
      email, password, redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    await built.service.consumeEmailToken(built.scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });

    await built.handlers.PUT(built.write({ limits: limitsOf(2, 900) }), built.params);

    // Zwei Versuche gehen durch bis zur Passwortpruefung, der dritte nicht
    // mehr — und zwar auch dann nicht, wenn das Passwort stimmt.
    for (const attempt of [1, 2]) {
      await expect(built.service.passwordSignIn(built.scope, {
        email, password: "wrong", rateLimitKey: randomUUID(),
      }), `attempt ${attempt}`).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(built.service.passwordSignIn(built.scope, {
      email, password, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });

    // Und die Grenze hinterlaesst genau eine Spur, ohne Adresse.
    const page = await built.service.listAuditEvents(built.scope, 50);
    const blocked = page.events.filter((event) => event.action === "project_auth.rate_limit.blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].metadata).toEqual({ kind: "sign_in", max: 2, windowSeconds: 900 });
    expect(JSON.stringify(blocked)).not.toContain("@");
  });
});
