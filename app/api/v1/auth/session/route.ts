import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, sessionToken } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { isAuthError, type AuthService } from "@/lib/server/auth/service";
import { tenancyService } from "@/lib/server/tenancy-service";

export const dynamic = "force-dynamic";

export async function handleSession(request: NextRequest, auth: AuthService): Promise<NextResponse> {
  const token = sessionToken(request);
  if (!token) return NextResponse.json({ error: "Authentication required" }, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });

  try {
    const result = await auth.getSession(token);
    return NextResponse.json({ data: { ...result, memberships: await tenancyService.list(result.user) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isAuthError(error, "INVALID_SESSION")) throw error;
    const response = NextResponse.json({ error: "Authentication required" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
    clearSessionCookie(response);
    return response;
  }
}

export function GET(request: NextRequest) {
  return handleSession(request, authRuntime.service);
}
