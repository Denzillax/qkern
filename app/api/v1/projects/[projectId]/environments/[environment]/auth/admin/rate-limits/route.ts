import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { PROJECT_AUTH_RATE_LIMIT_BOUNDS } from "@/lib/server/project-auth/rate-limits";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthRateLimitError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die Grenzen je Zeitfenster einer Projektumgebung (2.56), wie bei Supabase
 * unter Authentication, Rate Limits.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die geltenden
 * Grenzen samt Vorgaben und Raendern; PUT ersetzt alle drei und braucht dafuer
 * einen vertrauenswuerdigen Origin.
 *
 * Der Koerper nennt alle drei Arten, und das ist Absicht: Ein Koerper mit nur
 * einer Art liesse offen, was mit den beiden anderen geschehen soll, und
 * "unveraendert lassen" waere eine Annahme. Die Raender prueft dieses Schema
 * mit, damit ein offensichtlich unsinniger Wert nicht erst im Dienst
 * auffaellt; der Dienst prueft sie noch einmal, weil er der Ort ist, an dem
 * die Entscheidung wirklich faellt.
 */
const limit = z.object({
  max: z.number().int().min(PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.min).max(PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.max),
  windowSeconds: z.number().int()
    .min(PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.min)
    .max(PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.max),
}).strict();

const schema = z.object({
  limits: z.object({ sign_in: limit, mail: limit, refresh: limit }).strict(),
}).strict();

export function createProjectAuthRateLimitHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readRateLimits(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    PUT: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().setRateLimits(scope, body.data.limits, { id: actor.id }),
        });
      } catch (error) {
        // Eine abgelehnte Grenze ist keine allgemeine Ablehnung: Die Console
        // soll sagen koennen, welche Art warum nicht geht. Der Grund ist ein
        // stabiler Schluessel, kein Satz; uebersetzt wird er in der Console.
        if (error instanceof ProjectAuthRateLimitError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth rate limit",
            reason: error.reason,
            field: error.field,
          }, 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthRateLimitHandlers().GET(request, routeContext);

export const PUT = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthRateLimitHandlers().PUT(request, routeContext);
