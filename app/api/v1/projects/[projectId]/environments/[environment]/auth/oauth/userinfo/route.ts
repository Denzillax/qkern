import { NextRequest } from "next/server";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError } from "@/lib/server/project-auth/service";
import { projectAuthOAuthAllows } from "@/lib/server/project-auth/oauth";

/**
 * `GET /auth/oauth/userinfo` (2.82): Wer hat zugestimmt.
 *
 * Die Stelle, an der der Bereich `identity:read` wirklich etwas tut. Ein
 * Bereich, den niemand prueft, ist eine Beschriftung, und darum gibt es diese
 * Route: Sie ist der einzige Ort, an dem ein Client erfaehrt, in wessen Namen er
 * arbeitet.
 *
 * **Was hier steht:** die Kennung des Nutzers, seine E-Mail-Adresse, der Name
 * des Clients, die zugestimmten Bereiche und das Ende dieses Tokens.
 *
 * **Was hier nicht steht, und warum:** kein `user_metadata` und kein
 * `app_metadata`, keine Angabe zu einem zweiten Faktor, keine Sitzung, keine
 * Liste der Geraete. Alle diese Dinge sind Zusagen ueber die Anmeldung bei
 * QKERN, und sie gehoeren dem Projekt und dem Nutzer, nicht der fremden
 * Anwendung. `app_metadata` ist dabei der wichtigste Verzicht: Dort legen
 * Projekte ab, was ein Nutzer darf, und eine fremde Anwendung, die das liest,
 * liest die Rechtestruktur des Projekts.
 *
 * **Warum das eine eigene Route ist und nicht `/auth/user`:** Jene Route
 * beantwortet die Frage "wer bin ich" fuer die eigene Anwendung des Projekts und
 * antwortet mit dem vollen Nutzer samt Metadaten und Sitzung. Ein OAuth-Token
 * dort anzunehmen hiesse, diese Antwort an eine fremde Anwendung zu geben, oder
 * die Antwort je nach Token zu beschneiden. Das zweite waere eine Route mit zwei
 * Bedeutungen, und die erklaert sich schlecht.
 */
export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const token = presentedProjectAccessToken(request);
    if (!token) throw new ProjectAuthError("INVALID_TOKEN");
    const verdict = await getProjectAuthService().verifyOAuthToken(scope, token);
    // Unbekannt, abgelaufen oder gar kein OAuth-Token: derselbe Ausgang. Der
    // Grund bleibt drinnen, wie bei jeder Pruefung eines vorgelegten Tokens.
    if (!verdict.ok) throw new ProjectAuthError("INVALID_TOKEN");
    // Ein echtes Token ohne diesen Bereich ist keine Anmeldefrage, sondern eine
    // Rechtefrage: Das Token gilt, der Nutzer hat nur nicht zugestimmt. Darum
    // 403 und ein eigener Satz, statt eines 401, der zum erneuten Anmelden
    // auffordert und damit nichts aendern wuerde.
    if (!projectAuthOAuthAllows(verdict.identity.scopes, "identity:read")) {
      return withProjectAuthCors(request, projectAuthNoStore({
        error: "This OAuth token does not carry the identity:read scope",
      }, 403));
    }
    return withProjectAuthCors(request, projectAuthNoStore({ data: {
      userId: verdict.identity.userId,
      email: verdict.identity.email,
      clientId: verdict.identity.clientName,
      scopes: verdict.identity.scopes,
      expiresAt: verdict.identity.expiresAt.toISOString(),
    } }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
