import { NextRequest } from "next/server";
import { createSettlementHandler } from "@/lib/server/project-queues/settlement-http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import { projectQueuePreflight, type ProjectQueueRouteContext } from "@/lib/server/project-queues/http";

export const POST = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createSettlementHandler(getProjectQueueService(), "ack")(request, context);

export const OPTIONS = (request: NextRequest) => projectQueuePreflight(request);
