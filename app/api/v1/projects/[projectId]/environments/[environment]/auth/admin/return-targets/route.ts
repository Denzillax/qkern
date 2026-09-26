import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { PROJECT_AUTH_RETURN_TARGET_LIMIT } from "@/lib/server/project-auth/return-targets";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthReturnTargetError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die erlaubten Ruecksprungziele je Projektumgebung (2.54), wie bei Supabase
 * unter Authentication, URL Configuration.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die Liste,
 * die aeussere Grenze und was daraus wirklich gilt; PUT ersetzt die Liste
 * ganz und braucht dafuer einen vertrauenswuerdigen Origin.
 *
 * Der Koerper hat genau ein Feld, `targets`, und das ist ein Feld von
 * Zeichenketten. Die Form eines einzelnen Eintrags prueft dieses Schema
 * bewusst **nicht** — das tut der Dienst, weil dort die aeussere Grenze
 * bekannt ist und weil die Console den Grund der Ablehnung braucht. Was hier
 * abgewiesen wird, ist alles, was gar keine Liste von Zeichenketten ist.
 */
const schema = z.object({
  targets: z.array(z.string().max(255)).max(PROJECT_AUTH_RETURN_TARGET_LIMIT),
}).strict();

export function createProjectAuthReturnTargetHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readReturnTargets(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    PUT: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().setReturnTargets(scope, body.data.targets, { id: actor.id }),
        });
      } catch (error) {
        // Ein abgelehnter Eintrag ist keine allgemeine Ablehnung: Die Console
        // soll sagen koennen, welcher Wert warum nicht geht. Der Grund ist ein
        // stabiler Schluessel, kein Satz; uebersetzt wird er in der Console.
        if (error instanceof ProjectAuthReturnTargetError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth return target",
            reason: error.reason,
            value: error.value,
          }, 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthReturnTargetHandlers().GET(request, routeContext);

export const PUT = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthReturnTargetHandlers().PUT(request, routeContext);
