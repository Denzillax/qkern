import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitKey, safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

/**
 * Anmelden mit einem Passkey (2.79): `POST` holt die Herausforderung, `PUT`
 * bringt die Unterschrift und ergibt die Sitzung.
 *
 * Kein Access Token, nur der Projektschluessel: Das ist eine Anmeldung. `POST`
 * nennt keine Adresse und bekommt darum auch keine Auskunft darueber, wen es
 * gibt; welcher Nutzer kommt, sagt erst die Kennung in `PUT`.
 *
 * Die Antwort von `PUT` kann eine Sitzung sein oder eine Challenge fuer den
 * zweiten Faktor. Das ist dieselbe Form, die die Anmeldung mit Passwort
 * zurueckgibt, denn es ist derselbe Weg.
 */
const body = z.object({
  challengeToken: z.string().max(128),
  credentialId: z.string().min(16).max(1_364),
  authenticatorData: z.string().min(48).max(8_192),
  clientDataJSON: z.string().min(16).max(8_192),
  signature: z.string().min(16).max(1_024),
}).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const data = await getProjectAuthService().beginPasskeySignIn(scope, {
      rateLimitKey: rateLimitKey(request),
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 201));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export async function PUT(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const parsed = body.safeParse(await safeJson(request));
    if (!parsed.success) {
      return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    }
    const data = await getProjectAuthService().completePasskeySignIn(scope, {
      ...parsed.data, rateLimitKey: rateLimitKey(request),
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, PUT, OPTIONS");
