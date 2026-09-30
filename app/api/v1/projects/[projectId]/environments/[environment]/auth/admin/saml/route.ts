import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die hinterlegten SAML-Anbieter fuer die Console (2.99).
 *
 * Eine eigene Tuer und nicht ein zweites Feld in `admin/providers`: Die dortige
 * Antwort ist eine Liste von OIDC-Anbietern, und wer eine Liste zu einem Objekt
 * mit zwei Listen umbaut, aendert die Form einer Antwort, die es schon gibt.
 * Eine neue Faehigkeit bekommt eine neue Tuer.
 *
 * Admin-Grenze wie die Nutzerliste: Console-Session, kein Projekt-Key. Was
 * zurueckkommt, ist Slug, `entityID` und `requiresVerifiedEmail` — nie das
 * hinterlegte Zertifikat und nie der SSO-Endpunkt.
 */
export function createProjectAuthSamlProvidersHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    try {
      await adminProjectAuthScope(request, routeContext);
      if ([...request.nextUrl.searchParams.keys()].length > 0) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      return projectAuthNoStore({ data: getService().listSamlProviders() });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSamlProvidersHandler()(request, routeContext);
