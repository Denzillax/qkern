import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Sitzungen eines App-Nutzers (2.34), wie bei Supabase unter
 * Authentication, Sessions. Admin-Grenze wie die Nutzerliste: Console-Session
 * mit `project_auth_admin`, kein Projekt-Key. Der Scope kommt aus der
 * Mitgliedschaft, nie aus der Anfrage; ein Nutzer eines anderen Mandanten
 * ist damit schlicht unbekannt (404).
 */
const uuid = z.string().uuid();

export function createProjectAuthSessionsHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const { scope } = await adminProjectAuthScope(request, routeContext);
        const userId = uuid.safeParse(parsed?.raw.userId);
        if (!userId.success || [...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        return projectAuthNoStore({ data: await getService().listSessions(scope, userId.data) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    DELETE: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const parsed = await parsedProjectAuthParams(routeContext);
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const userId = uuid.safeParse(parsed?.raw.userId);
        if (!userId.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({ data: await getService().revokeAllSessions(scope, userId.data, { id: actor.id }) });
      } catch (error) { return projectAuthRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSessionsHandlers().GET(request, routeContext);

export const DELETE = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSessionsHandlers().DELETE(request, routeContext);
