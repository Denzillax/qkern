import { NextRequest } from "next/server";
import { z } from "zod";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Der Auth-Auszug aus der Audit-Kette (2.35), wie bei Supabase unter
 * Authentication, Audit Logs. Admin-Grenze wie die Sitzungen: Console-Session
 * mit `project_auth_admin`, der Scope kommt aus der Mitgliedschaft. Geliefert
 * werden nur `project_auth.*`-Eintraege dieses Projekts und dieser Umgebung,
 * neueste zuerst; Hashes der Kette bleiben drinnen.
 */
const query = z.object({
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  cursor: z.string().uuid().optional(),
}).strict();

export function createProjectAuthAuditHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    try {
      const { scope } = await adminProjectAuthScope(request, routeContext);
      const params = request.nextUrl.searchParams;
      const keys = [...params.keys()];
      const parsed = query.safeParse(Object.fromEntries(params.entries()));
      if (!parsed.success || new Set(keys).size !== keys.length) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      return projectAuthNoStore({
        data: await getService().listAuditEvents(scope, parsed.data.limit ?? 50, parsed.data.cursor),
      });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const GET = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthAuditHandler()(request, routeContext);
