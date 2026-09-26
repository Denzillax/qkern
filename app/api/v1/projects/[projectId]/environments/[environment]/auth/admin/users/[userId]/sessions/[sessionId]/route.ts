import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

/**
 * Eine Sitzung beenden (2.34). Der Dienst widerruft die ganze
 * Refresh-Familie der Sitzung und prueft, dass sie zu `userId` gehoert.
 */
const uuid = z.string().uuid();

export function createProjectAuthSessionHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const parsed = await parsedProjectAuthParams(routeContext);
      const { scope } = await adminProjectAuthScope(request, routeContext);
      const userId = uuid.safeParse(parsed?.raw.userId);
      const sessionId = uuid.safeParse(parsed?.raw.sessionId);
      if (!userId.success || !sessionId.success) {
        return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
      }
      return projectAuthNoStore({ data: await getService().revokeSession(scope, userId.data, sessionId.data) });
    } catch (error) { return projectAuthRouteError(error); }
  };
}

export const DELETE = (request: NextRequest, routeContext: ProjectAuthRouteContext) =>
  createProjectAuthSessionHandler()(request, routeContext);
