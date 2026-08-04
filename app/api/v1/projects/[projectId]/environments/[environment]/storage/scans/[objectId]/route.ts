import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectStorageContext,
  projectStorageNoStore,
  projectStorageRouteError,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";

export function createProjectStorageScanHandler(service: ProjectStorageService) {
  return async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const context = await adminProjectStorageContext(request, routeContext);
      if (!context.raw.objectId) return projectStorageNoStore({ error: "Invalid scan request" }, 400);
      return projectStorageNoStore({ data: await service.scanObject(
        context.principal, context.scope, context.raw.objectId,
      ) });
    } catch (error) { return projectStorageRouteError(error); }
  };
}

export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageScanHandler(getProjectStorageService())(request, routeContext);
