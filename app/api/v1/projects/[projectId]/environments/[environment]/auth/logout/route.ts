import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

const schema = z.object({ refreshToken: z.string().max(256) }).strict();

export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = schema.safeParse(await safeJson(request));
    if (!body.success) return withProjectAuthCors(request, projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
    await getProjectAuthService().logout(scope, body.data.refreshToken);
    return withProjectAuthCors(request, new NextResponse(null, {
      status: 204, headers: { "Cache-Control": "private, no-store" },
    }));
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
