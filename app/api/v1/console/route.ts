import { NextRequest, NextResponse } from "next/server";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { asControlPlaneContext, authenticatedContext, RequestAuthenticationError, RequestAuthorizationError, requireCapability } from "@/lib/server/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    const snapshot = await controlPlaneService.getConsoleSnapshot(asControlPlaneContext(context));
    return NextResponse.json({ user: context.user, organization: context.membership.organization, ...snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Console data unavailable" }, { status: 500 });
  }
}
