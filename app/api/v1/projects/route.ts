import { NextRequest, NextResponse } from "next/server";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { asControlPlaneContext, authenticatedContext, RequestAuthenticationError, RequestAuthorizationError, requireCapability } from "@/lib/server/request-context";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    return NextResponse.json({ data: await controlPlaneService.listProjects(asControlPlaneContext(context)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Projects unavailable" }, { status: 500 });
  }
}
