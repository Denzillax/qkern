import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  enqueuePolicy: z.enum(["authenticated", "service"]).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  visibilityTimeoutSeconds: z.number().int().min(5).max(900).optional(),
  retryBaseSeconds: z.number().int().min(1).max(300).optional(),
  retryMaxSeconds: z.number().int().min(1).max(3600).optional(),
  // Null bleibt erlaubt und heisst "keine Deduplizierung": Der CHECK aus 0026
  // laesst den Wert zu, und bestehende Queues tragen ihn. Seit 2.43 ignoriert
  // das Einreihen in so einer Queue den Dedupe-Key, statt an der
  // Paarbedingung zu scheitern.
  dedupeWindowSeconds: z.number().int().min(0).max(86400).optional(),
  retentionSeconds: z.number().int().min(60).max(604800).optional(),
  maxPendingMessages: z.number().int().min(1).max(10000).optional(),
}).strict();

export function createProjectQueueHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        return projectQueueNoStore({ data: await service.listQueues(context.principal, context.scope) });
      } catch (error) { return projectQueueRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        return projectQueueNoStore({ data: await service.createQueue(context.principal, context.scope, body.data) }, 201);
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueHandlers(getProjectQueueService()).GET(request, context);
export const POST = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueHandlers(getProjectQueueService()).POST(request, context);
