import { NextRequest } from "next/server";
import {
  parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Der Assertion Consumer Service (2.99): das HTTP-POST-Binding der Antwort.
 *
 * ## Warum hier kein Origin-Gate und kein Projekt-Key steht
 *
 * Diese Tuer wird von einem Formular aufgerufen, das der **Anbieter** in den
 * Browser gelegt hat. Der Browser schickt sie als Cross-Site-POST; ein
 * Projekt-Key steht nicht darin, ein erlaubter `Origin` auch nicht, und beides
 * liesse sich nicht nachtraeglich hineinbringen, ohne den Weg zu erfinden. Die
 * Grenze ist darum dieselbe wie beim OIDC-Callback: Die Umgebung kommt aus dem
 * Pfad und aus der offenen Anfrage, und ueberzeugen muss die Antwort selbst.
 *
 * Genau deshalb steht in `lib/server/project-auth/saml.ts` jede Pruefung, die
 * dort steht: Diese Route hat kein zweites Geheimnis, das sie vorzeigen
 * koennte. Was sie hat, ist die Signatur des Anbieters, die Bindung an die
 * eigene Anfrage und den Riegel gegen eine zweite Einreichung.
 *
 * Die Antwort ist JSON und keine Weiterleitung. Eine Weiterleitung mit Tokens
 * in der Adresse haette die Sitzung in eine URL geschrieben, und eine URL steht
 * in jedem Protokoll.
 */
export function createProjectAuthSamlAcsHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    try {
      const parsed = await parsedProjectAuthParams(routeContext);
      const provider = parsed?.raw.provider;
      const contentType = request.headers.get("content-type") ?? "";
      if (!parsed || !provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider) ||
          !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded") ||
          [...request.nextUrl.searchParams.keys()].length > 0) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      // Der Rumpf wird mit einer Grenze gelesen und nicht "wie er kommt": Eine
      // Antwort jenseits von vier Mebibyte ist keine Assertion, sondern Last.
      const raw = await request.text();
      if (raw.length > 4 * 1024 * 1024) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      const form = new URLSearchParams(raw);
      const response = form.get("SAMLResponse") ?? "";
      const requestId = form.get("RelayState") ?? "";
      if (!response || !requestId ||
          [...form.keys()].some((key) => !["SAMLResponse", "RelayState"].includes(key))) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      const service = getService();
      const scope = await service.resolveSamlScope({
        projectId: parsed.projectId, environment: parsed.environment, requestId,
      });
      const data = await service.completeSaml(scope, { provider, requestId, response });
      return projectAuthNoStore({ data });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const POST = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSamlAcsHandler()(request, routeContext);
