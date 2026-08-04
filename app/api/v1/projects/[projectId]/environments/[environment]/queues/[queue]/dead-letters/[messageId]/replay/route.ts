import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

export function createProjectQueueDeadLetterReplayHandler(service: ProjectQueueService) {
  return async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const context = await adminProjectQueueContext(request, routeContext);
      if (!context.raw.queue || !context.raw.messageId) {
        return projectQueueNoStore({ error: "Invalid queue request" }, 400);
      }
      return projectQueueNoStore({
        data: await service.replayDeadLetter(
          context.principal, context.scope, context.raw.queue, context.raw.messageId,
        ),
      }, 202);
    } catch (error) { return projectQueueRouteError(error); }
  };
}

export const POST = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueDeadLetterReplayHandler(getProjectQueueService())(request, context);
