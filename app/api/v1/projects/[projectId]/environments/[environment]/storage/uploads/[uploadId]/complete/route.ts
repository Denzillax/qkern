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

const schema = z.object({ completionToken: z.string().regex(/^qk_upload_[A-Za-z0-9_-]{43}$/) }).strict();

export function createProjectStorageCompletionHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS"),
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success || !context.raw.uploadId) return projectStorageNoStore({ error: "Invalid upload completion" }, 400);
        const data = await service.completeUpload(context.principal, context.scope, {
          uploadId: context.raw.uploadId,
          completionToken: body.data.completionToken,
        });
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "POST, OPTIONS");
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageCompletionHandlers(getProjectStorageService()).POST(request, routeContext);
