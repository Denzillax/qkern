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

const createSchema = z.object({
  name: z.string().trim().min(3).max(63),
  readPolicy: z.enum(["private", "authenticated", "owner", "public", "service"]).optional(),
  writePolicy: z.enum(["private", "authenticated", "owner", "service"]).optional(),
  allowedMimeTypes: z.array(z.string().min(3).max(192)).min(1).max(20).optional(),
  maxObjectBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  quotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
}).strict();

export function createProjectStorageBucketHandlers(service: ProjectStorageService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        return projectStorageNoStore({ data: await service.listBuckets(context.principal, context.scope) });
      } catch (error) { return projectStorageRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return projectStorageNoStore({ error: "Invalid storage bucket request" }, 400);
        const data = await service.createBucket(context.principal, context.scope, body.data);
        return projectStorageNoStore({ data }, 201);
      } catch (error) { return projectStorageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageBucketHandlers(getProjectStorageService()).GET(request, routeContext);
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageBucketHandlers(getProjectStorageService()).POST(request, routeContext);
