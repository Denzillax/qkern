import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitKey, safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

const schema = z.object({
  email: z.email().max(320), redirectTo: z.url().max(2048), createUser: z.boolean().optional(),
}).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = schema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    const data = await getProjectAuthService().requestMagicLink(scope, {
      ...body.data, rateLimitKey: rateLimitKey(request),
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 202));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
