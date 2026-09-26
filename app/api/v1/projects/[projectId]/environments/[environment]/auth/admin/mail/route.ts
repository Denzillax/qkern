import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import {
  projectAuthMailSettings, type ProjectAuthMailSettings,
} from "@/lib/server/project-auth/mail-settings";

/**
 * Der Mailweg von Project Auth als Lesewert (2.54), fuer Supabase-Leser:
 * Authentication, Emails, SMTP Settings und Templates — beide in einer Route,
 * weil beide dieselbe Antwort haben: Der Weg steht in der Umgebung des
 * Prozesses, nicht in der Console.
 *
 * Es gibt hier **nur GET**. Kein PUT, kein POST, kein PATCH, kein DELETE:
 * Es gibt nichts, wohin ein Schreibzugriff schreiben koennte. Ein Formular,
 * das SMTP-Daten entgegennaehme und sie nirgends ablegte, waere schlimmer als
 * gar keine Seite.
 *
 * Dieselbe Tuer wie die uebrigen `admin/*`-Routen: Console-Session mit
 * `project_auth_admin`, `Cache-Control: private, no-store`. Der Scope wird
 * gepruft, obwohl die Antwort fuer alle Umgebungen dieselbe ist — wer das
 * Projekt nicht sehen darf, soll auch dessen Mailweg nicht sehen.
 *
 * Das Passwort des Mailkontos geht nie hinaus, auch nicht gekuerzt, und es
 * gibt keine zusammengesetzte Verbindungszeichenkette.
 */
export function createProjectAuthMailHandlers(
  read: () => ProjectAuthMailSettings = () => projectAuthMailSettings(process.env),
) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
        }
        await adminProjectAuthScope(request, routeContext);
        return projectAuthNoStore({ data: read() });
      } catch (error) { return projectAuthRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthMailHandlers().GET(request, routeContext);
