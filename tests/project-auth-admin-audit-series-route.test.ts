import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthAuditSeriesHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/audit/series/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { MemoryProjectAuthAuditSink, type ProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Reihen-Route des Auth-Audits (2.47): dieselbe Tuer wie `admin/audit`,
 * ein Parameter, kein Schreibverb. Die PostgreSQL-Seite deckt der Fall
 * "(2.47)" in postgres.integration ab.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `series-${nonce}@qkern.test`,
    password: "a sufficiently long audit series route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

async function fixture(options: { audit?: ProjectAuthAuditSink } = { audit: new MemoryProjectAuthAuditSink() }) {
  const audit = options.audit;
  const principal = await identity();
  const { privateKey } = generateKeyPairSync("ed25519");
  const service = new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(), audit,
    tokens: new ProjectAuthTokenService({ kid: "series-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 8)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/auth/admin/audit/series`;
  const call = (query = "") =>
    new NextRequest(`${base}${query}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } });
  const params = { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) };
  return { principal, service, scope, base, call, params, handler: createProjectAuthAuditSeriesHandler(() => service) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin audit series route", () => {
  it("returns every bucket of the window, no-store, and counts what was recorded", async () => {
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

    const response = await built.handler(built.call(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort())
      .toEqual(["actions", "bucket", "bucketCount", "buckets", "totals", "truncated", "windowEnd", "windowStart"]);
    expect(body.data.bucket).toBe("hour");
    expect(body.data.bucketCount).toBe(48);
    expect(body.data.buckets).toHaveLength(48);
    expect(body.data.truncated).toBe(false);
    expect(new Date(body.data.windowEnd).getTime() - new Date(body.data.windowStart).getTime()).toBe(48 * 3_600_000);
    // Registrierung, Anmeldung und ein Fehlversuch mit unbekannter Adresse.
    expect(body.data.totals).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(body.data.totals.actions["project_auth.signup.succeeded"]).toBe(1);
    expect(body.data.totals.actions["project_auth.login.succeeded"]).toBe(1);
    expect(body.data.totals.actions["project_auth.login.failed"]).toBe(1);
    // Keine Adresse, kein Token, kein Kettenhash: Die Reihe traegt nur Zahlen.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain(email);
    expect(serialized).not.toMatch(/qk_|entry_hash|entryHash/);

    const daily = await built.handler(built.call("?bucket=day"), built.params);
    const dailyBody = await daily.json();
    expect(dailyBody.data.bucket).toBe("day");
    expect(dailyBody.data.buckets).toHaveLength(90);
    expect(dailyBody.data.totals).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
  });

  it("rejects an unknown bucket, a repeated parameter and any foreign parameter", async () => {
    const built = await fixture();
    for (const query of ["?bucket=minute", "?bucket=", "?bucket=hour&bucket=day", "?bucket=hour&limit=5", "?metric=api_requests"]) {
      const response = await built.handler(built.call(query), built.params);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid Project Auth request" });
    }
  });

  it("requires a console session and the project auth admin capability", async () => {
    const built = await fixture();
    const anonymous = await built.handler(new NextRequest(built.base), built.params);
    expect(anonymous.status).toBe(401);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    const developer = await built.handler(built.call(), built.params);
    expect(developer.status).toBe(404);
  });

  it("says plainly that there is no series when no audit sink is configured", async () => {
    const built = await fixture({});
    const response = await built.handler(built.call(), built.params);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Project Auth audit is not configured" });
  });
});
