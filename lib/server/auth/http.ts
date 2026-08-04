import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "__Host-qkern_session";

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const configured = [process.env.QKERN_APP_ORIGINS, process.env.NEXT_PUBLIC_APP_URL]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizedOrigin)
    .filter((entry): entry is string => Boolean(entry));
  return new Set(configured);
}

/** Mutating cookie-capable routes fail closed on missing or untrusted Origin. */
export function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const normalized = normalizedOrigin(origin);
  if (!normalized) return false;

  const allowed = configuredOrigins();
  if (allowed.size > 0) return allowed.has(normalized);
  if (process.env.NODE_ENV === "production") return false;
  return normalized === request.nextUrl.origin;
}

export function csrfRejected(): NextResponse {
  return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
}

/** Hash the network identifier so it never becomes application data or a loggable key. */
export function rateLimitKey(request: NextRequest): string {
  const address = trustedClientAddress(request);
  return createHash("sha256").update(address).digest("base64url");
}

/**
 * Forwarding headers are attacker-controlled unless the deployment explicitly
 * declares how many proxy hops it owns. Fail closed to one shared anonymous
 * bucket when the boundary is not configured.
 */
export function trustedClientAddress(request: NextRequest, environment: Record<string, string | undefined> = process.env): string {
  const rawHops = environment.QKERN_TRUST_PROXY_HOPS;
  if (!rawHops) return "untrusted-proxy";
  const trustedHops = Number(rawHops);
  if (!Number.isInteger(trustedHops) || trustedHops < 1 || trustedHops > 5) return "untrusted-proxy";

  const chain = request.headers.get("x-forwarded-for")?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const candidate = chain.length >= trustedHops ? chain[chain.length - trustedHops] : request.headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? candidate : "untrusted-proxy";
}

export function sessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function safeJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
