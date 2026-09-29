import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  expression: z.string().trim().min(5).max(64),
  queue: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  payload: z.unknown().optional(),
  enabled: z.boolean().optional(),
  // Die Form prueft der Dienst mit `Intl`; hier nur die Grenzen.
  timeZone: z.string().trim().min(1).max(64).optional(),
}).strict();

export function createComputeCronHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({ data: await service.listCron(context.principal, context.scope) });
      } catch (error) { return computeRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        const created = await service.createCron(context.principal, context.scope, {
          name: body.data.name,
          expression: body.data.expression,
          queue: body.data.queue,
          payload: body.data.payload as never,
          enabled: body.data.enabled,
          timeZone: body.data.timeZone,
        });
        return computeNoStore({ data: created }, 201);
      } catch (error) { return computeRouteError(error); }
    },
  };
}

// Der Dienst wird innerhalb des Fehlerpfads aufgeloest: Ist die Flaeche nicht
// freigeschaltet, ist das eine 503 mit klarer Meldung und kein unbehandelter
// Serverfehler.
export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronHandlers(getComputeDefinitionService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
