import type { NextRequest } from "next/server";
import { getUsageService } from "@/lib/server/usage/runtime";
import type { UsageService } from "@/lib/server/usage/service";
import {
  usageNoStore,
  usageReadContext,
  usageRouteError,
  type UsageRouteContext,
} from "@/lib/server/usage/http";

export function createUsageHandlers(service: UsageService) {
  return {
    GET: async (request: NextRequest, routeContext: UsageRouteContext) => {
      try {
        const keys = [...request.nextUrl.searchParams.keys()];
        if (keys.some((key) => key !== "period") || request.nextUrl.searchParams.getAll("period").length > 1) {
          return usageNoStore({ error: "Invalid usage request" }, 400);
        }
        const context = await usageReadContext(request, routeContext);
        const period = request.nextUrl.searchParams.get("period") ?? undefined;
        return usageNoStore({
          data: await service.readProjection(context.principal, context.scope, { period }),
        });
      } catch (error) { return usageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: UsageRouteContext) =>
  createUsageHandlers(getUsageService()).GET(request, context);
