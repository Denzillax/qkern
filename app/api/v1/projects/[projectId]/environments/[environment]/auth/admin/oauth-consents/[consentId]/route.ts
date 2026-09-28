import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Der Widerruf einer einzelnen Zustimmung (2.92).
 *
 * **DELETE als Verb, aber nicht als Wirkung.** Die Zeile bleibt mit ihrem
 * Zeitpunkt und ihrem Widerrufszeitpunkt stehen; gesetzt wird nur `revoked_at`.
 * Dieselbe Entscheidung wie bei den S3-Schluesselpaaren aus 2.78, und aus
 * demselben Grund: Wer widerruft, will die Spur behalten. Die Auth-Rolle hat auf
 * `project_auth_oauth_consents` gar kein DELETE (Migration 0064), hier ist also
 * nichts zu loeschen, auch wenn jemand wollte.
 *
 * **Und er wirkt sofort.** Die Token dieser Zustimmung gelten mit derselben
 * Anweisung nicht mehr: Ein OAuth-Token gilt, weil eine Zeile existiert, und
 * seit 0064 zusaetzlich nur, solange seine Zustimmung gilt. Es braucht keinen
 * zweiten Lauf, der Token einsammelt, und keine Frist.
 *
 * **Der Unterschied zum Entfernen des Clients.** Das nimmt alle Zustimmungen
 * dieses Clients mit, von allen Nutzern, und zwar wirklich: Sie fallen ueber
 * ON DELETE CASCADE. Dieser Widerruf trifft genau eine, und die Liste zeigt sie
 * danach weiterhin, mit dem Vermerk.
 *
 * **Kein GET hier.** Die Liste steht vollstaendig in der Antwort von
 * `GET /auth/admin/oauth-clients`, zusammen mit den Clients, zu denen sie
 * gehoert. Eine zweite Route fuer dieselben Zeilen waere eine zweite Stelle, an
 * der eine Zustimmung anders aussehen koennte.
 *
 * Die Antwort ist der Stand danach und nicht ein leerer Koerper: Die Console
 * zeigt ihn, ohne ihn in einem zweiten Aufruf zu holen.
 */
export function createProjectAuthOAuthConsentHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    DELETE: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const consentId = parsed?.raw.consentId;
        if (!consentId) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({
          data: await getService().revokeOAuthConsent(scope, consentId, { id: actor.id }),
        });
      } catch (error) {
        // Ein Bezeichner, der keiner ist, und eine Zustimmung, die es hier nicht
        // gibt oder die schon widerrufen ist, sind zwei verschiedene Faelle:
        // 400 gegen 404.
        if (error instanceof ProjectAuthError && error.code === "INVALID_INPUT") {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const DELETE = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthOAuthConsentHandlers().DELETE(request, routeContext);
