import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitKey, safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

const requestSchema = z.object({ email: z.email().max(320), redirectTo: z.url().max(2048) }).strict();
const resetSchema = z.object({ token: z.string().min(20).max(256), password: z.string().min(12).max(256) }).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = requestSchema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    const data = await getProjectAuthService().requestPasswordReset(scope, {
      ...body.data, rateLimitKey: rateLimitKey(request),
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }, 202));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export async function PATCH(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = resetSchema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    const data = await getProjectAuthService().resetPassword(scope, body.data);
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, PATCH, OPTIONS");
