import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import {
  PROJECT_AUTH_OAUTH_BOUNDS,
  PROJECT_AUTH_OAUTH_CLIENT_NAME,
  PROJECT_AUTH_OAUTH_SCOPES,
} from "@/lib/server/project-auth/oauth";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthOAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die OAuth-Clients einer Projektumgebung (2.82), in der Console unter
 * Auth → OAuth-Server.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die Liste samt
 * den Bereichen, der Rolle, der verbotenen Rolle, den nicht gebauten Verfahren
 * und den Grenzen; POST legt einen Client an und braucht einen
 * vertrauenswuerdigen Origin.
 *
 * **Es gibt kein PUT.** Ein Client wird angelegt und entfernt, nicht bearbeitet.
 * Ein Aendern der Ruecksprungziele oder der Bereiche wuerde die Zusage aendern,
 * unter der ein Nutzer zugestimmt hat, ohne dass Name, Alter oder Audit-Zeile
 * sich aendern. Die Datenbank hat darum auch kein UPDATE-Recht auf dieser
 * Tabelle (Migration 0062).
 *
 * **Und es gibt kein Geheimnis in der Antwort.** Ein Client hier ist ein
 * oeffentlicher Client; sein Schutz ist PKCE und nicht ein Wert, den ein
 * Programmpaket mit sich traegt. Wer nach `clientSecret` sucht, findet in dieser
 * Datei nichts, und das ist die Auskunft.
 */
const schema = z.object({
  client: z.object({
    name: z.string().regex(PROJECT_AUTH_OAUTH_CLIENT_NAME),
    redirectUris: z.array(z.string().min(1).max(PROJECT_AUTH_OAUTH_BOUNDS.redirectUriLength))
      .min(PROJECT_AUTH_OAUTH_BOUNDS.redirectUris.min)
      .max(PROJECT_AUTH_OAUTH_BOUNDS.redirectUris.max),
    // Die Liste kommt aus dem Modul und nicht aus dieser Datei. Was nicht darin
    // steht, weist schon das Schema ab, mit demselben Ergebnis wie der Dienst
    // und die Datenbank.
    scopes: z.array(z.enum(PROJECT_AUTH_OAUTH_SCOPES)).min(1).max(PROJECT_AUTH_OAUTH_SCOPES.length),
  }).strict(),
}).strict();

export function createProjectAuthOAuthClientHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().listOAuthClients(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().createOAuthClient(scope, body.data.client, { id: actor.id }),
        }, 201);
      } catch (error) {
        // Eine abgelehnte Definition ist keine allgemeine Ablehnung: Die Console
        // soll sagen koennen, welches Feld warum nicht geht. Ein Ziel mit
        // Abfrage, eines mit Platzhalter und eines mit http auf einem fremden
        // Host sind drei verschiedene Gruende, und wer sie als einen bekommt,
        // probiert.
        if (error instanceof ProjectAuthOAuthError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth OAuth client",
            reason: error.reason,
            field: error.field,
          }, error.reason === "duplicate" ? 409 : 400);
        }
        return projectAuthRouteError(error);
      }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthOAuthClientHandlers().GET(request, routeContext);

export const POST = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthOAuthClientHandlers().POST(request, routeContext);
