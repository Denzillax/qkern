import { NextRequest } from "next/server";
import {
  parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

export async function GET(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  try {
    const parsed = await parsedProjectAuthParams(routeContext);
    const provider = parsed?.raw.provider;
    const state = request.nextUrl.searchParams.get("state") ?? "";
    const code = request.nextUrl.searchParams.get("code") ?? "";
    if (!parsed || !provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider) ||
        !state || state.length > 256 || !code || code.length > 4096 ||
        [...request.nextUrl.searchParams.keys()].some((key) => !["state", "code"].includes(key))) {
      return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
    }
    const service = getProjectAuthService();
    const scope = await service.resolveOidcScope({
      projectId: parsed.projectId, environment: parsed.environment, state,
    });
    const data = await service.completeOidc(scope, { provider, state, code });
    return projectAuthNoStore({ data });
  } catch (error) { return projectAuthRouteError(error); }
}
