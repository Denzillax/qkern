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

const updateSchema = z.object({
  readPolicy: z.enum(["private", "authenticated", "owner", "public", "service"]),
  writePolicy: z.enum(["private", "authenticated", "owner", "service"]),
  allowedMimeTypes: z.array(z.string().min(3).max(192)).min(1).max(20),
  maxObjectBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  retentionDays: z.number().int().min(1).max(3650).nullable(),
}).strict();

export function createProjectStorageBucketItemHandlers(service: ProjectStorageService) {
  return {
    PATCH: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        const body = updateSchema.safeParse(await safeJson(request));
        if (!context.raw.bucketId || !body.success) {
          return projectStorageNoStore({ error: "Invalid storage bucket request" }, 400);
        }
        const data = await service.updateBucket(context.principal, context.scope, context.raw.bucketId, body.data);
        return projectStorageNoStore({ data });
      } catch (error) { return projectStorageRouteError(error); }
    },
    DELETE: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        if (!context.raw.bucketId) return projectStorageNoStore({ error: "Invalid storage bucket request" }, 400);
        return projectStorageNoStore({ data: await service.deleteBucket(
          context.principal, context.scope, context.raw.bucketId,
        ) });
      } catch (error) { return projectStorageRouteError(error); }
    },
  };
}

export const PATCH = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageBucketItemHandlers(getProjectStorageService()).PATCH(request, routeContext);
export const DELETE = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageBucketItemHandlers(getProjectStorageService()).DELETE(request, routeContext);
