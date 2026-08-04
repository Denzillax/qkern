import { NextRequest } from "next/server";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError } from "@/lib/server/project-auth/service";
import { publicProjectAuthUser } from "@/lib/server/project-auth/model";

export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const token = presentedProjectAccessToken(request);
    if (!token) throw new ProjectAuthError("INVALID_TOKEN");
    const principal = await getProjectAuthService().verifyAccess(scope, token);
    return withProjectAuthCors(request, projectAuthNoStore({ data: {
      user: publicProjectAuthUser(principal.user), assurance: principal.session.assurance,
      sessionId: principal.session.id,
    } }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
