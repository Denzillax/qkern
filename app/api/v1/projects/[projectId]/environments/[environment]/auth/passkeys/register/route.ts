import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError } from "@/lib/server/project-auth/service";

/**
 * Einen Passkey registrieren (2.79): `POST` holt die Herausforderung, `PUT`
 * bringt die Antwort des Browsers.
 *
 * Beide Wege brauchen ein Access Token einer brauchbaren Sitzung. Es gibt hier
 * absichtlich **keinen** zweiten Weg herein, wie ihn `auth/mfa/enroll` fuer den
 * Einrichtungsschein hat: Ein Passkey legt kein Konto an, er kommt zu einem
 * bestehenden dazu. Wer noch keine Sitzung bekommen kann, hat hier nichts zu
 * registrieren.
 *
 * Die Grenzen im Schema sind die Grenzen der Spezifikation, in base64url
 * gerechnet: 1023 Byte Kennung sind 1364 Zeichen, und ein Attestation-Objekt
 * jenseits von 16 KiB ist keines mehr.
 */
const body = z.object({
  challengeToken: z.string().max(128),
  attestationObject: z.string().min(16).max(16_384),
  clientDataJSON: z.string().min(16).max(8_192),
  label: z.string().min(1).max(64),
}).strict();

async function principal(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  const scope = await publicProjectAuthScope(request, routeContext);
  const token = presentedProjectAccessToken(request);
  if (!token) throw new ProjectAuthError("INVALID_TOKEN");
  return getProjectAuthService().verifyAccess(scope, token);
}

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const data = await getProjectAuthService().beginPasskeyRegistration(
      await principal(request, routeContext),
    );
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 201));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export async function PUT(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const parsed = body.safeParse(await safeJson(request));
    if (!parsed.success) {
      return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    }
    const data = await getProjectAuthService().completePasskeyRegistration(
      await principal(request, routeContext), parsed.data,
    );
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 201));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, PUT, OPTIONS");
