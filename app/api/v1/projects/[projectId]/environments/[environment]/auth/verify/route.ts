import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

const schema = z.object({
  type: z.enum(["email_verification", "magic_link"]), token: z.string().min(20).max(256),
}).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = schema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    const data = await getProjectAuthService().consumeEmailToken(scope, {
      token: body.data.token, purpose: body.data.type,
    });
    return withProjectAuthCors(request, projectAuthNoStore({ data }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
