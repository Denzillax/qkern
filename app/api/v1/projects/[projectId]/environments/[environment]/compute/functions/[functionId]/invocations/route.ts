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
 * Das Aufrufprotokoll einer Function — die Produktflaeche der Function-Logs
 * (1.89): Beginn, Dauer, Ausgang, Statuscode oder fester Fehlercode, neueste
 * zuerst. Bewusst ohne stdout/stderr — was der Container gesehen hat, bleibt
 * im Container.
 */
export function createComputeFunctionInvocationHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        const keys = [...request.nextUrl.searchParams.keys()];
        const rawLimit = request.nextUrl.searchParams.get("limit");
        if (keys.some((key) => key !== "limit") || request.nextUrl.searchParams.getAll("limit").length > 1 ||
            (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit))) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        return computeNoStore({
          data: await service.listFunctionInvocations(
            context.principal, context.scope, functionId(context.raw),
            rawLimit === null ? undefined : Number(rawLimit)),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function functionId(raw: { functionId?: string }) {
  if (!raw.functionId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.functionId;
}

export const GET = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeFunctionInvocationHandlers(getComputeDefinitionService()).GET(request, routeContext);
