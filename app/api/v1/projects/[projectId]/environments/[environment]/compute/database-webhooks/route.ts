import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { DATABASE_WEBHOOK_EVENTS } from "@/lib/console/database-webhooks";
import type { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getDatabaseWebhookService } from "@/lib/server/compute/definitions-runtime";

/**
 * Datenbank-Webhooks (2.50), ein Geschwister der Webhook-Definitionsroute.
 *
 * `signingSecretRef` ist eine **Referenz**, niemals ein Geheimnis. Der Wert
 * liegt im Vault; diese Flaeche transportiert ihn nicht und speichert ihn
 * nicht. Ein Feld dafuer gibt es im Schema nicht, und `.strict()` weist einen
 * Koerper ab, der eines mitbringt.
 *
 * Die eigentliche Pruefung macht `validateDatabaseWebhook` im Dienst — dasselbe
 * reine Modul, das die Ansicht schon vor dem Absenden anwendet. Dieses Schema
 * ist nur die aeussere Form.
 */
const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  table: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  events: z.array(z.enum(DATABASE_WEBHOOK_EVENTS)).min(1).max(3),
  url: z.string().trim().min(12).max(2048),
  signingSecretRef: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/),
  enabled: z.boolean().optional(),
}).strict();

export function createDatabaseWebhookHandlers(service: DatabaseWebhookService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({ data: await service.list(context.principal, context.scope) });
      } catch (error) { return computeRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.create(context.principal, context.scope, body.data),
        }, 201);
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createDatabaseWebhookHandlers(getDatabaseWebhookService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createDatabaseWebhookHandlers(getDatabaseWebhookService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
