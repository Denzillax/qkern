import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitKey, safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";

const schema = z.object({
  email: z.email().max(320), password: z.string().min(12).max(256),
  userMetadata: z.record(z.string(), z.unknown()).optional(),
  redirectTo: z.url().max(2048),
}).strict();

export function createProjectAuthSignupHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
  keys: ProjectApiKeyService = projectApiKeyService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
    try {
      const scope = await publicProjectAuthScope(request, routeContext, keys);
      const body = schema.safeParse(await safeJson(request));
      if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
      const data = await getService().signUp(scope, { ...body.data, rateLimitKey: rateLimitKey(request) });
      return withProjectAuthCors(request, projectAuthNoStore({ data }, 202));
    } catch (error) { return projectAuthRouteError(error, request); }
  };
}

export const POST = createProjectAuthSignupHandler();
export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
