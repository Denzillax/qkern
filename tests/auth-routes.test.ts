import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { handleLogin } from "@/app/api/v1/auth/login/route";
import { handleLogout } from "@/app/api/v1/auth/logout/route";
import { handleRegister } from "@/app/api/v1/auth/register/route";
import { handleSession } from "@/app/api/v1/auth/session/route";
import { SESSION_COOKIE_NAME, trustedClientAddress } from "@/lib/server/auth/http";
import { InMemorySessionRepository, InMemoryUserRepository } from "@/lib/server/auth/memory-repositories";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { AuthService } from "@/lib/server/auth/service";

class FastHasher implements PasswordHasher {
  readonly dummyHash = "test-hash:dummy";
  async hash(password: string) { return `test-hash:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

function authService() {
  return new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(),
    token: () => "route-test-token",
    id: (() => { let id = 0; return () => String(++id); })(),
  });
}

function post(path: string, body: unknown, origin = "https://qkern.test") {
  return new NextRequest(`https://qkern.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": "192.0.2.10",
    },
    body: JSON.stringify(body),
  });
}

function tokenFromSetCookie(header: string): string {
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(header);
  if (!match) throw new Error("Session cookie missing");
  return match[1];
}

describe("auth API routes", () => {
  it("ignores spoofable forwarding headers until a trusted proxy boundary is configured", () => {
    const request = post("/api/v1/auth/login", { email: "owner@qkern.ch", password: "x" });
    expect(trustedClientAddress(request, {})).toBe("untrusted-proxy");
    expect(trustedClientAddress(request, { QKERN_TRUST_PROXY_HOPS: "1" })).toBe("192.0.2.10");
    expect(trustedClientAddress(request, { QKERN_TRUST_PROXY_HOPS: "0" })).toBe("untrusted-proxy");
  });

  it("rejects a missing or cross-site Origin before processing a mutation", async () => {
    const auth = authService();
    const crossSite = await handleRegister(post("/api/v1/auth/register", {
      email: "owner@qkern.ch",
      password: "long-secret-password",
    }, "https://attacker.test"), auth);
    expect(crossSite.status).toBe(403);

    const missingOrigin = new NextRequest("https://qkern.test/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@qkern.ch", password: "long-secret-password" }),
    });
    expect((await handleLogin(missingOrigin, auth)).status).toBe(403);
  });

  it("sets a hardened host-only cookie and returns the authenticated session", async () => {
    const auth = authService();
    const registration = await handleRegister(post("/api/v1/auth/register", {
      email: "owner@qkern.ch",
      password: "long-secret-password",
    }), auth);
    expect(registration.status).toBe(201);
    const setCookie = registration.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/");

    const token = tokenFromSetCookie(setCookie);
    const request = new NextRequest("https://qkern.test/api/v1/auth/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const session = await handleSession(request, auth);
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ data: { user: { email: "owner@qkern.ch" } } });
  });

  it("does not distinguish unknown email from incorrect password", async () => {
    const auth = authService();
    await handleRegister(post("/api/v1/auth/register", {
      email: "owner@qkern.ch",
      password: "long-secret-password",
    }), auth);
    const wrongPassword = await handleLogin(post("/api/v1/auth/login", {
      email: "owner@qkern.ch",
      password: "wrong",
    }), auth);
    const unknownUser = await handleLogin(post("/api/v1/auth/login", {
      email: "unknown@qkern.ch",
      password: "wrong",
    }), auth);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
  });

  it("revokes logout server-side and expires the browser cookie", async () => {
    const auth = authService();
    const registration = await handleRegister(post("/api/v1/auth/register", {
      email: "owner@qkern.ch",
      password: "long-secret-password",
    }), auth);
    const token = tokenFromSetCookie(registration.headers.get("set-cookie") ?? "");
    const logoutRequest = new NextRequest("https://qkern.test/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://qkern.test",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: "{}",
    });
    const logout = await handleLogout(logoutRequest, auth);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const sessionRequest = new NextRequest("https://qkern.test/api/v1/auth/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect((await handleSession(sessionRequest, auth)).status).toBe(401);
  });
});
