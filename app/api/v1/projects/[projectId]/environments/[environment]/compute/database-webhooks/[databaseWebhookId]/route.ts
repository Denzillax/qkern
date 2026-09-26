import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import type { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getDatabaseWebhookService } from "@/lib/server/compute/definitions-runtime";

/**
 * Lesen und Abschalten. **Kein DELETE**, und zwar nicht aus Versehen.
 *
 * Loeschen nimmt ueber den Fremdschluessel die wartenden Zustellungen mit. Bei
 * den ausgehenden Webhooks kostet das darum zwei bewusste Schritte; hier fehlt
 * der zweite Schritt in diesem Slice ganz. Abschalten leistet, was ein
 * Betreiber im Alltag braucht: Es haelt die Zustellungen an, ohne etwas zu
 * verlieren, und es ist ruecknehmbar.
 */
const patchSchema = z.object({ enabled: z.boolean() }).strict();

export function createDatabaseWebhookItemHandlers(service: DatabaseWebhookService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.get(context.principal, context.scope, identifier(context.raw)),
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
          data: await service.setEnabled(
            context.principal, context.scope, identifier(context.raw), body.data.enabled,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function identifier(raw: { databaseWebhookId?: string }) {
  if (!raw.databaseWebhookId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.databaseWebhookId;
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createDatabaseWebhookItemHandlers(getDatabaseWebhookService())
      .GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const PATCH = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createDatabaseWebhookItemHandlers(getDatabaseWebhookService())
      .PATCH(request, context);
  } catch (error) { return computeRouteError(error); }
};
