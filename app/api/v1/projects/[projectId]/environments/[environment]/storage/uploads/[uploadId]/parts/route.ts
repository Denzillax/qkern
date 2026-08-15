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

/**
 * Eine signierte URL je Teil. Die Teil-Pruefsumme steckt in der Signatur:
 * Der Provider weist Bytes ab, die nicht dazu passen, und einen Teil ohne
 * Pruefsummen-Header ebenso (Release 1.69).
 */
const schema = z.object({
  completionToken: z.string().regex(/^qk_upload_[A-Za-z0-9_-]{43}$/),
  partNumber: z.number().int().min(1).max(10_000),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
}).strict();

export function createProjectStoragePartGrantHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS"),
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success || !context.raw.uploadId) {
          return projectStorageNoStore({ error: "Invalid part grant request" }, 400);
        }
        const data = await service.createPartUploadGrant(context.principal, context.scope, {
          uploadId: context.raw.uploadId,
          ...body.data,
        });
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS");
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStoragePartGrantHandlers(getProjectStorageService()).POST(request, routeContext);
