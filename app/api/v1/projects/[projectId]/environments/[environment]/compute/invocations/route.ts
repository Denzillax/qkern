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
 * Das Aufrufprotokoll einer ganzen Umgebung (2.51) — die Lesefläche der Seite
 * Logs → Functions.
 *
 * Die Route aus 1.89 steht daneben und bleibt: Sie liest **eine** Function.
 * Diese hier liest alle, mit Seitenschnitt und zwei Filtern, weil eine
 * Logseite nach Ausgang fragt und nicht nach einer Id.
 *
 * Vier Parameter und kein fünfter. Ein unbekannter Name, eine zweite Angabe
 * desselben Parameters oder eine Zahl ausserhalb der Form sind ein 400, und
 * zwar **vor** jedem Dienstaufruf.
 *
 * Was hier nie herauskommt: die Nutzlast eines Aufrufs, die Ausgabe seines
 * Containers, eine Fehlermeldung aus Sandbox oder Datenbank. Das Protokoll
 * hält sie gar nicht — Migration 0045 speichert stdout und stderr bewusst
 * nicht, und im Fehlerfall steht dort ein fester Code, nie ein Text.
 */
const OUTCOMES = new Set(["completed", "failed"]);
const KNOWN = new Set(["function", "outcome", "limit", "offset"]);
const NUMBER = /^\d{1,5}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function createComputeInvocationLogHandlers(service: ComputeDefinitionService) {
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
        const rawOutcome = parameters.get("outcome");
        if ((rawLimit !== null && !NUMBER.test(rawLimit)) ||
            (rawOffset !== null && !NUMBER.test(rawOffset)) ||
            (rawFunction !== null && !UUID.test(rawFunction)) ||
            (rawOutcome !== null && !OUTCOMES.has(rawOutcome))) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.readFunctionInvocationLog(context.principal, context.scope, {
            functionId: rawFunction,
            outcome: rawOutcome,
            limit: rawLimit === null ? FUNCTION_INVOCATION_LOG_LIMITS.defaultLimit : Number(rawLimit),
            offset: rawOffset === null ? 0 : Number(rawOffset),
          }),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeInvocationLogHandlers(getComputeDefinitionService()).GET(request, routeContext);
