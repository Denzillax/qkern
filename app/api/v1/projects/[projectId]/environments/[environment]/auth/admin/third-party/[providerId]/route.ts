import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Ein einzelner fremder Anbieter (2.80): entfernen, und nichts sonst.
 *
 * Kein GET, weil die Liste eine Ebene hoeher vollstaendig ist und ein Anbieter
 * kein Geheimnis traegt, das eine eigene Abfrage rechtfertigen wuerde. Kein PUT
 * und kein PATCH: Warum, steht in der Route eine Ebene hoeher und in Migration
 * 0061.
 *
 * **Was dieses DELETE wirklich tut, und was nicht.** Es nimmt die Erlaubnis
 * zurueck, nicht die ausgegebenen Token. Ab dem naechsten Aufruf findet die
 * Pruefung zu diesem Aussteller keinen Eintrag mehr, und damit faellt jedes
 * Token dieses Dienstes, auch die noch gueltigen. Feiner geht es nicht: QKERN
 * kann kein Token widerrufen, das es nicht ausgegeben hat. Grober ist es auch
 * nicht: Andere Anbieter und die eigenen Nutzer dieser Umgebung merken nichts
 * davon.
 *
 * Die Antwort ist die Liste danach und nicht ein leerer Koerper. Die Console
 * zeigt nach dem Entfernen den neuen Stand, und ein zweiter Aufruf, um ihn zu
 * holen, waere ein Moment, in dem die Ansicht etwas anderes zeigt als die
 * Datenbank.
 */
export function createProjectAuthThirdPartyProviderHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    DELETE: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const providerId = parsed?.raw.providerId;
        if (!providerId) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({
          data: await getService().deleteThirdPartyProvider(scope, providerId, { id: actor.id }),
        });
      } catch (error) {
        // Ein Bezeichner, der keiner ist, und ein Anbieter, den es in dieser
        // Umgebung nicht gibt, sind zwei verschiedene Faelle: 400 gegen 404. Der
        // Dienst unterscheidet sie, und diese Route gibt den Unterschied weiter,
        // weil ein 404 auf eine krumme Eingabe den Aufrufer suchen liesse, wo
        // nichts zu finden ist.
        if (error instanceof ProjectAuthError && error.code === "INVALID_INPUT") {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const DELETE = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthThirdPartyProviderHandlers().DELETE(request, routeContext);
