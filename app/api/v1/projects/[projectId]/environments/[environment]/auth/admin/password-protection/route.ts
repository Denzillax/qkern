import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import {
  PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS,
  PROJECT_AUTH_PASSWORD_NOTICES,
} from "@/lib/server/project-auth/password-leaks";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthPasswordProtectionError, type ProjectAuthService } from
  "@/lib/server/project-auth/service";

/**
 * Der Passwortschutz einer Projektumgebung (2.53), in der Console unter
 * Auth → Passwortschutz.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die geltende
 * Einstellung samt Vorgaben, Raendern und dem, was ueber die geladene
 * Leckliste gesagt werden darf; PUT ersetzt alle drei Werte und braucht dafuer
 * einen vertrauenswuerdigen Origin.
 *
 * Der Koerper nennt alle drei Werte, und das ist Absicht: Ein Koerper mit nur
 * dem Schalter liesse offen, was mit Mindestlaenge und Wortlaut geschehen
 * soll, und "unveraendert lassen" waere eine Annahme.
 *
 * **Was diese Route nicht tut:** Sie prueft kein Passwort. Ein Passwort
 * erreicht sie nie, und sie hat auch keinen Weg, eines entgegenzunehmen. Die
 * Pruefung steht im Dienst, an den beiden Stellen, an denen ein Passwort
 * gesetzt wird; eine Pruefung an dieser Route waere an genau einer Tuer
 * wirksam und an den anderen nicht.
 */
const schema = z.object({
  protection: z.object({
    leakedPasswordCheck: z.boolean(),
    minLength: z.number().int()
      .min(PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS.min)
      .max(PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS.max),
    notice: z.enum(PROJECT_AUTH_PASSWORD_NOTICES),
  }).strict(),
}).strict();

export function createProjectAuthPasswordProtectionHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().readPasswordProtection(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    PUT: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().setPasswordProtection(scope, body.data.protection, { id: actor.id }),
        });
      } catch (error) {
        // Eine abgelehnte Einstellung ist keine allgemeine Ablehnung: Die
        // Console soll sagen koennen, welches Feld warum nicht geht. Der
        // Grund ist ein stabiler Schluessel, kein Satz; uebersetzt wird er in
        // der Console.
        if (error instanceof ProjectAuthPasswordProtectionError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth password protection",
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
  createProjectAuthPasswordProtectionHandlers().GET(request, routeContext);

export const PUT = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthPasswordProtectionHandlers().PUT(request, routeContext);
