import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError } from "@/lib/server/project-auth/service";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/**
 * Zwei Wege herein, und nur hier gibt es den zweiten (2.52).
 *
 * Der gewohnte Weg ist ein Access Token einer brauchbaren Sitzung. Verlangt
 * die Umgebung den zweiten Faktor, gibt es fuer einen Nutzer ohne Faktor
 * aber gar keine Sitzung — dann kommt er mit dem Einrichtungsschein
 * `qk_enroll_...`, den ihm die Anmeldung zurueckgegeben hat. Der Schein
 * oeffnet nur diese Route; jede andere Grenze prueft ein Access Token, und
 * `presentedProjectAccessToken` weist jedes `qk_`-Token als Bearer ab.
 */
async function principal(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  const scope = await publicProjectAuthScope(request, routeContext);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  if (bearer?.startsWith("qk_enroll_")) {
    return getProjectAuthService().resolveMfaEnrollment(scope, bearer);
  }
  const token = presentedProjectAccessToken(request);
  if (!token) throw new ProjectAuthError("INVALID_TOKEN");
  return getProjectAuthService().verifyAccess(scope, token);
}

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const data = await getProjectAuthService().enrollMfa(await principal(request, routeContext));
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 201));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export async function PUT(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const body = schema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    const data = await getProjectAuthService().confirmMfa(await principal(request, routeContext), body.data.code);
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, PUT, OPTIONS");
