import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  applicationProjectQueueContext,
  projectQueueNoStore,
  projectQueueOriginAllowed,
  projectQueuePreflight,
  projectQueueRouteError,
  withProjectQueueCors,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

const schema = z.object({
  payload: z.unknown(),
  dedupeKey: z.string().min(1).max(128).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export function createProjectQueueMessageHandlers(service: ProjectQueueService) {
  return {
    POST: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      if (!projectQueueOriginAllowed(request)) return projectQueueNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectQueueContext(request, routeContext);
        const body = schema.safeParse(await safeJson(request));
        if (!body.success || !context.raw.queue) return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        return withProjectQueueCors(request, projectQueueNoStore({
          data: await service.enqueue(context.principal, context.scope, context.raw.queue, body.data),
        }, 202));
      } catch (error) { return projectQueueRouteError(error, request); }
    },
  };
}

export const POST = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueMessageHandlers(getProjectQueueService()).POST(request, context);
export const OPTIONS = (request: NextRequest) => projectQueuePreflight(request);
