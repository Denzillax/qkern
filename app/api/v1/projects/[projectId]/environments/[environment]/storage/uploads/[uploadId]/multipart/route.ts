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
 * Abschluss und Abbruch eines fortsetzbaren Uploads.
 *
 * POST schliesst mit der Teileliste ab; DELETE bricht ab und laesst nichts
 * zurueck. Beides verlangt den Completion-Token — wer die Reservierung nicht
 * halten kann, kann sie auch nicht beenden.
 */
const completeSchema = z.object({
  completionToken: z.string().regex(/^qk_upload_[A-Za-z0-9_-]{43}$/),
  parts: z.array(z.object({
    partNumber: z.number().int().min(1).max(10_000),
    etag: z.string().min(1).max(256),
  }).strict()).min(1).max(10_000),
}).strict();

const abortSchema = z.object({
  completionToken: z.string().regex(/^qk_upload_[A-Za-z0-9_-]{43}$/),
}).strict();

export function createProjectStorageMultipartHandlers(service: ProjectStorageService) {
  return {
    OPTIONS: (request: NextRequest) => projectStoragePreflight(request, "POST, DELETE, OPTIONS"),
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = completeSchema.safeParse(await safeJson(request));
        if (!body.success || !context.raw.uploadId) {
          return projectStorageNoStore({ error: "Invalid multipart completion" }, 400);
        }
        const data = await service.completeMultipartUpload(context.principal, context.scope, {
          uploadId: context.raw.uploadId,
          ...body.data,
        });
        return withProjectStorageCors(request, projectStorageNoStore({ data }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
    DELETE: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!projectStorageOriginAllowed(request)) return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectStorageContext(request, routeContext);
        const body = abortSchema.safeParse(await safeJson(request));
        if (!body.success || !context.raw.uploadId) {
          return projectStorageNoStore({ error: "Invalid multipart abort" }, 400);
        }
        await service.abortMultipartUpload(context.principal, context.scope, {
          uploadId: context.raw.uploadId,
          completionToken: body.data.completionToken,
        });
        return withProjectStorageCors(request, projectStorageNoStore({ data: { aborted: true } }));
      } catch (error) { return projectStorageRouteError(error, request); }
    },
  };
}

export const OPTIONS = (request: NextRequest) => projectStoragePreflight(request, "POST, DELETE, OPTIONS");
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageMultipartHandlers(getProjectStorageService()).POST(request, routeContext);
export const DELETE = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageMultipartHandlers(getProjectStorageService()).DELETE(request, routeContext);
