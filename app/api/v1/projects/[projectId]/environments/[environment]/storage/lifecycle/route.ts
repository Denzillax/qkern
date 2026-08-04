import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectStorageContext,
  projectStorageNoStore,
  projectStorageRouteError,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";

const schema = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict();

export function createProjectStorageLifecycleHandler(service: ProjectStorageService) {
  return async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const context = await adminProjectStorageContext(request, routeContext);
      const body = schema.safeParse(await safeJson(request));
      if (!body.success) return projectStorageNoStore({ error: "Invalid lifecycle request" }, 400);
      return projectStorageNoStore({ data: await service.expireLifecycle(
        context.principal, context.scope, body.data.limit,
      ) });
    } catch (error) { return projectStorageRouteError(error); }
  };
}

export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageLifecycleHandler(getProjectStorageService())(request, routeContext);
