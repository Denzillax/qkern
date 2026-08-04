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
  contentType: z.string().min(3).max(192),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
}).strict();

export function createProjectStorageUploadHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS"),
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success) return projectStorageNoStore({ error: "Invalid upload request" }, 400);
        const data = await service.prepareUpload(context.principal, context.scope, context.raw.bucketId, body.data);
        return withProjectStorageCors(request, projectStorageNoStore({ data }, 201));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS");
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageUploadHandlers(getProjectStorageService()).POST(request, routeContext);
