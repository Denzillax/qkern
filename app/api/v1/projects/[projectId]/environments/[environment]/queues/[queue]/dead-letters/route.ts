import { NextRequest } from "next/server";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

export function createProjectQueueDeadLetterHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        if (!context.raw.queue) return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        const rawLimit = request.nextUrl.searchParams.get("limit");
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
          return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        }
        return projectQueueNoStore({
          data: await service.listDeadLetters(context.principal, context.scope, context.raw.queue, { limit }),
        });
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueDeadLetterHandlers(getProjectQueueService()).GET(request, context);
