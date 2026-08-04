import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, csrfRejected, hasTrustedOrigin, sessionToken } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { AuthService } from "@/lib/server/auth/service";

export async function handleLogout(request: NextRequest, auth: AuthService): Promise<NextResponse> {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const token = sessionToken(request);
  if (token) await auth.logout(token);
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(response);
  return response;
}

export function POST(request: NextRequest) {
  return handleLogout(request, authRuntime.service);
}
