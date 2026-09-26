import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Der zweite Faktor je Projektumgebung (2.52), wie bei Supabase unter
 * Authentication, Multi-Factor.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft. GET liest den Schalter und die zwei Zahlen, PUT bewegt
 * ihn und braucht dafuer einen vertrauenswuerdigen Origin.
 *
 * Der Koerper hat genau ein Feld, `required`, und muss ein Boolean sein.
 * Alles andere — ein fremdes Feld, ein "true" als Text, ein fehlender
 * Koerper — ist ein 400, bevor der Dienst gerufen wird.
 */
const schema = z.object({ required: z.boolean() }).strict();

export function createProjectAuthMfaHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readMfaPolicy(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    PUT: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().setMfaRequired(scope, body.data.required, { id: actor.id }),
        });
      } catch (error) { return projectAuthRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthMfaHandlers().GET(request, routeContext);

export const PUT = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthMfaHandlers().PUT(request, routeContext);
