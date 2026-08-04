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

const schema = z.discriminatedUnion("grantType", [
  z.object({ grantType: z.literal("password"), email: z.email().max(320), password: z.string().max(256) }).strict(),
  z.object({ grantType: z.literal("refresh_token"), refreshToken: z.string().max(256) }).strict(),
]);

export function createProjectAuthTokenHandler(
  getService: () => ProjectAuthService = getProjectAuthService,
  keys: ProjectApiKeyService = projectApiKeyService,
) {
  return async (request: NextRequest, routeContext: ProjectAuthRouteContext) => {
    if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
    try {
      const scope = await publicProjectAuthScope(request, routeContext, keys);
      const body = schema.safeParse(await safeJson(request));
      if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
      const data = body.data.grantType === "password"
        ? await getService().passwordSignIn(scope, { ...body.data, rateLimitKey: rateLimitKey(request) })
        : await getService().refresh(scope, body.data.refreshToken);
      return withProjectAuthCors(request, projectAuthNoStore({ data }));
    } catch (error) { return projectAuthRouteError(error, request); }
  };
}

export const POST = createProjectAuthTokenHandler();
export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
