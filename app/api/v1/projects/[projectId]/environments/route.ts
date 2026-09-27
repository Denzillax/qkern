import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * `GET /v1/projects/{projectId}/environments` — welche Umgebungen dieses
 * Projekt hat und auf welche Datenbankreferenz jede zeigt (2.67).
 *
 * Die Referenz ist die undurchsichtige Kennung aus `project_environments`,
 * nicht die Adresse der Datenbank. Der Katalog der Verbindungen bleibt
 * serverseitig; hier steht nur der Name, unter dem eine Umgebung dort
 * nachschlaegt, und ob dieser Name schon die Form einer Bindung hat.
 *
 * Nur lesend, `private, no-store`, kein Query-Parameter.
 */
const projectIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    const params = await input.params;
    const projectId = projectIdSchema.safeParse(params.projectId);
    if (!projectId.success || [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    const environments = await controlPlaneService.listProjectEnvironments(
      asControlPlaneContext(context),
      projectId.data,
    );
    return NextResponse.json({ data: { environments } }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    if (domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Project environments unavailable" }, { status: 500 });
  }
}
