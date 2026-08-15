import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die konfigurierten OIDC-Provider fuer die Console — der offene Punkt aus
 * 1.76 ("Kein Console-Fluss fuer die Provider-Auswahl").
 *
 * Admin-Grenze wie die Nutzerliste daneben: Console-Session, kein Projekt-Key.
 * Was zurueckkommt, ist die Projektion aus `listOidcProviders` — Slug und
 * Issuer, nie Client-ID oder der Name der Secret-Umgebungsvariablen.
 */
export function createProjectAuthProvidersHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    try {
      await adminProjectAuthScope(request, routeContext);
      if ([...request.nextUrl.searchParams.keys()].length > 0) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      return projectAuthNoStore({ data: getService().listOidcProviders() });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthProvidersHandler()(request, routeContext);
