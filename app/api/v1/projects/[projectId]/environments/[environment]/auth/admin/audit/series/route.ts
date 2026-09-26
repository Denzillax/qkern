import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Die Zeitreihe des Auth-Audits (2.47), neben dem Auszug selbst.
 *
 * Dieselbe Tuer wie `admin/audit`: Console-Session mit `project_auth_admin`,
 * der Scope kommt aus der Mitgliedschaft, `Cache-Control: private, no-store`.
 *
 * Ein Parameter und kein zweiter: `bucket` ist `hour` oder `day` und steht
 * ohne Angabe auf `hour`. Ein unbekannter Wert, eine zweite Angabe desselben
 * Parameters und jeder fremde Parameter sind ein 400, und zwar **vor** dem
 * Dienstaufruf. Das Fenster kommt nicht aus dem Aufruf, sondern aus der
 * Eimergroesse; die Antwort nennt es.
 */
const BUCKETS = new Set(["hour", "day"]);

export function createProjectAuthAuditSeriesHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    try {
      const parameters = request.nextUrl.searchParams;
      const keys = [...parameters.keys()];
      const bucket = parameters.get("bucket") ?? "hour";
      if (keys.some((key) => key !== "bucket") || parameters.getAll("bucket").length > 1 ||
          !BUCKETS.has(bucket)) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      const { scope } = await adminProjectAuthScope(request, routeContext);
      return projectAuthNoStore({ data: await getService().readAuditSeries(scope, { bucket }) });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthAuditSeriesHandler()(request, routeContext);
