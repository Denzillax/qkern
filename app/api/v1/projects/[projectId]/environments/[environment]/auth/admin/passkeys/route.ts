import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die Uebersicht der Passkeys einer Projektumgebung (2.79), wie bei Supabase
 * unter Authentication, Passkeys.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft.
 *
 * Nur `GET`, und das ist eine Entscheidung. Die Console zeigt drei Zahlen und
 * die Herkuenfte, gegen die geprueft wird; sie richtet keinen Passkey ein und
 * nimmt keinen weg. Einrichten kann nur, wer den Authenticator in der Hand hat,
 * und entfernen soll der Nutzer selbst, aus seiner eigenen Anwendung heraus
 * (`auth/passkeys`). Ein zweiter Loeschweg von der Admin-Seite waere eine
 * zweite Tuer zu derselben Zeile; er kommt, wenn es einen Grund dafuer gibt,
 * und bis dahin sagt die Seite, dass es ihn nicht gibt.
 */
export function createProjectAuthPasskeyHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readPasskeyPolicy(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthPasskeyHandlers().GET(request, routeContext);
