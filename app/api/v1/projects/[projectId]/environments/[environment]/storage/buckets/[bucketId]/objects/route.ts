import { NextRequest } from "next/server";
import {
  applicationProjectStorageContext,
  projectStorageNoStore,
  projectStorageOriginAllowed,
  projectStoragePreflight,
  projectStorageRouteError,
  withProjectStorageCors,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";

export function createProjectStorageObjectHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "GET, DELETE, OPTIONS"),
    GET: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const limit = request.nextUrl.searchParams.get("limit");
        const data = await service.listObjects(context.principal, context.scope, context.raw.bucketId, {
          prefix: request.nextUrl.searchParams.get("prefix") ?? undefined,
          cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
          limit: limit === null ? undefined : Number(limit),
        });
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
    DELETE: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const key = request.nextUrl.searchParams.get("key") ?? "";
        const data = await service.deleteObject(context.principal, context.scope, context.raw.bucketId, key);
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "GET, DELETE, OPTIONS");
export const GET = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageObjectHandlers(getProjectStorageService()).GET(request, routeContext);
export const DELETE = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageObjectHandlers(getProjectStorageService()).DELETE(request, routeContext);
