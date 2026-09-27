import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import {
  PROJECT_AUTH_HOOK_BOUNDS,
  PROJECT_AUTH_HOOK_CLAIM_NAME,
  PROJECT_AUTH_HOOK_FUNCTION_NAME,
} from "@/lib/server/project-auth/hooks";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthHookError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die Auth-Hooks einer Projektumgebung (2.77), in der Console unter
 * Auth → Auth-Hooks.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die geltende
 * Definition samt Vorgaben, Raendern, reservierten Namen und dem, was bei einem
 * Ausfall gilt; PUT ersetzt beide Punkte und braucht einen vertrauenswuerdigen
 * Origin.
 *
 * Der Koerper nennt beide Punkte, und das ist Absicht: Ein Koerper mit nur
 * einem liesse offen, was mit dem anderen geschehen soll, und "unveraendert
 * lassen" waere eine Annahme.
 *
 * **Was diese Route nicht tut:** Sie ruft keinen Hook. Sie probiert ihn auch
 * nicht aus. Es gibt bewusst kein "Testaufruf"-Verb, denn ein Testaufruf mit
 * erfundener Nutzlast beweist, dass ein Container antwortet, und nicht, dass die
 * Anmeldung durchkommt. Was ein Hook wirklich getan hat, steht im
 * Aufrufprotokoll unter Functions → Aufrufe und, wenn er abgewiesen hat, im
 * Audit-Log unter Auth → Audit-Log.
 */
const binding = {
  // `null` ist eine Angabe und kein fehlender Wert: Sie heisst "dieser Punkt
  // ruft nichts". Darum `nullable()` und nicht `optional()`.
  functionName: z.string().regex(PROJECT_AUTH_HOOK_FUNCTION_NAME).nullable(),
  timeoutMs: z.number().int()
    .min(PROJECT_AUTH_HOOK_BOUNDS.timeoutMs.min)
    .max(PROJECT_AUTH_HOOK_BOUNDS.timeoutMs.max),
};

const schema = z.object({
  hooks: z.object({
    signIn: z.object(binding).strict(),
    accessTokenClaims: z.object({
      ...binding,
      claims: z.array(z.string().regex(PROJECT_AUTH_HOOK_CLAIM_NAME))
        .max(PROJECT_AUTH_HOOK_BOUNDS.claims.max),
    }).strict(),
  }).strict(),
}).strict();

export function createProjectAuthHooksHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readAuthHooks(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    PUT: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().setAuthHooks(scope, body.data.hooks, { id: actor.id }),
        });
      } catch (error) {
        // Eine abgelehnte Definition ist keine allgemeine Ablehnung: Die Console
        // soll sagen koennen, welcher Punkt warum nicht geht. Ein reservierter
        // Anspruchsname kommt hier heraus und nicht als 400 ohne Grund, weil
        // genau das der haeufigste Fehlversuch ist.
        if (error instanceof ProjectAuthHookError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth hook",
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
  createProjectAuthHooksHandlers().GET(request, routeContext);

export const PUT = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthHooksHandlers().PUT(request, routeContext);
