import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

const patchSchema = z.object({ enabled: z.boolean() }).strict();

export function createComputeWebhookItemHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.getWebhook(context.principal, context.scope, webhookId(context.raw)),
        });
      } catch (error) { return computeRouteError(error); }
    },
    PATCH: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = patchSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.setWebhookEnabled(
            context.principal, context.scope, webhookId(context.raw), body.data.enabled,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
    /**
     * Löschen entfernt über den Fremdschlüssel auch alle wartenden
     * Zustellungen. Der Dienst verlangt deshalb, dass der Webhook vorher
     * abgeschaltet wurde; sonst antwortet diese Route mit 409.
     */
    DELETE: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        await service.deleteWebhook(context.principal, context.scope, webhookId(context.raw));
        return computeNoStore({ data: { deleted: true } });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function webhookId(raw: { webhookId?: string }) {
  if (!raw.webhookId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.webhookId;
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeWebhookItemHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const PATCH = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeWebhookItemHandlers(getComputeDefinitionService()).PATCH(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const DELETE = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeWebhookItemHandlers(getComputeDefinitionService()).DELETE(request, context);
  } catch (error) { return computeRouteError(error); }
};
