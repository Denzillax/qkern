import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthPasswordProtectionHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/password-protection/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import {
  parseProjectAuthLeakList,
  projectAuthPasswordDigest,
  PROJECT_AUTH_BUILT_IN_LEAK_SOURCE,
} from "@/lib/server/project-auth/password-leaks";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthPasswordProtectionError,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route des Passwortschutzes (2.53): dieselbe Tuer wie die uebrigen
 * `admin/*`-Routen, alle drei Werte in einem Koerper, ein Audit-Eintrag je
 * Aenderung — und eine Regel, die bei der Registrierung wirklich greift. Die
 * reine Entscheidung prueft `project-auth-password-leaks`; die
 * PostgreSQL-Seite der Fall "(2.60)" in postgres.integration.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

const LEAKED_PASSWORD = "correct horse battery staple";
const CLEAN_PASSWORD = "eine ausreichend lange Parole ohne Leck";

function leakList() {
  const parsed = parseProjectAuthLeakList(
    `${projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1")}:11`, "sha1",
  );
  if (!parsed.ok) throw new Error("unexpected rejection");
  return parsed.list;
}

function protectionOf(leakedPasswordCheck: boolean, minLength: number, notice: "named" | "generic") {
  return { leakedPasswordCheck, minLength, notice };
}

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `protection-route-${nonce}@qkern.test`,
    password: "a sufficiently long protection route test password",
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
    leakedPasswords: leakList(),
    rateLimiter: new InMemoryRateLimiter(), audit,
    tokens: new ProjectAuthTokenService({ kid: "protection-route", privateKey }, "https://qkern.test"),
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
    + "/environments/development/auth/admin/password-protection";
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
    handlers: createProjectAuthPasswordProtectionHandlers(() => service),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin password protection route", () => {
  it("reads the setting, the defaults, the bounds and the list, no-store, and starts unconfigured", async () => {
    const built = await fixture();
    const response = await built.handlers.GET(built.read(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort())
      .toEqual(["bounds", "configured", "defaults", "list", "notices", "protection", "updatedAt"]);
    expect(body.data).toEqual({
      protection: protectionOf(false, 12, "named"),
      defaults: protectionOf(false, 12, "named"),
      bounds: { minLength: { min: 12, max: 128 } },
      notices: ["named", "generic"],
      list: {
        source: "file", algorithm: "sha1", prefixLength: 40, entries: 1,
        builtInEntries: 25, builtInSource: PROJECT_AUTH_BUILT_IN_LEAK_SOURCE,
      },
      configured: false,
      updatedAt: null,
    });
    // Die Antwort nennt keinen Pfad und keinen Eintrag der Liste.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1"));
    expect(serialised).not.toContain(LEAKED_PASSWORD);
  });

  it("replaces all three values and writes exactly one audit entry", async () => {
    const built = await fixture();
    const response = await built.handlers.PUT(
      built.write({ protection: protectionOf(true, 16, "generic") }), built.params,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({
      protection: protectionOf(true, 16, "generic"), configured: true,
    });

    const again = await built.handlers.GET(built.read(), built.params);
    const stored = (await again.json()).data;
    expect(stored.protection).toEqual(protectionOf(true, 16, "generic"));
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const page = await built.service.listAuditEvents(built.scope, 50);
    const entries = page.events.filter((event) => event.action === "project_auth.password_protection.changed");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorType: "admin", actorRef: built.principal.user.id, status: "succeeded",
      resourceRef: "project_auth_environment:development",
      metadata: {
        leakCheck: true, minLength: 16, notice: "generic",
        listSource: "file", listEntries: 1,
      },
    });
    // Keine Adresse des Console-Nutzers in der Kette.
    expect(JSON.stringify(entries)).not.toContain("@");
  });

  it("refuses a body that is not exactly all three values, and any query parameter", async () => {
    const built = await fixture();
    for (const body of [
      {},
      { protection: {} },
      { protection: { leakedPasswordCheck: true } },
      { protection: { ...protectionOf(true, 12, "named"), extra: 1 } },
      { protection: { ...protectionOf(true, 11, "named") } },
      { protection: { ...protectionOf(true, 129, "named") } },
      { protection: { ...protectionOf(true, 12, "named"), minLength: 12.5 } },
      { protection: { ...protectionOf(true, 12, "named"), notice: "loud" } },
      { protection: { ...protectionOf(true, 12, "named"), leakedPasswordCheck: "yes" } },
      { protection: protectionOf(true, 12, "named"), extra: 1 },
      // Ein Passwort im Koerper ist keine erlaubte Eingabe: Diese Route nimmt
      // keines an, und ein Feld dafuer gibt es nicht.
      { protection: { ...protectionOf(true, 12, "named"), password: LEAKED_PASSWORD } },
      "not json",
    ]) {
      const response = await built.handlers.PUT(built.write(body), built.params);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({ error: "Invalid Project Auth request" });
    }
    for (const query of ["?protection=x", "?limit=5"]) {
      const response = await built.handlers.GET(built.read(query), built.params);
      expect(response.status, query).toBe(400);
    }
    // Nichts davon ist gespeichert.
    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.configured).toBe(false);
  });

  it("names the field when the service refuses a value", async () => {
    const built = await fixture();
    // Das Schema der Route und die Pruefung des Dienstes sagen dasselbe, und
    // darum kommt ein vom Dienst abgelehnter Wert durch die Route gar nicht
    // erst hindurch. Geprueft wird hier trotzdem, was die Route tut, wenn der
    // Dienst ablehnt: Der typisierte Grund samt Feld muss ankommen, sonst
    // koennte die Console nicht sagen, welcher Wert nicht geht.
    vi.spyOn(built.service, "setPasswordProtection").mockRejectedValue(
      new ProjectAuthPasswordProtectionError("min_length_out_of_range", "minLength"),
    );
    const response = await built.handlers.PUT(
      built.write({ protection: protectionOf(true, 16, "named") }), built.params,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Project Auth password protection",
      reason: "min_length_out_of_range",
      field: "minLength",
    });
  });

  it("requires a console session, the project auth admin capability and a trusted origin", async () => {
    const built = await fixture();
    expect((await built.handlers.GET(new NextRequest(built.base), built.params)).status).toBe(401);
    const anonymousWrite = await built.handlers.PUT(new NextRequest(built.base, {
      method: "PUT", headers: { origin: "https://qkern.test", "content-type": "application/json" },
      body: JSON.stringify({ protection: protectionOf(true, 12, "named") }),
    }), built.params);
    expect(anonymousWrite.status).toBe(401);

    const crossSite = await built.handlers.PUT(
      built.write({ protection: protectionOf(true, 12, "named") }, "https://attacker.test"), built.params,
    );
    expect(crossSite.status).toBe(403);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    expect((await built.handlers.GET(built.read(), built.params)).status).toBe(404);
    expect((await built.handlers.PUT(
      built.write({ protection: protectionOf(true, 12, "named") }), built.params,
    )).status).toBe(404);
    vi.restoreAllMocks();

    expect((await (await built.handlers.GET(built.read(), built.params)).json()).data.configured).toBe(false);
    const page = await built.service.listAuditEvents(built.scope, 50);
    expect(page.events.filter((event) => event.action === "project_auth.password_protection.changed")).toEqual([]);
  });

  it("enforces the stored rule where a password is really set", async () => {
    const built = await fixture();
    // Vor dem Einschalten geht das bekannte Passwort durch: Die Vorgabe ist aus.
    expect(await built.service.signUp(built.scope, {
      email: `before-${randomUUID()}@example.test`, password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    })).toMatchObject({ accepted: true });

    await built.handlers.PUT(built.write({ protection: protectionOf(true, 12, "named") }), built.params);

    await expect(built.service.signUp(built.scope, {
      email: `after-${randomUUID()}@example.test`, password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "LEAKED_PASSWORD" });
    expect(await built.service.signUp(built.scope, {
      email: `clean-${randomUUID()}@example.test`, password: CLEAN_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    })).toMatchObject({ accepted: true });

    // Und die Ablehnung hinterlaesst genau eine Spur, ohne Passwort, ohne
    // Digest und ohne Adresse.
    const page = await built.service.listAuditEvents(built.scope, 50);
    const refused = page.events.filter((event) => event.action === "project_auth.password.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0].metadata).toEqual({ reason: "known_leak", listSource: "file", listEntries: 1 });
    const serialised = JSON.stringify(refused);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain(LEAKED_PASSWORD);
    expect(serialised).not.toContain(projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1"));
  });
});
