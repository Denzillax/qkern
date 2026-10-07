import { NextRequest, NextResponse } from "next/server";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * `GET /v1/projects/deleted` — die geloeschten Projekte der Organisation,
 * deren Frist noch laeuft (2.173). Lesen genuegt, wie bei der Liste der
 * Projekte; zurueckholen braucht `project_delete`.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    const projects = await controlPlaneService.listDeletedProjects(asControlPlaneContext(context));
    return NextResponse.json({ data: { projects } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Deleted projects unavailable" }, { status: 500 });
  }
}
