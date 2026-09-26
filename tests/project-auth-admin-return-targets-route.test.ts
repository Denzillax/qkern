import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthReturnTargetHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/return-targets/route";
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
 * Die Route der Ruecksprungziele (2.54): dieselbe Tuer wie die uebrigen
 * `admin/*`-Routen, ein Feld im Koerper, ein Audit-Eintrag je Aenderung —
 * und eine Liste, die nur verengt. Die reine Entscheidung prueft
 * `project-auth-return-targets`; die PostgreSQL-Seite der Fall "(2.54)" in
 * postgres.integration.
 */
const BOUND = ["https://app.test", "https://admin.app.test"];

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `targets-route-${nonce}@qkern.test`,
    password: "a sufficiently long targets route test password",
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
    tokens: new ProjectAuthTokenService({ kid: "targets-route", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(BOUND),
    exposeDeliveryTokens: true,
  });
  const scope = {
    organizationId: principal.membership.organization.id, projectId: principal.project.id,
    environment: "development" as const,
  };
  const base = `https://qkern.test/api/v1/projects/${principal.project.id}`
    + "/environments/development/auth/admin/return-targets";
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
    handlers: createProjectAuthReturnTargetHandlers(() => service),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin return targets route", () => {
  it("reads the three lists, no-store, and starts without a narrowing", async () => {
    const built = await fixture();
    const response = await built.handlers.GET(built.read(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort())
      .toEqual(["effective", "limit", "outerBound", "targets", "updatedAt"]);
    expect(body.data).toEqual({
      targets: [], outerBound: BOUND, effective: BOUND, limit: 20, updatedAt: null,
    });
  });

  it("narrows the outer bound and writes exactly one audit entry with the count", async () => {
    const built = await fixture();
    const response = await built.handlers.PUT(built.write({ targets: ["https://app.test"] }), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({
      targets: ["https://app.test"], outerBound: BOUND, effective: ["https://app.test"],
    });

    const again = await built.handlers.GET(built.read(), built.params);
    const stored = (await again.json()).data;
    expect(stored.targets).toEqual(["https://app.test"]);
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Leeren nimmt die Verengung wieder weg; das ist kein Weiten, sondern
    // die Rueckkehr auf die aeussere Grenze.
    const cleared = await built.handlers.PUT(built.write({ targets: [] }), built.params);
    expect((await cleared.json()).data).toMatchObject({ targets: [], effective: BOUND });

    const page = await built.service.listAuditEvents(built.scope, 50);
    const entries = page.events.filter((event) => event.action === "project_auth.return_targets.changed");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actorType: "admin", actorRef: built.principal.user.id, status: "succeeded",
      resourceRef: "project_auth_environment:development", metadata: { count: 0 },
    });
    expect(entries[1].metadata).toEqual({ count: 1 });
    // Keine Adresse des Console-Nutzers und keine Herkunft in der Kette.
    expect(JSON.stringify(entries)).not.toContain("@");
    expect(JSON.stringify(entries)).not.toContain("app.test");
  });

  it("refuses a target that would widen the outer bound and says which one", async () => {
    const built = await fixture();
    const response = await built.handlers.PUT(
      built.write({ targets: ["https://app.test", "https://attacker.test"] }), built.params,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Project Auth return target",
      reason: "outside_outer_bound",
      value: "https://attacker.test",
    });
    // Und nichts davon ist gespeichert: kein halb angewandter Schreibzugriff.
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.targets).toEqual([]);
    const page = await built.service.listAuditEvents(built.scope, 50);
    expect(page.events.filter((event) => event.action === "project_auth.return_targets.changed")).toEqual([]);
  });

  it("refuses every other hostile entry with its own reason", async () => {
    const built = await fixture();
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["https://*.app.test", "wildcard"],
      ["https://app.test/callback", "not_an_origin"],
      ["https://app.test/", "not_an_origin"],
      ["http://app.test", "insecure_scheme"],
      ["https://user:secret@app.test", "carries_credentials"],
      ["javascript:alert(1)", "not_an_origin"],
      ["app.test", "not_a_url"],
      ["", "empty"],
    ];
    for (const [value, reason] of cases) {
      const response = await built.handlers.PUT(built.write({ targets: [value] }), built.params);
      expect(response.status, value).toBe(400);
      expect((await response.json()).reason, value).toBe(reason);
    }
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.targets).toEqual([]);
  });

  it("refuses a body that is not exactly one array of strings, and any query parameter", async () => {
    const built = await fixture();
    for (const body of [
      {}, { targets: "https://app.test" }, { targets: [1] }, { targets: {} },
      { targets: [], extra: 1 }, { targets: Array.from({ length: 21 }, () => "https://app.test") },
      "not json",
    ]) {
      const response = await built.handlers.PUT(built.write(body), built.params);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid Project Auth request" });
    }
    for (const query of ["?targets=x", "?limit=5"]) {
      const response = await built.handlers.GET(built.read(query), built.params);
      expect(response.status, query).toBe(400);
    }
  });

  it("requires a console session, the project auth admin capability and a trusted origin", async () => {
    const built = await fixture();
    expect((await built.handlers.GET(new NextRequest(built.base), built.params)).status).toBe(401);
    const anonymousWrite = await built.handlers.PUT(new NextRequest(built.base, {
      method: "PUT", headers: { origin: "https://qkern.test", "content-type": "application/json" },
      body: JSON.stringify({ targets: ["https://app.test"] }),
    }), built.params);
    expect(anonymousWrite.status).toBe(401);

    const crossSite = await built.handlers.PUT(
      built.write({ targets: ["https://app.test"] }, "https://attacker.test"), built.params,
    );
    expect(crossSite.status).toBe(403);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    expect((await built.handlers.GET(built.read(), built.params)).status).toBe(404);
    expect((await built.handlers.PUT(built.write({ targets: [] }), built.params)).status).toBe(404);
    vi.restoreAllMocks();

    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.targets).toEqual([]);
    const page = await built.service.listAuditEvents(built.scope, 50);
    expect(page.events.filter((event) => event.action === "project_auth.return_targets.changed")).toEqual([]);
  });

  it("enforces the stored list where a return target is really accepted", async () => {
    const built = await fixture();
    const signUp = (redirectTo: string) => built.service.signUp(built.scope, {
      email: `app-${randomUUID()}@example.test`,
      password: "a sufficiently long password", redirectTo, rateLimitKey: randomUUID(),
    });
    // Ohne Verengung gelten beide Herkuenfte der aeusseren Grenze.
    await expect(signUp("https://admin.app.test/willkommen")).resolves.toMatchObject({ accepted: true });

    await built.handlers.PUT(built.write({ targets: ["https://app.test"] }), built.params);

    // Jetzt nicht mehr — und zwar an der Anmeldung, nicht erst in der Mail.
    await expect(signUp("https://admin.app.test/willkommen"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(signUp("https://app.test/willkommen")).resolves.toMatchObject({ accepted: true });
    // Ausserhalb beider Grenzen bleibt ausserhalb.
    await expect(signUp("https://attacker.test/")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
