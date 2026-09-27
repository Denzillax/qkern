import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { DASHBOARD_EVENT_KINDS } from "@/lib/console/dashboard-webhooks";
import type { DashboardWebhookService } from "@/lib/server/compute/dashboard-webhooks";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getDashboardWebhookService } from "@/lib/server/compute/definitions-runtime";

/**
 * Dashboard-Webhooks (2.75), ein Geschwister der Log-Drain-Route.
 *
 * `signingSecretRef` ist eine **Referenz**, niemals ein Geheimnis. Der Wert
 * liegt im Vault; diese Flaeche transportiert ihn nicht und speichert ihn nicht.
 * Ein Feld dafuer gibt es im Schema nicht, und `.strict()` weist einen Koerper
 * ab, der eines mitbringt.
 *
 * Es gibt ebenso **kein** Feld fuer eine Feldauswahl, einen Filter oder eine
 * Nutzlast. Was eine Meldung traegt, entscheidet die Projektion der Console,
 * nicht der Aufrufer; waere es hier waehlbar, waere die Grenze verhandelbar.
 *
 * Die eigentliche Pruefung macht `validateDashboardWebhook` im Dienst --
 * dasselbe reine Modul, das die Ansicht schon vor dem Absenden anwendet. Dieses
 * Schema ist nur die aeussere Form.
 */
const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  url: z.string().trim().min(12).max(2048),
  kinds: z.array(z.enum(DASHBOARD_EVENT_KINDS)).min(1).max(DASHBOARD_EVENT_KINDS.length),
  signingSecretRef: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/),
  enabled: z.boolean().optional(),
}).strict();

export function createDashboardWebhookHandlers(service: DashboardWebhookService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        // Die Kopplungen und der Stand des Sammlers: wann jeder Webhook zuletzt
        // gemeldet hat und bis zu welcher Position. Eine leere Liste heisst
        // "noch nie", und die Ansicht sagt das auch so.
        const [data, notifications] = await Promise.all([
          service.list(context.principal, context.scope),
          service.collectorState(context.principal, context.scope),
        ]);
        return computeNoStore({ data, notifications });
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
    return await createDashboardWebhookHandlers(getDashboardWebhookService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createDashboardWebhookHandlers(getDashboardWebhookService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
