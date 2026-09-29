import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Der Widerruf genau eines ausgegebenen Tokens (2.93).
 *
 * **Die Luecke, die das schliesst.** Seit 2.82 fiel ein Token nur zusammen mit
 * etwas Groesserem: mit seinem Client, also mit allen Token aller Nutzer, und
 * seit 2.92 zusaetzlich mit seiner Zustimmung, also mit allen Token derselben
 * Erlaubnis. Ein einzelnes Token, das in falsche Haende geraten ist, war damit
 * nur zu stoppen, indem man einem Nutzer seine Erlaubnis nahm oder eine ganze
 * Anwendung abschaltete.
 *
 * **DELETE als Verb und als Wirkung**, anders als beim Widerruf einer
 * Zustimmung. Ein Token gilt, weil eine Zeile existiert; die Zeile faellt, und
 * damit gilt es nicht mehr. Es gibt am Token keine Spalte fuer einen Widerruf,
 * und es soll auch keine geben: Sie waere eine zweite Bedingung im heissen Weg,
 * die jemand vergessen kann, waehrend eine fehlende Zeile niemand vergessen
 * kann. Das Recht dazu liegt seit Migration 0063 bei der Auth-Rolle, weil der
 * Aufraeumer abgelaufene Zeilen entfernt; dieser Widerruf braucht darum keine
 * eigene Migration.
 *
 * **Die Spur bleibt trotzdem.** Die Zustimmung, an der das Token hing, steht
 * weiter da, mit Nutzer, Bereichen und Zeitpunkt, und der Widerruf schreibt
 * eine Audit-Zeile. Was verschwindet, ist der Zugang, nicht die Tatsache.
 *
 * **Und die Zustimmung bleibt gueltig.** Wer ein Token zurueckzieht, sagt, dass
 * dieses Geheimnis nichts mehr taugt, und nicht, dass der Nutzer seine Erlaubnis
 * zurueckgenommen hat; die Anwendung darf sich darum ein neues holen. Wer beides
 * will, widerruft die Zustimmung. Die Console sagt diesen Unterschied an beiden
 * Knoepfen.
 *
 * **Kein GET hier**, wie schon bei den Zustimmungen: Die Liste steht
 * vollstaendig in der Antwort von `GET /auth/admin/oauth-clients`, ohne
 * Pruefsumme und ohne Token. Eine zweite Route fuer dieselben Zeilen waere eine
 * zweite Stelle, an der ein Token anders aussehen koennte.
 *
 * Die Antwort ist der Stand danach und nicht ein leerer Koerper: Die Console
 * zeigt ihn, ohne ihn in einem zweiten Aufruf zu holen.
 */
export function createProjectAuthOAuthTokenHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    DELETE: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const tokenId = parsed?.raw.tokenId;
        if (!tokenId) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({
          data: await getService().revokeOAuthToken(scope, tokenId, { id: actor.id }),
        });
      } catch (error) {
        // Ein Bezeichner, der keiner ist, und ein Token, das es hier nicht gibt
        // oder das schon widerrufen ist, sind zwei verschiedene Faelle:
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
  createProjectAuthOAuthTokenHandlers().DELETE(request, routeContext);
