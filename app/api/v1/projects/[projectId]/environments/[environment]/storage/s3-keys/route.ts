import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectStorageContext,
  projectStorageNoStore,
  projectStorageRouteError,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import type { ProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys";
import { getProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys-runtime";

/**
 * S3-Zugang (2.78). Die Antwort auf POST ist die einzige Stelle, an der das
 * Geheimnis vorkommt; GET kennt es nicht und kann es nicht kennen.
 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bucketIds: z.array(z.string().uuid()).min(1).max(20),
  expiresAt: z.iso.datetime({ offset: true }),
  // `.strict()` ist hier tragend: Ein Koerper, der ein eigenes Geheimnis oder
  // einen Hash mitbringen will, wird abgewiesen statt stillschweigend ignoriert.
}).strict();

export function createProjectStorageS3AccessKeyHandlers(service: ProjectStorageS3AccessKeyService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        return projectStorageNoStore({ data: await service.list(context.principal, context.scope) });
      } catch (error) { return projectStorageRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return projectStorageNoStore({ error: "Invalid S3 access key request" }, 400);
        const created = await service.create(context.principal, context.scope, body.data);
        return projectStorageNoStore({ data: created.key, secret: created.secret }, 201);
      } catch (error) { return projectStorageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageS3AccessKeyHandlers(getProjectStorageS3AccessKeyService()).GET(request, routeContext);
export const POST = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageS3AccessKeyHandlers(getProjectStorageS3AccessKeyService()).POST(request, routeContext);
