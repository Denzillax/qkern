import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
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
 * `DELETE /v1/projects/{projectId}` — ein Projekt loeschen, mit Frist (2.173).
 *
 * Entschieden am 7. Oktober 2026: Das Projekt ist sofort gesperrt und
 * ausgeblendet, laesst sich sieben Tage lang zurueckholen und wird danach mit
 * Datenbank, Backups und Buckets abgeraeumt. Nur die Owner-Rolle
 * (`project_delete`), und der Koerper muss den Namen des Projekts tragen,
 * genau wie die Console ihn abtippen laesst: `{ "confirmName": "..." }`.
 *
 * Antworten: 200 mit Frist; 400, wenn der Name nicht passt; 403 ohne Recht
 * (wie beim Anlegen, nicht 404: wer das Projekt sieht, weiss, dass es da ist);
 * 404, wenn es das Projekt nicht gibt oder es schon geloescht ist.
 */
const projectIdSchema = z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/);
const bodySchema = z.object({ confirmName: z.string().min(1).max(200) }).strict();

export async function DELETE(
  request: NextRequest,
  input: { params: Promise<{ projectId: string }> },
) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const projectId = projectIdSchema.safeParse((await input.params).projectId);
  if (!projectId.success) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  const body = bodySchema.safeParse(await safeJson(request).catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid project deletion request" }, { status: 400 });
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "project_delete");
    const deleted = await controlPlaneService.deleteProject(asControlPlaneContext(context), projectId.data, body.data.confirmName);
    return NextResponse.json({ data: deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) {
      return NextResponse.json({ error: "This role may not delete projects." }, { status: 403 });
    }
    const code = domainErrorCode(error);
    if (code === "PROJECT_DELETE_CONFIRMATION") {
      return NextResponse.json({ error: "The confirmation does not match the project name." }, { status: 400 });
    }
    if (code === "RESOURCE_NOT_FOUND") return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not delete project" }, { status: 500 });
  }
}
