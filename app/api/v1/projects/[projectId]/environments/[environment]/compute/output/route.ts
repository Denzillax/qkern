import { NextRequest } from "next/server";
import { FUNCTION_INVOCATION_LOG_LIMITS, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * Alle Inhaltslogs einer Umgebung (2.98), neueste zuerst, ohne die Zeilen:
 * je Aufruf die Function, der Beginn, der Ausgang und die Zahlen (Zeilen je
 * Strom, Bytes, abgeschnitten). Die Zeilen selbst holt
 * `compute/invocations/{invocationId}/output`.
 *
 * Diese Route gibt es, weil der Log-Explorer eine Leseroute ueber die ganze
 * Umgebung verlangt, bevor er eine Quelle aufnimmt. Sie hat dieselben drei
 * Parameter wie das Aufrufprotokoll ohne den Ausgang, und wie dort ist jeder
 * unbekannte, doppelte oder unpassende Parameter ein 400 vor dem Dienst.
 */
const KNOWN = new Set(["function", "limit", "offset"]);
const NUMBER = /^\d{1,5}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function createComputeOutputLogHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const parameters = request.nextUrl.searchParams;
        if ([...parameters.keys()].some((key) => !KNOWN.has(key)) ||
            [...KNOWN].some((key) => parameters.getAll(key).length > 1)) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        const rawLimit = parameters.get("limit");
        const rawOffset = parameters.get("offset");
        const rawFunction = parameters.get("function");
        if ((rawLimit !== null && !NUMBER.test(rawLimit)) ||
            (rawOffset !== null && !NUMBER.test(rawOffset)) ||
            (rawFunction !== null && !UUID.test(rawFunction))) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.readFunctionOutputLog(context.principal, context.scope, {
            functionId: rawFunction,
            limit: rawLimit === null ? FUNCTION_INVOCATION_LOG_LIMITS.defaultLimit : Number(rawLimit),
            offset: rawOffset === null ? 0 : Number(rawOffset),
          }),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeOutputLogHandlers(getComputeDefinitionService()).GET(request, routeContext);
