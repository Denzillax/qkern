import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectAuthScope, parsedProjectAuthParams, projectAuthNoStore, projectAuthRouteError,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";

const schema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  appMetadata: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((value) => value.status !== undefined || value.appMetadata !== undefined);

export async function PATCH(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  try {
    const parsed = await parsedProjectAuthParams(routeContext);
    const { scope } = await adminProjectAuthScope(request, routeContext);
    const body = schema.safeParse(await safeJson(request));
    const userId = parsed?.raw.userId;
    if (!body.success || !userId || userId.length > 128) {
      return projectAuthNoStore({ error: "Invalid Project Auth request" }, 400);
    }
    return projectAuthNoStore({ data: await getProjectAuthService().updateUser(scope, userId, body.data) });
  } catch (error) { return projectAuthRouteError(error); }
}
