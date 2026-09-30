import { NextRequest, NextResponse } from "next/server";
import {
  parsedProjectAuthParams, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";

/**
 * Die SAML-Metadaten dieser Projektumgebung fuer einen hinterlegten Anbieter.
 *
 * Wer QKERN beim Anbieter eintraegt, hat bisher `entityID` und Consumer-Adresse
 * von Hand abgetippt. Diese Tuer gibt beides als `EntityDescriptor` heraus,
 * dazu das eigene Zertifikat, falls eines hinterlegt ist.
 *
 * ## Warum dieselbe Grenze wie `saml/providers` und nicht offen
 *
 * Projekt-Key, Origin-Gate, no-store, wie die oeffentliche Anbieterliste
 * daneben. Ein Anbieter ruft dieses Dokument nicht selbst ab: Der Betreiber
 * holt es und legt es beim Anbieter ab, und er hat den Key. Eine Tuer ohne Key
 * waere eine Tuer, an der jeder die Projektkennungen und die Consumer-Adresse
 * jeder Umgebung aufzaehlen koennte. Geheim ist daran nichts, aufzaehlbar soll
 * es trotzdem nicht sein, und dieselbe Entscheidung steht schon bei der
 * Anbieterliste.
 *
 * ## Warum XML und nicht JSON
 *
 * Weil ein Metadatendokument in einer JSON-Huelle keines mehr ist. Der
 * Anbieter erwartet genau dieses Dokument mit genau diesem Medientyp, und wer
 * es erst auspacken muss, tippt wieder Felder ab.
 */
export function createProjectAuthSamlMetadataHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
  keys: ProjectApiKeyService = projectApiKeyService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
    try {
      const parsed = await parsedProjectAuthParams(routeContext);
      const scope = await publicProjectAuthScope(request, routeContext, keys);
      const provider = parsed?.raw.provider;
      if (!provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider) ||
          [...request.nextUrl.searchParams.keys()].length > 0) {
        return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
      }
      const xml = getService().samlMetadata(scope, provider);
      // no-store wie bei jeder Auth-Antwort. Ein Metadatendokument sieht nach
      // etwas aus, das ein Zwischenspeicher gerne haelt, und genau darum steht
      // es hier: Wer das Zertifikat wechselt, will es sofort herausgeben.
      return withProjectAuthCors(request, new NextResponse(xml, {
        status: 200,
        headers: {
          "content-type": "application/samlmetadata+xml; charset=utf-8",
          "cache-control": "no-store",
        },
      }));
    } catch (error) { return projectAuthRouteError(error, request); }
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSamlMetadataHandler()(request, routeContext);
export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
