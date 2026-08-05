import { NextRequest } from "next/server";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * Zustellstatus eines Webhooks — **ohne Nutzlast**.
 *
 * Der Status beantwortet die Frage eines Betreibers: Kommt etwas an, und wenn
 * nicht, warum. Der Inhalt der Nachricht beantwortet sie nicht und gehört dem
 * Projekt; die Übersicht kopiert ihn deshalb nicht in eine zweite Fläche mit
 * eigenem Zugriffsweg. Der Dead-Letter-Pfad der Queues hält es genauso.
 */
export function createComputeDeliveryHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        if (!context.raw.webhookId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
        const raw = new URL(request.url).searchParams.get("limit");
        const limit = raw === null ? 50 : Number(raw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
          return computeNoStore({ error: "Invalid compute definition" }, 400);
        }
        return computeNoStore({
          data: await service.listDeliveries(
            context.principal, context.scope, context.raw.webhookId, limit,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeDeliveryHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
