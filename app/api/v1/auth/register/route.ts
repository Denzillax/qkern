import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, rateLimitKey, safeJson, setSessionCookie } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { AuthError, type AuthService } from "@/lib/server/auth/service";
import { tenancyService } from "@/lib/server/tenancy-service";

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
}).strict();

export async function handleRegister(request: NextRequest, auth: AuthService): Promise<NextResponse> {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const parsed = registerSchema.safeParse(await safeJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid registration data" }, { status: 400 });

  try {
    const result = await auth.register({ ...parsed.data, rateLimitKey: rateLimitKey(request) });
    const membership = await tenancyService.ensureWorkspace(result.user);
    const response = NextResponse.json({ data: { user: result.user, session: result.session, membership } }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(response, result.token, result.session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AuthError && error.code === "ACCOUNT_EXISTS") {
      return NextResponse.json({ error: "Account could not be created" }, { status: 409 });
    }
    if (error instanceof AuthError && error.code === "RATE_LIMITED") {
      return NextResponse.json({ error: "Too many attempts" }, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds ?? 60) },
      });
    }
    return NextResponse.json({ error: "Account could not be created" }, { status: 500 });
  }
}

export function POST(request: NextRequest) {
  return handleRegister(request, authRuntime.service);
}
