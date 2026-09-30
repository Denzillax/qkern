import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitKey, safeJson } from "@/lib/server/auth/http";
import {
  parsedProjectAuthParams, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

/**
 * Der Anfang einer SP-initiierten SAML-Anmeldung (2.99).
 *
 * Dieselbe oeffentliche Grenze wie `oidc/{provider}/authorize` daneben:
 * Projekt-Key, Origin-Gate, CORS, no-store. Was zurueckkommt, ist die Adresse
 * beim Anbieter und die Kennung der Anfrage. Die App schickt den Browser
 * dorthin; QKERN leitet nicht selbst weiter, weil eine Antwort mit `302` der
 * App die Entscheidung abnaehme, ob sie ueberhaupt umleiten will.
 */
const schema = z.object({ redirectTo: z.url().max(2048) }).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const parsed = await parsedProjectAuthParams(routeContext);
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = schema.safeParse(await safeJson(request));
    const provider = parsed?.raw.provider;
    if (!body.success || !provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider)) {
      return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    }
    const data = await getProjectAuthService().startSaml(scope, {
      provider, redirectTo: body.data.redirectTo, rateLimitKey: rateLimitKey(request),
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
