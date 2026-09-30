import { NextRequest } from "next/server";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";

/**
 * Die hinterlegten SAML-Anbieter **vor** der Anmeldung (2.99).
 *
 * Dieselbe Grenze und dieselbe Verengung wie bei `oidc/providers`: Zwei
 * Felder, Slug und `entityID` des Anbieters. Ob QKERN fuer diesen Anbieter ein
 * bestaetigtes `email_verified` verlangt, ist eine Betriebsangabe fuer die
 * Console und nichts, was ein noch nicht angemeldeter Aufrufer erfahren muss.
 */
export function createProjectAuthPublicSamlProvidersHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
  keys: ProjectApiKeyService = projectApiKeyService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
    try {
      await publicProjectAuthScope(request, routeContext, keys);
      if ([...request.nextUrl.searchParams.keys()].length > 0) {
        return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
      }
      const providers = getService().listSamlProviders()
        .map((provider) => ({ id: provider.id, entityId: provider.entityId }));
      return withProjectAuthCors(request, projectAuthNoStore({ data: providers }));
    } catch (error) { return projectAuthRouteError(error, request); }
  };
}

export const GET = createProjectAuthPublicSamlProvidersHandler();
export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
