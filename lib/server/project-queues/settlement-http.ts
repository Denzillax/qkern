import { NextRequest } from "next/server";
import { z } from "zod";
import { safeJson } from "@/lib/server/auth/http";
import {
  applicationProjectQueueContext,
  projectQueueNoStore,
  projectQueueOriginAllowed,
  projectQueueRouteError,
  withProjectQueueCors,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

const base = z.object({
  workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  leaseToken: z.string().regex(/^qk_lease_[A-Za-z0-9_-]{43}$/),
}).strict();
const failure = base.extend({
  failureCode: z.enum(["HANDLER_ERROR", "HANDLER_TIMEOUT", "DEPENDENCY_UNAVAILABLE", "INVALID_PAYLOAD"]),
}).strict();

export function createSettlementHandler(service: ProjectQueueService, action: "ack" | "fail" | "lease") {
  return async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
    if (!projectQueueOriginAllowed(request)) return projectQueueNoStore({ error: "Origin is not allowed" }, 403);
    try {
      const context = await applicationProjectQueueContext(request, routeContext);
      const parsed = (action === "fail" ? failure : base).safeParse(await safeJson(request));
      if (!parsed.success || !context.raw.queue || !context.raw.messageId) {
        return projectQueueNoStore({ error: "Invalid queue settlement" }, 400);
      }
      const data = action === "ack"
        ? await service.acknowledge(context.principal, context.scope, context.raw.queue, context.raw.messageId, parsed.data)
        : action === "lease"
          ? await service.renewLease(context.principal, context.scope, context.raw.queue, context.raw.messageId, parsed.data)
          : await service.fail(context.principal, context.scope, context.raw.queue, context.raw.messageId,
            parsed.data as z.infer<typeof failure>);
      return withProjectQueueCors(request, projectQueueNoStore({ data }));
    } catch (error) { return projectQueueRouteError(error, request); }
  };
}
