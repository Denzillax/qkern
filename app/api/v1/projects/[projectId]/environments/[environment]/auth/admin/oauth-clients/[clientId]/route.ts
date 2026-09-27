import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Ein einzelner OAuth-Client (2.82): entfernen, und nichts sonst.
 *
 * Kein GET, weil die Liste eine Ebene hoeher vollstaendig ist und ein Client
 * kein Geheimnis traegt, das eine eigene Abfrage rechtfertigen wuerde. Kein PUT
 * und kein PATCH: Warum, steht in der Route eine Ebene hoeher und in Migration
 * 0062.
 *
 * **Was dieses DELETE wirklich tut.** Es nimmt die Erlaubnis zurueck **und** die
 * ausgegebenen Token: Ueber ON DELETE CASCADE fallen die Codes und die Token
 * dieses Clients mit ihm. Das ist der Unterschied zu den fremden Anbietern
 * (2.80), wo QKERN das Token nicht ausgegeben hat und es darum nicht
 * zurueckziehen kann. Hier hat es QKERN ausgegeben, also kann es das.
 *
 * Grob ist es trotzdem: Es faellt jedes Token dieses Clients, von allen Nutzern.
 * Eine einzelne Zustimmung eines einzelnen Nutzers zurueckzunehmen, gibt es
 * nicht, und die Seite sagt das.
 *
 * Die Antwort ist die Liste danach und nicht ein leerer Koerper, aus demselben
 * Grund wie bei 2.80: Die Console zeigt den neuen Stand, ohne ihn in einem
 * zweiten Aufruf zu holen.
 */
export function createProjectAuthOAuthClientDetailHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    DELETE: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const clientId = parsed?.raw.clientId;
        if (!clientId) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({
          data: await getService().deleteOAuthClient(scope, clientId, { id: actor.id }),
        });
      } catch (error) {
        // Ein Bezeichner, der keiner ist, und ein Client, den es in dieser
        // Umgebung nicht gibt, sind zwei verschiedene Faelle: 400 gegen 404.
        if (error instanceof ProjectAuthError && error.code === "INVALID_INPUT") {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const DELETE = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthOAuthClientDetailHandlers().DELETE(request, routeContext);
