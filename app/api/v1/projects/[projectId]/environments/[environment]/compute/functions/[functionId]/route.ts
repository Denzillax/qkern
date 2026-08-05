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

/**
 * Nur `enabled` ist änderbar. Bild, Entrypoint, Grenzen und Referenzen bleiben
 * unveränderlich — ein Aufruf darf niemals gegen eine Definition laufen, die
 * sich zwischen Auflösen und Ausführen verändert hat. Migration 0033 gewährt
 * auch nicht mehr.
 */
const patchSchema = z.object({ enabled: z.boolean() }).strict();

export function createComputeFunctionItemHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.getFunction(context.principal, context.scope, functionId(context.raw)),
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
          data: await service.setFunctionEnabled(
            context.principal, context.scope, functionId(context.raw), body.data.enabled,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
    DELETE: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        await service.deleteFunction(context.principal, context.scope, functionId(context.raw));
        return computeNoStore({ data: { deleted: true } });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function functionId(raw: { functionId?: string }) {
  if (!raw.functionId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.functionId;
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionItemHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const PATCH = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionItemHandlers(getComputeDefinitionService()).PATCH(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const DELETE = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionItemHandlers(getComputeDefinitionService()).DELETE(request, context);
  } catch (error) { return computeRouteError(error); }
};
