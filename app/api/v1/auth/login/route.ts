import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, rateLimitKey, safeJson, setSessionCookie } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { AuthError, type AuthService } from "@/lib/server/auth/service";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export async function handleLogin(request: NextRequest, auth: AuthService): Promise<NextResponse> {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const parsed = loginSchema.safeParse(await safeJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Authentication failed" }, { status: 401 });

  try {
    const result = await auth.login({ ...parsed.data, rateLimitKey: rateLimitKey(request) });
    const response = NextResponse.json({ data: { user: result.user, session: result.session } }, {
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(response, result.token, result.session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AuthError && error.code === "RATE_LIMITED") {
      return NextResponse.json({ error: "Too many attempts" }, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds ?? 60) },
      });
    }
    if (error instanceof AuthError && error.code === "INVALID_CREDENTIALS") {
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }
    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  }
}

export function POST(request: NextRequest) {
  return handleLogin(request, authRuntime.service);
}
