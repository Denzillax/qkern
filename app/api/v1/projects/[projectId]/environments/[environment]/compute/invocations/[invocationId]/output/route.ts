import { NextRequest } from "next/server";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * Die Inhaltslogs eines Aufrufs (2.98): was der Container auf stdout und
 * stderr geschrieben hat, Zeile fuer Zeile mit Zeitpunkt und Strom, unter den
 * Grenzen aus Migration 0069.
 *
 * Nur lesend, nur Admins, kein Parameter: Die Kennung des Aufrufs steht im
 * Pfad, und jede Angabe in der Query ist ein 400, bevor der Dienst gerufen
 * wird. Ein unbekannter Aufruf ist ein 404; ein Aufruf, der nichts
 * geschrieben hat, antwortet mit `output: null`, denn das ist ein Befund
 * ueber den Aufruf und kein Fehlen der Route.
 *
 * Gestrichen wird aus den Zeilen nichts, und die Route sagt es nicht anders:
 * QKERN kennt keinen Wert eines Geheimnisses, den es streichen koennte. Was
 * eine Function selbst ausgibt, gibt diese Route weiter, bis zur Grenze.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function createComputeInvocationOutputHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        const raw = await routeContext.params;
        if (!raw.invocationId || !UUID.test(raw.invocationId)) {
          return computeNoStore({ error: "Resource not found" }, 404);
        }
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.readFunctionInvocationOutput(
            context.principal, context.scope, raw.invocationId,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeInvocationOutputHandlers(getComputeDefinitionService()).GET(request, routeContext);
