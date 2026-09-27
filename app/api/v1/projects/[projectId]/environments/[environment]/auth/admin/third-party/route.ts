import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import {
  PROJECT_AUTH_THIRD_PARTY_BOUNDS,
  PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME,
  PROJECT_AUTH_THIRD_PARTY_NAME,
  PROJECT_AUTH_THIRD_PARTY_ROLES,
} from "@/lib/server/project-auth/third-party";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthThirdPartyError, type ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die fremden Anbieter einer Projektumgebung (2.80), in der Console unter
 * Auth → Fremde Anbieter.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, kein Projekt-Key, der Scope kommt aus der
 * Mitgliedschaft, `Cache-Control: private, no-store`. GET liest die Liste samt
 * den Grenzen, den erlaubten Rollen, der verbotenen Rolle und den geprueften
 * Verfahren; POST legt einen Anbieter an und braucht einen vertrauenswuerdigen
 * Origin.
 *
 * **Es gibt kein PUT.** Ein Anbieter wird angelegt und entfernt, nicht
 * bearbeitet. Ein Aendern von Aussteller oder Schluesselsatz verwandelte den
 * Eintrag in eine andere Vertrauensbeziehung, ohne dass Name, Alter oder
 * Audit-Zeile sich aendern; wer die Liste danach liest, sieht denselben Anbieter
 * und meint denselben Dienst. Die Datenbank hat darum auch kein UPDATE-Recht auf
 * dieser Tabelle (Migration 0061).
 *
 * **Was diese Route nicht tut:** Sie holt keinen Schluesselsatz und prueft kein
 * Token. Es gibt bewusst kein "Verbindung testen": Ein Holen zum Zeitpunkt des
 * Eintragens beweist, dass eine Adresse jetzt antwortet, und nicht, dass eine
 * Anfrage in einer Stunde durchkommt. Geholt wird beim ersten echten Token, und
 * was dabei geschah, steht unter Logs → Data API.
 */
const schema = z.object({
  provider: z.object({
    name: z.string().regex(PROJECT_AUTH_THIRD_PARTY_NAME),
    issuer: z.string().min(12).max(512),
    jwksUri: z.string().min(12).max(512),
    audiences: z.array(z.string().min(1).max(255))
      .min(PROJECT_AUTH_THIRD_PARTY_BOUNDS.audiences.min)
      .max(PROJECT_AUTH_THIRD_PARTY_BOUNDS.audiences.max),
    // `optional()` und nicht `nullable()`: Fuer beide gibt es genau eine
    // sinnvolle Vorgabe (`sub` und `authenticated`), und eine Frage mit genau
    // einer sinnvollen Antwort muss niemand stellen.
    subjectClaim: z.string().regex(PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME).optional(),
    // Hier dagegen ist `null` eine Angabe: "die Rolle kommt aus keinem
    // Anspruch". Darum `nullable()` **und** `optional()`.
    roleClaim: z.string().regex(PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME).nullable().optional(),
    // Die Liste kommt aus dem Modul und nicht aus dieser Datei. `service_role`
    // steht nicht darin, und genau deshalb weist schon das Schema sie ab, mit
    // demselben Ergebnis wie der Dienst und die Datenbank.
    defaultRole: z.enum(PROJECT_AUTH_THIRD_PARTY_ROLES).optional(),
  }).strict(),
}).strict();

export function createProjectAuthThirdPartyHandlers(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        const { scope } = await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: await getService().listThirdPartyProviders(scope) });
      } catch (error) { return projectAuthRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const { scope, actor } = await adminProjectAuthScope(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        return projectAuthNoStore({
          data: await getService().createThirdPartyProvider(scope, body.data.provider, { id: actor.id }),
        }, 201);
      } catch (error) {
        // Eine abgelehnte Definition ist keine allgemeine Ablehnung: Die Console
        // soll sagen koennen, welches Feld warum nicht geht. Der Versuch, die
        // Rolle `service_role` einzutragen, kommt als eigener Grund heraus und
        // nicht als "ungueltige Rolle", weil das die falsche Auskunft waere: Die
        // Rolle gibt es, und sie ist hier verboten.
        if (error instanceof ProjectAuthThirdPartyError) {
          return projectAuthNoStore({
            error: "Invalid Project Auth third party provider",
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
  createProjectAuthThirdPartyHandlers().GET(request, routeContext);

export const POST = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthThirdPartyHandlers().POST(request, routeContext);
