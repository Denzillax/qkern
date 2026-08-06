import { NextRequest } from "next/server";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import {
  computeNoStore,
  computeRouteError,
  functionInvocationContext,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import {
  functionInvocationStatus,
  type FunctionInvocationService,
} from "@/lib/server/compute/function-invocation";
import { getFunctionInvocationService } from "@/lib/server/compute/definitions-runtime";
import { safeJson } from "@/lib/server/auth/http";

/**
 * Führt eine Function aus.
 *
 * Bis Release 1.22 gab es die Sandbox, aber keinen Weg zu ihr. Dieser Endpunkt
 * ist der Weg.
 *
 * Bewusst **ohne** CORS-Freigabe: Aufrufen darf ein Service-Projektschlüssel
 * oder eine Administratorsitzung, nicht ein Browser einer fremden Herkunft. Die
 * Antwort der Function wird nicht durchgereicht, sondern auf ihre geprüfte Form
 * reduziert — Statuscode, begrenzte Header und begrenztes JSON.
 */
export function createFunctionInvocationHandler(service: FunctionInvocationService) {
  return async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
    let context;
    try {
      context = await functionInvocationContext(request, routeContext);
    } catch (error) { return computeRouteError(error); }

    const name = context.raw.name;
    if (!name) return computeRouteError(new ComputeDefinitionError("COMPUTE_NOT_FOUND"));

    try {
      const result = await service.invoke(
        context.principal, context.scope, name, (await safeJson(request)) as never,
      );
      return computeNoStore({ data: result });
    } catch (error) {
      const status = functionInvocationStatus(error);
      if (status === 404) return computeNoStore({ error: "Resource not found" }, 404);
      if (status === 429) {
        return computeNoStore({ error: "The function is at its concurrency limit" }, 429);
      }
      // Der Fehler kann eine Container- oder Datenbankmeldung tragen und
      // gehoert nicht in die Antwort.
      return computeNoStore({ error: "The function could not be executed" }, status);
    }
  };
}

export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createFunctionInvocationHandler(getFunctionInvocationService())(request, context);
  } catch (error) { return computeRouteError(error); }
};
