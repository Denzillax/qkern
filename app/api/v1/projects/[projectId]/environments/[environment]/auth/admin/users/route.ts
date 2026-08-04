import { NextRequest } from "next/server";
import {
  adminProjectAuthScope, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  try {
    const { scope } = await adminProjectAuthScope(request, routeContext);
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if ([...request.nextUrl.searchParams.keys()].some((key) => !["limit", "cursor"].includes(key)) ||
        (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit))) {
      return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
    }
    return projectAuthNoStore({ data: await getProjectAuthService().listUsers(scope, limit, cursor) });
  } catch (error) { return projectAuthRouteError(error); }
}
