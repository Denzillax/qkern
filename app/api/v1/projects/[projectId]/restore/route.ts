import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
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
 * `POST /v1/projects/{projectId}/restore` — ein geloeschtes Projekt vor Ablauf
 * seiner Frist zurueckholen (2.173). Dasselbe Recht wie das Loeschen: Wer
 * zurueckholt, entscheidet ueber dasselbe Projekt. Nach der Frist gibt es
 * nichts mehr zurueckzuholen, und die Antwort ist 404.
 */
const projectIdSchema = z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/);

export async function POST(
  request: NextRequest,
  input: { params: Promise<{ projectId: string }> },
) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const projectId = projectIdSchema.safeParse((await input.params).projectId);
  if (!projectId.success) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "project_delete");
    const project = await controlPlaneService.restoreProject(asControlPlaneContext(context), projectId.data);
    return NextResponse.json({ data: project }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) {
      return NextResponse.json({ error: "This role may not delete projects." }, { status: 403 });
    }
    if (domainErrorCode(error) === "RESOURCE_NOT_FOUND") return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not restore project" }, { status: 500 });
  }
}
