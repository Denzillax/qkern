import { NextRequest, NextResponse } from "next/server";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { QUEUE_METRICS_CONTENT_TYPE, renderQueueMetrics } from "@/lib/server/project-queues/metrics";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * `GET /queues/metrics` — Prometheus-Textformat ueber alle Queues des Scopes.
 *
 * Dieselbe Admin-Grenze wie `status`, dieselbe Fehlerabbildung. Ein Scraper
 * bekommt Text, kein JSON; `no-store`, weil jeder Scrape die Wahrheit des
 * Augenblicks will. Eine Queue namens `metrics` verliert nur diesen einen
 * Pfad an den Export — ihre Unterrouten (`/metrics/status`, …) bleiben.
 */
export function createProjectQueueMetricsHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        }
        const exported = await service.exportMetrics(context.principal, context.scope);
        return new NextResponse(
          renderQueueMetrics(context.scope, exported.queues, new Date(exported.generatedAt)),
          { status: 200, headers: { "Content-Type": QUEUE_METRICS_CONTENT_TYPE, "Cache-Control": "private, no-store" } },
        );
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueMetricsHandlers(getProjectQueueService()).GET(request, context);
