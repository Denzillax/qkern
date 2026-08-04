import { NextRequest } from "next/server";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

export function createProjectQueueStatusHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        if (!context.raw.queue) return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        return projectQueueNoStore({ data: await service.status(context.principal, context.scope, context.raw.queue) });
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueStatusHandlers(getProjectQueueService()).GET(request, context);
