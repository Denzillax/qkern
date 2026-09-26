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
 * Der Login-Chooser: die konfigurierten OIDC-Provider **vor** der Anmeldung.
 *
 * Dieselbe oeffentliche Grenze wie `authorize` daneben — Projekt-Key,
 * Origin-Gate, CORS, no-store. Was zurueckkommt, ist die
 * Zwei-Felder-Projektion aus 1.83: Slug und Issuer, nie Client-ID oder der
 * Name der Secret-Umgebungsvariablen. Eine App kann damit ihre
 * Login-Buttons aufzaehlen, statt Slugs zu raten.
 *
 * Seit 2.57 nennt `listOidcProviders` zusaetzlich `requiresVerifiedEmail`,
 * damit der Sicherheitsberater seine achte Regel rechnen kann. Diese Tuer
 * hier verengt wieder auf die zwei Felder: Ob ein Anbieter ohne
 * `email_verified` zugelassen ist, ist eine Betriebsangabe fuer die Console
 * und nichts, was ein noch nicht angemeldeter Aufrufer erfahren muss.
 */
export function createProjectAuthPublicProvidersHandler(
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
      const providers = getService().listOidcProviders()
        .map((provider) => ({ id: provider.id, issuer: provider.issuer }));
      return withProjectAuthCors(request, projectAuthNoStore({ data: providers }));
    } catch (error) { return projectAuthRouteError(error, request); }
  };
}

export const GET = createProjectAuthPublicProvidersHandler();
export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
