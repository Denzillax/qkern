import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
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

const schema = z.object({
  key: z.string().min(1).max(1024),
  expiresInSeconds: z.number().int().min(30).max(900).optional(),
  downloadName: z.string().trim().min(1).max(180).optional(),
}).strict();

export function createProjectStorageDownloadHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS"),
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectStorageNoStore({ error: "Invalid download request" }, 400);
        const data = await service.createDownloadGrant(context.principal, context.scope, context.raw.bucketId, body.data);
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS");
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageDownloadHandlers(getProjectStorageService()).POST(request, routeContext);
