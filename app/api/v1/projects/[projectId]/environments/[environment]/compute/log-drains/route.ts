import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { LOG_DRAIN_SOURCES } from "@/lib/console/log-drains";
import type { LogDrainService } from "@/lib/server/compute/log-drains";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getLogDrainService } from "@/lib/server/compute/definitions-runtime";

/**
 * Log-Drains (2.54), ein Geschwister der Datenbank-Webhook-Route.
 *
 * `signingSecretRef` ist eine **Referenz**, niemals ein Geheimnis. Der Wert
 * liegt im Vault; diese Flaeche transportiert ihn nicht und speichert ihn nicht.
 * Ein Feld dafuer gibt es im Schema nicht, und `.strict()` weist einen Koerper
 * ab, der eines mitbringt.
 *
 * Es gibt ebenso **kein** Feld fuer eine Feldauswahl, einen Filter oder eine
 * Nutzlast. Was ein Drain traegt, entscheidet die Projektion der Console, nicht
 * der Aufrufer; waere es hier waehlbar, waere die Grenze verhandelbar.
 *
 * Die eigentliche Pruefung macht `validateLogDrain` im Dienst -- dasselbe reine
 * Modul, das die Ansicht schon vor dem Absenden anwendet. Dieses Schema ist nur
 * die aeussere Form.
 */
const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  url: z.string().trim().min(12).max(2048),
  sources: z.array(z.enum(LOG_DRAIN_SOURCES)).min(1).max(LOG_DRAIN_SOURCES.length),
  signingSecretRef: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/),
  enabled: z.boolean().optional(),
}).strict();

export function createLogDrainHandlers(service: LogDrainService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        // Die Drains und, seit 2.64, der Stand des Sammlers: wann jeder Drain
        // zuletzt weitergeleitet hat und bis zu welcher Position. Eine leere
        // Liste heisst "noch nie", und die Ansicht sagt das auch so.
        const [data, forwards] = await Promise.all([
          service.list(context.principal, context.scope),
          service.collectorState(context.principal, context.scope),
        ]);
        return computeNoStore({ data, forwards });
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
    return await createLogDrainHandlers(getLogDrainService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createLogDrainHandlers(getLogDrainService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
