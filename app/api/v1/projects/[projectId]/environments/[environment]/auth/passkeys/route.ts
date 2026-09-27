import { NextRequest } from "next/server";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError } from "@/lib/server/project-auth/service";

/**
 * Die Passkeys des angemeldeten Nutzers: auflisten und einen entfernen (2.79).
 *
 * Nur mit Access Token, und der Nutzer daraus ist der Nutzer der Liste. Es gibt
 * hier keinen Weg, die Passkeys eines anderen zu sehen oder zu nehmen: Der
 * Nutzer kommt aus dem geprueften Token und nicht aus dem Pfad.
 *
 * `DELETE` nimmt die ID des Passkeys als Suchparameter und nicht im Koerper.
 * Ein `DELETE` mit Koerper ist erlaubt, aber nicht ueberall gleich behandelt;
 * eine ID im Suchparameter ist keine persoenliche Angabe und steht damit an
 * einer Stelle, an der sie stehen darf.
 */
const PASSKEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function principal(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  const scope = await publicProjectAuthScope(request, routeContext);
  const token = presentedProjectAccessToken(request);
  if (!token) throw new ProjectAuthError("INVALID_TOKEN");
  return getProjectAuthService().verifyAccess(scope, token);
}

export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const data = await getProjectAuthService().listPasskeys(await principal(request, routeContext));
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export async function DELETE(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const passkeyId = new URL(request.url).searchParams.get("passkeyId") ?? "";
    if (!PASSKEY_ID.test(passkeyId)) {
      return withProjectAuthCors(request, projectAuthNoStore({ error: "Resource not found" }, 404));
    }
    const data = await getProjectAuthService().removePasskey(
      await principal(request, routeContext), passkeyId,
    );
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, DELETE, OPTIONS");
