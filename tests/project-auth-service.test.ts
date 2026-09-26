import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import {
  MemoryProjectAuthAuditSink,
  type ProjectAuthAuditEvent,
  type ProjectAuthAuditSink,
} from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  ProjectAuthError,
  ProjectAuthService,
  type ProjectAuthDelivery,
  type ProjectAuthDeliveryPort,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

class DeliveryRecorder implements ProjectAuthDeliveryPort {
  readonly messages: ProjectAuthDelivery[] = [];
  async deliver(message: ProjectAuthDelivery) { this.messages.push({ ...message }); }
}

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };

function fixture(audit?: ProjectAuthAuditSink) {
  const repository = new MemoryProjectAuthRepository();
  const delivery = new DeliveryRecorder();
  const { privateKey } = generateKeyPairSync("ed25519");
  let now = new Date("2026-08-03T12:00:00.000Z");
  let id = 0;
  let token = 0;
  const service = new ProjectAuthService({
    repository, delivery, audit, passwords: new FastHasher(), rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "test-key", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
    oidcCatalog: new ProjectAuthOidcCatalog([]), oidcClient: new ProjectAuthOidcClient({}, async () => {
      throw new Error("not expected");
    }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date(now),
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    opaqueToken: (prefix) => `qk_${prefix}_${String.fromCharCode(97 + (token++ % 26)).repeat(43)}`,
  });
  return { service, repository, delivery, setNow: (value: string) => { now = new Date(value); } };
}

async function verifiedAccount(built: ReturnType<typeof fixture>, email = "user@example.test") {
  const signup = await built.service.signUp(scope, {
    email, password: "a sufficiently long password", redirectTo: "https://app.test/auth/callback",
    rateLimitKey: `signup-${email}`,
  });
  if (!signup.debugToken) throw new Error("missing development token");
  const session = await built.service.consumeEmailToken(scope, {
    token: signup.debugToken, purpose: "email_verification",
  });
  if ("mfaRequired" in session) throw new Error("unexpected MFA");
  return session;
}

describe("Project Auth service", () => {
  it("separates app users, verifies email and rotates refresh tokens with family replay revocation", async () => {
    const built = fixture();
    const signup = await built.service.signUp(scope, {
      email: "User@Example.Test", password: "a sufficiently long password",
      userMetadata: { locale: "de-CH" }, redirectTo: "https://app.test/auth/callback", rateLimitKey: "signup-1",
    });
    expect(signup).toMatchObject({ accepted: true });
    expect(signup.debugToken).toMatch(/^qk_verify_/);
    expect(built.delivery.messages).toHaveLength(1);
    await expect(built.service.passwordSignIn(scope, {
      email: "user@example.test", password: "a sufficiently long password", rateLimitKey: "login-before-verify",
    })).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    const initial = await built.service.consumeEmailToken(scope, {
      token: signup.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in initial) throw new Error("unexpected MFA");
    expect(initial.user.email).toBe("user@example.test");
    expect(initial.user).not.toHaveProperty("passwordHash");
    const principal = await built.service.verifyAccess(scope, initial.accessToken);
    expect(principal.claims).toMatchObject({
      role: "authenticated", email_verified: true, aal: "aal1", project_id: "project-1",
    });

    const rotated = await built.service.refresh(scope, initial.refreshToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    await expect(built.service.verifyAccess(scope, initial.accessToken)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(built.service.refresh(scope, initial.refreshToken)).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });
    await expect(built.service.verifyAccess(scope, rotated.accessToken)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("keeps magic-link and password-reset requests enumeration-safe and one-time", async () => {
    const built = fixture();
    await expect(built.service.requestPasswordReset(scope, {
      email: "unknown@example.test", redirectTo: "https://app.test/reset", rateLimitKey: "unknown-reset",
    })).resolves.toEqual({ accepted: true });
    expect(built.delivery.messages).toHaveLength(0);

    const magic = await built.service.requestMagicLink(scope, {
      email: "magic@example.test", redirectTo: "https://app.test/callback", createUser: true,
      rateLimitKey: "magic-create",
    });
    expect(magic.debugToken).toMatch(/^qk_magic_/);
    const session = await built.service.consumeEmailToken(scope, {
      token: magic.debugToken!, purpose: "magic_link",
    });
    expect(session).not.toHaveProperty("mfaRequired");
    await expect(built.service.consumeEmailToken(scope, {
      token: magic.debugToken!, purpose: "magic_link",
    })).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    const reset = await built.service.requestPasswordReset(scope, {
      email: "magic@example.test", redirectTo: "https://app.test/reset", rateLimitKey: "known-reset",
    });
    await expect(built.service.resetPassword(scope, {
      token: reset.debugToken!, password: "the replacement password",
    })).resolves.toEqual({ reset: true });
    await expect(built.service.resetPassword(scope, {
      token: reset.debugToken!, password: "another replacement password",
    })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("enrolls TOTP, returns recovery codes once and upgrades sessions to aal2", async () => {
    const built = fixture();
    const session = await verifiedAccount(built, "mfa@example.test");
    const principal = await built.service.verifyAccess(scope, session.accessToken);
    const enrollment = await built.service.enrollMfa(principal);
    expect(enrollment.recoveryCodes).toHaveLength(10);
    expect(enrollment.uri).toContain("otpauth://totp/");
    const code = totp(enrollment.secret, new Date("2026-08-03T12:00:00.000Z"));
    await expect(built.service.confirmMfa(principal, code)).resolves.toEqual({ verified: true });

    const login = await built.service.passwordSignIn(scope, {
      email: "mfa@example.test", password: "a sufficiently long password", rateLimitKey: "mfa-login",
    });
    expect(login).toMatchObject({ mfaRequired: true });
    if (!("mfaRequired" in login)) throw new Error("MFA challenge missing");
    const aal2 = await built.service.verifyMfaChallenge(scope, {
      challengeToken: login.challengeToken, code, rateLimitKey: "mfa-code",
    });
    expect((await built.service.verifyAccess(scope, aal2.accessToken)).claims.aal).toBe("aal2");

    const recoveryLogin = await built.service.passwordSignIn(scope, {
      email: "mfa@example.test", password: "a sufficiently long password", rateLimitKey: "recovery-login",
    });
    if (!("mfaRequired" in recoveryLogin)) throw new Error("MFA challenge missing");
    await expect(built.service.verifyMfaChallenge(scope, {
      challengeToken: recoveryLogin.challengeToken, code: enrollment.recoveryCodes[0], rateLimitKey: "recovery-code",
    })).resolves.toMatchObject({ tokenType: "Bearer" });

    const replayLogin = await built.service.passwordSignIn(scope, {
      email: "mfa@example.test", password: "a sufficiently long password", rateLimitKey: "recovery-replay-login",
    });
    if (!("mfaRequired" in replayLogin)) throw new Error("MFA challenge missing");
    await expect(built.service.verifyMfaChallenge(scope, {
      challengeToken: replayLogin.challengeToken, code: enrollment.recoveryCodes[0], rateLimitKey: "recovery-replay",
    })).rejects.toMatchObject({ code: "INVALID_MFA" });
  });

  it("disables a user and immediately revokes every access session", async () => {
    const built = fixture();
    const session = await verifiedAccount(built, "disabled@example.test");
    const principal = await built.service.verifyAccess(scope, session.accessToken);
    await built.service.updateUser(scope, principal.user.id, { status: "disabled" });
    await expect(built.service.verifyAccess(scope, session.accessToken)).rejects.toBeInstanceOf(ProjectAuthError);
  });

  it("lists active sessions without token material and revokes one family or all of one user (2.34)", async () => {
    const built = fixture();
    const first = await verifiedAccount(built, "sessions@example.test");
    const second = await built.service.passwordSignIn(scope, {
      email: "sessions@example.test", password: "a sufficiently long password", rateLimitKey: "sessions-second",
    });
    if ("mfaRequired" in second) throw new Error("unexpected MFA");
    const other = await verifiedAccount(built, "bystander@example.test");
    const firstPrincipal = await built.service.verifyAccess(scope, first.accessToken);
    const secondPrincipal = await built.service.verifyAccess(scope, second.accessToken);
    const otherPrincipal = await built.service.verifyAccess(scope, other.accessToken);
    const userId = firstPrincipal.user.id;
    // Eine Rotation ersetzt die erste Sitzung; nur die neue gilt als aktiv.
    const rotated = await built.service.refresh(scope, first.refreshToken);

    const listed = await built.service.listSessions(scope, userId);
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.map((entry) => entry.familyId).sort())
      .toEqual([firstPrincipal.session.familyId, secondPrincipal.session.familyId].sort());
    expect(JSON.stringify(listed)).not.toMatch(/refreshTokenHash|qk_refresh_|organizationId/);

    // Fremde Sitzung unter diesem Nutzer: 404, und sie bleibt bestehen.
    await expect(built.service.revokeSession(scope, userId, otherPrincipal.session.id))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(built.service.listSessions({ ...scope, projectId: "project-2" }, userId))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(built.service.revokeSession({ ...scope, environment: "staging" }, userId, secondPrincipal.session.id))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const rotatedId = (await built.service.verifyAccess(scope, rotated.accessToken)).session.id;
    expect(await built.service.revokeSession(scope, userId, rotatedId)).toEqual({ revoked: 1 });
    await expect(built.service.refresh(scope, rotated.refreshToken)).rejects.toBeInstanceOf(ProjectAuthError);
    await expect(built.service.verifyAccess(scope, rotated.accessToken)).rejects.toBeInstanceOf(ProjectAuthError);
    await expect(built.service.verifyAccess(scope, second.accessToken)).resolves.toBeTruthy();
    expect((await built.service.listSessions(scope, userId)).sessions.map((entry) => entry.id))
      .toEqual([secondPrincipal.session.id]);
    await expect(built.service.revokeSession(scope, userId, rotatedId))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    expect(await built.service.revokeAllSessions(scope, userId)).toEqual({ revoked: 1 });
    expect((await built.service.listSessions(scope, userId)).sessions).toEqual([]);
    await expect(built.service.verifyAccess(scope, second.accessToken)).rejects.toBeInstanceOf(ProjectAuthError);
    expect((await built.service.verifyAccess(scope, other.accessToken)).user.id).toBe(otherPrincipal.user.id);
    expect((await built.service.listSessions(scope, otherPrincipal.user.id)).sessions).toHaveLength(1);
    await expect(built.service.revokeAllSessions(scope, "00000000-0000-4000-8000-999999999999"))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

/**
 * Audit-Ereignisse (2.35). Der Speicher-Sink bereinigt wie der
 * PostgreSQL-Sink; geprueft wird, was der Dienst hineingibt und dass keine
 * E-Mail und kein Token durchkommt.
 */
describe("Project Auth audit events", () => {
  const password = "a sufficiently long password";

  it("records a successful password login with the method and without the email", async () => {
    const audit = new MemoryProjectAuthAuditSink();
    const built = fixture(audit);
    const initial = await verifiedAccount(built, "audit-user@example.test");
    const login = await built.service.passwordSignIn(scope, {
      email: "audit-user@example.test", password, rateLimitKey: "audit-login",
    });
    if ("mfaRequired" in login) throw new Error("unexpected MFA");
    const userId = (await built.service.verifyAccess(scope, login.accessToken)).user.id;

    const page = await built.service.listAuditEvents(scope, 50);
    expect(page.events.map((event) => event.action)).toEqual([
      "project_auth.login.succeeded", "project_auth.login.succeeded", "project_auth.signup.succeeded",
    ]);
    const [latest] = page.events;
    expect(latest).toMatchObject({
      actorType: "app_user", actorRef: `project_auth_user:${userId}`, resourceRef: `project_auth_user:${userId}`,
      status: "succeeded", metadata: { method: "password", assurance: "aal1" },
    });
    expect(page.events[1].metadata).toMatchObject({ method: "email_verification" });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("audit-user@example.test");
    expect(serialized).not.toContain(initial.refreshToken);
    expect(serialized).not.toMatch(/qk_(refresh|verify|magic|reset|challenge)_/);
  });

  it("records a failed login with an unknown email as anonymous and with a reason", async () => {
    const audit = new MemoryProjectAuthAuditSink();
    const built = fixture(audit);
    await verifiedAccount(built, "known@example.test");
    await expect(built.service.passwordSignIn(scope, {
      email: "nobody@example.test", password, rateLimitKey: "audit-unknown",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(built.service.passwordSignIn(scope, {
      email: "known@example.test", password: "a wrong but long password", rateLimitKey: "audit-wrong",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const [wrong, unknown] = (await built.service.listAuditEvents(scope, 2)).events;
    expect(unknown).toMatchObject({
      action: "project_auth.login.failed", actorType: "app_user", actorRef: "anonymous",
      status: "failed", metadata: { method: "password", reason: "invalid_credentials" },
    });
    expect(wrong).toMatchObject({
      action: "project_auth.login.failed", status: "failed",
      metadata: { method: "password", reason: "invalid_credentials" },
    });
    expect(wrong.actorRef).toMatch(/^project_auth_user:/);
    expect(JSON.stringify([wrong, unknown])).not.toMatch(/@example\.test|wrong but long/);
  });

  it("records admin session revocations with the console actor and pages newest first", async () => {
    const audit = new MemoryProjectAuthAuditSink();
    const built = fixture(audit);
    const first = await verifiedAccount(built, "revoked@example.test");
    const principal = await built.service.verifyAccess(scope, first.accessToken);
    const admin = { id: "11111111-1111-4111-8111-111111111111" };

    await built.service.revokeSession(scope, principal.user.id, principal.session.id, admin);
    await built.service.revokeAllSessions(scope, principal.user.id, admin);
    await built.service.updateUser(scope, principal.user.id, { status: "disabled", appMetadata: { role: "x" } }, admin);

    const firstPage = await built.service.listAuditEvents(scope, 2);
    expect(firstPage.events.map((event) => event.action))
      .toEqual(["project_auth.user.updated", "project_auth.sessions.revoked_all"]);
    expect(firstPage.nextCursor).toBe(firstPage.events[1].id);
    expect(firstPage.events[0]).toMatchObject({
      actorType: "admin", actorRef: admin.id, metadata: { status: "disabled", appMetadataChanged: true },
    });
    expect(firstPage.events[0].metadata).not.toHaveProperty("role");
    const secondPage = await built.service.listAuditEvents(scope, 2, firstPage.nextCursor!);
    expect(secondPage.events[0]).toMatchObject({
      action: "project_auth.session.revoked", actorType: "admin", actorRef: admin.id,
      resourceRef: `project_auth_user:${principal.user.id}`,
      metadata: { family: principal.session.familyId, revokedCount: 1 },
    });
    // Ein anderes Projekt sieht nichts davon.
    expect((await built.service.listAuditEvents({ ...scope, projectId: "project-2" })).events).toEqual([]);
    await expect(built.service.listAuditEvents(scope, 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(built.service.listAuditEvents(scope, 50, "not-a-cursor")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("keeps login working when the sink fails and logs only the action", async () => {
    const recorded: ProjectAuthAuditEvent[] = [];
    const failing: ProjectAuthAuditSink = {
      async record(event) { recorded.push(event); throw new Error("audit database is down"); },
      async list() { return { events: [], nextCursor: null }; },
    };
    const built = fixture(failing);
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      await verifiedAccount(built, "resilient@example.test");
      const login = await built.service.passwordSignIn(scope, {
        email: "resilient@example.test", password, rateLimitKey: "audit-resilient",
      });
      expect(login).toMatchObject({ tokenType: "Bearer" });
    } finally {
      console.error = original;
    }
    expect(recorded.map((event) => event.action)).toContain("project_auth.login.succeeded");
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).not.toMatch(/resilient@example\.test|qk_/);
    expect(errors[0][1]).toEqual({ action: "project_auth.signup.succeeded", error: "Error" });
  });

  it("drops metadata values that look like emails or tokens and rejects unsafe references", async () => {
    const audit = new MemoryProjectAuthAuditSink();
    await audit.record({
      scope, action: "project_auth.login.failed", actorType: "app_user", actorRef: "anonymous",
      resourceRef: "project_auth_user:unknown", status: "failed",
      metadata: { method: "password", email: "leak@example.test", token: `qk_refresh_${"a".repeat(43)}` },
    });
    expect((await audit.list(scope, { limit: 1 })).events[0].metadata).toEqual({ method: "password" });
    await expect(audit.record({
      scope, action: "project_auth.login.failed", actorType: "app_user", actorRef: "leak@example.test",
      resourceRef: "project_auth_user:unknown", status: "failed",
    })).rejects.toThrow();
  });
});

function totp(secret: string, now: Date): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const decoded: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { decoded.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(decoded)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
