import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemorySessionRepository, InMemoryUserRepository } from "@/lib/server/auth/memory-repositories";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { AuthService, hashSessionToken } from "@/lib/server/auth/service";

class TestPasswordHasher implements PasswordHasher {
  readonly dummyHash = "hash:dummy";
  readonly verifiedHashes: string[] = [];

  async hash(password: string): Promise<string> {
    return `hash:${createHash("sha256").update(password).digest("hex")}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    this.verifiedHashes.push(encodedHash);
    return encodedHash === await this.hash(password);
  }
}

function fixture(options: { sessionTtlMs?: number } = {}) {
  let time = new Date("2026-07-17T12:00:00.000Z");
  let id = 0;
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const passwords = new TestPasswordHasher();
  const auth = new AuthService({
    users,
    sessions,
    passwords,
    rateLimiter: new InMemoryRateLimiter(),
    now: () => new Date(time),
    token: () => "raw-session-token-that-is-never-stored",
    id: () => String(++id),
    sessionTtlMs: options.sessionTtlMs,
  });
  return {
    auth, users, sessions, passwords,
    // Dieselbe Uhr wie der Dienst — der Test darf nie die echte Uhr fragen:
    // Bis 1.85 tat er es an einer Stelle, bestand im August nur zufaellig
    // und fiel im September, als die fixierte Session abgelaufen war.
    now: () => new Date(time),
    setTime: (value: string) => { time = new Date(value); },
  };
}

describe("AuthService", () => {
  it("canonicalizes email, hashes the password, and stores only a session-token hash", async () => {
    const { auth, users, sessions, now } = fixture();
    const result = await auth.register({
      email: "  Owner@QKERN.CH ",
      password: "long-secret-password",
      rateLimitKey: "ip-a",
    });

    expect(result.user.email).toBe("owner@qkern.ch");
    expect(result.token).toBe("raw-session-token-that-is-never-stored");
    const storedUser = await users.findByEmail("owner@qkern.ch");
    expect(storedUser?.passwordHash).not.toContain("long-secret-password");
    const storedSession = await sessions.findActiveByTokenHash(hashSessionToken(result.token), now());
    expect(storedSession?.tokenHash).toBe(hashSessionToken(result.token));
    expect(storedSession?.tokenHash).not.toBe(result.token);
  });

  it("uses the same generic credential error and performs dummy verification for unknown users", async () => {
    const { auth, passwords } = fixture();
    await auth.register({ email: "owner@qkern.ch", password: "long-secret-password", rateLimitKey: "register" });

    await expect(auth.login({ email: "owner@qkern.ch", password: "wrong", rateLimitKey: "login-1" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: "unknown@qkern.ch", password: "wrong", rateLimitKey: "login-2" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(passwords.verifiedHashes.at(-1)).toBe(passwords.dummyHash);
  });

  it("revokes a session on logout and supports revoking every user session", async () => {
    const { auth } = fixture();
    const registration = await auth.register({ email: "owner@qkern.ch", password: "long-secret-password", rateLimitKey: "register" });
    await expect(auth.getSession(registration.token)).resolves.toMatchObject({ user: { email: "owner@qkern.ch" } });

    await auth.logout(registration.token);
    await expect(auth.getSession(registration.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });

    const login = await auth.login({ email: "owner@qkern.ch", password: "long-secret-password", rateLimitKey: "login" });
    await expect(auth.revokeAllSessions(login.user.id)).resolves.toBe(1);
    await expect(auth.getSession(login.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("invalidates expired sessions", async () => {
    const { auth, setTime } = fixture({ sessionTtlMs: 1_000 });
    const registration = await auth.register({ email: "owner@qkern.ch", password: "long-secret-password", rateLimitKey: "register" });
    setTime("2026-07-17T12:00:02.000Z");
    await expect(auth.getSession(registration.token)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("rate limits repeated login attempts using an abstract limiter", async () => {
    const { auth } = fixture();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(auth.login({ email: "unknown@qkern.ch", password: "wrong", rateLimitKey: "one-ip" }))
        .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(auth.login({ email: "unknown@qkern.ch", password: "wrong", rateLimitKey: "one-ip" }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 900 });
  });
});
