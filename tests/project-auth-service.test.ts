import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
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

function fixture() {
  const repository = new MemoryProjectAuthRepository();
  const delivery = new DeliveryRecorder();
  const { privateKey } = generateKeyPairSync("ed25519");
  let now = new Date("2026-08-03T12:00:00.000Z");
  let id = 0;
  let token = 0;
  const service = new ProjectAuthService({
    repository, delivery, passwords: new FastHasher(), rateLimiter: new InMemoryRateLimiter(),
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
