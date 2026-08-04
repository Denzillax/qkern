import { NextRequest } from "next/server";
import {
  parsedProjectAuthParams, projectAuthNoStore, projectAuthPreflight, projectAuthRouteError,
  withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  try {
    if (!await parsedProjectAuthParams(routeContext)) return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
    const response = projectAuthNoStore(getProjectAuthService().jwks());
    response.headers.set("Cache-Control", "public, max-age=300, must-revalidate");
    return withProjectAuthCors(request, response);
  } catch (error) { return projectAuthRouteError(error, request); }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "GET, OPTIONS");
